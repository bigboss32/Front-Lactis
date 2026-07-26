import { HttpContextToken, HttpErrorResponse, HttpRequest } from '@angular/common/http';
import {
  MonoTypeOperatorFunction,
  TimeoutError,
  catchError,
  retry,
  throwError,
  timeout,
  timer,
} from 'rxjs';

/**
 * Fallos de RED convertidos en mensajes que entiende el dueño de la quesera.
 *
 * El problema que resuelve este archivo: cuando la señal se cae, el navegador
 * devuelve un HttpErrorResponse con status 0 y sin cuerpo, así que los ~35
 * `catch` de la aplicación —que todos leen `err.error?.error?.detail`— se
 * quedaban sin detalle y mostraban su texto genérico ("No fue posible
 * guardar"). Ese texto no dice lo único que importa cuando se está registrando
 * plata: SI EL REGISTRO QUEDÓ O NO.
 *
 * La solución es normalizar el error EN EL INTERCEPTOR con la misma forma que
 * usa el backend ({ error: { code, detail } }, ver Back-Lactis
 * app/core/exceptions.py), de modo que todas las pantallas mejoren de golpe sin
 * tocar ni un `catch`.
 *
 * REGLA DE ORO DE LOS TEXTOS: solo se afirma "no se guardó nada" cuando de
 * verdad se puede demostrar. En cualquier otro caso el mensaje manda a revisar
 * la lista, porque un mensaje que afirma el fracaso cuando el registro sí entró
 * hace que el usuario lo repita y quede DOS VECES.
 */

/**
 * Para qué era la petición. Cambia el mensaje porque lo que el usuario necesita
 * saber es distinto en cada caso:
 *  - 'lectura'   (GET/HEAD): no se cargaron los datos; puede reintentar sin miedo.
 *  - 'escritura' (POST/PUT/PATCH/DELETE): ¿se guardó o no? De esto depende que
 *    repita el abono y lo registre dos veces.
 *  - 'sesion'    (login, refresh, recuperar/restablecer contraseña): no hay nada
 *    "guardado" de qué hablar, así que no se menciona.
 */
export type IntencionPeticion = 'lectura' | 'escritura' | 'sesion';

/**
 * Marca una petición que usa POST pero NO GUARDA NADA.
 *
 * El verbo HTTP no alcanza para deducir la intención: la pre-liquidación
 * (`POST /liquidaciones/previsualizar`) es una CONSULTA que necesita cuerpo, y
 * su propio diálogo dice "No genera ni guarda nada; es solo para consultar".
 * Sin esta marca, un tiempo agotado ahí mostraba "Antes de volver a guardar,
 * revisa en la lista si el registro quedó guardado" en una pantalla que ni
 * siquiera tiene botón Guardar.
 *
 * Se usa un HttpContext y no una cabecera a propósito: el contexto es
 * información local de Angular que NUNCA viaja por la red, así que no hay que
 * acordarse de borrarla antes de enviar (una cabecera interna que se escapara
 * al servidor sería, además, una filtración silenciosa de cómo funciona la app).
 */
export const SOLO_LECTURA = new HttpContextToken<boolean>(() => false);

/**
 * Tiempo máximo que esperamos una respuesta de NUESTRA API.
 *
 * Son 30 segundos y no 10 a propósito: el backend está en Render con plan
 * gratuito y, tras un rato sin uso, la primera petición arranca el servicio en
 * frío y puede tardar hasta ~60 s. Con 10 s mataríamos peticiones buenas y el
 * usuario vería un error donde en realidad solo había que esperar. Con 30 s
 * cubrimos buena parte del arranque en frío y, aun así, ponemos un techo: sin
 * timeout (como estaba antes) una petición con mala señal se queda colgada
 * minutos, y para el usuario eso es indistinguible de un cuelgue.
 */
export const MS_TIEMPO_LIMITE = 30_000;

