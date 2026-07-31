import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Vehiculo, VehiculoDocumento, VehiculoMantenimiento, Viaje } from '../../core/models';
import { EstadoChip } from '../../shared/estado-chip';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { isoToDate } from '../../shared/date-utils';
import { MantenimientosService } from './mantenimientos.service';
import { ETIQUETAS_TIPO_DOCUMENTO, VehiculoDocumentosService } from './vehiculo-documentos.service';
import { VehiculoGastoFormDialog } from './vehiculo-gasto-form.dialog';
import { ViajeFormDialog } from './viaje-form.dialog';

/**
 * Ficha del vehículo: datos generales, documentos legales con su vigencia,
 * últimos mantenimientos y arranque rápido (nuevo viaje / gasto general).
 * Los formularios de mantenimiento y documento viven en la pantalla de
 * Mantenimiento; aquí solo se consultan.
 */
@Component({
  selector: 'app-vehiculo-detail',
  imports: [
    DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatTableModule,
    MatProgressBarModule, EstadoChip, MoneyPipe, CantidadPipe, HasPermissionDirective,
  ],
  template: `
    <h2 mat-dialog-title>
      {{ data.vehiculo.placa }}{{ data.vehiculo.nombre ? ' — ' + data.vehiculo.nombre : '' }}
    </h2>
    <mat-dialog-content>
      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <div class="info-grid">
        <div>
          <span class="etq">Marca / línea</span>
          <span>{{ data.vehiculo.marca ?? '—' }}{{ data.vehiculo.linea ? ' ' + data.vehiculo.linea : '' }}</span>
        </div>
        <div>
          <span class="etq">Año</span>
          <span>{{ data.vehiculo.anio ?? '—' }}</span>
        </div>
        <div>
          <span class="etq">Capacidad</span>
          <span>{{ data.vehiculo.capacidad_kg !== null ? (data.vehiculo.capacidad_kg | cantidad: 'kg') : '—' }}</span>
        </div>
        <div>
          <span class="etq">Tarifa por kilo</span>
          <span>{{ data.vehiculo.tarifa_kilo | money }}</span>
        </div>
        <div>
          <span class="etq">Odómetro actual</span>
          <span>{{ data.vehiculo.odometro_actual | cantidad: 'km' }}</span>
        </div>
        <div>
          <span class="etq">Estado</span>
          <app-estado-chip [estado]="data.vehiculo.estado" />
        </div>
      </div>
      @if (data.vehiculo.observaciones) {
        <p class="observaciones">{{ data.vehiculo.observaciones }}</p>
      }

      <div class="arranque">
        <button mat-stroked-button *hasPermission="'transporte:crear'" (click)="nuevoViaje()">
          <mat-icon>local_shipping</mat-icon> Nuevo viaje
        </button>
        <button mat-stroked-button *hasPermission="'transporte:crear'" (click)="nuevoGasto()">
          <mat-icon>receipt_long</mat-icon> Gasto general
        </button>
      </div>

      <p class="seccion">Documentos legales</p>
      @if (documentos().length > 0) {
        <table mat-table [dataSource]="documentos()">
          <ng-container matColumnDef="tipo">
            <th mat-header-cell *matHeaderCellDef>Tipo</th>
            <td mat-cell *matCellDef="let doc">
              {{ etiquetaDocumento(doc.tipo) }}{{ doc.numero ? ' · ' + doc.numero : '' }}
            </td>
          </ng-container>
          <ng-container matColumnDef="vencimiento">
            <th mat-header-cell *matHeaderCellDef>Vence</th>
            <td mat-cell *matCellDef="let doc">{{ doc.fecha_vencimiento | date: 'dd/MM/yyyy' }}</td>
          </ng-container>
          <ng-container matColumnDef="vigencia">
            <th mat-header-cell *matHeaderCellDef>Vigencia</th>
            <td mat-cell *matCellDef="let doc"><app-estado-chip [estado]="vigenciaDe(doc)" /></td>
          </ng-container>
          <ng-container matColumnDef="valor">
            <th mat-header-cell *matHeaderCellDef class="num">Valor</th>
            <td mat-cell *matCellDef="let doc" class="num">{{ doc.valor | money }}</td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="columnasDocumentos"></tr>
          <tr mat-row *matRowDef="let doc; columns: columnasDocumentos"></tr>
        </table>
      } @else if (!cargando()) {
        <p class="sin-datos">Sin documentos registrados (se cargan en la pantalla de Mantenimiento)</p>
      }

      <p class="seccion">Últimos mantenimientos</p>
      @if (mantenimientos().length > 0) {
        <table mat-table [dataSource]="mantenimientos()">
          <ng-container matColumnDef="fecha">
            <th mat-header-cell *matHeaderCellDef>Fecha</th>
            <td mat-cell *matCellDef="let mant">{{ mant.fecha | date: 'dd/MM/yyyy' }}</td>
          </ng-container>
          <ng-container matColumnDef="tipo">
            <th mat-header-cell *matHeaderCellDef>Tipo</th>
            <td mat-cell *matCellDef="let mant">{{ mant.tipo === 'preventivo' ? 'Preventivo' : 'Correctivo' }}</td>
          </ng-container>
          <ng-container matColumnDef="descripcion">
            <th mat-header-cell *matHeaderCellDef>Descripción</th>
            <td mat-cell *matCellDef="let mant">{{ mant.descripcion }}</td>
          </ng-container>
          <ng-container matColumnDef="valor">
            <th mat-header-cell *matHeaderCellDef class="num">Valor</th>
            <td mat-cell *matCellDef="let mant" class="num">{{ mant.valor | money }}</td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="columnasMantenimientos"></tr>
          <tr mat-row *matRowDef="let mant; columns: columnasMantenimientos"></tr>
        </table>
      } @else if (!cargando()) {
        <p class="sin-datos">Sin mantenimientos registrados</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cerrar()">Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: `
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 8px;

      div { display: flex; flex-direction: column; gap: 2px; }
      .etq { font-size: 0.75rem; color: var(--mat-sys-on-surface-variant); }
    }
    .observaciones {
      margin: 8px 0 0;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: pre-line;
    }
    .arranque {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 16px 0 4px;
    }
    .seccion { margin: 16px 0 4px; font-size: 1rem; font-weight: 500; }
    table { width: 100%; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .sin-datos { color: var(--mat-sys-on-surface-variant); font-size: 0.9rem; }
  `,
})
export class VehiculoDetailDialog {
  private readonly documentosService = inject(VehiculoDocumentosService);
  private readonly mantenimientosService = inject(MantenimientosService);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef<VehiculoDetailDialog>);
  private readonly snackbar = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly data = inject<{ vehiculo: Vehiculo }>(MAT_DIALOG_DATA);

  readonly etiquetasDocumento = ETIQUETAS_TIPO_DOCUMENTO;
  readonly columnasDocumentos = ['tipo', 'vencimiento', 'vigencia', 'valor'];
  readonly columnasMantenimientos = ['fecha', 'tipo', 'descripcion', 'valor'];

  readonly documentos = signal<VehiculoDocumento[]>([]);
  readonly mantenimientos = signal<VehiculoMantenimiento[]>([]);
  readonly cargando = signal(false);
  readonly huboCambios = signal(false);

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
      const [documentos, mantenimientos] = await Promise.all([
        firstValueFrom(
          this.documentosService.filtrar({ vehiculo_id: this.data.vehiculo.id, page_size: 20 }),
        ),
        firstValueFrom(
          this.mantenimientosService.filtrar({ vehiculo_id: this.data.vehiculo.id, page_size: 5 }),
        ),
      ]);
      this.documentos.set(documentos.items);
      this.mantenimientos.set(mantenimientos.items);
    } finally {
      this.cargando.set(false);
    }
  }

  etiquetaDocumento(tipo: string): string {
    return this.etiquetasDocumento[tipo] ?? tipo;
  }

  /** Vigencia calculada en el cliente: vencido / por vencer (30 días) / vigente. */
  vigenciaDe(documento: VehiculoDocumento): string {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const vencimiento = isoToDate(documento.fecha_vencimiento);
    if (!vencimiento) return 'vigente';
    const dias = Math.round((vencimiento.getTime() - hoy.getTime()) / 86_400_000);
    if (dias < 0) return 'vencido';
    if (dias <= 30) return 'por vencer';
    return 'vigente';
  }

  nuevoViaje(): void {
    this.dialog
      .open(ViajeFormDialog, { data: { vehiculoId: this.data.vehiculo.id }, width: '640px' })
      .afterClosed()
      .subscribe((viaje?: Viaje) => {
        if (!viaje) return;
        this.snackbar.open('Viaje registrado', 'OK', { duration: 3000 });
        // Directo al detalle del viaje a cargar los fletes.
        this.dialogRef.close(this.huboCambios());
        this.router.navigate(['/transporte/viajes', viaje.id]);
      });
  }

  nuevoGasto(): void {
    this.dialog
      .open(VehiculoGastoFormDialog, {
        data: { vehiculoId: this.data.vehiculo.id },
        width: '640px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.huboCambios.set(true);
          this.snackbar.open('Gasto guardado', 'OK', { duration: 3000 });
        }
      });
  }
}
