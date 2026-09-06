import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';

import { CrudService } from '../../core/api.service';
import { Liquidacion, ModoTransporte, Monto } from '../../core/models';
import { EnlaceSoporte, SoporteArchivo, SoportesLista } from '../../shared/soportes.model';

export interface GenerarLiquidacionesPayload {
  periodo_inicio: string; // ISO 'YYYY-MM-DD'
  periodo_fin: string; // ISO 'YYYY-MM-DD'
  tipo: 'proveedor' | 'transportador' | 'ambos';
  proveedor_id?: string | null;
}

/**
 * UN TERCERO AL QUE LA CORRIDA NO LE GENERÓ LIQUIDACIÓN, y por qué.
 * Es el `LiquidacionOmitida` del backend.
 *
 * Hay dos motivos hoy: el PERÍODO CRUZADO —el servidor no deja nacer una liquidación
 * montada sobre otra del mismo tercero, porque encimadas dejan sin cobrar lo que quedó
 * debiendo en la primera— y el FLETE SIN TARIFA, que saldría en $0. Antes cualquiera de
 * los dos tumbaba la corrida entera y dejaba sin comprobante a los que no tenían nada que
 * ver; hoy el servidor SALTA a ese tercero y sigue con los demás.
 *
 * Y POR ESO ESTA LISTA TIENE QUE VERSE. Si se salta a alguien en silencio, el dueño
 * cree que ya liquidó a todos, cierra la quincena, y el proveedor le reclama después su
 * leche sin comprobante: es plata que quedó sin liquidar, no un detalle de la corrida.
 */
export interface OmitidoAlGenerar {
  /** El valor técnico ('proveedor' / 'transportador'). Acá solo es respaldo de `cuenta`. */
  tipo: 'proveedor' | 'transportador' | null;
  /**
   * 'leche' o 'flete': cuál de las dos cuentas del tercero se quedó sin comprobante.
   *
   * Lo manda el servidor ya en las palabras del dueño —el mismo par con que el candado de
   * Recepción diaria nombra las dos liquidaciones— y por eso no se deriva del `tipo` acá:
   * si la pantalla lo tradujera por su cuenta, el día que el backend agregue una tercera
   * cuenta esta diría cualquier cosa.
   */
  cuenta: string | null;
  tercero_id: string | null;
  /** El nombre con que el dueño lo conoce: "Henri C". Es lo primero que busca. */
  tercero_nombre: string | null;
  /**
   * EL MOTIVO TAL COMO LO ESCRIBE EL SERVIDOR, sin reescribirlo acá.
   *
   * Viene redactado y completo, con nombres, cifras y fechas, y con la salida que tiene el
   * dueño: el del cruce nombra la otra liquidación y su período y dice las dos salidas
   * (ajustar las fechas, o anular esa liquidación si se va a rehacer); el del flete dice
   * cuántos litros quedaron esperando y que hay que ponerle la tarifa. Es el mismo texto
   * que antes salía como error. Traducirlo en la pantalla sería tener dos versiones del
   * mismo motivo, y la de acá quedaría vieja el día que el servidor agregue otra razón.
   */
  motivo: string | null;
}

/** Resultado completo de la corrida: lo que se generó Y a quién no se le generó. */
export interface ResultadoGenerar {
  generadas: Liquidacion[];
  omitidos: OmitidoAlGenerar[];
  /**
   * EL SERVIDOR RESPONDIÓ EL SOBRE CON LAS DOS PARTES, PERO LA LISTA DE OMITIDOS NO
   * APARECIÓ CON NINGUNO DE LOS NOMBRES CONOCIDOS.
   *
   * Existe porque el silencio es el peor final posible de esta pantalla: si el campo se
   * llamara distinto, la lista saldría vacía, el dueño leería "se generaron 5" y cerraría
   * la quincena creyendo que liquidó a todos. Con esto no se puede decir "no quedó nadie
   * afuera" —no se sabe— y la pantalla lo dice en voz alta.
   *
   * Falso con la forma VIEJA (el arreglo pelado de liquidaciones): ahí no había lista que
   * buscar, porque un cruce tumbaba la corrida entera con un error.
   */
  omitidosSinLeer: boolean;
}

