import { dateToIso } from './date-utils';

/**
 * LA QUINCENA DE "GENERAR LIQUIDACIONES" Y DEL FILTRO DEL LISTADO, ESCRITA UNA SOLA VEZ.
 *
 * Vivía dentro del diálogo de Generar. Subió acá cuando el listado de liquidaciones
 * necesitó filtrar por quincena con la misma cuenta: si cada una repitiera "la 2.ª va del
 * 16 a fin de mes", el día que una cambiara, el listado filtraría un período distinto del
 * que Generar acaba de liquidar.
 *
 * TODAVÍA TIENEN SU PROPIA CUENTA DE "ESTA QUINCENA" la pre-liquidación, el filtro de
 * Recepción diaria y los botones rápidos de `rango-fechas-rapido.ts`. Dan el mismo
 * resultado, pero migrarlas es otro cambio: ninguna de las tres decide qué se liquida.
 */

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export type NumeroDeQuincena = 1 | 2;

/** Un mes concreto: `mes` va de 0 (enero) a 11 (diciembre), como en `Date`. */
export interface MesDelAnio {
  anio: number;
  mes: number;
}

/** Una quincena concreta de un mes concreto. */
export interface QuincenaDelMes extends MesDelAnio {
  quincena: NumeroDeQuincena;
}

/**
 * Rango ISO de una quincena: 1.ª = día 1 al 15; 2.ª = día 16 a fin de mes.
 *
 * `mes` puede salirse de 0–11 (−1 o 12): `Date` lo lleva al año vecino, y de ahí que la
 * quincena anterior de enero sea la 2.ª de diciembre del año pasado sin un caso aparte.
 */
export function rangoQuincena(
  anio: number,
  mes: number,
  quincena: NumeroDeQuincena,
): { inicio: string; fin: string } {
  if (quincena === 1) {
    return { inicio: dateToIso(new Date(anio, mes, 1)), fin: dateToIso(new Date(anio, mes, 15)) };
  }
  return {
    inicio: dateToIso(new Date(anio, mes, 16)),
    fin: dateToIso(new Date(anio, mes + 1, 0)), // día 0 del mes siguiente = último día del mes
  };
}

/** La quincena en la que cae `fecha` (hoy si no se dice), entera: 1.ª si es del 1 al 15, 2.ª si no. */
export function quincenaDeLaFecha(fecha: Date = new Date()): QuincenaDelMes {
  return {
    anio: fecha.getFullYear(),
    mes: fecha.getMonth(),
    quincena: fecha.getDate() <= 15 ? 1 : 2,
  };
}

/** "1 al 15" o "16 al 28": los días que cubre esa quincena en ese mes. */
export function diasDeLaQuincena(anio: number, mes: number, quincena: NumeroDeQuincena): string {
  const rango = rangoQuincena(anio, mes, quincena);
  return `${Number(rango.inicio.slice(8, 10))} al ${Number(rango.fin.slice(8, 10))}`;
}

/** "septiembre 2026". */
export function etiquetaDelMes({ anio, mes }: MesDelAnio): string {
  return `${MESES[mes]} ${anio}`;
}

/** El mes de al lado: `pasos` = −1 el anterior, +1 el siguiente. Diciembre → enero cambia el año. */
export function mesVecino({ anio, mes }: MesDelAnio, pasos: number): MesDelAnio {
  const corrido = new Date(anio, mes + pasos, 1);
  return { anio: corrido.getFullYear(), mes: corrido.getMonth() };
}

/**
 * ¿Estas dos fechas son, justo, UNA quincena entera (1–15 o 16–fin de mes del mismo mes)?
 * Devuelve cuál, o null si no (rango suelto, medio vacío o de otro tamaño).
 *
 * Compara contra `rangoQuincena` y no contra números sueltos: así un febrero de 28 o de 29
 * días, o un mes de 30 y uno de 31, salen de la misma cuenta que usa el botón al fijarlas.
 */
export function quincenaExacta(
  desde: Date | null | undefined,
  hasta: Date | null | undefined,
): QuincenaDelMes | null {
  const inicio = dateToIso(desde);
  const fin = dateToIso(hasta);
  if (!desde || !inicio || !fin) return null;
  const anio = desde.getFullYear();
  const mes = desde.getMonth();
  for (const quincena of [1, 2] as const) {
    const rango = rangoQuincena(anio, mes, quincena);
    if (rango.inicio === inicio && rango.fin === fin) return { anio, mes, quincena };
  }
  return null;
}
