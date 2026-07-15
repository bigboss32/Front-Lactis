import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Empresa } from '../../core/models';
import { EmpresasService } from './empresas.service';

@Component({
  selector: 'app-empresa-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar empresa' : 'Nueva empresa' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-empresa" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>NIT</mat-label>
          <input matInput formControlName="nit" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Dirección</mat-label>
          <input matInput formControlName="direccion" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Ciudad</mat-label>
          <input matInput formControlName="ciudad" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Departamento</mat-label>
          <input matInput formControlName="departamento" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>País</mat-label>
          <input matInput formControlName="pais" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Teléfono</mat-label>
          <input matInput formControlName="telefono" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Correo</mat-label>
          <input matInput type="email" formControlName="correo" />
          @if (form.controls.correo.hasError('email')) {
            <mat-error>Correo inválido</mat-error>
          }
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-empresa"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
})
export class EmpresaFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(EmpresasService);
  private readonly dialogRef = inject(MatDialogRef<EmpresaFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: Empresa } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    nombre: [this.data?.item?.nombre ?? '', [Validators.required, Validators.minLength(2)]],
    nit: [this.data?.item?.nit ?? '', [Validators.required, Validators.minLength(3)]],
    direccion: [this.data?.item?.direccion ?? ''],
    ciudad: [this.data?.item?.ciudad ?? ''],
    departamento: [this.data?.item?.departamento ?? ''],
    pais: [this.data?.item?.pais ?? 'Colombia', [Validators.required, Validators.minLength(2)]],
    telefono: [this.data?.item?.telefono ?? ''],
    correo: [this.data?.item?.correo ?? '', [Validators.email]],
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      // El backend valida el correo como EmailStr: cadena vacía → null.
      const payload = { ...valores, correo: valores.correo || null };
      if (this.data?.item) {
        await firstValueFrom(this.servicio.update(this.data.item.id, payload));
        this.dialogRef.close(true);
      } else {
        // Al crear se devuelve la Empresa para encadenar el flujo
        // "crear administrador" desde la lista.
        const creada = await firstValueFrom(this.servicio.create(payload));
        this.dialogRef.close(creada);
      }
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
