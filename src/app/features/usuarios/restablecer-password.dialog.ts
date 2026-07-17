import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Usuario } from '../../core/models';
import { protegerCambios } from '../../shared/proteger-cambios';
import { UsuariosService } from './usuarios.service';

/** Contraseña con al menos una letra y un número (misma regla del backend). */
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;

@Component({
  selector: 'app-restablecer-password',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>Restablecer contraseña</h2>
    <mat-dialog-content>
      <p class="detalle">
        Se asignará una nueva contraseña a
        <strong>{{ data.usuario.nombre }} {{ data.usuario.apellido }}</strong>
        ({{ data.usuario.username }}).
      </p>
      <form [formGroup]="form" id="form-password" (ngSubmit)="guardar()">
        <mat-form-field class="full">
          <mat-label>Nueva contraseña</mat-label>
          <input
            matInput
            type="password"
            formControlName="password"
            required
            autocomplete="new-password"
          />
          <mat-hint>Mínimo 8 caracteres, con letras y números</mat-hint>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-password"
        [disabled]="form.invalid || guardando()"
      >
        Restablecer
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .detalle { margin: 0 0 12px; }
    .full { width: 100%; }
  `,
})
export class RestablecerPasswordDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(UsuariosService);
  private readonly dialogRef = inject(MatDialogRef<RestablecerPasswordDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ usuario: Usuario }>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    password: [
      '',
      [Validators.required, Validators.minLength(8), Validators.pattern(PASSWORD_PATTERN)],
    ],
  });

  constructor() {
    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      await firstValueFrom(
        this.servicio.restablecerPassword(this.data.usuario.id, this.form.getRawValue().password),
      );
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible restablecer la contraseña')
          : 'No fue posible restablecer la contraseña';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
