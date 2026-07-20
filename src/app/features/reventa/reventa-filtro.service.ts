import { Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { map } from 'rxjs';

import { dateToIso } from '../../shared/date-utils';

/** Primer día del mes actual como `Date` local. */
function primerDiaMesDate(): Date {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
}

/** Último día del mes actual como `Date` local. */
function ultimoDiaMesDate(): Date {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
}

/**
 * Rango de fechas del negocio de reventa, compartido por las sub-páginas
 * (Resumen, Compras, Ventas). La shell muestra los datepickers atados a estos
 * controles y las páginas consumen las fechas como texto ISO.
 */
@Injectable({ providedIn: 'root' })
export class ReventaFiltroService {
  readonly desde = new FormControl<Date | null>(primerDiaMesDate());
  readonly hasta = new FormControl<Date | null>(ultimoDiaMesDate());

  readonly desdeIso = toSignal(this.desde.valueChanges.pipe(map(dateToIso)), {
    initialValue: dateToIso(this.desde.value),
  });
  readonly hastaIso = toSignal(this.hasta.valueChanges.pipe(map(dateToIso)), {
    initialValue: dateToIso(this.hasta.value),
  });
}
