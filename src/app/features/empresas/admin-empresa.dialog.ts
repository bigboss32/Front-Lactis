import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Empresa, Page, Rol, Usuario } from '../../core/models';

/** Nombre exacto del rol de sistema que administra una empresa. */
const ROL_ADMIN_EMPRESA = 'Administrador Empresa';

/** Contraseña con al menos una letra y un número (misma regla del backend). */
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;

/**
 * Crea el usuario administrador de una empresa concreta.
 * Pensado para el flujo guiado de montaje de una quesera nueva:
 * resuelve el rol "Administrador Empresa" y envía empresa_id explícito
 * (el superadmin puede crear usuarios de cualquier empresa).
 */
@Component({
  selector: 'app-admin-empresa',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>Crear administrador de {{ data.empresa.nombre }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-admin-empresa" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Empresa destino</mat-label>
          <input matInput [value]="data.empresa.nombre" readonly />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Apellido</mat-label>
          <input matInput formControlName="apellido" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Correo</mat-label>
          <input matInput type="email" formControlName="correo" required />
          @if (form.controls.correo.hasError('email')) {
            <mat-error>Correo inválido</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>Usuario (login)</mat-label>
          <input matInput formControlName="username" required autocomplete="off" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Contraseña</mat-label>
          <input
            matInput
            type="password"
            formControlName="password"
            required
            autocomplete="new-password"
          />
          <mat-hint>Mínimo 8 caracteres, con letras y números</mat-hint>
          @if (form.controls.password.hasError('minlength') || form.controls.password.hasError('pattern')) {
            <mat-error>Mínimo 8 caracteres, con letras y números</mat-error>
          }
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-admin-empresa"
        [disabled]="form.invalid || guardando()"
      >
        Crear administrador
      </button>
    </mat-dialog-actions>
  `,
})
export class AdminEmpresaDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<AdminEmpresaDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ empresa: Empresa }>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    nombre: ['', [Validators.required, Validators.minLength(2)]],
    apellido: ['', [Validators.required, Validators.minLength(2)]],
    correo: ['', [Validators.required, Validators.email]],
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: [
      '',
      [Validators.required, Validators.minLength(8), Validators.pattern(PASSWORD_PATTERN)],
    ],
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const rolId = await this.resolverRolAdmin();
      if (!rolId) {
        this.snackbar.open(
          `No se encontró el rol "${ROL_ADMIN_EMPRESA}" en el sistema`,
          'OK',
          { duration: 5000 },
        );
        return;
      }
      const valor = this.form.getRawValue();
      const usuario = await firstValueFrom(
        this.api.post<Usuario>('/usuarios', {
          nombre: valor.nombre,
          apellido: valor.apellido,
          correo: valor.correo,
          username: valor.username,
          password: valor.password,
          empresa_id: this.data.empresa.id,
          rol_ids: [rolId],
        }),
      );
      this.snackbar.open(
        `Administrador ${usuario.username} creado para ${this.data.empresa.nombre}`,
        'OK',
        { duration: 4000 },
      );
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible crear el administrador')
          : 'No fue posible crear el administrador';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }

  /** Busca en el catálogo de roles el id del rol "Administrador Empresa". */
  private async resolverRolAdmin(): Promise<string | null> {
    const pagina = await firstValueFrom(this.api.get<Page<Rol>>('/roles', { page_size: 100 }));
    return pagina.items.find((rol) => rol.nombre === ROL_ADMIN_EMPRESA)?.id ?? null;
  }
}