/**
 * Techo para las peticiones que mueven ARCHIVOS (subir un adjunto, bajar un PDF).
 *
 * Por qué no se les aplica el tope normal: una foto de recibo pesa 3-12 MB y la
 * finca sube a ~100-500 kbps, o sea MINUTOS. Con 30 s el adjunto fallaba
 * siempre, y encima con el mensaje de plata ("revisa si el registro quedó
 * guardado") cuando el gasto ya estaba guardado y lo único que falló fue la foto.
 *
 * Se eligió un límite mucho mayor en vez de quitar el techo del todo porque una
 * subida sin techo alguno se queda colgada para siempre si la señal muere en
 * mitad del envío, y eso el usuario no lo distingue de un cuelgue de la app.
 * Además, la subida se hace con `reportProgress` (ver ApiService.upload): cada
 * evento de progreso reinicia el reloj del operador `timeout` de rxjs, así que
 * estos 120 s significan "la subida lleva dos minutos CONGELADA", no "la subida
 * es grande".
 */
export const MS_TIEMPO_LIMITE_LARGO = 120_000;

/**
 * Esperas (crecientes) antes de cada reintento de una LECTURA. La longitud del
 * arreglo es el número de intentos extra: 2.
 */
export const ESPERAS_REINTENTO_MS = [500, 1_000];

/**
 * Qué le pasó a la petición, en los únicos términos que le cambian la vida al
 * usuario:
 *  - 'sinConexion'     : el celular no tenía red; la petición NUNCA salió.
 *  - 'conexionPerdida' : status 0 estando en línea; AMBIGUO, pudo llegar.
 *  - 'tiempoAgotado'   : nadie respondió a tiempo; AMBIGUO, pudo llegar.
 *  - 'errorServidor'   : 5xx; AMBIGUO, el 502 de una pasarela puede llegar
 *                        después de que el backend ya hizo commit.
 */
type CasoDeRed = 'sinConexion' | 'conexionPerdida' | 'tiempoAgotado' | 'errorServidor';

interface MensajeDeRed {
  /**
   * Código que viaja en el sobre { error: { code, detail } }. Las pantallas lo
   * miran para saber si el resultado fue INCIERTO y, en ese caso, dejar el
   * aviso mucho más tiempo (ver shared/errores-ui.ts).
   */
  code: string;
  detail: string;
}

/** Cola común de los mensajes ambiguos de escritura: siempre la misma orden. */
const REVISA_LA_LISTA =
  'Revisa en la lista si el registro quedó guardado antes de volver a guardar.';

