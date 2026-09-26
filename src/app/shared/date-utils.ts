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

/**
 * Colombia va SIEMPRE cinco horas atrás de UTC: no tiene horario de verano. Por eso el
 * desfase se puede escribir como una constante y no hace falta una librería de zonas.
 */
const MINUTOS_DE_COLOMBIA = -5 * 60;

/**
 * '2026-09-06T02:04:00Z' → '05/09/2026 21:04' — UN INSTANTE COMO LO LEE UNA PERSONA ACÁ.
 *
 * Hace falta porque estas horas TIENEN UN GEMELO EN EL PAPEL: el comprobante en PDF
 * imprime "Corregido el 06/09/2026 16:01" convirtiendo a hora de Colombia
 * (`_en_hora_de_colombia`, en el backend), y el dueño pone el papel al lado de la
 * pantalla. Con el `| date` a secas la hora sale en la zona del computador que esté
 * mirando —un navegador en UTC muestra cinco horas más— y las dos versiones del MISMO
 * hecho se contradicen; peor todavía, pasada la medianoche local se corre EL DÍA y el
 * renglón diría que la quincena se corrigió un día que no fue.
 *
 * Lo que llegue SIN zona escrita se toma como UTC, que es como lo manda el backend
 * cuando la base no guarda la zona. Es el mismo criterio de allá.
 */
export function enHoraDeColombia(instante: string | null | undefined): string {
  const enColombia = aColombia(instante);
  if (!enColombia) return '—';
  return (
    `${fechaDeColombia(enColombia)} ` +
    `${dosDigitos(enColombia.getUTCHours())}:${dosDigitos(enColombia.getUTCMinutes())}`
  );
}

/** El mismo instante, solo la fecha: '05/09/2026'. Para donde la hora estorba. */
export function fechaEnHoraDeColombia(instante: string | null | undefined): string | null {
  const enColombia = aColombia(instante);
  return enColombia ? fechaDeColombia(enColombia) : null;
}

/**
 * Corre el instante a hora de Colombia y lo devuelve como un `Date` que se lee CON LOS
 * GETTERS DE UTC. Suena al revés y es a propósito: `getHours()` leería la zona del
 * computador y volvería a meter el desfase que se acaba de quitar.
 */
function aColombia(instante: string | null | undefined): Date | null {
  if (!instante) return null;
  const texto = String(instante);
  const conZona = /(Z|[+-]\d{2}:?\d{2})$/.test(texto) ? texto : `${texto}Z`;
  const fecha = new Date(conZona);
  if (isNaN(fecha.getTime())) return null;
  return new Date(fecha.getTime() + MINUTOS_DE_COLOMBIA * 60_000);
}

const dosDigitos = (numero: number): string => `${numero}`.padStart(2, '0');

const fechaDeColombia = (enColombia: Date): string =>
  `${dosDigitos(enColombia.getUTCDate())}/${dosDigitos(enColombia.getUTCMonth() + 1)}/` +
  `${enColombia.getUTCFullYear()}`;

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
