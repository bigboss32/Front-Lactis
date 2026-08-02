import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { Liquidacion, Monto } from '../../core/models';
import { dateToIso, hoyDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { MoneyPipe } from '../../shared/pipes';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { LiquidacionesService } from './liquidaciones.service';

export interface PagoDialogData {
  /** La liquidación a la que se le abona. */
  id: string;
  /** Proveedor o transportador, para que se vea a quién se le está pagando. */
  tercero: string;
  /** Lo que TODAVÍA se le debe: el tope de este pago. */
  saldo: Monto;
}

/**
 * Registra un pago (total o parcial) de una liquidación aprobada.
 *
 * Copia el diálogo de abonos de reventa a propósito: misma forma, mismos
 * campos y mismo comportamiento, para que registrar un pago se sienta igual en
 * todo el sistema.
 *
 * El valor viene PRELLENADO con el saldo completo: el caso de siempre es pagar
 * todo de una, y así el botón "Pagar" de siempre sigue siendo Pagar → Enter.
 * Quien vaya a abonar solo una parte cambia la cifra.
 */
@Component({
  selector: 'app-pago-liquidacion-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatButtonModule, MoneyPipe, MilesInputDirective,
    SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>Registrar pago — {{ data.tercero }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-pago-liquidacion" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha del pago</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Valor</mat-label>
          <!-- cdkFocusInitial: el foco arranca en el valor, no en la fecha (que se llena con el calendario). -->
          <input matInput type="text" inputmode="numeric" appMiles formControlName="valor" required cdkFocusInitial />
          <span matTextPrefix>$&nbsp;</span>
          <mat-hint>
            Saldo pendiente: {{ data.saldo | money }}. Si le paga menos, queda debiendo el resto.
          </mat-hint>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea matInput formControlName="observaciones" rows="2"></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-pago-liquidacion"
        [disabled]="form.invalid || guardando()"
      >
        @if (guardando()) {
          <app-spinner-boton /> Registrando pago…
        } @else {
          Registrar pago
        }
      </button>
    </mat-dialog-actions>
  `,
})
export class PagoLiquidacionFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(LiquidacionesService);
  private readonly dialogRef = inject(MatDialogRef<PagoLiquidacionFormDialog, Liquidacion>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<PagoDialogData>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    fecha: [hoyDate(), Validators.required],
    valor: [
      Number(this.data.saldo),
      // El tope también va aquí, no solo en el backend: es la diferencia entre
      // avisar mientras se teclea y dejar que el usuario oprima Guardar para
      // que el servidor le diga que no.
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
      const actualizada = await firstValueFrom(
        this.servicio.registrarPago(this.data.id, {
          fecha: dateToIso(valores.fecha),
          valor: Number(valores.valor),
          observaciones: valores.observaciones || null,
        }),
      );
      // Se devuelve la liquidación que respondió el servidor: quien abrió el
      // diálogo pinta ESA y no una versión calculada a mano, que podría diferir.
      this.dialogRef.close(actualizada);
    } catch (err) {
      // Cuando no se sabe si el pago entró (tiempo agotado, 5xx, señal caída con
      // el celular en línea) el aviso dura mucho más y hay que cerrarlo a mano:
      // es el mensaje que evita que el dueño lo registre dos veces.
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible registrar el pago');
    } finally {
      this.guardando.set(false);
    }
  }
}