const MENSAJES: Record<IntencionPeticion, Record<CasoDeRed, MensajeDeRed>> = {
  lectura: {
    sinConexion: {
      code: 'sin_conexion',
      detail: 'Sin conexión: no se pudieron cargar los datos. Revisa la señal y vuelve a intentar.',
    },
    conexionPerdida: {
      code: 'sin_conexion',
      detail:
        'Se perdió la conexión: no se pudieron cargar los datos. Revisa la señal y vuelve a intentar.',
    },
    tiempoAgotado: {
      code: 'tiempo_agotado',
      detail: 'El servidor tardó demasiado en responder. Revisa la señal y vuelve a intentar.',
    },
    // Una lectura fallida no arriesga plata: basta con decir que no se cargó.
    errorServidor: {
      code: 'error_servidor',
      detail:
        'El servidor respondió con un error: no se pudieron cargar los datos. Vuelve a intentar en unos segundos.',
    },
  },
  escritura: {
    // Única afirmación absoluta de todo el archivo, y solo se usa cuando
    // `navigator.onLine === false` demuestra que la petición ni salió del celular.
    sinConexion: {
      code: 'sin_conexion',
      detail: 'Sin conexión: NO se guardó nada. Revisa la señal y vuelve a tocar Guardar.',
    },
    // Status 0 ESTANDO EN LÍNEA. Angular pone status 0 en cualquier evento
    // 'error' del XHR (`status: xhr.status || 0`), incluido el corte de señal
    // DESPUÉS de que el cuerpo salió completo, el salto WiFi->LTE
    // (ERR_NETWORK_CHANGED) y el bloqueo por CORS. En el borde de cobertura el
    // POST del abono sale entero, el backend hace commit y la señal cae antes
    // de que vuelva la respuesta: decir aquí "NO se guardó nada" sería mentira
    // y llevaría al abono duplicado.
    conexionPerdida: {
      code: 'resultado_incierto',
      detail: `Se perdió la conexión. ${REVISA_LA_LISTA}`,
    },
    // Ojo con la honestidad: en un tiempo agotado la petición SÍ pudo llegar al
    // servidor y guardarse; lo que se perdió fue la respuesta. Decirle aquí "no
    // se guardó nada" sería mentirle y lo llevaría a duplicar el registro, que
    // es justo lo que queremos evitar.
    tiempoAgotado: {
      code: 'tiempo_agotado',
      detail:
        'El servidor tardó demasiado en responder. Antes de volver a guardar, revisa en la ' +
        'lista si el registro quedó guardado.',
    },
    // 5xx: Render devuelve 502/503 (y una página HTML, sin el sobre del backend)
    // mientras la instancia despierta, y esa respuesta puede llegar DESPUÉS del
    // commit. Mismo riesgo de duplicado que el 504.
    errorServidor: {
      code: 'resultado_incierto',
      detail: `El servidor respondió con un error. ${REVISA_LA_LISTA}`,
    },
  },
  sesion: {
    sinConexion: {
      code: 'sin_conexion',
      detail: 'Sin conexión: no se pudo contactar el servidor. Revisa la señal y vuelve a intentar.',
    },
    conexionPerdida: {
      code: 'sin_conexion',
      detail: 'Se perdió la conexión con el servidor. Revisa la señal y vuelve a intentar.',
    },
    tiempoAgotado: {
      code: 'tiempo_agotado',
      detail: 'El servidor tardó demasiado en responder. Espera unos segundos y vuelve a intentar.',
    },
    errorServidor: {
      code: 'error_servidor',
      detail: 'El servidor respondió con un error. Espera unos segundos y vuelve a intentar.',
    },
  },
};

/** Todos los códigos que pone ESTE archivo; sirven para no normalizar dos veces. */
const CODIGOS_DE_RED = new Set([
  'sin_conexion',
  'tiempo_agotado',
  'resultado_incierto',
  'error_servidor',
]);

/**
 * Deduce la intención de la petición.
 *
 * El método HTTP manda, salvo dos excepciones: las rutas de sesión y los POST
 * marcados como consulta (`SOLO_LECTURA`, o cualquier petición que espere un
 * binario), que no guardan nada aunque usen POST.
 */
export function intencionDePeticion(
  metodo: string,
  esRutaDeSesion = false,
  esSoloLectura = false,
): IntencionPeticion {
  if (esRutaDeSesion) return 'sesion';
  if (esSoloLectura) return 'lectura';
  const m = (metodo ?? '').toUpperCase();
  return m === 'GET' || m === 'HEAD' ? 'lectura' : 'escritura';
}

/**
 * ¿Esta petición consulta en vez de guardar?
 *
 * Dos vías: la marca explícita del servicio (`SOLO_LECTURA`) y el hecho de
 * esperar un binario. Un `responseType: 'blob'` en esta app siempre es un
 * PDF/Excel que se genera al vuelo para verlo o compartirlo; no crea registros.
 */
export function esPeticionDeSoloLectura(req: HttpRequest<unknown>): boolean {
  return req.context.get(SOLO_LECTURA) || req.responseType === 'blob';
}

/**
 * Cuánto tiempo se le da a ESTA petición.
 *
 * Las que mueven archivos (cuerpo FormData al subir, respuesta binaria al
 * bajar) van con el techo largo; el resto, con los 30 s de siempre.
 */
