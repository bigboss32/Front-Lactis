import { Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { map } from 'rxjs';

import { dateToIso } from '../../shared/date-utils';

/** Lo mínimo para reconocer una temporada por su rango de fechas. */
export interface RangoConNombre {
  id: string;
  nombre: string;
  fecha_inicio: string;
  fecha_fin: string;
}

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

  /**
   * Temporadas ya consultadas en esta sesión, para poder ponerle NOMBRE al rango
   * que está puesto sin volver a preguntarle al servidor.
   *
   * Vive aquí y no en el selector porque el selector se destruye al cambiar de
   * pantalla: al entrar al Resumen desde la pantalla de Temporadas, el selector
   * nace vacío y el botón se quedaba diciendo "Temporada" cuando el filtro estaba
   * justo en las fechas de una. Con eso se perdía el contexto: se veía "Ganancia
   * neta del período" sin saber de qué temporada era ese período.
   *
   * Es una caché, no la verdad: si está vacía, el botón simplemente no afirma
   * nada. Nunca se muestra un nombre que no corresponda al rango puesto.
   */
  readonly temporadasConocidas = signal<RangoConNombre[]>([]);

  recordarTemporadas(temporadas: RangoConNombre[]): void {
    this.temporadasConocidas.set(
      temporadas.map(({ id, nombre, fecha_inicio, fecha_fin }) => ({
        id,
        nombre,
        fecha_inicio,
        fecha_fin,
      })),
    );
  }
}
