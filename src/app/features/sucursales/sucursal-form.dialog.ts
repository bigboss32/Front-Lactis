import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Sucursal } from '../../core/models';
import { SucursalesService, TIPOS_SUCURSAL } from './sucursales.service';

@Component({
  selector: 'app-sucursal-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar sucursal' : 'Nueva sucursal' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-sucursal" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Tipo</mat-label>
          <mat-select formControlName="tipo" required>
            @for (tipo of tipos; track tipo.valor) {
              <mat-option [value]="tipo.valor">{{ tipo.etiqueta }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Dirección</mat-label>
          <input matInput formControlName="direccion" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Teléfono</mat-label>
          <input matInput formControlName="telefono" />
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Responsable</mat-label>
          <input matInput formControlName="responsable" />
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-sucursal"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
})
export class SucursalFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(SucursalesService);
  private readonly dialogRef = inject(MatDialogRef<SucursalFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: Sucursal } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly guardando = signal(false);

  readonly tipos = TIPOS_SUCURSAL;

  readonly form = this.fb.group({
    nombre: [this.data?.item?.nombre ?? '', [Validators.required, Validators.minLength(2)]],
    tipo: [this.data?.item?.tipo ?? 'centro_acopio', [Validators.required]],
    direccion: [this.data?.item?.direccion ?? ''],
    telefono: [this.data?.item?.telefono ?? ''],
    responsable: [this.data?.item?.responsable ?? ''],
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
