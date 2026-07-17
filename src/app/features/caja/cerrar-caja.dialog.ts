import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { CajaService } from './caja.service';

/** Arqueo de caja: registra el efectivo contado y cierra la caja del día. */
@Component({
  selector: 'app-cerrar-caja-dialog',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule,
    MilesInputDirective,
  ],
  template: `
    <h2 mat-dialog-title>Cerrar caja (arqueo)</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-cerrar-caja" (ngSubmit)="guardar()">
        <mat-form-field class="full">
          <mat-label>Efectivo contado</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="efectivo_contado" required />
          <span matTextPrefix>$&nbsp;</span>
          <mat-hint>Dinero físico contado al hacer el arqueo</mat-hint>
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
        form="form-cerrar-caja"
        [disabled]="form.invalid || guardando()"
      >
        Cerrar caja
      </button>
    </mat-dialog-actions>
  `,
})
export class CerrarCajaDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(CajaService);
  private readonly dialogRef = inject(MatDialogRef<CerrarCajaDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ cajaId: string }>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    efectivo_contado: [0, [Validators.required, Validators.min(0)]],
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
      const caja = await firstValueFrom(
        this.servicio.cerrar(this.data.cajaId, {
          efectivo_contado: valores.efectivo_contado,
          observaciones: valores.observaciones || null,
        }),
      );
      // Devuelve la caja actualizada para que el detalle muestre la diferencia.
      this.dialogRef.close(caja);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible cerrar la caja')
          : 'No fue posible cerrar la caja';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
