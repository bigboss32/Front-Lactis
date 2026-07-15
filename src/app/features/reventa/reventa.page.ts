import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Monto } from '../../core/models';
import { PageHeader } from '../../shared/page-header';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { CompraListTab } from './compra-list.tab';
import { ConversionFormDialog } from './conversion-form.dialog';
import { ConversionListPanel } from './conversion-list.panel';
import { ResumenReventa, ReventaService } from './reventa.service';
import { VentaQuesoListTab } from './venta-list.tab';

/** Fecha local en formato ISO YYYY-MM-DD. */
function fechaIso(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

function primerDiaMesIso(): string {
  const hoy = new Date();
  return fechaIso(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
}

function ultimoDiaMesIso(): string {
  const hoy = new Date();
  return fechaIso(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0));
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
    MatIconModule, MatTabsModule, PageHeader, MoneyPipe, CantidadPipe,
    HasPermissionDirective, CompraListTab, VentaQuesoListTab, ConversionListPanel,
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
  readonly desde = new FormControl<string>(primerDiaMesIso(), { nonNullable: true });
  readonly hasta = new FormControl<string>(ultimoDiaMesIso(), { nonNullable: true });
  readonly desdeValor = toSignal(this.desde.valueChanges, { initialValue: this.desde.value });
  readonly hastaValor = toSignal(this.hasta.valueChanges, { initialValue: this.hasta.value });

  readonly resumen = signal<ResumenReventa | null>(null);
  readonly exportando = signal(false);
  /** Se incrementa para forzar la recarga del historial de borona. */
  readonly recargaConversiones = signal(0);

  constructor() {
    for (const control of [this.desde, this.hasta]) {
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => void this.cargarResumen());
    }
    void this.cargarResumen();
  }

  async cargarResumen(): Promise<void> {
    const desde = this.desde.value;
    const hasta = this.hasta.value;
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

  async exportarExcel(): Promise<void> {
    const desde = this.desde.value;
    const hasta = this.hasta.value;
    if (!desde || !hasta) {
      this.snackbar.open('Selecciona el rango de fechas (desde y hasta) para exportar', 'OK', {
        duration: 4000,
      });
      return;
    }
    this.exportando.set(true);
    try {
      await firstValueFrom(this.servicio.exportarExcel(desde, hasta));
    } catch {
      this.snackbar.open('No fue posible exportar: verifica que existan registros en el período', 'OK', {
        duration: 5000,
      });
    } finally {
      this.exportando.set(false);
    }
  }
}
