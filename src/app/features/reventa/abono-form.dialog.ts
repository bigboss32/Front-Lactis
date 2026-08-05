import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { Monto } from '../../core/models';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { MoneyPipe } from '../../shared/pipes';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { dateToIso, hoyDate } from '../../shared/date-utils';
import { ReventaService } from './reventa.service';

export interface AbonoDialogData {
  /** A qué lado pertenece: compra a productor o venta a cliente. */
  tipo: 'compra' | 'venta';
  /** Id de la FACTURA si `documento` es true; si no, del producto (renglón). */
  id: string;
  titulo: string;
  saldo: Monto;
  /**
   * `true` = el abono es a la FACTURA ENTERA y se derrama sobre sus productos.
   *
   * Se derrama, NO se divide: entra a los productos en su orden y a cada uno le toca
   * `min(lo que queda, su saldo)`. Sin división no hay redondeo, así que la suma de
   * los abonos da el abono exacto y cada uno queda siendo una cifra entera que el
   * dueño puede señalar. Un reparto proporcional sería la forma más fácil de
   * descuadrar la cartera.
   */
  documento?: boolean;
  /** Cuántos productos tiene la factura, para explicar el reparto cuando hay varios. */
  cuantosProductos?: number;
}

/**
 * Registra un abono (pago parcial) a una factura de reventa o a uno solo de sus
 * productos.
 */
@Component({
  selector: 'app-abono-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatButtonModule, MoneyPipe, MilesInputDirective,
    SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.titulo }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-abono" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Valor</mat-label>
          <!-- cdkFocusInitial: el foco arranca en el valor, no en la fecha (que se llena con el calendario). -->
          <input matInput type="text" inputmode="numeric" appMiles formControlName="valor" required cdkFocusInitial />
          <span matTextPrefix>$&nbsp;</span>
          <mat-hint>Saldo pendiente: {{ data.saldo | money }}</mat-hint>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea matInput formControlName="observaciones" rows="2"></textarea>
        </mat-form-field>
      </form>
      @if (reparteEntreProductos) {
        <!-- Se dice cómo se reparte ANTES de registrarlo: el dueño va a ver el abono
             partido en varias cifras cuando abra los abonos, y tiene que reconocerlas. -->
        <p class="aviso-derrame">
          Este abono se le aplica a los {{ data.cuantosProductos }} productos de la
          factura <strong>en orden</strong>: se le abona al primero hasta donde
          alcance, después al segundo, y así. No se parte en pedacitos iguales.
        </p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-abono"
        [disabled]="form.invalid || guardando()"
      >
        @if (guardando()) {
          <app-spinner-boton /> Registrando abono…
        } @else {
          Registrar abono
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .aviso-derrame {
      margin: 12px 0 0;
      padding: 8px 12px;
      border-radius: 10px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.84rem;
      line-height: 1.45;
    }
  `,
})
export class AbonoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<AbonoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<AbonoDialogData>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  /** El abono va a una factura DE VARIOS productos, así que hay que explicar el reparto. */
  readonly reparteEntreProductos = !!this.data.documento && (this.data.cuantosProductos ?? 1) > 1;

  readonly form = this.fb.group({
    fecha: [hoyDate(), Validators.required],
    valor: [
      Number(this.data.saldo),
      [Validators.required, Validators.min(0.01), Validators.max(Number(this.data.saldo))],
    ],
    observaciones: [''],
  });

  constructor() {
    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const payload = {
        fecha: dateToIso(valores.fecha),
        valor: Number(valores.valor),
        observaciones: valores.observaciones || null,
      };
      if (this.data.documento) {
        // A la factura entera: el backend lo derrama sobre sus productos, en orden.
        await firstValueFrom(this.servicio.abonarDocumento(this.data.id, payload));
      } else if (this.data.tipo === 'compra') {
        await firstValueFrom(this.servicio.abonarCompra(this.data.id, payload));
      } else {
        await firstValueFrom(this.servicio.abonarVenta(this.data.id, payload));
      }
      this.dialogRef.close(true);
    } catch (err) {
      // Cuando no se sabe si el abono entró (tiempo agotado, 5xx, señal caída
      // con el celular en línea) el aviso dura mucho más y hay que cerrarlo a
      // mano: es el mensaje que evita que el dueño lo registre dos veces.
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible registrar el abono');
    } finally {
      this.guardando.set(false);
    }
  }
}