export function limiteDeTiempo(req: HttpRequest<unknown>): number {
  const mueveArchivos = req.body instanceof FormData || req.responseType === 'blob';
  return mueveArchivos ? MS_TIEMPO_LIMITE_LARGO : MS_TIEMPO_LIMITE;
}

/**
 * ¿El error ya lo tradujimos nosotros?
 *
 * Hace falta porque el fallo del /auth/refresh se normaliza dentro del
 * interceptor (con intención 'sesion') y después vuelve a pasar por el
 * normalizador final de la petición original: sin esta guarda, un tiempo
 * agotado del refresh acabaría con el texto de escritura ("revisa si quedó
 * guardado") de una petición que ni siquiera se llegó a repetir.
 */
function yaNormalizado(error: unknown): boolean {
  const code = (error as HttpErrorResponse | null)?.error?.error?.code;
  return typeof code === 'string' && CODIGOS_DE_RED.has(code);
}

/**
 * ¿El dispositivo estaba SIN RED cuando falló la petición?
 *
 * `navigator.onLine === false` es la única señal fiable de que la petición
 * nunca salió del celular: el sistema operativo dice que no hay ninguna
 * interfaz de red activa, así que el XHR no pudo ni abrir el socket. Solo con
 * eso es defendible afirmar "NO se guardó nada".
 *
 * Lo que NO garantiza es lo contrario: `onLine === true` significa únicamente
 * que hay una interfaz de red conectada (el WiFi de la finca puede estar
 * enlazado y sin internet, o la señal puede haberse caído justo después de
 * mandar el cuerpo). Por eso solo se usa el caso `false`, que es el único que
 * demuestra algo; el `true` deja el resultado como AMBIGUO.
 */
