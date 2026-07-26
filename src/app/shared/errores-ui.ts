import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';

/**
 * Cómo se le muestra un error al usuario. Estaba repetido palabra por palabra en
 * media docena de pantallas; aquí vive una sola vez.
 */

/** Detalle que manda el backend, o el texto de respaldo si no vino ninguno. */
export function detalleDeError(err: unknown, respaldo: string): string {
  return err instanceof HttpErrorResponse ? (err.error?.error?.detail ?? respaldo) : respaldo;
}

/**
 * Códigos del interceptor (core/errores-red.ts) en los que NO SE SABE si el
 * registro quedó guardado: la petición pudo llegar al servidor y perderse solo
 * la respuesta.
 *
 * Quedan fuera a propósito 'sin_conexion' (el celular no tenía red, así que la
 * petición no salió: no hay duda que resolver) y 'error_servidor' (que solo se
 * usa en lecturas).
 */
const CODIGOS_INCIERTOS = new Set(['tiempo_agotado', 'resultado_incierto']);

/** ¿El error deja en duda si el registro quedó guardado? */
export function esResultadoIncierto(err: unknown): boolean {
  if (!(err instanceof HttpErrorResponse)) return false;
  const code: unknown = err.error?.error?.code;
  return typeof code === 'string' && CODIGOS_INCIERTOS.has(code);
}

/** Segundos que dura el aviso de un error corriente (validación del backend). */
const MS_AVISO_NORMAL = 5_000;
/**
 * Y los del aviso ambiguo. Es el mensaje más importante del sistema —el que
 * decide si el abono se registra dos veces— y mide ~118 caracteres: con los 5 s
 * de un texto de 33, en un celular al sol y dentro de un diálogo modal, es fácil
 * que no alcance a leerse.
 */
const MS_AVISO_INCIERTO = 15_000;

/**
 * Muestra el error de un GUARDADO.
 *
 * Si el resultado quedó en duda, el aviso dura mucho más y trae "Entendido"
 * para que el usuario lo cierre él cuando lo haya leído, en vez de que se vaya
 * solo mientras busca en la lista. Los errores corrientes se quedan como
 * estaban.
 */
export function avisarErrorAlGuardar(
  snackbar: MatSnackBar,
  err: unknown,
  respaldo: string,
): void {
  const incierto = esResultadoIncierto(err);
  snackbar.open(detalleDeError(err, respaldo), incierto ? 'Entendido' : 'OK', {
    duration: incierto ? MS_AVISO_INCIERTO : MS_AVISO_NORMAL,
  });
}
