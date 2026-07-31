import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { Monto } from '../../core/models';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { MoneyPipe } from '../../shared/pipes';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { dateToIso, hoyDate } from '../../shared/date-utils';
import { ViajesService } from './viajes.service';

export interface AbonoFleteDialogData {
  servicioId: string;
  titulo: string;
  saldo: Monto;
}

/** Registra un abono (pago parcial) a un servicio de flete. */
@Component({
  selector: 'app-abono-flete-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatDatepickerModule, MatButtonModule, MoneyPipe,
    MilesInputDirective, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.titulo }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-abono-flete" (ngSubmit)="guardar()">
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
        <mat-form-field>
          <mat-label>Método</mat-label>
          <mat-select formControlName="metodo">
            <mat-option value="efectivo">Efectivo</mat-option>
            <mat-option value="transferencia">Transferencia</mat-option>
            <mat-option value="otro">Otro</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Referencia</mat-label>
          <input matInput formControlName="referencia" maxlength="100" />
          <mat-hint>Opcional; nº de la transferencia</mat-hint>
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
        form="form-abono-flete"
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
    // Espacio extra entre filas: las pistas del saldo y la referencia ocupan una línea más.
    .form-grid { row-gap: 22px; }
  `,
})
export class AbonoFleteFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ViajesService);
  private readonly dialogRef = inject(MatDialogRef<AbonoFleteFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<AbonoFleteDialogData>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    fecha: [hoyDate(), Validators.required],
    valor: [
      Number(this.data.saldo),
      [Validators.required, Validators.min(0.01), Validators.max(Number(this.data.saldo))],
    ],
    metodo: ['efectivo' as 'efectivo' | 'transferencia' | 'otro', Validators.required],
    referencia: [''],
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
      const actualizado = await firstValueFrom(
        this.servicio.registrarAbono(this.data.servicioId, {
          fecha: dateToIso(valores.fecha)!,
          valor: Number(valores.valor),
          metodo: valores.metodo,
          referencia: valores.referencia.trim() || null,
          observaciones: valores.observaciones || null,
        }),
      );
      this.dialogRef.close(actualizado);
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
