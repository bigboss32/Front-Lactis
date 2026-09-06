/**
 * Utilidades de fecha para los selectores de calendario (mat-datepicker).
 *
 * El datepicker de Material trabaja con objetos `Date`, pero el backend espera
 * y devuelve las fechas como texto ISO `yyyy-MM-dd`. Estas dos funciones hacen
 * el puente usando SIEMPRE los componentes locales de la fecha, de modo que la
 * fecha nunca "se corre un día" por la zona horaria.
 */

/**
 * '2026-06-16' → '16/06/2026'.
 *
 * Sin pasar por `new Date`: una fecha ISO pelada se interpreta en UTC y en Colombia
 * (UTC-5) se corre UN DÍA hacia atrás. En un período de quincena eso significa mostrar
 * "15/06/2026" en un comprobante que dice 16, que es de las cosas que hacen dudar de
 * todo lo demás que está en la pantalla.
 *
 * VIVÍA EN LIQUIDACIONES y se subió acá cuando gastos necesitó lo mismo para
 * nombrar el gasto al que se le está anexando la factura. Copiarla habría sido
 * abrir la puerta a que una de las dos empezara a mostrar la fecha corrida.
 */
export function comoFecha(iso: string): string {
  return iso.split('-').reverse().join('/');
}

/** Convierte el `Date` de un datepicker a texto `yyyy-MM-dd` (o null si vacío). */
export function dateToIso(value: Date | string): string;
export function dateToIso(value: Date | string | null | undefined): string | null;
export function dateToIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return null;
  const mes = `${date.getMonth() + 1}`.padStart(2, '0');
  const dia = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${mes}-${dia}`;
}

/** Convierte el texto `yyyy-MM-dd` del backend a un `Date` local para el datepicker. */
export function isoToDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  // 'T00:00:00' fuerza medianoche local (sin desfase de zona horaria).
  const date = new Date(`${value}T00:00:00`);
  return isNaN(date.getTime()) ? null : date;
}

/** `Date` de hoy, para valores por defecto de formularios. */
export function hoyDate(): Date {
  return new Date();
}
