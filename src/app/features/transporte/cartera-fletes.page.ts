import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { CarteraFleteCliente } from '../../core/models';
import { PageHeader } from '../../shared/page-header';
import { MoneyPipe } from '../../shared/pipes';
import { detalleDeError } from '../../shared/errores-ui';
import { CarteraClienteDetalleDialog } from './cartera-cliente-detalle.dialog';
import { ViajesService } from './viajes.service';

/** Saldos de fletes pendientes de cobro por cliente (clon de la cartera de ventas). */
@Component({
  selector: 'app-cartera-fletes',
  imports: [
    MatCardModule, MatTableModule, MatButtonModule, MatIconModule,
    MatProgressBarModule, MatTooltipModule, PageHeader, MoneyPipe,
  ],
  template: `
    <div class="page">
      <app-page-header
        titulo="Cartera de fletes"
        subtitulo="Saldos pendientes de cobro por cliente, ordenados por saldo"
      />

      <mat-card class="table-card tarjetas alto-limitado">
        @if (cargando()) {
          <mat-progress-bar mode="indeterminate" />
        }

        <!-- La tabla se oculta si la consulta falló: una tabla con solo el
             encabezado se lee igual que "no hay nada", que es justo lo que hay
             que evitar aquí. -->
        @if (!errorCarga()) {
          <!-- .zona-tabla es lo único que se desplaza: el encabezado fijo necesita
               un antecesor con scroll al que pegarse. -->
          <div class="zona-tabla">
            <table mat-table [dataSource]="filas()">
              <ng-container matColumnDef="cliente">
                <th mat-header-cell *matHeaderCellDef>Cliente</th>
                <td mat-cell *matCellDef="let fila" [attr.data-label]="'Cliente'">
                  <span class="cliente-directorio">
                    @if (fila.cliente_id) {
                      <mat-icon matTooltip="Cliente del directorio">group</mat-icon>
                    }
                    {{ fila.cliente_nombre }}
                  </span>
                </td>
                <td mat-footer-cell *matFooterCellDef>Total</td>
              </ng-container>

              <ng-container matColumnDef="servicios_pendientes">
                <th mat-header-cell *matHeaderCellDef class="num">Fletes pendientes</th>
                <td mat-cell *matCellDef="let fila" class="num" [attr.data-label]="'Fletes pendientes'">{{ fila.servicios_pendientes }}</td>
                <td mat-footer-cell *matFooterCellDef></td>
              </ng-container>

              <ng-container matColumnDef="total_facturado">
                <th mat-header-cell *matHeaderCellDef class="num">Facturado</th>
                <td mat-cell *matCellDef="let fila" class="num" [attr.data-label]="'Facturado'">{{ fila.total_facturado | money }}</td>
                <td mat-footer-cell *matFooterCellDef></td>
              </ng-container>

              <ng-container matColumnDef="total_abonado">
                <th mat-header-cell *matHeaderCellDef class="num">Abonado</th>
                <td mat-cell *matCellDef="let fila" class="num" [attr.data-label]="'Abonado'">{{ fila.total_abonado | money }}</td>
                <td mat-footer-cell *matFooterCellDef></td>
              </ng-container>

              <ng-container matColumnDef="saldo">
                <th mat-header-cell *matHeaderCellDef class="num">Saldo</th>
                <td mat-cell *matCellDef="let fila" class="num" [attr.data-label]="'Saldo'">{{ fila.saldo | money }}</td>
                <td mat-footer-cell *matFooterCellDef class="num">{{ totalSaldo() | money }}</td>
              </ng-container>

              <tr mat-header-row *matHeaderRowDef="columnas; sticky: true"></tr>
              <tr
                mat-row
                *matRowDef="let fila; columns: columnas"
                class="fila-click"
                matTooltip="Ver los fletes pendientes y abonar"
                (click)="abrirDetalle(fila)"
              ></tr>
              <!-- El pie va SIEMPRE presente, nunca dentro de un @if: MatTable
                   registra las definiciones de fila en el primer render y no
                   vuelve a pintar el <tfoot> si la definición aparece después,
                   así que el "Total" no se pintaba jamás y el dueño tenía que
                   sumar de cabeza. Cuando no hay filas se oculta con [hidden]
                   (CSS), que no toca el registro de la definición. -->
              <tr mat-footer-row *matFooterRowDef="columnas; sticky: true" [hidden]="filas().length === 0"></tr>
            </table>
          </div>
        }

        @if (errorCarga(); as error) {
          <div class="error-state" role="alert">
            <mat-icon aria-hidden="true">cloud_off</mat-icon>
            <p>{{ error }}</p>
            <p class="aclara">Esto no quiere decir que no le deban: la consulta no alcanzó a llegar.</p>
            <button mat-stroked-button type="button" (click)="cargar()">
              <mat-icon>refresh</mat-icon> Reintentar
            </button>
          </div>
        }

        <!-- El estado vacío solo cuando de verdad se consultó y no había nada. -->
        @if (!cargando() && !errorCarga() && filas().length === 0) {
          <div class="empty-state">
            <mat-icon>account_balance_wallet</mat-icon>
            <p>No hay fletes pendientes de cobro</p>
          </div>
        }
      </mat-card>
    </div>
  `,
  styles: `
    .mat-mdc-footer-cell { font-weight: 600; }

    .fila-click { cursor: pointer; }
    .fila-click:hover td { background: color-mix(in srgb, currentColor 5%, transparent); }

    .cliente-directorio {
      display: inline-flex;
      align-items: center;
      gap: 4px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-on-surface-variant); }
    }

    // El atributo [hidden] lo esconde el navegador con display:none, pero
    // cualquier regla de Material sobre la fila gana por especificidad. Se
    // reafirma aquí para que ocultar el pie sin filas funcione siempre.
    tr[hidden] { display: none; }
  `,
})
export class CarteraFletesPage implements OnInit {
  private readonly servicio = inject(ViajesService);
  private readonly dialog = inject(MatDialog);

