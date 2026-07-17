import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { firstValueFrom, map } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Monto } from '../../core/models';
import { dateToIso } from '../../shared/date-utils';
import { PageHeader } from '../../shared/page-header';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { RangoFechasRapido } from '../../shared/rango-fechas-rapido';
import { CompraListTab } from './compra-list.tab';
import { ConversionFormDialog } from './conversion-form.dialog';
import { ConversionListPanel } from './conversion-list.panel';
import { ResumenReventa, ReventaService } from './reventa.service';
import { VentaQuesoListTab } from './venta-list.tab';

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
 * Página del negocio de reventa: queso comprado a productores (con merma y
 * abonos) que se revende a clientes. Contabilidad separada del libro de la
 * quesera: no toca contabilidad ni ventas normales.
 */
@Component({
  selector: 'app-reventa-page',
  imports: [
    ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatIconModule, MatTabsModule, PageHeader, MoneyPipe,
    CantidadPipe, HasPermissionDirective, CompraListTab, VentaQuesoListTab,
    ConversionListPanel, RangoFechasRapido,
  ],
  templateUrl: './reventa.page.html',
  styles: `
    // ------------------------------------------------- tarjetas resumen
    .resumen-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 12px;
      margin-bottom: 8px;
    }

    .tarjeta {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      min-height: 76px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);

      .icono {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        flex-shrink: 0;
        background: color-mix(in srgb, var(--color-tarjeta) 15%, transparent);
        color: var(--color-tarjeta);
      }

      .textos {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .cifra { font-size: 1.4rem; font-weight: 600; line-height: 1.2; }
      .titulo { font-size: 0.85rem; color: var(--mat-sys-on-surface-variant); }
      .detalle { font-size: 0.8rem; font-weight: 500; color: var(--color-tarjeta); }
    }

    // Mismos tonos que estado-chip: ámbar/azul/verde/rojo.
    .tarjeta.ambar { --color-tarjeta: #b26a00; }
    .tarjeta.azul  { --color-tarjeta: #1565c0; }
    .tarjeta.verde { --color-tarjeta: #2e7d32; }
    .tarjeta.rojo  { --color-tarjeta: #c62828; }

    .tarjeta.verde .cifra, .tarjeta.rojo .cifra { color: var(--color-tarjeta); }

    :host-context(html.dark) {
      .tarjeta.ambar { --color-tarjeta: #ffb74d; }
      .tarjeta.azul  { --color-tarjeta: #64b5f6; }
      .tarjeta.verde { --color-tarjeta: #81c784; }
      .tarjeta.rojo  { --color-tarjeta: #e57373; }
    }

    // ------------------------------------------ línea informativa del período
    .linea-info {
      margin: 0 0 16px;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);

      strong { color: var(--mat-sys-on-surface); font-variant-numeric: tabular-nums; }
    }

    .tab-panel { padding-top: 16px; }
  `,
})
export class ReventaPage {
  private readonly servicio = inject(ReventaService);
  private readonly snackbar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  // Rango del período: por defecto el mes actual.
  readonly desde = new FormControl<Date | null>(primerDiaMesDate());
  readonly hasta = new FormControl<Date | null>(ultimoDiaMesDate());
  // Los hijos consumen las fechas como texto ISO 'yyyy-MM-dd'.
  readonly desdeValor = toSignal(this.desde.valueChanges.pipe(map(dateToIso)), {
    initialValue: dateToIso(this.desde.value),
  });
  readonly hastaValor = toSignal(this.hasta.valueChanges.pipe(map(dateToIso)), {
    initialValue: dateToIso(this.hasta.value),
  });

  readonly resumen = signal<ResumenReventa | null>(null);
  /** Se incrementa para forzar la recarga del historial de borona. */
  readonly recargaConversiones = signal(0);

  constructor() {
    for (const control of [this.desde, this.hasta]) {
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => void this.cargarResumen());
    }
    void this.cargarResumen();
  }

  async cargarResumen(): Promise<void> {
    const desde = dateToIso(this.desde.value);
    const hasta = dateToIso(this.hasta.value);
    if (!desde || !hasta) {
      this.resumen.set(null);
      return;
    }
    try {
      this.resumen.set(await firstValueFrom(this.servicio.resumen(desde, hasta)));
    } catch {
      this.resumen.set(null);
    }
  }

  esNegativo(valor: Monto): boolean {
    return Number(valor) < 0;
  }

  pasarABorona(): void {
    const resumen = this.resumen();
    this.dialog
      .open(ConversionFormDialog, {
        data: { disponible: resumen?.kilos_disponibles ?? 0 },
        width: '480px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.snackbar.open('Queso pasado a borona', 'OK', { duration: 3000 });
        this.recargaConversiones.update((n) => n + 1);
        void this.cargarResumen();
      });
  }

}
