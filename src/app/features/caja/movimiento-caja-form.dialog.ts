import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { CajaService } from './caja.service';
import { MilesInputDirective } from '../../shared/miles-input.directive';

@Component({
  selector: 'app-movimiento-caja-form-dialog',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MilesInputDirective,
  ],
  template: `
    <h2 mat-dialog-title>Registrar movimiento de caja</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-mov-caja" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Tipo</mat-label>
          <mat-select formControlName="tipo" required>
            <mat-option value="ingreso">Ingreso</mat-option>
            <mat-option value="egreso">Egreso</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Valor</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="valor" required />
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Concepto</mat-label>
          <input matInput formControlName="concepto" required />
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Referencia</mat-label>
          <input matInput formControlName="referencia" />
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-mov-caja"
        [disabled]="form.invalid || guardando()"
      >
        Registrar
      </button>
    </mat-dialog-actions>
  `,
})
export class MovimientoCajaFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(CajaService);
  private readonly dialogRef = inject(MatDialogRef<MovimientoCajaFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ cajaId: string }>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    tipo: ['ingreso' as 'ingreso' | 'egreso', Validators.required],
    concepto: ['', [Validators.required, Validators.minLength(2)]],
    valor: [0, [Validators.required, Validators.min(0.01)]],
    referencia: [''],
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      await firstValueFrom(
        this.servicio.registrarMovimiento({
          caja_id: this.data.cajaId,
          tipo: valores.tipo,
          concepto: valores.concepto,
          valor: valores.valor,
          referencia: valores.referencia || null,
        }),
      );
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible registrar el movimiento')
          : 'No fue posible registrar el movimiento';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