/**
 * Los nombres con que la respuesta puede traer las liquidaciones creadas y los saltados.
 *
 * El PRIMERO de cada lista es el del contrato de hoy (`GenerarLiquidacionesResultado` del
 * backend: `generadas` y `omitidas`). Los demás son tolerancia, y no sobran: si el nombre
 * no coincidiera, la lista saldría vacía y la pantalla se quedaría muda sobre plata sin
 * liquidar. Cuando ninguno coincide, eso se marca y se dice en voz alta (ver
 * `omitidosSinLeer`), que es lo único honesto. La forma de cada elemento se normaliza
 * aparte, en `omitidoDeCrudo`.
 */
const CLAVES_GENERADAS = ['generadas', 'liquidaciones', 'creadas', 'items'] as const;
const CLAVES_OMITIDOS = ['omitidas', 'omitidos', 'saltados', 'no_generadas'] as const;

function primeraLista(cuerpo: Record<string, unknown>, claves: readonly string[]): unknown[] {
  for (const clave of claves) {
    const valor = cuerpo[clave];
    if (Array.isArray(valor)) return valor;
  }
  return [];
}

function textoDe(fila: Record<string, unknown>, claves: readonly string[]): string | null {
  for (const clave of claves) {
    const valor = fila[clave];
    if (typeof valor === 'string' && valor.trim()) return valor.trim();
  }
  return null;
}

/** Un omitido con los campos puestos donde la pantalla los busca. */
function omitidoDeCrudo(crudo: unknown): OmitidoAlGenerar {
  const fila = (crudo ?? {}) as Record<string, unknown>;
  const tipo = textoDe(fila, ['tipo']);
  return {
    tipo: tipo === 'proveedor' || tipo === 'transportador' ? tipo : null,
    cuenta: textoDe(fila, ['cuenta']),
    tercero_id: textoDe(fila, ['tercero_id', 'proveedor_id', 'transportador_id', 'id']),
    tercero_nombre: textoDe(fila, [
      'tercero_nombre',
      'proveedor_nombre',
      'transportador_nombre',
      'nombre',
    ]),
    motivo: textoDe(fila, ['motivo', 'razon', 'detalle', 'mensaje', 'error']),
  };
}

/**
 * Acomoda la respuesta de "Generar" venga como venga.
 *
 * El contrato de hoy es el sobre con `generadas` y `omitidas`. La tolerancia no es por
 * gusto: este endpoint ACABA de cambiar de forma —antes respondía el arreglo pelado de
 * liquidaciones y un cruce venía como error— y lo que se lee acá no es una pantalla, es
 * plata sin liquidar. Con la forma vieja sigue funcionando, y con una que no se entienda
 * no se calla: se marca en `omitidosSinLeer` y la pantalla lo dice.
 */
export function resultadoGenerarDeCrudo(crudo: unknown): ResultadoGenerar {
  if (Array.isArray(crudo)) {
    return { generadas: crudo as Liquidacion[], omitidos: [], omitidosSinLeer: false };
  }
  if (!crudo || typeof crudo !== 'object') {
    return { generadas: [], omitidos: [], omitidosSinLeer: false };
  }
  const cuerpo = crudo as Record<string, unknown>;
  const clave = CLAVES_OMITIDOS.find((c) => Array.isArray(cuerpo[c]));
  return {
    generadas: primeraLista(cuerpo, CLAVES_GENERADAS) as Liquidacion[],
    omitidos: clave ? (cuerpo[clave] as unknown[]).map(omitidoDeCrudo) : [],
    omitidosSinLeer: clave === undefined,
  };
}

/** Un pago parcial contra una liquidación: los mismos campos que un abono de reventa. */
export interface PagoPayload {
  fecha: string; // ISO 'YYYY-MM-DD'
  valor: number;
  destinatario?: string | null;
  observaciones: string | null;
}

// ------------------- soportes del PAGO (la foto de la transferencia, en R2)
/**
 * Un soporte de UN PAGO de liquidación.
 *
 * SE PEGA AL PAGO, NO A LA LIQUIDACIÓN. Una quincena se puede pagar en tres partes
 * —dos abonos y el saldo—, cada entrega tiene su propia transferencia y su propio
 * comprobante, y colgarlos todos de la liquidación dejaría un montón de fotos sin
 * saber cuál corresponde a cuál entrega.
 *
 * Sirve igual para la liquidación de LECHE y la de FLETE: las dos usan el mismo
 * pago por dentro, así que el dueño le anexa la transferencia al pago de un
 * productor y al de un transportador con la misma pantalla.
 *
 * La forma común está en `shared/soportes.model.ts`, que es la que entiende el
 * diálogo compartido con reventa. Acá solo se agrega de cuál pago cuelga.
 */
