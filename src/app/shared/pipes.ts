import { Pipe, PipeTransform } from '@angular/core';

import { Monto } from '../core/models';

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const NUMERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });

/**
 * Pesos CON centavos, para las tarifas por unidad. Ver MoneyPipe.
 *
 * maximumFractionDigits sin mínimo a propósito: una tarifa entera de $238 se
 * sigue viendo "$ 238" y no "$ 238,00".
 */
const COP_CENTAVOS = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 2,
});

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
 * El `conCentavos` es opt-in y por defecto va apagado, o sea que TODOS los totales
 * de la aplicación se siguen viendo igual que siempre. Se prende solo donde la
 * cifra no es un total sino una TARIFA POR UNIDAD, que ahí sí lleva centavos: la
 * del transportador puede ser $242,76 por litro, y redondearla a "$ 243" en la
 * pantalla es mostrarle al dueño una tarifa que no es la que se va a pagar.
 *
 *     {{ fila.valor_transporte | money: true }}
 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: Monto | null | undefined, conCentavos = false): string {
    if (value === null || value === undefined || value === '') return '—';
    return (conCentavos ? COP_CENTAVOS : COP).format(Number(value));
  }
}

/** Formatea cantidades (litros, kg) con máximo 1 decimal. */
@Pipe({ name: 'cantidad' })
export class CantidadPipe implements PipeTransform {
  transform(value: Monto | null | undefined, sufijo = ''): string {
    if (value === null || value === undefined || value === '') return '—';
    return NUMERO.format(Number(value)) + (sufijo ? ` ${sufijo}` : '');
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
 */
@Pipe({ name: 'enUnidad' })
export class EnUnidadPipe implements PipeTransform {
  private readonly barras = new BarrasPipe();
  private readonly cantidad = new CantidadPipe();

  transform(value: Monto | null | undefined, unidad: string | null | undefined): string {
    return unidad === 'barra'
      ? this.barras.transform(value)
      : this.cantidad.transform(value, 'kg');
  }
}
