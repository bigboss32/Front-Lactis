import { Liquidacion, Monto } from '../../core/models';

/**
 * EL RÓTULO DEL RENGLÓN DE LA DEUDA VIEJA, dicho como lo diría el dueño y escrito UNA
 * sola vez.
 *
 * Es el MISMO texto que imprime el comprobante en PDF. Vive en una constante porque se
 * usa en el resumen del detalle, en la nota que explica de dónde salió el descuento, en
 * el aviso del recálculo y ahora también en el cuadre de la corrección: si en alguno
 * dijera otra cosa, la pantalla y el papel se estarían contradiciendo sobre una plata
 * que se le quita al proveedor, y esa discusión la pierde el dueño.
 *
 * BAJÓ A ESTE ARCHIVO cuando el diálogo de corregir una quincena pagada necesitó el
 * mismo rótulo: dejarlo en el detalle habría hecho que los dos diálogos se importaran
 * en círculo (el detalle abre al de corregir), que es como un módulo termina cargándose
 * a medio inicializar.
 */
export const ROTULO_SALDO_ANTERIOR = 'Lo que quedó debiendo de la quincena pasada';

/**
 * El menos de los renglones que restan: U+2212 (signo de resta), NO el guion del
 * teclado.
 *
 * No es un capricho tipográfico. Estas cifras se leen y se copian, y un guion pegado a
 * la plata ("- $ 24.600") se confunde con una cifra NEGATIVA —que es justo lo que hay
 * que evitar en el renglón del saldo—. El signo de resta se lee como una operación: "al
 * total le quito esto".
 */
export const MENOS = '−';

/**
 * Lee un precio escrito a la colombiana: "1.750" son mil setecientos cincuenta,
 * no uno con setenta y cinco. El punto separa miles y la coma es el decimal, al
 * revés de lo que entiende Number(). Devuelve null si lo tecleado no es un
 * precio utilizable, para no mandarle NaN al backend.
 *
 * VIVE ACÁ Y NO EN UNA PANTALLA porque ahora hay DOS sitios que reciben un precio por
 * litro tecleado a mano —el lápiz del día en el detalle, y la corrección del precio de
 * una quincena ya pagada— y los dos tienen que entender lo mismo. Dos lectores de plata
 * es como termina uno guardando $1,75 donde el otro guarda $1.750.
 */
export function precioTecleado(texto: string): number | null {
  const limpio = texto.trim().replace(/\s|\$/g, '').replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  const numero = Number(limpio);
  return numero > 0 ? numero : null;
}

/**
 * POR QUÉ EL TERCERO LE QUEDÓ DEBIENDO A LA QUESERA. Son DOS cosas distintas y hasta
 * ahora la pantalla solo sabía nombrar una.
 *
 *  · 'anticipos' — el caso de siempre: los anticipos que se le entregaron (más lo que
 *    ya venía debiendo de antes) suman más que la quincena, así que el neto quedó por
 *    debajo de cero y NUNCA salió un peso contra este comprobante.
 *  · 'entregado_de_mas' — el caso que trajo la corrección de una quincena pagada: se le
 *    entregaron $500.000, después se corrigió el precio de un día y la quincena bajó a
 *    $400.000. No hubo NINGÚN anticipo: hubo plata entregada de más. Decirle al dueño
 *    que "los anticipos suman más que esta quincena" es literalmente falso, y él va a
 *    ir a buscar unos anticipos que no existen.
 *  · 'las_dos' — hubo anticipos que se comieron la quincena Y además ya se le había
 *    entregado plata. No debería pasar (con el neto por debajo de cero el servidor
 *    rebota el pago), pero si pasa hay que decirlo entero en vez de escoger una mitad.
 *
 * LA CUENTA QUE LO DECIDE, y sale de la única identidad que este proyecto garantiza
 * siempre: neto_a_pagar = pagado + saldo, y `le_queda_debiendo` es el saldo volteado.
 * Entonces `pagado − neto_a_pagar = le_queda_debiendo`. Con `pagado` en cero la
 * diferencia es toda del neto negativo (anticipos); con el neto en cero o por encima,
 * es toda de la plata entregada.
 *
 * EL CERO ES EL PISO A PROPÓSITO: mientras no haya salido un peso (`pagado <= 0`) la
 * respuesta es 'anticipos', que es exactamente lo que decían las tres frases de antes.
 * Así una liquidación vieja —o una respuesta sin `pagado`— sigue leyéndose igual.
 */
export type CausaDeLaDeuda = 'anticipos' | 'entregado_de_mas' | 'las_dos';

export function causaDeLaDeuda(
  liq: Pick<Liquidacion, 'pagado' | 'neto_a_pagar'>,
): CausaDeLaDeuda {
  const pagado = Number(liq.pagado ?? 0);
  if (!(pagado > 0)) return 'anticipos';
  return Number(liq.neto_a_pagar ?? 0) < 0 ? 'las_dos' : 'entregado_de_mas';
}

/**
 * LA MITAD DE LA FRASE QUE EXPLICA LA DEUDA, para que las tres pantallas que la dicen
 * —el detalle, el candado de Pagar y el tooltip de la lista— no puedan decir cosas
 * distintas sobre la misma plata.
 *
 * Solo cubre los casos NUEVOS ('entregado_de_mas' y 'las_dos'): el de los anticipos se
 * queda escrito donde estaba, palabra por palabra, porque cada pantalla lo dice con su
 * propio detalle (una nombra el saldo anterior, otra no) y reescribirlo sería cambiar
 * tres textos que hoy son ciertos.
 *
 * `enPesos` se recibe y no se importa: cada pantalla ya tiene su formateador y las
 * cifras de la frase tienen que salir idénticas a las de su tabla.
 */
export function porQueSeLePagoDeMas(
  liq: Pick<Liquidacion, 'pagado' | 'neto_a_pagar' | 'anticipos' | 'valor_total' | 'version'>,
  enPesos: (monto: Monto | null | undefined) => string,
): string {
  const corregida = Number(liq.version ?? 1) > 1;
  const laQuincena = corregida
    ? `la quincena, ya corregida, quedó en ${enPesos(liq.neto_a_pagar)}`
    : `esta quincena quedó en ${enPesos(liq.neto_a_pagar)}`;
  if (causaDeLaDeuda(liq) === 'las_dos') {
    return (
      `ya se le habían entregado ${enPesos(liq.pagado)}, y además los anticipos ` +
      `aplicados (${enPesos(liq.anticipos)}) suman más que el valor total de esta ` +
      `liquidación (${enPesos(liq.valor_total)})`
    );
  }
  return `ya se le habían entregado ${enPesos(liq.pagado)} y ${laQuincena}`;
}
