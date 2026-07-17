import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
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
import { MilesInputDirective } from '../../shared/miles-input.directive';

@Component({
  selector: 'app-abrir-caja-dialog',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule,
    MatDatepickerModule, MilesInputDirective,
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
        Abrir caja
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
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible abrir la caja')
          : 'No fue posible abrir la caja';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
