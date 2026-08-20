import { Monto, esDiaFijo } from '../../core/models';
import { pesosExactos } from '../../shared/pipes';

/**
 * CÓMO SE ESCRIBE EL RENGLÓN DE UN DÍA COBRADO POR DÍA COMPLETO.
 *
 * Vive aparte y en un solo sitio porque lo usan las DOS hojas que muestran el desglose
 * del flete —el comprobante ya generado y el avance de mitad de quincena— y porque el
 * texto tiene que ser EL MISMO que imprime el PDF que se le entrega al conductor
 * (`_ROTULO_DIA_FIJO` y `_notas_del_dia_fijo` en Back-Lactis, módulo de liquidaciones).
 * El dueño pone el papel al lado de la pantalla; si una dice "Día completo" y la otra
 * "Fijo", la discusión con el conductor la pierde él.
 *
 * EL PROBLEMA QUE RESUELVE. En un renglón por litro la línea se comprueba multiplicando
 * (219,45 L × $242,76 = $53.273,68) y por eso la columna Precio/L lleva una tarifa. En
 * uno de día fijo NO EXISTE ninguna tarifa por litro que reproduzca $150.000 el día:
 * escribir la cifra ahí invitaría a multiplicarla por los litros —y a preguntar por los
 * cuarenta y cinco millones que no aparecen—, y escribir el promedio pondría en pantalla
 * una cifra que no es la tarifa de nada. Por eso el backend manda `precio_litro` en CERO
 * (que es la verdad) y esa columna lleva una PALABRA.
 */

/** Ese día se cobró por día completo. La línea se verifica leyéndola. */
export const ROTULO_DIA_FIJO = 'Día completo';

/**
 * Y ese día completo YA SE PAGÓ en otro comprobante, por eso este renglón va en $0,00.
 *
 * Pasa cuando se anota leche de un día que ya estaba liquidado: el día costó $150.000
 * una vez y recoger un proveedor más ese mismo día no cuesta más. Sin esta palabra, un
 * renglón en cero parece un error del sistema o una plata que alguien le quitó.
 */
export const ROTULO_DIA_FIJO_YA_COBRADO = 'Ya cobrado';

/** Lo mínimo que hace falta para escribir la columna Precio/L de un renglón. */
export interface RenglonDeFlete {
  precio_litro: Monto;
  valor: Monto;
  modo_transporte?: string | null;
  /**
   * Si este renglón fijo va en $0,00 porque ese día completo YA SE COBRÓ en OTRO
   * comprobante. Lo manda el backend (`dia_fijo_ya_cobrado` en `LiquidacionDetalle` y en
   * `PreLiquidacionDetalle`) y es el MISMO dato con el que el PDF escribe la palabra.
   * Opcional para leer una respuesta vieja: sin el campo, ningún renglón dice "Ya
   * cobrado", que es lo que era cierto antes de que existiera.
   */
  dia_fijo_ya_cobrado?: boolean | null;
}

/** ¿Este renglón se cobró por día completo? Un renglón viejo (sin modo) es por litro. */
export function renglonDeDiaFijo(renglon: RenglonDeFlete): boolean {
  return esDiaFijo(renglon.modo_transporte);
}

/**
 * ¿ESTE RENGLÓN VA EN $0,00 PORQUE EL DÍA YA SE COBRÓ EN OTRO COMPROBANTE?
 *
 * SALE DEL DATO Y NO DE MIRAR SI EL VALOR ES CERO, y esa es la corrección: son DOS
 * hechos distintos y por las cifras no se distinguen.
 *
 *  · el día completo ya se pagó en otro papel → $0,00 y «Ya cobrado». Es un hecho sobre
 *    OTRO documento;
 *  · la tarifa fija de esa ruta es de $0,00 —el dueño decidió no cobrar ese viaje— →
 *    también $0,00, pero ahí no se le ha pagado nada a nadie.
 *
 * Deduciéndolo del cero, la pantalla le afirmaba al dueño que a ese conductor ya se le
 * había pagado ese día mientras el PDF —que sí usa el dato guardado— decía lo contrario.
 * Las dos cosas no pueden ser ciertas a la vez, y la que manda es el papel.
 *
 * Es el gemelo exacto de `_ya_cobrado_en_otro` del backend.
 */
export function renglonYaCobrado(renglon: RenglonDeFlete): boolean {
  return renglon.dia_fijo_ya_cobrado === true;
}

/**
 * LO QUE VA EN LA COLUMNA Precio/L: la tarifa, o la palabra del día fijo.
 *
 * Es el gemelo exacto de `_precio_del_renglon` del backend, que es la que imprime el
 * PDF. Con centavos siempre que los tenga, como el resto del documento: una tarifa de
 * $242,76 leída "$ 243" no reproduce el valor cuando el dueño multiplica a mano.
 */
export function precioDelRenglon(renglon: RenglonDeFlete): string {
  if (!renglonDeDiaFijo(renglon)) return pesosExactos(renglon.precio_litro);
  return renglonYaCobrado(renglon) ? ROTULO_DIA_FIJO_YA_COBRADO : ROTULO_DIA_FIJO;
}

/**
 * LA LETRA CHICA QUE EXPLICA ESOS RENGLONES. Vacía cuando no hay ninguno.
 *
 * Son PALABRA POR PALABRA las notas que el PDF imprime bajo el resumen (el oficial y el
 * del avance). Hacen falta por lo mismo en el papel y en la pantalla: quien suma la
 * columna a mano se encuentra una línea cuyo valor no sale de multiplicar nada, y sin
 * una frase que lo diga solo ve una cifra que no le cuadra con los litros.
 *
 * La segunda nota sale únicamente cuando de verdad hay un renglón MARCADO como ya
 * cobrado, que es el caso raro. No basta con que un fijo valga $0,00: un viaje que el
 * dueño decidió no cobrar también vale cero y nadie le pagó nada al conductor. Ver
 * `renglonYaCobrado`.
 */
export function notasDelDiaFijo(renglones: readonly RenglonDeFlete[]): string[] {
  const fijos = renglones.filter(renglonDeDiaFijo);
  if (fijos.length === 0) return [];
  const notas = [
    `Los renglones que dicen «${ROTULO_DIA_FIJO}» se cobran POR DÍA y no por litro: ese ` +
      'día completo vale lo que dice la columna Valor, sin importar cuántos litros ni ' +
      'cuántos proveedores se recogieron. Los litros van al lado como información; ' +
      'multiplicarlos no da el valor.',
  ];
  if (fijos.some(renglonYaCobrado)) {
    notas.push(
      `Los renglones que dicen «${ROTULO_DIA_FIJO_YA_COBRADO}» van en $0,00 porque el día ` +
        'completo ya se le pagó en otro comprobante: es leche que se anotó después, y ' +
        'recoger un proveedor más ese mismo día no cuesta más.',
    );
  }
  return notas;
}
