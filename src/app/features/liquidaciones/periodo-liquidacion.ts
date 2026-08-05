import { LiquidacionReferencia } from '../../core/models';

/**
 * '2026-06-16' → '16/06/2026'.
 *
 * Sin pasar por `new Date`: una fecha ISO pelada se interpreta en UTC y en Colombia
 * (UTC-5) se corre UN DÍA hacia atrás. En un período de quincena eso significa mostrar
 * "15/06/2026" en un comprobante que dice 16, que es de las cosas que hacen dudar de
 * todo lo demás que está en la pantalla.
 */
export function comoFecha(iso: string): string {
  return iso.split('-').reverse().join('/');
}

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
