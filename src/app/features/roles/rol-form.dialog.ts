import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Rol } from '../../core/models';
import { PermisosMatriz } from './permisos-matriz';
import { RolesService } from './roles.service';

@Component({
  selector: 'app-rol-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, PermisosMatriz,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar rol' : 'Nuevo rol' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-rol" (ngSubmit)="guardar()">
        <mat-form-field class="full">
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" required />
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Descripción</mat-label>
          <textarea matInput formControlName="descripcion" rows="2"></textarea>
        </mat-form-field>
      </form>
      @if (!data?.item) {
        <h3 class="subtitulo">Permisos del rol</h3>
        <app-permisos-matriz [(seleccionados)]="permisoIds" />
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-rol"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .subtitulo {
      margin: 8px 0;
      font-size: 0.95rem;
      font-weight: 500;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class RolFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(RolesService);
  private readonly dialogRef = inject(MatDialogRef<RolFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: Rol } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly permisoIds = signal<string[]>([]);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    nombre: [this.data?.item?.nombre ?? '', [Validators.required, Validators.minLength(3)]],
    descripcion: [this.data?.item?.descripcion ?? ''],
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valor = this.form.getRawValue();
      if (this.data?.item) {
        await firstValueFrom(
          this.servicio.update(this.data.item.id, {
            nombre: valor.nombre,
            descripcion: valor.descripcion || null,
          }),
        );
      } else {
        await firstValueFrom(
          this.servicio.create({
            nombre: valor.nombre,
            descripcion: valor.descripcion || null,
            permiso_ids: this.permisoIds(),
          }),
        );
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