function estabaSinRed(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Sin respuesta HTTP: señal caída, DNS que no resuelve, CORS abajo, cambio de red. */
function esStatusCero(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 0;
}

/**
 * Lo cortamos nosotros: se cumplió el plazo del operador `timeout` de rxjs.
 * También se reconoce el aborto por tiempo del propio navegador (DOMException
 * 'TimeoutError', que es lo que produce la opción `timeout` de HttpRequest) para
 * que nunca se confunda con un "no llegó a salir".
 */
function esTimeoutPropio(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if ((error as { name?: string } | null)?.name === 'TimeoutError') return true;
  return error instanceof HttpErrorResponse && error.error?.name === 'TimeoutError';
}

/**
 * Se agotó el tiempo: o lo cortamos nosotros o lo cortó una pasarela
 * intermedia (504). En los dos casos el servidor pudo haber recibido la petición.
 */
function esTiempoAgotado(error: unknown): boolean {
  return esTimeoutPropio(error) || (error instanceof HttpErrorResponse && error.status === 504);
}

/**
 * Rango de errores del servidor. Vive en una sola función porque lo consultan
 * dos decisiones que TIENEN que coincidir: si vale la pena reintentar y qué
 * mensaje mostrar. Cuando estaban separadas, `esReintentable` reintentaba todo
 * el 5xx pero el traductor solo conocía el 504, y un 502 de Render llegaba a la
 * pantalla sin traducir.
 */
function esRangoDeServidor(status: number): boolean {
  return status >= 500 && status <= 599;
}

/**
 * ¿Vale la pena repetir la petición?
 *
 * Solo por fallo de red (status 0) o por error del servidor (5xx, incluido el
 * 502/503 de Render mientras despierta). Un 4xx —validación, permisos, no
 * encontrado— no se arregla repitiéndolo: devuelve exactamente el mismo error.
 *
 * La excepción es NUESTRO propio timeout: aunque sea un fallo "de red", cada
 * intento cuesta 30 s, así que dos reintentos dejarían al usuario mirando el
 * spinner hasta 90 s. Es peor que darle a los 30 s un mensaje claro y que él
 * decida. Un 504 sí se reintenta (es una respuesta del servidor, llega sola y no
 * cuesta esos 30 s).
 */
export function esReintentable(error: unknown): boolean {
  if (esTimeoutPropio(error)) return false;
  if (!(error instanceof HttpErrorResponse)) return false;
  return error.status === 0 || esRangoDeServidor(error.status);
}

/**
 * Convierte un fallo de red en un HttpErrorResponse con la MISMA forma que los
 * errores del backend ({ error: { code, detail } }). Si el error no es de red lo
 * devuelve tal cual, para no pisar el detalle que ya trae el backend.
 */
export function normalizarErrorDeRed(
  error: unknown,
  intencion: IntencionPeticion,
  url?: string,
): unknown {
  // Ya traducido (viene del refresh, por ejemplo): no se toca dos veces.
  if (yaNormalizado(error)) return error;

  // Primero el tiempo agotado: un aborto por tiempo del navegador también llega
  // con status 0 y no queremos tratarlo como "no salió de aquí".
  let caso: CasoDeRed | null = null;
  if (esTiempoAgotado(error)) {
    caso = 'tiempoAgotado';
  } else if (esStatusCero(error)) {
    caso = estabaSinRed() ? 'sinConexion' : 'conexionPerdida';
  } else if (error instanceof HttpErrorResponse && esRangoDeServidor(error.status)) {
    caso = 'errorServidor';
  }
  if (!caso) return error;

  const original = error instanceof HttpErrorResponse ? error : null;
  const mensaje = MENSAJES[intencion][caso];
  return new HttpErrorResponse({
    error: { error: { code: mensaje.code, detail: mensaje.detail } },
    // Se conserva el status original (0 sin red, 502/503/504 de la pasarela)
    // para no romper las pantallas que ya lo miran. Un timeout nuestro no tiene
    // respuesta HTTP, así que queda en 0.
    status: original?.status ?? 0,
    statusText: original?.statusText ?? 'Tiempo de espera agotado',
    url: original?.url ?? url ?? undefined,
  });
}

/**
 * Pone techo de tiempo a un intento HTTP y, SOLO si es una lectura, lo reintenta
 * con espera creciente.
 *
 * NO SE REINTENTAN LAS ESCRITURAS, y esto no es un olvido: si un POST de abono
 * llegó al servidor y lo que se perdió fue la respuesta, repetirlo registra el
 * abono DOS VECES. Con plata de por medio preferimos preguntarle al usuario
 * antes que "arreglarlo" solos. Las peticiones de sesión tampoco se reintentan
 * (el refresh rota el token: repetirlo invalidaría la sesión).
 *
 * `ms` permite subirle el techo a las peticiones con archivos (ver
 * `limiteDeTiempo`). Como `timeout` de rxjs reinicia su reloj en CADA emisión,
 * en una subida con `reportProgress` el plazo se mide entre dos eventos de
 * progreso, no sobre la subida entera.
 */
export function conTiempoLimite<T>(
  intencion: IntencionPeticion,
  ms: number = MS_TIEMPO_LIMITE,
): MonoTypeOperatorFunction<T> {
  return (fuente) =>
    fuente.pipe(
      timeout(ms),
      retry({
        // count 0 => `retry` es la identidad: cero riesgo para escrituras.
        count: intencion === 'lectura' ? ESPERAS_REINTENTO_MS.length : 0,
        delay: (error, intento) => {
          if (!esReintentable(error)) return throwError(() => error);
          return timer(ESPERAS_REINTENTO_MS[intento - 1] ?? 1_000);
        },
      }),
    );
}

/** Traduce el fallo de red al mensaje que verán los `catch` de las pantallas. */
export function normalizarFallosDeRed<T>(
  intencion: IntencionPeticion,
  url?: string,
): MonoTypeOperatorFunction<T> {
  return (fuente) =>
    fuente.pipe(
      catchError((error) => throwError(() => normalizarErrorDeRed(error, intencion, url))),
    );
}