export interface AdjuntoPagoLiquidacion extends SoporteArchivo {
  pago_id: string;
}

export interface AdjuntosPagoLista extends SoportesLista {
  adjuntos: AdjuntoPagoLiquidacion[];
}

/** Pre-liquidación: pide cómo va un tercero sin generar ni guardar nada. */
export interface PrevisualizarPayload {
  periodo_inicio: string; // ISO 'YYYY-MM-DD'
  periodo_fin: string; // ISO 'YYYY-MM-DD'
  tipo: 'proveedor' | 'transportador';
  tercero_id: string;
}

export interface PreLiquidacionDetalle {
  fecha: string;
  litros: Monto;
  precio_litro: Monto;
  valor: Monto;
  /**
   * La ruta del renglón en la del transportador: sus renglones son por día Y
   * ruta, así que un día en que hizo dos rutas a tarifas distintas viene partido
   * en dos. Opcionales: la del proveedor no las trae. Ver `LiquidacionDetalle` en
   * core/models.ts, que es la misma idea en el comprobante ya generado.
   */
  ruta_id?: string | null;
  ruta_nombre?: string | null;
  /**
   * La ruta ya está borrada del catálogo. Opcional porque el backend todavía no
   * manda el campo; ver `ruta_borrada` en core/models.ts, es el mismo.
   */
  ruta_borrada?: boolean;
  /**
   * CÓMO SE COBRÓ ESTE RENGLÓN: por litro o por día completo. El mismo campo (y el
   * mismo trato) que en `LiquidacionDetalle` de core/models.ts, porque es la misma
   * tabla: el avance imprime un PDF con los mismos renglones, y ese papel escribe
   * "Día completo" donde no hay tarifa por litro que escribir. Si la pantalla del
   * avance dijera "$ 0,00" donde el papel dice "Día completo", el dueño estaría
   * mandando por WhatsApp un documento que no se parece a lo que él está viendo.
   */
  modo_transporte?: ModoTransporte;
  /**
   * Y si un renglón fijo en $0,00 lo está porque ese día YA SE COBRÓ completo en otro
   * comprobante. El mismo campo (y el mismo trato) que en `LiquidacionDetalle` de
   * core/models.ts: no se deduce de que el valor sea cero, porque un fijo de $0,00 que
   * nunca se cobró también vale cero.
   */
  dia_fijo_ya_cobrado?: boolean;
}

export interface PreLiquidacionAnticipo {
  fecha: string;
  valor: Monto;
  observaciones: string | null;
}

