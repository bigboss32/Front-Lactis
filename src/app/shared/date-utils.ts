/**
 * Utilidades de fecha para los selectores de calendario (mat-datepicker).
 *
 * El datepicker de Material trabaja con objetos `Date`, pero el backend espera
 * y devuelve las fechas como texto ISO `yyyy-MM-dd`. Estas dos funciones hacen
 * el puente usando SIEMPRE los componentes locales de la fecha, de modo que la
 * fecha nunca "se corre un día" por la zona horaria.
 */

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
