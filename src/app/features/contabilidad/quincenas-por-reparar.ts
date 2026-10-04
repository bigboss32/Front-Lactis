/**
 * LA NOTA AL LADO DE "Liquidaciones por pagar", en el tablero y en el balance: una sola
 * redacción para las dos pantallas, que cuentan la misma cifra.
 *
 * Esa cifra deja por fuera las quincenas a las que la migración de los abonos les borró
 * la deuda, porque el servidor no deja pagarlas hasta repararlas. El caso medido: la
 * quincena de julio de 90 L × $2.000 = $180.000 contra $300.000 de adelanto, corregida
 * después con un día olvidado de 100 L = $200.000. Quedó con saldo $200.000 y $120.000 de
 * deuda borrada, y lo que de verdad falta entregarle es $80.000. El tablero y el balance
 * decían $0 por pagar sin una palabra, y se leía como "no se le debe nada a nadie";
 * Liquidaciones sí lo decía con su tarjeta "Deuda borrada por reparar".
 *
 * CUENTA QUINCENAS, NO PESOS, a propósito. La deuda borrada ($120.000) no es lo que se
 * debe, y lo que se debe puede caer de cualquiera de los dos lados: en esa la quesera
 * debe $80.000, y en la de $230.000 con la misma deuda borrada es el tercero el que debe
 * $70.000. Esa posición la escribe el servidor en el detalle de cada quincena. Tampoco
 * manda a Pagar: el servidor lo rebota en esas filas.
 *
 * El número es `quincenas_por_reparar` del servidor, el mismo universo de la tarjeta de
 * Liquidaciones; coincide con ella cuando el listado está sin filtros (el listado filtra
 * por tipo y por fechas, y el tablero y el balance no). "(ver Liquidaciones)" solo sale
 * si quien mira puede entrar ahí. Cero o ausente (una respuesta vieja): no hay nota.
 */
export function notaQuincenasPorReparar(
  cuantas: number | null | undefined,
  puedeVerLiquidaciones: boolean,
): string | null {
  const n = Number(cuantas ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  const donde = puedeVerLiquidaciones ? ' (ver Liquidaciones)' : '';
  return n === 1
    ? '1 quincena con deuda borrada por la migración no entra en esta cifra: hay que ' +
        `repararla${donde}`
    : `${n} quincenas con deuda borrada por la migración no entran en esta cifra: hay que ` +
        `repararlas${donde}`;
}
