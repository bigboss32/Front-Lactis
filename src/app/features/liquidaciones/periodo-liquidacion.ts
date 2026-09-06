import { LiquidacionReferencia } from '../../core/models';
import { comoFecha } from '../../shared/date-utils';

/**
 * '2026-06-16' → '16/06/2026'. SUBIÓ A `shared/date-utils` cuando gastos necesitó
 * lo mismo para nombrar el gasto al que se le anexa la factura; se re-exporta desde
 * aquí para no tocar a las tres pantallas que ya la importaban de este archivo.
 */
export { comoFecha };

/**
 * "16/06/2026 al 30/06/2026" — CÓMO SE NOMBRA UNA LIQUIDACIÓN DELANTE DEL DUEÑO.
 *
 * Vive acá, y no en cada pantalla, porque desde que la deuda viaja de una quincena a la
 * siguiente hay TRES sitios que nombran a OTRA liquidación —el detalle ("ya se le cobró
 * en la del…"), la marca de la lista y el comprobante en PDF— y los tres tienen que
 * llamarla igual: si una dijera "2026-06-16" el dueño no podría emparejar los papeles,
 * y esa cifra es plata que se le quita a un proveedor.
 *
 * Se prefiere el `periodo_texto` que arma el backend: es exactamente el que imprime el
 * comprobante. El armado local es solo el respaldo por si esa cadena no viniera.
 */
export function periodoDe(
  ref: Pick<LiquidacionReferencia, 'periodo_inicio' | 'periodo_fin'> & { periodo_texto?: string },
): string {
  return ref.periodo_texto || `${comoFecha(ref.periodo_inicio)} al ${comoFecha(ref.periodo_fin)}`;
}
