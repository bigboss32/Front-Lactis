import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Pago, Venta } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { PagoFormDialog } from './pago-form.dialog';
import { VentaFormDialog } from './venta-form.dialog';
import { VentasService } from './ventas.service';

@Component({
  selector: 'app-venta-detail',
  imports: [
    DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatTableModule,
    MatProgressBarModule, EstadoChip, MoneyPipe, CantidadPipe, HasPermissionDirective,
  ],
  templateUrl: './venta-detail.dialog.html',
  styles: `
    .titulo { display: flex; align-items: center; gap: 12px; }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 8px;

      div { display: flex; flex-direction: column; }
      .etq { font-size: 0.75rem; color: var(--mat-sys-on-surface-variant); }
    }
    .seccion { margin: 16px 0 4px; font-size: 1rem; font-weight: 500; }
    .tabla-detalle { width: 100%; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .totales {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      margin-top: 12px;

      div {
        display: flex;
        gap: 24px;
        span { color: var(--mat-sys-on-surface-variant); }
        strong { min-width: 110px; text-align: right; font-variant-numeric: tabular-nums; }
      }
      .saldo { font-size: 1.05rem; }
    }
    .observaciones {
      margin: 12px 0 0;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: pre-line;
    }
    .sin-pagos { color: var(--mat-sys-on-surface-variant); font-size: 0.9rem; }
  `,
})
export class VentaDetailDialog {
  private readonly servicio = inject(VentasService);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef<VentaDetailDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ venta: Venta }>(MAT_DIALOG_DATA);

  readonly columnasDetalle = ['descripcion', 'cantidad', 'precio_unitario', 'total'];
  readonly columnasPagos = ['fecha', 'valor', 'metodo', 'referencia'];
  readonly metodos: Record<string, string> = {
    efectivo: 'Efectivo',
    transferencia: 'Transferencia',
    otro: 'Otro',
  };

  readonly venta = signal<Venta>(this.data.venta);
  readonly pagos = signal<Pago[]>([]);
  readonly cargando = signal(false);
  readonly huboCambios = signal(false);

  readonly puedeRegistrarPago = computed(
    () => ['pendiente', 'parcial'].includes(this.venta().estado) && Number(this.venta().saldo) > 0,
  );
  readonly puedeAnular = computed(
    () => this.venta().estado !== 'anulada' && Number(this.venta().pagado) === 0,
  );
  // Editar productos/importes solo si no está anulada y aún no tiene pagos.
  readonly puedeEditar = this.puedeAnular;

  constructor() {
    // Se controla el cierre manualmente para devolver siempre `huboCambios`
    // aunque el usuario cierre con Escape o clic en el fondo.
    this.dialogRef.disableClose = true;
    this.dialogRef.backdropClick().pipe(takeUntilDestroyed()).subscribe(() => this.cerrar());
    this.dialogRef.keydownEvents().pipe(takeUntilDestroyed()).subscribe((evento) => {
      if (evento.key === 'Escape') this.cerrar();
    });
    this.refrescar();
  }

  cerrar(): void {
    this.dialogRef.close(this.huboCambios());
  }

  async refrescar(): Promise<void> {
    this.cargando.set(true);
    try {
      const [venta, pagos] = await Promise.all([
        firstValueFrom(this.servicio.getById(this.data.venta.id)),
        firstValueFrom(this.servicio.pagosDeVenta(this.data.venta.id)),
      ]);
      this.venta.set(venta);
      this.pagos.set(pagos.items);
    } finally {
      this.cargando.set(false);
    }
  }

  editar(): void {
    this.dialog
      .open(VentaFormDialog, { data: { venta: this.venta() }, width: '760px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.huboCambios.set(true);
        this.snackbar.open('Venta actualizada', 'OK', { duration: 3000 });
        this.refrescar();
      });
  }

  registrarPago(): void {
    this.dialog
      .open(PagoFormDialog, { data: { venta: this.venta() }, width: '480px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.huboCambios.set(true);
          this.snackbar.open('Pago registrado', 'OK', { duration: 3000 });
          this.refrescar();
        }
      });
  }

  anular(): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Anular venta',
          mensaje: `¿Anular la venta Nº ${this.venta().numero}? Se reintegrará el inventario descontado.`,
          accion: 'Anular',
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(this.servicio.anular(this.venta().id));
          this.huboCambios.set(true);
          this.snackbar.open('Venta anulada', 'OK', { duration: 3000 });
          this.refrescar();
        } catch (err) {
          const detalle =
            err instanceof HttpErrorResponse
              ? (err.error?.error?.detail ?? 'No fue posible anular la venta')
              : 'No fue posible anular la venta';
          this.snackbar.open(detalle, 'OK', { duration: 5000 });
        }
      });
  }
}
