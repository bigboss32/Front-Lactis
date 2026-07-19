import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { CantidadPipe } from '../../shared/pipes';
import { ConversionBorona, ReventaService } from './reventa.service';

/**
 * Panel plegable con el historial de queso pasado a borona. Se recarga cuando
 * la página incrementa `recargar` (tras crear una conversión) y avisa con
 * `cambio` cuando elimina una para que la página refresque el resumen.
 */
@Component({
  selector: 'app-conversion-list-panel',
  imports: [
    DatePipe, MatExpansionModule, MatTableModule, MatPaginatorModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    CantidadPipe, HasPermissionDirective,
  ],
  template: `
    <mat-expansion-panel class="historial">
      <mat-expansion-panel-header>
        <mat-panel-title>
          <mat-icon>inventory</mat-icon> Ajustes de inventario
        </mat-panel-title>
        <mat-panel-description>
          Queso pasado a borona o merma{{ total() ? ' (' + total() + ')' : '' }}
        </mat-panel-description>
      </mat-expansion-panel-header>

      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <table mat-table [dataSource]="filas()">
        <ng-container matColumnDef="fecha">
          <th mat-header-cell *matHeaderCellDef>Fecha</th>
          <td mat-cell *matCellDef="let fila">{{ fila.fecha | date: 'dd/MM/yyyy' }}</td>
        </ng-container>

        <ng-container matColumnDef="destino">
          <th mat-header-cell *matHeaderCellDef>Tipo</th>
          <td mat-cell *matCellDef="let fila">
            <span class="badge" [class.merma]="fila.destino === 'merma'">
              {{ fila.destino === 'merma' ? 'Merma' : 'Borona' }}
            </span>
          </td>
        </ng-container>

        <ng-container matColumnDef="kilos">
          <th mat-header-cell *matHeaderCellDef class="num">Kilos</th>
          <td mat-cell *matCellDef="let fila" class="num">{{ fila.kilos | cantidad: 'kg' }}</td>
        </ng-container>

        <ng-container matColumnDef="observaciones">
          <th mat-header-cell *matHeaderCellDef>Observaciones</th>
          <td mat-cell *matCellDef="let fila">{{ fila.observaciones || '—' }}</td>
        </ng-container>

        <ng-container matColumnDef="acciones">
          <th mat-header-cell *matHeaderCellDef class="col-acciones"></th>
          <td mat-cell *matCellDef="let fila" class="col-acciones">
            <button
              mat-icon-button
              *hasPermission="'reventa:eliminar'"
              matTooltip="Eliminar conversión"
              (click)="eliminar(fila)"
            >
              <mat-icon>delete</mat-icon>
            </button>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columnas"></tr>
        <tr mat-row *matRowDef="let fila; columns: columnas"></tr>
      </table>

      @if (!cargando() && filas().length === 0) {
        <div class="empty-state">
          <mat-icon>inventory</mat-icon>
          <p>Aún no hay ajustes de inventario</p>
        </div>
      }

      <mat-paginator
        [length]="total()"
        [pageIndex]="page() - 1"
        [pageSize]="pageSize()"
        [pageSizeOptions]="[10, 20, 50]"
        (page)="cambiarPagina($event)"
        showFirstLastButtons
      />
    </mat-expansion-panel>
  `,
  styles: `
    .historial { margin-top: 16px; }

    mat-panel-title {
      display: flex;
      align-items: center;
      gap: 8px;

      mat-icon { color: var(--mat-sys-on-surface-variant); }
    }

    table { width: 100%; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .col-acciones { width: 56px; text-align: right; }

    .badge {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 0.75rem;
      background: color-mix(in srgb, #1565c0 15%, transparent);
      color: #1565c0;
    }
    .badge.merma { background: color-mix(in srgb, #c62828 15%, transparent); color: #c62828; }

    :host-context(html.dark) {
      .badge { color: #64b5f6; }
      .badge.merma { color: #e57373; }
    }
  `,
})
export class ConversionListPanel {
  private readonly servicio = inject(ReventaService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  /** Contador que la página incrementa para forzar la recarga de la lista. */
  readonly recargar = input(0);
  /** Avisa a la página que hubo cambios para recargar el resumen. */
  readonly cambio = output<void>();

  readonly columnas = ['fecha', 'destino', 'kilos', 'observaciones', 'acciones'];
  readonly filas = signal<ConversionBorona[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  constructor() {
    effect(() => {
      this.recargar();
      untracked(() => {
        this.page.set(1);
        void this.cargar();
      });
    });
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.listarConversiones({ page: this.page(), page_size: this.pageSize() }),
      );
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    void this.cargar();
  }

  eliminar(fila: ConversionBorona): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar ajuste',
          mensaje:
            '¿Eliminar este ajuste? El queso volverá al inventario disponible.',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutarEliminar(fila.id);
      });
  }

  private async ejecutarEliminar(id: string): Promise<void> {
    try {
      await firstValueFrom(this.servicio.eliminarConversion(id));
      this.snackbar.open('Conversión eliminada', 'OK', { duration: 3000 });
      await this.cargar();
      this.cambio.emit();
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible eliminar la conversión')
          : 'No fue posible eliminar la conversión';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    }
  }
}
