import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { MoneyPipe } from '../../shared/pipes';
import { AbonoReventa, ReventaService } from './reventa.service';

export interface AbonosDialogData {
  titulo: string;
  abonos: AbonoReventa[];
  /** A qué pertenece la lista, para poder eliminar un abono mal registrado. */
  tipo: 'compra' | 'venta';
  id: string;
}

/**
 * Lista de abonos de una compra o venta de queso. Permite eliminar un abono
 * registrado por error: el backend baja el "abonado" y recalcula el estado.
 */
@Component({
  selector: 'app-abonos-list',
  imports: [
    DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatTableModule,
    MatTooltipModule, MoneyPipe, HasPermissionDirective,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.titulo }}</h2>
    <mat-dialog-content>
      @if (abonos().length > 0) {
        <table mat-table [dataSource]="abonos()">
          <ng-container matColumnDef="fecha">
            <th mat-header-cell *matHeaderCellDef>Fecha</th>
            <td mat-cell *matCellDef="let abono">{{ abono.fecha | date: 'dd/MM/yyyy' }}</td>
          </ng-container>

          <ng-container matColumnDef="valor">
            <th mat-header-cell *matHeaderCellDef class="num">Valor</th>
            <td mat-cell *matCellDef="let abono" class="num">{{ abono.valor | money }}</td>
          </ng-container>

          <ng-container matColumnDef="observaciones">
            <th mat-header-cell *matHeaderCellDef>Observaciones</th>
            <td mat-cell *matCellDef="let abono">{{ abono.observaciones || '—' }}</td>
          </ng-container>

          <ng-container matColumnDef="acciones">
            <th mat-header-cell *matHeaderCellDef class="col-acciones"></th>
            <td mat-cell *matCellDef="let abono" class="col-acciones">
              <button
                mat-icon-button
                *hasPermission="'reventa:crear'"
                matTooltip="Eliminar este abono (registrado por error)"
                [disabled]="eliminando()"
                (click)="eliminarAbono(abono)"
              >
                <mat-icon>delete</mat-icon>
              </button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="columnas"></tr>
          <tr mat-row *matRowDef="let abono; columns: columnas"></tr>
        </table>
      } @else {
        <div class="empty-state">
          <mat-icon>payments</mat-icon>
          <p>No hay abonos registrados</p>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cerrar()">Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: `
    table { width: 100%; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .col-acciones { width: 48px; text-align: right; }
  `,
})
export class AbonosListDialog {
  private readonly servicio = inject(ReventaService);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef<AbonosListDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<AbonosDialogData>(MAT_DIALOG_DATA);
  readonly abonos = signal<AbonoReventa[]>([...this.data.abonos]);
  readonly eliminando = signal(false);
  readonly columnas = ['fecha', 'valor', 'observaciones', 'acciones'];

  /** Se pone en true si se eliminó algún abono, para que la lista se recargue al cerrar. */
  private cambiado = false;

  eliminarAbono(abono: AbonoReventa): void {
    const valor = `$${Number(abono.valor).toLocaleString('es-CO')}`;
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar abono',
          mensaje: `¿Eliminar el abono de ${valor}? Se recalculará el saldo. Esta acción no se puede deshacer.`,
          accion: 'Eliminar',
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        this.eliminando.set(true);
        try {
          if (this.data.tipo === 'compra') {
            await firstValueFrom(this.servicio.eliminarAbonoCompra(this.data.id, abono.id));
          } else {
            await firstValueFrom(this.servicio.eliminarAbonoVenta(this.data.id, abono.id));
          }
          this.abonos.update((lista) => lista.filter((a) => a.id !== abono.id));
          this.cambiado = true;
          this.snackbar.open('Abono eliminado', 'OK', { duration: 3000 });
        } catch (err) {
          const detalle =
            err instanceof HttpErrorResponse
              ? (err.error?.error?.detail ?? 'No fue posible eliminar el abono')
              : 'No fue posible eliminar el abono';
          this.snackbar.open(detalle, 'OK', { duration: 5000 });
        } finally {
          this.eliminando.set(false);
        }
      });
  }

  cerrar(): void {
    this.dialogRef.close(this.cambiado);
  }
}
