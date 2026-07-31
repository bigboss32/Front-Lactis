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
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { CarteraFleteCliente, CarteraFleteDetalle, CarteraFleteServicio } from '../../core/models';
import { EstadoChip } from '../../shared/estado-chip';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { detalleDeError } from '../../shared/errores-ui';
import { AbonoFleteFormDialog } from './abono-flete-form.dialog';
import { AbonosFleteListDialog } from './abonos-flete-list.dialog';
import { ViajesService } from './viajes.service';

export interface CarteraClienteDetalleData {
  /** Fila de la cartera: identifica al cliente (del directorio o por nombre). */
  cliente: CarteraFleteCliente;
}

/**
 * Detalle de la cartera de un cliente: sus fletes pendientes, con abono desde
 * aquí mismo (el cobro llega después del viaje) y salto al viaje de origen.
 * Cierra devolviendo true si hubo abonos, para que la cartera se recargue.
 */
@Component({
  selector: 'app-cartera-cliente-detalle',
  imports: [
    DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatTableModule,
    MatProgressBarModule, MatTooltipModule, EstadoChip, MoneyPipe, CantidadPipe,
    HasPermissionDirective,
  ],
  template: `
    <h2 mat-dialog-title>Cartera de {{ data.cliente.cliente_nombre }}</h2>
    <mat-dialog-content>
      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (errorCarga(); as error) {
        <div class="error-state" role="alert">
          <mat-icon aria-hidden="true">cloud_off</mat-icon>
          <p>{{ error }}</p>
          <button mat-stroked-button type="button" (click)="cargar()">
            <mat-icon>refresh</mat-icon> Reintentar
          </button>
        </div>
      }

      @if (detalle(); as d) {
        <div class="cifras">
          <div class="cifra">
            <span class="etq">Total facturado</span>
            <span class="val">{{ d.total_facturado | money }}</span>
          </div>
          <div class="cifra">
            <span class="etq">Total abonado</span>
            <span class="val">{{ d.total_abonado | money }}</span>
          </div>
          <div class="cifra">
            <span class="etq">Saldo pendiente</span>
            <span class="val con-saldo">{{ d.saldo | money }}</span>
          </div>
        </div>

        @if (d.servicios.length > 0) {
          <table mat-table [dataSource]="d.servicios">
            <ng-container matColumnDef="viaje">
              <th mat-header-cell *matHeaderCellDef>Viaje</th>
              <td mat-cell *matCellDef="let fila">
                Nº {{ fila.viaje_numero }}
                <span class="nota">{{ fila.viaje_fecha | date: 'dd/MM/yyyy' }}</span>
              </td>
            </ng-container>

            <ng-container matColumnDef="descripcion">
              <th mat-header-cell *matHeaderCellDef>Descripción</th>
              <td mat-cell *matCellDef="let fila">
                {{ fila.descripcion }}
                <span class="nota">{{ fila.sentido === 'ida' ? 'Ida' : 'Regreso' }}</span>
              </td>
            </ng-container>

            <ng-container matColumnDef="cobro">
              <th mat-header-cell *matHeaderCellDef>Cobro</th>
              <td mat-cell *matCellDef="let fila">
                @if (fila.tipo_cobro === 'por_kilo') {
                  {{ fila.kilos | cantidad: 'kg' }} × {{ fila.tarifa_kilo | money }}
                } @else {
                  Precio fijo
                }
              </td>
            </ng-container>

            <ng-container matColumnDef="valor">
              <th mat-header-cell *matHeaderCellDef class="num">Valor</th>
              <td mat-cell *matCellDef="let fila" class="num">{{ fila.valor_total | money }}</td>
            </ng-container>

            <ng-container matColumnDef="abonado">
              <th mat-header-cell *matHeaderCellDef class="num">Abonado</th>
              <td mat-cell *matCellDef="let fila" class="num">{{ fila.abonado | money }}</td>
            </ng-container>

            <ng-container matColumnDef="saldo">
              <th mat-header-cell *matHeaderCellDef class="num">Saldo</th>
              <td mat-cell *matCellDef="let fila" class="num">{{ fila.saldo | money }}</td>
            </ng-container>

            <ng-container matColumnDef="estado">
              <th mat-header-cell *matHeaderCellDef>Estado</th>
              <td mat-cell *matCellDef="let fila"><app-estado-chip [estado]="fila.estado" /></td>
            </ng-container>

            <ng-container matColumnDef="acciones">
              <th mat-header-cell *matHeaderCellDef class="col-acciones"></th>
              <td mat-cell *matCellDef="let fila" class="col-acciones">
                @if (puedeAbonar(fila)) {
                  <button
                    mat-icon-button
                    *hasPermission="'transporte:crear'"
                    matTooltip="Registrar abono"
                    (click)="abonar(fila)"
                  >
                    <mat-icon>payments</mat-icon>
                  </button>
                }
                <button mat-icon-button matTooltip="Ver abonos" (click)="verAbonos(fila)">
                  <mat-icon>receipt_long</mat-icon>
                </button>
                <button mat-icon-button matTooltip="Abrir el viaje" (click)="irAlViaje(fila)">
                  <mat-icon>open_in_new</mat-icon>
                </button>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="columnas"></tr>
            <tr mat-row *matRowDef="let fila; columns: columnas"></tr>
          </table>
        } @else if (!cargando()) {
          <div class="empty-state">
            <mat-icon>account_balance_wallet</mat-icon>
            <p>El cliente ya no tiene fletes pendientes</p>
          </div>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cerrar()">Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: `
    table { width: 100%; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }

    // Tres iconos por fila (abonar, ver abonos, abrir el viaje).
    .col-acciones { width: 144px; text-align: right; }

    .nota {
      display: block;
      font-size: 0.72rem;
      color: var(--mat-sys-on-surface-variant);
    }

    // -------------------------------------------------------------- cifras
    .cifras {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }

    .cifra {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 12px 14px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);

      .etq { font-size: 0.75rem; color: var(--mat-sys-on-surface-variant); }
      .val { font-size: 1.15rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    }

    .val.con-saldo { color: #c62828; }
    :host-context(html.dark) .val.con-saldo { color: #e57373; }
  `,
})
export class CarteraClienteDetalleDialog {
  private readonly servicio = inject(ViajesService);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef<CarteraClienteDetalleDialog>);
  private readonly snackbar = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly data = inject<CarteraClienteDetalleData>(MAT_DIALOG_DATA);

  readonly columnas = [
    'viaje', 'descripcion', 'cobro', 'valor', 'abonado', 'saldo', 'estado', 'acciones',
  ];
  readonly detalle = signal<CarteraFleteDetalle | null>(null);
  readonly cargando = signal(false);
  readonly errorCarga = signal<string | null>(null);
  /** True si se registró o eliminó algún abono: la cartera debe recargarse. */
  readonly huboCambios = signal(false);

  constructor() {
    // Se controla el cierre manualmente para devolver siempre `huboCambios`
    // aunque el usuario cierre con Escape o clic en el fondo.
    this.dialogRef.disableClose = true;
    this.dialogRef.backdropClick().pipe(takeUntilDestroyed()).subscribe(() => this.cerrar());
    this.dialogRef.keydownEvents().pipe(takeUntilDestroyed()).subscribe((evento) => {
      if (evento.key === 'Escape') this.cerrar();
    });
    this.cargar();
  }

  cerrar(): void {
    this.dialogRef.close(this.huboCambios());
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorCarga.set(null);
    try {
      // El backend exige cliente_id O cliente_nombre (los ocasionales no tienen id).
      const cliente = this.data.cliente;
      const params = cliente.cliente_id
        ? { cliente_id: cliente.cliente_id }
        : { cliente_nombre: cliente.cliente_nombre };
      this.detalle.set(await firstValueFrom(this.servicio.carteraDetalle(params)));
    } catch (err) {
      this.detalle.set(null);
      this.errorCarga.set(
        detalleDeError(
          err,
          'No se pudo cargar el detalle de la cartera. Revise la conexión e intente de nuevo.',
        ),
      );
    } finally {
      this.cargando.set(false);
    }
  }

  puedeAbonar(servicioFlete: CarteraFleteServicio): boolean {
    return (
      ['pendiente', 'parcial'].includes(servicioFlete.estado) &&
      Number(servicioFlete.saldo) > 0
    );
  }

  abonar(servicioFlete: CarteraFleteServicio): void {
    this.dialog
      .open(AbonoFleteFormDialog, {
        data: {
          servicioId: servicioFlete.id,
          titulo: `Abonar a "${servicioFlete.descripcion}"`,
          saldo: servicioFlete.saldo,
        },
        width: '520px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.huboCambios.set(true);
          this.snackbar.open('Abono registrado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  verAbonos(servicioFlete: CarteraFleteServicio): void {
    this.dialog
      .open(AbonosFleteListDialog, {
        data: {
          titulo: `Abonos de "${servicioFlete.descripcion}"`,
          servicioId: servicioFlete.id,
          abonos: servicioFlete.abonos,
        },
        width: '640px',
      })
      .afterClosed()
      .subscribe((cambiado) => {
        if (cambiado) {
          this.huboCambios.set(true);
          this.cargar();
        }
      });
  }

  /** Salta al detalle del viaje de origen del flete (y cierra este diálogo). */
  irAlViaje(servicioFlete: CarteraFleteServicio): void {
    this.cerrar();
    this.router.navigate(['/transporte/viajes', servicioFlete.viaje_id]);
  }
}
