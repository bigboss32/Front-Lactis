import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { firstValueFrom } from 'rxjs';

import { Kardex } from '../../core/models';
import { CantidadPipe } from '../../shared/pipes';
import { ProductosService, TIPO_MOVIMIENTO_LABELS } from './inventario.service';

/** Diálogo de solo lectura con el kardex (histórico de movimientos y saldo) de un producto. */
@Component({
  selector: 'app-kardex-dialog',
  imports: [
    DatePipe, MatDialogModule, MatButtonModule, MatIconModule,
    MatProgressBarModule, MatTableModule, CantidadPipe,
  ],
  template: `
    <h2 mat-dialog-title>Kardex — {{ data.nombre }}</h2>
    <mat-dialog-content>
      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (kardex(); as k) {
        <p class="resumen">
          Unidad: <strong>{{ k.unidad }}</strong> · Stock actual:
          <strong>{{ k.stock_actual | cantidad }}</strong>
        </p>

        <table mat-table [dataSource]="k.movimientos">
          <ng-container matColumnDef="fecha">
            <th mat-header-cell *matHeaderCellDef>Fecha</th>
            <td mat-cell *matCellDef="let fila">{{ fila.fecha | date: 'dd/MM/yyyy' }}</td>
          </ng-container>

          <ng-container matColumnDef="tipo">
            <th mat-header-cell *matHeaderCellDef>Tipo</th>
            <td mat-cell *matCellDef="let fila">{{ etiquetaTipo(fila.tipo) }}</td>
          </ng-container>

          <ng-container matColumnDef="cantidad">
            <th mat-header-cell *matHeaderCellDef class="num">Cantidad</th>
            <td mat-cell *matCellDef="let fila" class="num">{{ fila.cantidad | cantidad }}</td>
          </ng-container>

          <ng-container matColumnDef="referencia">
            <th mat-header-cell *matHeaderCellDef>Referencia</th>
            <td mat-cell *matCellDef="let fila">{{ fila.referencia ?? '—' }}</td>
          </ng-container>

          <ng-container matColumnDef="saldo">
            <th mat-header-cell *matHeaderCellDef class="num">Saldo</th>
            <td mat-cell *matCellDef="let fila" class="num">{{ fila.saldo | cantidad }}</td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="columnas"></tr>
          <tr mat-row *matRowDef="let fila; columns: columnas"></tr>
        </table>

        @if (k.movimientos.length === 0) {
          <div class="empty-state">
            <mat-icon>history</mat-icon>
            <p>El producto aún no tiene movimientos registrados</p>
          </div>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: `
    .resumen {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.9rem;
    }
  `,
})
export class KardexDialog {
  private readonly servicio = inject(ProductosService);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ productoId: string; nombre: string }>(MAT_DIALOG_DATA);
  readonly kardex = signal<Kardex | null>(null);
  readonly cargando = signal(true);

  readonly columnas = ['fecha', 'tipo', 'cantidad', 'referencia', 'saldo'];

  constructor() {
    this.cargar();
  }

  etiquetaTipo(tipo: string): string {
    return TIPO_MOVIMIENTO_LABELS[tipo] ?? tipo;
  }

  private async cargar(): Promise<void> {
    try {
      this.kardex.set(await firstValueFrom(this.servicio.kardex(this.data.productoId)));
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible cargar el kardex')
          : 'No fue posible cargar el kardex';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.cargando.set(false);
    }
  }
}
