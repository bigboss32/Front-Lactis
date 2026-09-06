import { Observable } from 'rxjs';

/**
 * LA FORMA DE UN SOPORTE DE PAGO, la misma en los dos módulos que los tienen.
 *
 * Vive aparte del diálogo (`soportes.dialog.ts`) y no dentro de él por una razón
 * práctica: los servicios de reventa y de liquidaciones necesitan estos tipos, y si
 * los sacaran del archivo del componente arrastrarían el componente entero —con su
 * plantilla y sus estilos— al pedazo de código de cada servicio.
 */

/**
 * Un soporte de pago con su enlace TEMPORAL.
 *
 * `url` no está guardada en ninguna parte: el backend la firma cada vez que se
 * pide la lista y se muere sola a los pocos minutos (`url_expira`). Si la
 * pantalla queda abierta media hora, los enlaces que tiene en memoria ya no
 * sirven y hay que volver a pedir la lista.
 *
 * Es `null` cuando el almacenamiento no está configurado en el servidor: la
 * fila igual se muestra, pero sin poder abrirla.
 */
export interface SoporteArchivo {
  id: string;
  nombre_archivo: string;
  content_type: string;
  tamano_bytes: number;
  es_imagen: boolean;
  subido_por_nombre: string | null;
  created_at: string;
  url: string | null;
  url_expira: string | null;
}

export interface SoportesLista {
  /** false = el servidor no tiene configurado el almacenamiento de imágenes. */
  disponible: boolean;
  mensaje: string | null;
  /** Cuántos soportes más caben (el tope menos los que ya hay). */
  cupo_restante: number;
  adjuntos: SoporteArchivo[];
}

/** Enlace de más duración para mandar UN soporte por fuera (WhatsApp). */
export interface EnlaceSoporte {
  url: string;
  nombre_archivo: string;
  expira: string;
  /** Ya viene en cristiano y en hora de Colombia: "hasta el martes 5 de agosto...". */
  expira_texto: string;
  dias: number;
}

/**
 * LOS TRES PERMISOS DE LA PANTALLA, que NO son el mismo y por eso los pone quien
 * la abre.
 *
 * Reventa y liquidaciones exigen permisos distintos para lo mismo, porque el
 * backend los eligió por coherencia con cada módulo: allá colgar el soporte de una
 * compra pide 'reventa:crear' —que es lo que pide crear la compra— y acá colgarlo
 * de un pago pide 'liquidaciones:administrar' —que es lo que pide registrar el
 * pago—. Si el diálogo los tuviera escritos adentro, uno de los dos lados
 * mostraría un botón que el servidor va a rebotar.
 */
export interface SoportesPermisos {
  subir: string;
  compartir: string;
  eliminar: string;
}

/**
 * DE DÓNDE CUELGAN LOS SOPORTES QUE SE ESTÁN VIENDO: quien abre el diálogo trae
 * las cuatro llamadas y los permisos, y la pantalla no sabe —ni tiene por qué
 * saber— si son los de una compra de queso o los del pago de una quincena.
 */
export interface SoportesOrigen {
  /** El subtítulo, para que se sepa a qué se le está pegando la foto. */
  titulo: string;
  /**
   * Una línea de aclaración debajo del título, cuando hace falta.
   *
   * En las liquidaciones hace mucha falta: los soportes se pegan a UN PAGO y no a
   * la quincena entera, y quien tiene tres pagos en el mismo comprobante necesita
   * leer a cuál de los tres le está anexando la foto de la transferencia.
   */
  ayuda?: string;
  permisos: SoportesPermisos;
  listar(): Observable<SoportesLista>;
  subir(archivos: File[]): Observable<{ progreso: number; cuerpo?: SoportesLista }>;
  compartir(id: string): Observable<EnlaceSoporte>;
  eliminar(id: string): Observable<void>;
}

/**
 * Lo que el diálogo devuelve al cerrarse.
 *
 * `cuantos` va aparte de `cambiado` porque quien abrió esta pantalla casi siempre
 * pinta un clip con el número al lado, y ese número lo tiene el diálogo de primera
 * mano: sin él habría que volver a pedir el documento entero al servidor solo para
 * enterarse de que ahora hay tres fotos en vez de dos.
 */
export interface SoportesResultado {
  cambiado: boolean;
  cuantos: number;
}