export interface PreLiquidacion {
  tipo: 'proveedor' | 'transportador';
  tercero_id: string;
  tercero_nombre: string;
  tercero_detalle: string | null;
  periodo_inicio: string;
  periodo_fin: string;
  total_litros: Monto;
  precio_promedio: Monto;
  /**
   * El avance trae algún día cobrado POR DÍA COMPLETO, y por eso `precio_promedio` no
   * se puede afirmar (llega en cero a propósito). Ver `tiene_dias_fijos` en
   * core/models.ts: es el mismo campo en el comprobante ya generado. Esta pantalla solo
   * muestra el promedio en el avance del PROVEEDOR —donde no hay días fijos, porque eso
   * es flete— igual que el PDF preliminar.
   */
  tiene_dias_fijos?: boolean;
  valor_bruto: Monto;
  bonificaciones: Monto;
  descuentos: Monto;
  valor_transporte: Monto;
  anticipos: Monto;
  valor_total: Monto;
  /**
   * Lo que el tercero quedó debiendo de quincenas pasadas, YA RESTADO del `saldo`.
   *
   * OPCIONAL, y el servidor NO la manda en el avance: el avance no genera nada ni aparta
   * ninguna deuda, así que no puede prometer un descuento que todavía no tiene dueño (la
   * deuda se cobra en el momento de generar, y ahí se decide cuál liquidación se la cobra).
   * Lo que sí manda es `deuda_pendiente`, que es la misma plata SIN restar. Ver
   * `saldo_anterior` en core/models.ts, que es este mismo campo en el comprobante ya
   * generado, donde sí está restado.
   *
   * El renglón de la pantalla solo sale si la columna CUADRA con él
   * (`saldo_anterior` restado da el `saldo`): un renglón "− $120.000" encima de un saldo
   * que no lo tiene restado descuadra el desglose contra la cifra grande, y el dueño lo
   * suma a mano. Ver `cobraSaldoAnterior` en preliquidacion.dialog.ts.
   */
  saldo_anterior?: Monto;
  /**
   * LO QUE EL TERCERO QUEDÓ DEBIENDO DE QUINCENAS PASADAS Y EL AVANCE TODAVÍA NO RESTA.
   *
   * En positivo, cero cuando no debe nada. Es la cifra con la que el PDF preliminar
   * escribe su aviso, y la pantalla tiene que decir LO MISMO CON LAS MISMAS PALABRAS:
   * el dueño manda el papel mirando la pantalla, y si la pantalla promete "saldo
   * $250.000" mientras el papel avisa que van a salir $130.000 porque el tercero debe
   * $120.000, la discusión con el proveedor la pierde él.
   *
   * OPCIONAL en el tipo aunque el backend ya la manda siempre (cero cuando no debe nada):
   * así una respuesta vieja no deja la pantalla mostrando "$ NaN", y mientras no llegue la
   * pantalla advierte que el saldo estimado puede bajar —no puede prometer que no hay
   * deuda, porque no lo sabe—. Ver `avisoDeLaDeuda` en preliquidacion.dialog.ts.
   */
  deuda_pendiente?: Monto;
  saldo: Monto;
  detalles: PreLiquidacionDetalle[];
  anticipos_detalle: PreLiquidacionAnticipo[];
}

// ------------------------------- corregir una quincena YA PAGADA
// Lo pidió el dueño: "que si soy administrador de empresa pueda editar la liquidación
// que ya está pagada, es que se le olvidó un detalle y tiene que editarla". Y escogió UN
// SOLO COMPROBANTE CORREGIDO (v2) en vez de dos papeles separados, así que todo lo de
// abajo describe UNA operación: el comprobante sube de versión y las cifras quedan con
// su antes y su después escritos.

/** El precio nuevo de UN día que YA está en el comprobante. */
export interface PrecioDeUnDia {
  /** El id del renglón del detalle, que es como el servidor señala el día. */
  detalle_id: string;
  precio_litro: number;
}

/**
 * LO QUE SE MANDA PARA CORREGIR, y va TODO EN UNA SOLA PETICIÓN.
 *
 * Los días que se quedaron sueltos y los precios que estaban mal son una sola operación:
 * partirlas en dos llamadas dejaría el comprobante a medio corregir entre una y otra,
 * con una versión, un papel y un saldo intermedios que nunca existieron.
 *
 * EL MOTIVO ES OBLIGATORIO (el servidor exige 3 caracteres): es lo único que después le
 * explica a alguien por qué el papel que el productor guardó dice otra cifra.
 */
export interface CorregirQuincenaPayload {
  motivo: string;
  /** Los días sueltos que el dueño MARCÓ, uno por uno. Nunca "todo lo que esté suelto". */
  recepciones_a_incluir: string[];
  precios: PrecioDeUnDia[];
}

/**
 * UN DÍA DEL PERÍODO QUE NO ESTÁ EN NINGUNA LIQUIDACIÓN: candidato a entrar.
 *
 * Viene con el valor ya calculado para que la casilla muestre la cifra puesta y el dueño
 * reconozca el día ANTES de marcarlo.
 */
export interface DiaSuelto {
  recepcion_id: string;
  fecha: string;
  litros: Monto;
  precio_litro: Monto;
  valor: Monto;
  /**
   * QUÉ LE VA A PASAR AL FLETE DE ESE DÍA, que es el papel de OTRA persona. Lo escribe
   * el servidor y se muestra tal cual: el dueño que suma a mano va a preguntar por qué
   * ese día no tiene flete, y hay que responderle en el diálogo y no en soporte.
   */
  nota_flete: string | null;
}

/**
 * EL ANTES Y EL DESPUÉS DE LA CORRECCIÓN, SIN QUE SE MUEVA UN PESO.
 *
 * Es la calculadora del dueño puesta en la pantalla. LAS CIFRAS SALEN DE ACÁ Y NO SE
 * CALCULAN EN EL FRONTEND: dos calculadoras terminan diciendo cifras distintas, y la que
 * él tiene al lado es la del papel.
 */
