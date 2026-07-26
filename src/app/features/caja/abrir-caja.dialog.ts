import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { CajaService } from './caja.service';
import { dateToIso, hoyDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';

@Component({
  selector: 'app-abrir-caja-dialog',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule,
    MatDatepickerModule, MilesInputDirective, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>Abrir caja</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-abrir-caja" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Saldo inicial</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="saldo_inicial" required />
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-abrir-caja"
        [disabled]="form.invalid || guardando()"
      >
        @if (guardando()) {
          <app-spinner-boton /> Abriendo caja…
        } @else {
          Abrir caja
        }
      </button>
    </mat-dialog-actions>
  `,
})
export class AbrirCajaDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(CajaService);
  private readonly dialogRef = inject(MatDialogRef<AbrirCajaDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly guardando = signal(false);

  readonly form = this.fb.group({
    fecha: [hoyDate(), Validators.required],
    saldo_inicial: [0, [Validators.required, Validators.min(0)]],
  });

  constructor() {
    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      await firstValueFrom(
        this.servicio.abrir({ ...valores, fecha: dateToIso(valores.fecha) ?? '' }),
      );
      this.dialogRef.close(true);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible abrir la caja');
    } finally {
      this.guardando.set(false);
    }
  }
}
