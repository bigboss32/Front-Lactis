import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { TipoQueso } from '../../core/models';
import { TiposQuesoService } from './produccion.service';

@Component({
  selector: 'app-tipo-queso-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar tipo de queso' : 'Nuevo tipo de queso' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-tipo-queso" (ngSubmit)="guardar()">
        <mat-form-field class="full">
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" required />
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Descripción</mat-label>
          <textarea matInput formControlName="descripcion" rows="2"></textarea>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Precio de referencia</mat-label>
          <input matInput type="number" min="0" formControlName="precio_referencia" required />
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-tipo-queso"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
})
export class TipoQuesoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(TiposQuesoService);
  private readonly dialogRef = inject(MatDialogRef<TipoQuesoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: TipoQueso } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    nombre: [this.data?.item?.nombre ?? '', [Validators.required, Validators.minLength(2)]],
    descripcion: [this.data?.item?.descripcion ?? ''],
    precio_referencia: [
      Number(this.data?.item?.precio_referencia ?? 0),
      [Validators.required, Validators.min(0)],
    ],
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const payload = this.form.getRawValue();
      if (this.data?.item) {
        await firstValueFrom(this.servicio.update(this.data.item.id, payload));
      } else {
        await firstValueFrom(this.servicio.create(payload));
      }
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible guardar')
          : 'No fue posible guardar';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
