import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { CajaDiaria } from '../../core/models';
import { EstadoChip } from '../../shared/estado-chip';
import { MoneyPipe } from '../../shared/pipes';
import { CajaService } from './caja.service';
import { CerrarCajaDialog } from './cerrar-caja.dialog';
import { MovimientoCajaFormDialog } from './movimiento-caja-form.dialog';

/** Detalle de una caja diaria: resumen, movimientos y acciones (movimiento / arqueo). */
@Component({
  selector: 'app-caja-detalle-dialog',
  imports: [
    DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule,
    MatTableModule, EstadoChip, MoneyPipe, HasPermissionDirective,
  ],
  templateUrl: './caja-detalle.dialog.html',
  styles: `
    .resumen {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 32px;
      margin-bottom: 16px;
    }
    .dato span {
      display: block;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .dato strong { font-weight: 500; }
    .negativo { color: var(--mat-sys-error); }
    .num { text-align: right; }
    .sin-movimientos {
      padding: 24px 0;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class CajaDetalleDialog implements OnInit {
  private readonly servicio = inject(CajaService);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef<CajaDetalleDialog>);
  private readonly snackbar = inject(MatSnackBar);
  private readonly money = new MoneyPipe();

  readonly data = inject<{ cajaId: string }>(MAT_DIALOG_DATA);

  readonly caja = signal<CajaDiaria | null>(null);
  readonly cargando = signal(false);
  /** true si se registraron movimientos o se cerró la caja: el listado debe recargarse. */
  readonly cambios = signal(false);

  readonly columnas = ['tipo', 'concepto', 'referencia', 'valor'];

  ngOnInit(): void {
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.caja.set(await firstValueFrom(this.servicio.getById(this.data.cajaId)));
    } catch (err) {
      // Antes fallaba en silencio: el diálogo se quedaba vacío (o con los datos
      // viejos) sin decir que el refresco no llegó.
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible cargar la caja')
          : 'No fue posible cargar la caja';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.cargando.set(false);
    }
  }

  registrarMovimiento(): void {
    this.dialog
      .open(MovimientoCajaFormDialog, { data: { cajaId: this.data.cajaId }, width: '560px' })
      .afterClosed()
      .subscribe(async (guardado) => {
        if (guardado) {
          this.cambios.set(true);
          this.snackbar.open('Movimiento registrado', 'OK', { duration: 3000 });
          // Se espera el refresco: mientras esté en curso, cargando() mantiene
          // deshabilitado el botón del arqueo.
          await this.cargar();
        }
      });
  }

  cerrarCaja(): void {
    // Sin caja o con un refresco en curso no se abre el arqueo (el botón ya está
    // deshabilitado, pero la guarda cubre el clic disparado por teclado).
    if (!this.caja() || this.cargando()) return;
    // Se le pasa SOLO el id: el diálogo de arqueo pide la caja él mismo, porque
    // decide sobre el saldo (diferencia y nota obligatoria) y el cierre no se
    // puede reabrir; una foto tomada aquí puede estar vieja.
    this.dialog
      .open(CerrarCajaDialog, { data: { cajaId: this.data.cajaId }, width: '480px' })
      .afterClosed()
      .subscribe((cajaCerrada: CajaDiaria | undefined) => {
        if (cajaCerrada) {
          this.cambios.set(true);
          this.caja.set(cajaCerrada);
          this.snackbar.open(
            `Caja cerrada. Diferencia: ${this.money.transform(cajaCerrada.diferencia)}`,
            'OK',
            { duration: 6000 },
          );
        }
      });
  }

  cerrar(): void {
    this.dialogRef.close(this.cambios());
  }
}