export interface PrevisualizacionCorreccion {
  dias_sueltos: DiaSuelto[];
  valor_total_antes: Monto;
  valor_total_despues: Monto;
  neto_antes: Monto;
  neto_despues: Monto;
  /** Lo que ya se le entregó. La corrección NO lo mueve: ni un pago se toca. */
  pagado: Monto;
  saldo_antes: Monto;
  saldo_despues: Monto;
  estado_antes: string;
  estado_despues: string;
  /**
   * LAS DOS PUNTAS, LAS DOS EN POSITIVO Y EN CAMPOS SEPARADOS. Son dos frases distintas
   * ("queda por entregarle" / "se le pagó de más") y la pantalla no tiene que deducir
   * cuál decir a partir del signo de un saldo.
   */
  queda_por_entregar: Monto;
  se_le_pago_de_mas: Monto;
  version_actual: number;
  /**
   * LO QUE EL SISTEMA SABE Y EL DUEÑO NO, redactado por el servidor: qué pasa con el
   * flete, que el período queda reservado, y cuántas veces se corrigió ya esta quincena.
   * Se muestran TAL CUAL antes de confirmar; traducirlos acá sería tener dos versiones
   * del mismo aviso, y la de la pantalla quedaría vieja el día que el servidor agregue
   * una razón nueva.
   */
  avisos: string[];
}

/** Un día que entró en una corrección, tal como quedó escrito en el renglón. */
export interface DiaAgregadoEnCorreccion {
  fecha: string;
  litros: Monto;
  precio_litro: Monto;
  valor: Monto;
}

/** Un precio que una corrección cambió, con las dos cifras. */
export interface PrecioCorregidoEnCorreccion {
  fecha: string;
  litros: Monto;
  precio_antes: Monto;
  precio_despues: Monto;
  valor_antes: Monto;
  valor_despues: Monto;
}

/**
 * UNA CORRECCIÓN YA HECHA. Es el renglón que hace que esta operación no sirva para tapar
 * plata: quién, cuándo, por qué, y contra qué cifra.
 */
export interface Correccion {
  id: string;
  version_nueva: number;
  motivo: string;
  corregido_por_nombre: string | null;
  created_at: string;
  valor_total_antes: Monto;
  valor_total_despues: Monto;
  neto_antes: Monto;
  neto_despues: Monto;
  pagado_al_momento: Monto;
  saldo_antes: Monto;
  saldo_despues: Monto;
  estado_antes: string;
  estado_despues: string;
  dias_agregados: DiaAgregadoEnCorreccion[];
  precios_corregidos: PrecioCorregidoEnCorreccion[];
}

@Injectable({ providedIn: 'root' })
export class LiquidacionesService extends CrudService<Liquidacion> {
  constructor() {
    super('/liquidaciones');
  }

  /**
   * Genera las liquidaciones del período: devuelve las creadas Y a quién se saltó.
   *
   * La respuesta se normaliza (`resultadoGenerarDeCrudo`) porque la corrida dejó de ser
   * "todo o nada": un tercero con un período cruzado ya no tumba a los demás, se salta
   * y viaja en la lista de omitidos. Quien llama tiene que mostrar las DOS partes —lo
   * generado y lo que quedó sin liquidar—; ver `GenerarQuincenaDialog`.
   */
  generar(payload: GenerarLiquidacionesPayload): Observable<ResultadoGenerar> {
    return this.api
      .post<unknown>(`${this.base}/generar`, payload)
      .pipe(map(resultadoGenerarDeCrudo));
  }

  /**
   * Corrige el precio por litro de UN día de la liquidación.
   *
   * Devuelve la liquidación entera recalculada por el backend —y no solo el día—
   * porque al cambiar el precio también cambian el valor bruto, el promedio, el
   * total y el saldo: pintar solo la fila dejaría el resumen mintiendo.
   *
   * El backend solo lo permite en borrador; la pantalla oculta el campo fuera de
   * ese estado, pero el que dice que no de verdad es el servidor.
   */
  actualizarPrecioDetalle(
    id: string,
    detalleId: string,
    precioLitro: number,
  ): Observable<Liquidacion> {
    return this.api.put<Liquidacion>(`${this.base}/${id}/detalles/${detalleId}`, {
      precio_litro: precioLitro,
    });
  }

