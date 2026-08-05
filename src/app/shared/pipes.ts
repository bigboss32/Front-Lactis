import { Pipe, PipeTransform } from '@angular/core';

import { Monto } from '../core/models';

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const NUMERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });

/**
 * Cantidades con la MISMA precisión que guarda la base (dos decimales) y sin
 * ceros de relleno: 250 L, 227,5 L, 81,99 L, 0,01 L.
 *
 * Es el gemelo exacto de `litros()` / `kilogramos()` del backend (utils/export.py,
 * que imprimen los PDF): si la pantalla recorta a un decimal, la columna deja de
 * sumar el total —dos renglones de 81,99 L se leen "82 L" y "82 L" contra un total
 * de 163,98 L— y encima la pantalla y el papel dicen cosas distintas del mismo
 * documento. Se pide con `| cantidad: 'L' : 2`.
 */
const NUMERO_EXACTO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

/**
 * Pesos con centavos SIEMPRE que existan, y nunca uno solo: $ 1.250,50, no
 * "$ 1.250,5".
 *
 * Un solo decimal en plata se lee como si se hubiera perdido un centavo. Es la
 * misma regla del backend (`pesos()` en utils/export.py: "0 o 2 dígitos, nunca
 * 1"), y tiene que ser la misma porque el dueño compara el PDF con la pantalla
 * cifra por cifra.
 */
const COP_CENTAVOS = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Una cifra de plata tal como la imprime el comprobante en PDF: sin centavos si
 * no los tiene ($ 238) y con los DOS si los tiene ($ 242,76).
 *
 * Existe como función y no solo como pipe porque las mismas cifras salen en
 * textos que no pasan por la plantilla —el resumen de WhatsApp, el aviso de
 * "queda debiendo", la confirmación de borrar un pago— y ahí también tienen que
 * cuadrar: `toLocaleString()` a secas deja "1.250,5".
 */
export function pesosExactos(valor: Monto | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const numero = Number(valor);
  // Number.isInteger decide: 238 → "$ 238" (como siempre), 242,76 → "$ 242,76".
  return (Number.isInteger(numero) ? COP : COP_CENTAVOS).format(numero);
}

/**
 * Las barras van SIN decimales: una barra es una barra.
 *
 * No se reutiliza NUMERO (que admite un decimal) a propósito: "8,5 barras" no
 * existe, y verlo en pantalla haría pensar que se pueden vender medias. El backend
 * las guarda en una columna sin decimales y rechaza los que lleguen.
 */
const ENTERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

/**
 * Formatea pesos colombianos sin decimales: 408600 → $ 408.600
 *
 * El `conCentavos` es opt-in y por defecto va apagado, o sea que las listas y los
 * indicadores de la aplicación se siguen viendo igual que siempre. Se prende en dos
 * clases de cifra, y las dos por la misma razón —que la pantalla no puede mostrar
 * una plata distinta de la que se paga—:
 *
 *  · las TARIFAS POR UNIDAD: la del transportador puede ser $242,76 por litro, y
 *    redondearla a "$ 243" es mostrar una tarifa que no es la que se va a pagar;
 *  · TODAS las cifras de un DOCUMENTO que se cuadra a mano (el comprobante de
 *    liquidación y la pre-liquidación, desglose y resumen): ahí el desglose tiene
 *    que sumar exacto la cifra grande, y el PDF del mismo documento ya imprime los
 *    centavos, así que pantalla y papel tienen que decir lo mismo.
 *
 *     {{ fila.valor_transporte | money: true }}
 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: Monto | null | undefined, conCentavos = false): string {
    if (value === null || value === undefined || value === '') return '—';
    return conCentavos ? pesosExactos(value) : COP.format(Number(value));
  }
}

/**
 * Formatea cantidades (litros, kg) con máximo 1 decimal.
 *
 * `decimales` es opt-in y por omisión sigue en 1, o sea que todas las pantallas
 * de la aplicación se ven igual que siempre. Se sube a 2 donde la columna TIENE
 * QUE SUMAR el total del documento —el comprobante de liquidación y la
 * pre-liquidación—: ahí un renglón de 81,99 L leído "82 L" descuadra el desglose
 * contra la cifra grande, y el PDF del mismo documento sí imprime los dos
 * decimales.
 *
 *     {{ detalle.litros | cantidad: 'L' : 2 }}
 */
@Pipe({ name: 'cantidad' })
export class CantidadPipe implements PipeTransform {
  transform(value: Monto | null | undefined, sufijo = '', decimales = 1): string {
    if (value === null || value === undefined || value === '') return '—';
    const formato = decimales >= 2 ? NUMERO_EXACTO : NUMERO;
    return formato.format(Number(value)) + (sufijo ? ` ${sufijo}` : '');
  }
}

/**
 * Barras de mozzarella: "8 barras", "1 barra". Sin decimales NUNCA.
 *
 * Existe en vez de usar `| cantidad: 'barras'` por dos razones, y las dos son
 * para que la pantalla no mienta:
 *  - sin decimales (ver ENTERO): "8,5 barras" no es una cantidad posible;
 *  - se pluraliza, porque esto lo lee una persona y "1 barras" se ve como un error
 *    del sistema y le quita confianza a todas las demás cifras de la pantalla.
 */
@Pipe({ name: 'barras' })
export class BarrasPipe implements PipeTransform {
  transform(value: Monto | null | undefined): string {
    if (value === null || value === undefined || value === '') return '—';
    const numero = Math.round(Number(value));
    return `${ENTERO.format(numero)} ${Math.abs(numero) === 1 ? 'barra' : 'barras'}`;
  }
}

/**
 * Una cantidad CON SU UNIDAD, decidida por el dato y no por la plantilla.
 *
 * Se usa donde una misma columna puede traer kilos o barras (el desglose por
 * producto, las listas de compras y ventas, los estados de cuenta): se le pasa la
 * `unidad` que manda el backend y él decide el formato y el rótulo. Así ninguna
 * plantilla tiene que acordarse de la regla, y —lo importante— NINGUNA puede
 * imprimir "8 kg" donde hay 8 barras, que es el error que este trabajo tiene que
 * evitar por encima de todo.
 *
 * Cuál de los dos números mirar lo decide quien llama (`fila.unidad === 'barra' ?
 * fila.barras : fila.kilos`), porque el campo cambia de nombre en cada tabla.
 *
 * `decimales` es opt-in y por omisión sigue en 1, o sea que todas las pantallas
 * que ya lo usan se ven igual que siempre. Se sube a 2 donde la cantidad ES PARTE
 * DE UNA CUENTA que tiene que cuadrar —el recibo de una factura de reventa, donde
 * debajo de "99,11 kg × $15.777" va el resultado de multiplicar esas dos cifras—:
 * si ahí se leyera "99,1 kg", el dueño multiplicaría a mano y le saldría otra
 * plata. A las BARRAS no les aplica: no tienen decimales nunca (ver BarrasPipe).
 *
 *     {{ renglon.kilos | enUnidad: 'kg' : 2 }}
 */
@Pipe({ name: 'enUnidad' })
export class EnUnidadPipe implements PipeTransform {
  private readonly barras = new BarrasPipe();
  private readonly cantidad = new CantidadPipe();

  transform(
    value: Monto | null | undefined,
    unidad: string | null | undefined,
    decimales = 1,
  ): string {
    return unidad === 'barra'
      ? this.barras.transform(value)
      : this.cantidad.transform(value, 'kg', decimales);
  }
}
