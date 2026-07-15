import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';

import { MoneyPipe } from '../../shared/pipes';
import { AbonoReventa } from './reventa.service';

export interface AbonosDialogData {
  titulo: string;
  abonos: AbonoReventa[];
}

/** Lista de abonos registrados a una compra o a una venta de queso. */
@Component({
  selector: 'app-abonos-list',
  imports: [DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatTableModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>{{ data.titulo }}</h2>
    <mat-dialog-content>
      @if (data.abonos.length > 0) {
        <table mat-table [dataSource]="data.abonos">
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

          <tr mat-header-row *matHeaderRowDef="columnas"></tr>
          <tr mat-row *matRowDef="let abono; columns: columnas"></tr>
        </table>
      } @else {
        <div class="empty-state">
          <mat-icon>payments</mat-icon>
          <p>Aún no se han registrado abonos</p>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: `
    table { width: 100%; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
  `,
})
export class AbonosListDialog {
  readonly data = inject<AbonosDialogData>(MAT_DIALOG_DATA);
  readonly columnas = ['fecha', 'valor', 'observaciones'];
}
