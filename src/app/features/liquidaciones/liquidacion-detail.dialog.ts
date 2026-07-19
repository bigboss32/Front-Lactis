import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Liquidacion } from '../../core/models';
import { compartirArchivo, compartirWhatsApp } from '../../shared/compartir';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { LiquidacionEstadoStepper } from './liquidacion-estado-stepper';
import { LiquidacionesService } from './liquidaciones.service';

@Component({
  selector: 'app-liquidacion-detail',
  imports: [
    DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule,
    MatTableModule, MatTooltipModule, EstadoChip, MoneyPipe, CantidadPipe, HasPermissionDirective,
    LiquidacionEstadoStepper,
  ],
  templateUrl: './liquidacion-detail.dialog.html',
  styles: `
    .info {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 32px;
      margin-bottom: 8px;
    }
    .etiqueta {
      display: block;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }
    h3 {
      margin: 16px 0 8px;
      font-size: 1rem;
      font-weight: 500;
    }
    table { width: 100%; }
    .num { text-align: right; }
    .sin-datos {
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
      margin: 8px 0;
    }
    .resumen {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 32px;
      max-width: 420px;
    }
    .resumen .destacado { font-weight: 600; }
  `,
})
export class LiquidacionDetailDialog {
  private readonly servicio = inject(LiquidacionesService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item: Liquidacion }>(MAT_DIALOG_DATA);

  readonly liq = signal<Liquidacion>(this.data.item);
  readonly procesando = signal(false);
  readonly descargando = signal(false);
  readonly compartiendo = signal(false);

  readonly tercero = computed(
    () => this.liq().proveedor_nombre ?? this.liq().transportador_nombre ?? '—',
  );

  readonly columnasDetalle = ['fecha', 'litros', 'precio_litro', 'valor'];

  constructor() {
    // Recarga la liquidación para asegurar que los detalles estén completos.
    firstValueFrom(this.servicio.getById(this.data.item.id))
      .then((liq) => this.liq.set(liq))
      .catch(() => undefined);
  }

  aprobar(): void {
    void this.ejecutar(() => this.servicio.aprobar(this.liq().id), 'Liquidación aprobada');
  }

  pagar(): void {
    void this.ejecutar(() => this.servicio.pagar(this.liq().id), 'Liquidación marcada como pagada');
  }

  anular(): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Anular liquidación',
          mensaje:
            '¿Anular esta liquidación? Las recepciones y anticipos del período quedarán disponibles para volver a liquidar.',
          accion: 'Anular',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(() => this.servicio.anular(this.liq().id), 'Liquidación anulada');
      });
  }

  async descargarPdf(): Promise<void> {
    this.descargando.set(true);
    try {
      await firstValueFrom(this.servicio.descargarPdf(this.liq().id));
    } catch {
      this.snackbar.open('No fue posible descargar el PDF', 'OK', { duration: 5000 });
    } finally {
      this.descargando.set(false);
    }
  }

  async compartir(): Promise<void> {
    this.compartiendo.set(true);
    try {
      const blob = await firstValueFrom(this.servicio.pdfBlob(this.liq().id));
      const nombre = `liquidacion_${this.tercero()}.pdf`.replace(/\s+/g, '_');
      const resultado = await compartirArchivo(
        blob,
        nombre,
        `Liquidación de ${this.tercero()}`,
        `Recibo de liquidación de ${this.tercero()}`,
      );
      if (resultado === 'descargado') {
        this.snackbar.open(
          'Tu dispositivo no permite compartir directamente; se descargó el PDF',
          'OK',
          { duration: 4000 },
        );
      }
    } catch {
      this.snackbar.open('No fue posible compartir el recibo', 'OK', { duration: 5000 });
    } finally {
      this.compartiendo.set(false);
    }
  }

  /** Abre WhatsApp con un resumen en texto de la liquidación. */
  enviarWhatsApp(): void {
    const l = this.liq();
    const money = (m: unknown) => `$${Number(m).toLocaleString('es-CO')}`;
    const fecha = (iso: string) => iso.split('-').reverse().join('/');
    const texto =
      `*Liquidación de ${this.tercero()}*\n` +
      `Período: ${fecha(l.periodo_inicio)} al ${fecha(l.periodo_fin)}\n` +
      `Total litros: ${Number(l.total_litros).toLocaleString('es-CO')} L\n` +
      `Valor total: ${money(l.valor_total)}\n` +
      `Saldo a pagar: ${money(l.saldo)}`;
    compartirWhatsApp(texto);
  }

  private async ejecutar(
    accion: () => Observable<Liquidacion>,
    mensaje: string,
  ): Promise<void> {
    this.procesando.set(true);
    try {
      const actualizada = await firstValueFrom(accion());
      this.liq.set(actualizada);
      this.snackbar.open(mensaje, 'OK', { duration: 3000 });
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible completar la acción')
          : 'No fue posible completar la acción';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.procesando.set(false);
    }
  }
}
