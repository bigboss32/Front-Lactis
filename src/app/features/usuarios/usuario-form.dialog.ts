import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Page, Rol, Usuario } from '../../core/models';
import { protegerCambios } from '../../shared/proteger-cambios';
import { UsuariosService } from './usuarios.service';

/** Contraseña con al menos una letra y un número (misma regla del backend). */
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;

/** Data del diálogo: usuario a editar (opcional) y, para el superadmin en creación,
 * el nombre de la empresa activa donde se creará el usuario. */
export interface UsuarioFormData {
  item?: Usuario;
  empresaNombre?: string | null;
}

@Component({
  selector: 'app-usuario-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatSelectModule, MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ esEdicion ? 'Editar usuario' : 'Nuevo usuario' }}</h2>
    <mat-dialog-content>
      @if (!esEdicion && data?.empresaNombre) {
        <div class="aviso-empresa">
          <mat-icon>business</mat-icon>
          <span>El usuario se creará en la empresa: <b>{{ data?.empresaNombre }}</b></span>
        </div>
      }
      <form [formGroup]="form" class="form-grid" id="form-usuario" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Apellido</mat-label>
          <input matInput formControlName="apellido" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Documento</mat-label>
          <input matInput formControlName="documento" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Correo</mat-label>
          <input matInput type="email" formControlName="correo" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Teléfono</mat-label>
          <input matInput formControlName="telefono" />
        </mat-form-field>
        @if (!esEdicion) {
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
          </mat-form-field>
          <mat-form-field>
            <mat-label>Roles</mat-label>
            <mat-select formControlName="rol_ids" multiple>
              @for (rol of roles(); track rol.id) {
                <mat-option [value]="rol.id">{{ rol.nombre }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-usuario"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .aviso-empresa {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      margin-bottom: 14px;
      border-radius: 10px;
      font-size: 0.85rem;
      background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 25%, transparent);
      color: var(--mat-sys-on-surface);

      mat-icon { color: var(--mat-sys-primary); flex-shrink: 0; }
    }
  `,
})
export class UsuarioFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(UsuariosService);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<UsuarioFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<UsuarioFormData | null>(MAT_DIALOG_DATA, { optional: true });
  readonly esEdicion = !!this.data?.item;
  readonly roles = signal<Rol[]>([]);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    nombre: [this.data?.item?.nombre ?? '', [Validators.required, Validators.minLength(2)]],
    apellido: [this.data?.item?.apellido ?? '', [Validators.required, Validators.minLength(2)]],
    documento: [this.data?.item?.documento ?? ''],
    correo: [this.data?.item?.correo ?? '', [Validators.required, Validators.email]],
    telefono: [this.data?.item?.telefono ?? ''],
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: [
      '',
      [Validators.required, Validators.minLength(8), Validators.pattern(PASSWORD_PATTERN)],
    ],
    rol_ids: [[] as string[]],
  });

  constructor() {
    if (this.esEdicion) {
      // En edición no se cambian username/password (endpoint dedicado) ni roles (asignar roles).
      this.form.controls.username.disable();
      this.form.controls.password.disable();
      this.form.controls.rol_ids.disable();
    } else {
      firstValueFrom(
        this.api.get<Page<Rol>>('/roles', { page_size: 100, estado: 'activo' }),
      ).then((page) => this.roles.set(page.items));
    }
    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valor = this.form.getRawValue();
      if (this.data?.item) {
        await firstValueFrom(
          this.servicio.update(this.data.item.id, {
            nombre: valor.nombre,
            apellido: valor.apellido,
            documento: valor.documento || null,
            correo: valor.correo,
            telefono: valor.telefono || null,
          }),
        );
      } else {
        await firstValueFrom(
          this.servicio.create({
            nombre: valor.nombre,
            apellido: valor.apellido,
            documento: valor.documento || null,
            correo: valor.correo,
            telefono: valor.telefono || null,
            username: valor.username,
            password: valor.password,
            rol_ids: valor.rol_ids,
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