  /**
   * Vuelve a cuadrar la liquidación con lo que hay hoy en el sistema.
   *
   * Dos casos, y los dos terminan igual: el comprobante muestra una cifra que ya
   * no corresponde. El primero es el anticipo registrado DESPUÉS de generarla
   * ("Anticipos aplicados $0"); el segundo es la TARIFA del transportador mal
   * tecleada y corregida después en su ficha —los renglones del comprobante son
   * la foto del día en que se generó, así que se quedan con la tarifa vieja—.
   * Volver a "Generar" no arregla ninguno de los dos: las recepciones del período
   * ya están apartadas por esta liquidación.
   *
   * Devuelve la liquidación entera recalculada. Quien la llama compara sus cifras
   * con las que tenía en pantalla para poder decirle al usuario CUÁNTO cambió; la
   * API no manda un "antes" y no le hace falta.
   *
   * Una APROBADA vuelve a borrador: aprobar es un visto bueno sobre unas cifras y
   * si las cifras cambian hay que darlo otra vez (es la misma cuenta que hace el
   * backend cuando se corrige una recepción de una liquidación aprobada). Con
   * plata entregada —pagada, o con un solo abono— el servidor rebota: esa cifra ya
   * está en manos del tercero.
   */
  recalcular(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/recalcular`);
  }

  aprobar(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/aprobar`);
  }

  pagar(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/pagar`);
  }

  /**
   * Registra un pago PARCIAL (abono) contra una liquidación aprobada.
   *
   * Devuelve la liquidación entera —no solo el pago— porque al abonar cambian
   * `pagado`, `saldo`, el estado y el historial a la vez: pintar solo una parte
   * dejaría la pantalla contradiciéndose a la vista.
   *
   * El backend no deja abonar más que el saldo ni pagarle a un borrador.
   */
  registrarPago(id: string, payload: PagoPayload): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/pagos`, payload);
  }

  /**
   * Elimina un pago mal registrado: el backend devuelve el saldo y el estado.
   *
   * Se lleva por delante SUS SOPORTES, también el archivo del almacenamiento: la
   * foto de una transferencia que ya no existe no se queda cobrando espacio.
   */
  eliminarPago(id: string, pagoId: string): Observable<Liquidacion> {
    return this.api.delete<Liquidacion>(`${this.base}/${id}/pagos/${pagoId}`);
  }

  // ------------------ soportes del pago (la foto de la transferencia)
  /** Los soportes del pago, con enlaces firmados de corta duración (15 minutos). */
  adjuntosDePago(id: string, pagoId: string): Observable<AdjuntosPagoLista> {
    return this.api.get<AdjuntosPagoLista>(`${this.base}/${id}/pagos/${pagoId}/adjuntos`);
  }

  /**
   * Sube N soportes en UNA sola petición e informa el progreso.
   *
   * Una petición por archivo sería más simple, pero con la señal del campo unas
   * pasarían y otras no, y el dueño quedaría sin saber cuáles de sus fotos
   * alcanzaron a subir. Así es todo o nada, y el backend además valida todos los
   * archivos antes de guardar el primero.
   *
   * La respuesta es la LISTA COMPLETA ya actualizada y con enlaces frescos, así que
   * no hay que volver a pedirla después de subir.
   */
  subirAdjuntosDePago(
    id: string,
    pagoId: string,
    archivos: File[],
  ): Observable<{ progreso: number; cuerpo?: AdjuntosPagoLista }> {
    return this.api.uploadVarios<AdjuntosPagoLista>(
      `${this.base}/${id}/pagos/${pagoId}/adjuntos`,
      archivos,
    );
  }

  /**
   * Enlace largo para mandar UN soporte por fuera. Queda en la auditoría.
   *
   * Va por el id del soporte y sin la liquidación ni el pago en la ruta: es el
   * mismo camino que en reventa, y el backend aísla por empresa con la columna que
   * el propio soporte lleva adentro.
   */
  compartirAdjuntoDePago(adjuntoId: string): Observable<EnlaceSoporte> {
    return this.api.post<EnlaceSoporte>(`${this.base}/adjuntos/${adjuntoId}/compartir`);
  }

  /** Quita el soporte y también el archivo del almacenamiento. */
  eliminarAdjuntoDePago(adjuntoId: string): Observable<void> {
    return this.api.delete(`${this.base}/adjuntos/${adjuntoId}`);
  }

  anular(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/anular`);
  }

  // ------------------------------- corregir una quincena YA PAGADA
  /**
   * CÓMO QUEDARÍA LA QUINCENA CORREGIDA, sin escribir nada.
   *
   * `soloLectura`: usa POST porque las casillas marcadas van en el cuerpo, pero NO GUARDA
   * NADA. Sin la marca, un fallo de red aquí avisaría "revisa en la lista si el registro
   * quedó guardado" sobre una operación que no guardó ni podía guardar, y encima de una
   * quincena PAGADA: es exactamente el aviso que hace que el dueño la corrija dos veces.
   * Es el mismo trato que `previsualizar`.
   *
   * OJO CON EL MOTIVO: el servidor exige el campo (3 caracteres) para poder leer el
   * sobre, pero el avance NO lo usa ni lo guarda —solo mira los días y los precios—. El
   * diálogo manda un texto provisional mientras el dueño no ha escrito el suyo; ver
   * `MOTIVO_PROVISIONAL` en corregir-quincena.dialog.ts.
   */
  previsualizarCorreccion(
    id: string,
    payload: CorregirQuincenaPayload,
  ): Observable<PrevisualizacionCorreccion> {
    return this.api.post<PrevisualizacionCorreccion>(
      `${this.base}/${id}/corregir/previsualizar`,
      payload,
      undefined,
      { soloLectura: true },
    );
  }

  /**
   * CORRIGE LA QUINCENA Y EMITE LA VERSIÓN SIGUIENTE DEL COMPROBANTE.
   *
   * Devuelve la liquidación entera —no solo lo que cambió— porque al corregir se mueven
   * a la vez el valor total, el neto, el saldo, el estado y la versión: pintar solo una
   * parte dejaría la pantalla contradiciéndose a la vista, encima de un papel que el
   * productor ya tiene en la mano.
   *
   * NO borra pagos ni soportes, NO suelta ninguna marca y NO pasa por borrador: si el
   * total sube, la quincena queda en 'parcial' y el saldo se paga por la puerta de
   * siempre; si baja, queda con saldo negativo y la quincena siguiente lo descuenta sola.
   */
  corregir(id: string, payload: CorregirQuincenaPayload): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/corregir`, payload);
  }

  /**
   * Las correcciones hechas a esta quincena, la más reciente de últimas.
   *
   * Va por su propia ruta y no dentro de la liquidación: la relación es diferida en el
   * backend, así que meterla en el esquema dispararía una consulta POR FILA al listar
   * una página, para un dato que en casi todas está vacío. Con `version` la pantalla ya
   * sabe si tiene que pedirlo, y solo lo pide cuando es mayor que 1.
   */
  correcciones(id: string): Observable<Correccion[]> {
    return this.api.get<Correccion[]>(`${this.base}/${id}/correcciones`);
  }

  descargarPdf(id: string): Observable<void> {
    return this.api.download(`${this.base}/${id}/pdf`, 'liquidacion.pdf');
  }

  /** PDF del recibo como Blob (para compartir por WhatsApp, etc.). */
  pdfBlob(id: string): Observable<Blob> {
    return this.api.getBlob(`${this.base}/${id}/pdf`);
  }

  /**
   * Calcula cómo va un tercero en el período, sin generar la liquidación.
   *
   * `soloLectura`: usa POST porque el filtro va en el cuerpo, pero NO GUARDA
   * NADA (el propio diálogo lo dice). Sin la marca, un fallo de red aquí
   * mostraba "revisa en la lista si el registro quedó guardado" y, sin señal,
   * "vuelve a tocar Guardar" en una pantalla que no tiene botón Guardar.
   */
  previsualizar(payload: PrevisualizarPayload): Observable<PreLiquidacion[]> {
    return this.api.post<PreLiquidacion[]>(`${this.base}/previsualizar`, payload, undefined, {
      soloLectura: true,
    });
  }

  /** PDF preliminar (no oficial) de una pre-liquidación, como Blob. Tampoco guarda nada. */
  previsualizarPdfBlob(payload: PrevisualizarPayload): Observable<Blob> {
    return this.api.postBlob(`${this.base}/previsualizar/pdf`, payload, { soloLectura: true });
  }
}