  readonly columnas = ['cliente', 'servicios_pendientes', 'total_facturado', 'total_abonado', 'saldo'];
  readonly filas = signal<CarteraFleteCliente[]>([]);
  readonly cargando = signal(false);
  /**
   * Mensaje de la consulta fallida. Mientras esté puesto NO se muestra el estado
   * vacío: "No hay fletes pendientes de cobro" sobre un fallo de red es una
   * mentira sobre la plata que le deben, y el usuario decide cobros con eso.
   */
  readonly errorCarga = signal<string | null>(null);

  readonly totalSaldo = computed(() =>
    this.filas().reduce((acum, fila) => acum + Number(fila.saldo), 0),
  );

  ngOnInit(): void {
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorCarga.set(null);
    try {
      const cartera = await firstValueFrom(this.servicio.cartera());
      this.filas.set([...cartera].sort((a, b) => Number(b.saldo) - Number(a.saldo)));
    } catch (err) {
      // Se borran los saldos anteriores a propósito: si la recarga falló, las
      // cifras de la pantalla ya no se pueden confirmar y cobrar sobre un saldo
      // viejo es el mismo error que cobrar sobre uno inventado.
      this.filas.set([]);
      this.errorCarga.set(
        detalleDeError(
          err,
          'No se pudieron cargar los saldos de la cartera. Revise la conexión e intente de nuevo.',
        ),
      );
    } finally {
      this.cargando.set(false);
    }
  }

  abrirDetalle(fila: CarteraFleteCliente): void {
    this.dialog
      .open(CarteraClienteDetalleDialog, { data: { cliente: fila }, width: '900px' })
      .afterClosed()
      .subscribe((cambiado) => {
        if (cambiado) this.cargar();
      });
  }
}
