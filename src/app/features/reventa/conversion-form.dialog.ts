import { HttpErrorResponse } from '@angular/common/http';
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
import { dateToIso, hoyDate } from '../../shared/date-utils';
import { CantidadPipe } from '../../shared/pipes';
import { ReventaService } from './reventa.service';

export interface ConversionDialogData {
  /** Kilos de queso disponibles para pasar a borona (kilos_disponibles). */
  disponible: Monto;
}

/**
 * Pasa queso del inventario de reventa a borona (queso devuelto o que ya no
 * sirve como queso entero). El backend valida contra el disponible real.
 */
@Component({
  selector: 'app-conversion-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatButtonModule, CantidadPipe,
  ],
  template: `
    <h2 mat-dialog-title>Pasar queso a borona</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-conversion" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Kilos</mat-label>
          <input matInput type="number" min="0" step="0.1" formControlName="kilos" required />
          <span matTextSuffix>kg</span>
          <mat-hint>Disponible: {{ data.disponible | cantidad: 'kg' }}</mat-hint>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea
            matInput
            formControlName="observaciones"
            rows="2"
            placeholder="Ej. Queso devuelto del viaje"
          ></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-conversion"
        [disabled]="form.invalid || guardando()"
      >
        Pasar a borona
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    // Espacio extra: la pista de disponible ocupa una línea adicional.
    .form-grid { row-gap: 22px; }
  `,
})
export class ConversionFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<ConversionFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<ConversionDialogData>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    fecha: [hoyDate(), Validators.required],
    kilos: [0, [Validators.required, Validators.min(0.01)]],
    observaciones: [''],
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      await firstValueFrom(
        this.servicio.crearConversion({
          fecha: dateToIso(valores.fecha),
          kilos: Number(valores.kilos),
          observaciones: valores.observaciones || null,
        }),
      );
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible pasar el queso a borona')
          : 'No fue posible pasar el queso a borona';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
