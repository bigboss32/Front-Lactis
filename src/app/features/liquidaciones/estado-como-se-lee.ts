import { Liquidacion } from '../../core/models';

/**
 * EL ESTADO DE UNA LIQUIDACIÓN COMO SE PINTA, que no siempre es el que se guarda.
 *
 * Lo pidió el dueño mirando la lista: una quincena en firme en la que el tercero quedó
 * debiendo (se le adelantó más de lo que vale) no tiene nada que entregarse, y decir
 * "aprobada" en el chip se leía como "falta pagarla". El backend manda `estado_visible`
 * = "pagada · quedó debiendo" en ese caso, y la pantalla SOLO LO PINTA: la regla vive en
 * `Liquidacion.estado_visible` del backend —la misma que imprime el PDF—, y deducirla
 * acá otra vez sería darle al chip y al papel la oportunidad de decir cosas distintas.
 *
 * SOLO PARA LO QUE SE MUESTRA. Los botones (Pagar, Anular, Corregir, Recalcular) y los
 * candados siguen leyendo `estado`, que es el que el servidor usa para aceptar o rebotar
 * cada acción. Si un botón mirara esto, se estaría cambiando lo que el dueño PUEDE
 * HACER, no lo que ve. Hay una prueba que lo mide (liquidacion-detail.dialog.spec.ts).
 * Lo que SÍ lo sigue es la REDACCIÓN de un candado, que tiene que decir lo mismo que el
 * chip de al lado (ver `motivoNoRecalcular`): si el candado sale o no, lo decide `estado`.
 *
 * Con `||` y no con `??`, a propósito: una respuesta vieja o cacheada no trae el campo
 * (undefined), y el esquema del backend lo declara con "" por defecto; en los dos casos
 * lo que se pinta es `estado`, y nunca un chip vacío.
 */
export function estadoComoSeLee(liq: Pick<Liquidacion, 'estado' | 'estado_visible'>): string {
  return liq.estado_visible || liq.estado;
}

/**
 * El rótulo que manda el backend (`ESTADO_VISIBLE_PAGADA_DEBIENDO`) para la quincena en
 * firme en la que el tercero quedó debiendo. Acá solo se COMPARA con lo que llegó; nunca
 * se deduce de las cifras.
 */
export const PAGADA_QUEDO_DEBIENDO = 'pagada · quedó debiendo';
