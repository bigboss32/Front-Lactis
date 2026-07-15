import { Pipe, PipeTransform } from '@angular/core';

import { Monto } from '../core/models';

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const NUMERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });

/** Formatea pesos colombianos sin decimales: 408600 → $ 408.600 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: Monto | null | undefined): string {
    if (value === null || value === undefined || value === '') return '—';
    return COP.format(Number(value));
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
