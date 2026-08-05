import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MoneyPipe } from '../../shared/pipes';
import { AbonoReventa, ReventaService } from './reventa.service';

/**
 * Los abonos de UN PRODUCTO de la factura, con el nombre del producto.
 *
 * Los abonos cuelgan del producto y no de la cabecera: un abono a la factura se
 * DERRAMA sobre sus productos en orden, y cada cuota queda siendo un abono entero
 * de un producto. Por eso aquí hay que saber de cuál viene cada uno: sin el id del
 * renglón no se puede eliminar el que se registró por error.
 */
export interface ParteAbonada {
  /** Id del RENGLÓN (la compra o la venta), no de la factura. */
  id: string;
  /** "Queso", "Mozzarella"… para la columna Producto. */
  etiqueta: string;
  abonos: AbonoReventa[];
}

export interface AbonosDialogData {
  titulo: string;
  /** A qué lado pertenece la lista, para saber a qué ruta pedir la eliminación. */
  tipo: 'compra' | 'venta';
  partes: ParteAbonada[];
}

/** Una fila de la tabla: el abono más de qué producto salió. */
interface FilaAbono {
  abono: AbonoReventa;
  renglonId: string;
  etiqueta: string;
}

/**
 * Los abonos de una factura de reventa, producto por producto. Permite eliminar
 * uno registrado por error: el backend baja el "abonado" del producto y recalcula
 * su estado (y con él el de la factura, que es derivado).
 *
 * LA COLUMNA "PRODUCTO" SOLO APARECE CUANDO HAY VARIOS: en una factura de un solo
 * producto sería una columna con la misma palabra repetida. Y al pie va el TOTAL
 * ABONADO, que es la suma exacta de las filas de arriba: es la cifra que el dueño
 * compara contra la de la lista.
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
      @if (filas().length > 0) {
        <table mat-table [dataSource]="filas()">
          <ng-container matColumnDef="fecha">
            <th mat-header-cell *matHeaderCellDef>Fecha</th>
            <td mat-cell *matCellDef="let fila">{{ fila.abono.fecha | date: 'dd/MM/yyyy' }}</td>
            <td mat-footer-cell *matFooterCellDef>Total abonado</td>
          </ng-container>

          <ng-container matColumnDef="producto">
            <th mat-header-cell *matHeaderCellDef>Producto</th>
            <td mat-cell *matCellDef="let fila">{{ fila.etiqueta }}</td>
            <td mat-footer-cell *matFooterCellDef></td>
          </ng-container>

          <ng-container matColumnDef="valor">
            <th mat-header-cell *matHeaderCellDef class="num">Valor</th>
            <!-- Con centavos: la suma de esta columna tiene que dar EXACTO el total
                 abonado de la factura, y el dueño la cuadra a mano. -->
            <td mat-cell *matCellDef="let fila" class="num">{{ fila.abono.valor | money: true }}</td>
            <td mat-footer-cell *matFooterCellDef class="num">
              <strong>{{ totalAbonado() | money: true }}</strong>
            </td>
          </ng-container>

          <ng-container matColumnDef="observaciones">
            <th mat-header-cell *matHeaderCellDef>Observaciones</th>
            <td mat-cell *matCellDef="let fila">{{ fila.abono.observaciones || '—' }}</td>
            <td mat-footer-cell *matFooterCellDef></td>
          </ng-container>

          <ng-container matColumnDef="acciones">
            <th mat-header-cell *matHeaderCellDef class="col-acciones"></th>
            <td mat-cell *matCellDef="let fila" class="col-acciones">
              <!--
                'reventa:eliminar', NO 'crear'. El backend exige 'eliminar' para
                borrar un abono (borrar una entrega de plata es la puerta para
                taparla), así que con 'crear' a quien solo puede ANOTAR abonos le
                aparecía el botón y al pulsarlo se llevaba un 403. Un botón que
                engaña es peor que un botón que no está.
              -->
              <button
                mat-icon-button
                *hasPermission="'reventa:eliminar'"
                matTooltip="Eliminar este abono (registrado por error)"
                [disabled]="eliminando()"
                (click)="eliminarAbono(fila)"
              >
                <mat-icon>delete</mat-icon>
              </button>
            </td>
            <td mat-footer-cell *matFooterCellDef class="col-acciones"></td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="columnas()"></tr>
          <tr mat-row *matRowDef="let fila; columns: columnas()"></tr>
          <tr mat-footer-row *matFooterRowDef="columnas()"></tr>
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
    td.mat-mdc-footer-cell { font-weight: 500; }
  `,
})
export class AbonosListDialog {
  private readonly servicio = inject(ReventaService);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef<AbonosListDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<AbonosDialogData>(MAT_DIALOG_DATA);
  readonly eliminando = signal(false);

  /**
   * Las filas, en el orden en que vienen los productos de la factura (que es el
   * orden en que se derramó cada abono). No se reordenan por fecha: el orden de los
   * productos es el que le permite al dueño seguir el derrame con el dedo.
   */
  readonly filas = signal<FilaAbono[]>(
    this.data.partes.flatMap((parte) =>
      parte.abonos.map((abono) => ({ abono, renglonId: parte.id, etiqueta: parte.etiqueta })),
    ),
  );

  /** La suma EXACTA de las filas de arriba: es lo que dice la columna del pie. */
  readonly totalAbonado = computed(() =>
    this.filas().reduce((suma, fila) => suma + Number(fila.abono.valor), 0),
  );

  readonly columnas = computed(() => {
    const conProducto = this.data.partes.length > 1;
    return conProducto
      ? ['fecha', 'producto', 'valor', 'observaciones', 'acciones']
      : ['fecha', 'valor', 'observaciones', 'acciones'];
  });

  /** Se pone en true si se eliminó algún abono, para que la lista se recargue al cerrar. */
  private cambiado = false;

  eliminarAbono(fila: FilaAbono): void {
    const valor = `$${Number(fila.abono.valor).toLocaleString('es-CO')}`;
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
            await firstValueFrom(
              this.servicio.eliminarAbonoCompra(fila.renglonId, fila.abono.id),
            );
          } else {
            await firstValueFrom(this.servicio.eliminarAbonoVenta(fila.renglonId, fila.abono.id));
          }
          this.filas.update((lista) => lista.filter((f) => f.abono.id !== fila.abono.id));
          this.cambiado = true;
          this.snackbar.open('Abono eliminado', 'OK', { duration: 3000 });
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible eliminar el abono');
        } finally {
          this.eliminando.set(false);
        }
      });
  }

  cerrar(): void {
    this.dialogRef.close(this.cambiado);
  }
}
