import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { CajaService } from './caja.service';

function hoyISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

@Component({
  selector: 'app-abrir-caja-dialog',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>Abrir caja</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-abrir-caja" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput type="date" formControlName="fecha" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Saldo inicial</mat-label>
          <input matInput type="number" min="0" formControlName="saldo_inicial" required />
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
    fecha: [hoyISO(), Validators.required],
    saldo_inicial: [0, [Validators.required, Validators.min(0)]],
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      await firstValueFrom(this.servicio.abrir(this.form.getRawValue()));
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
