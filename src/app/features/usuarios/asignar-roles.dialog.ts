import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Page, Rol, Usuario } from '../../core/models';
import { UsuariosService } from './usuarios.service';

@Component({
  selector: 'app-asignar-roles',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatSelectModule, MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>Asignar roles</h2>
    <mat-dialog-content>
      <p class="detalle">
        Roles de <strong>{{ data.usuario.nombre }} {{ data.usuario.apellido }}</strong>
        ({{ data.usuario.username }}).
      </p>
      <mat-form-field class="full">
        <mat-label>Roles</mat-label>
        <mat-select [formControl]="rolIds" multiple>
          @for (rol of roles(); track rol.id) {
            <mat-option [value]="rol.id">{{ rol.nombre }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button mat-flat-button [disabled]="guardando()" (click)="guardar()">Guardar</button>
    </mat-dialog-actions>
  `,
  styles: `
    .detalle { margin: 0 0 12px; }
    .full { width: 100%; }
  `,
})
export class AsignarRolesDialog {
  private readonly servicio = inject(UsuariosService);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<AsignarRolesDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ usuario: Usuario }>(MAT_DIALOG_DATA);
  readonly roles = signal<Rol[]>([]);
  readonly guardando = signal(false);

  readonly rolIds = new FormControl<string[]>(
    this.data.usuario.roles.map((rol) => rol.id),
    { nonNullable: true },
  );

  constructor() {
    firstValueFrom(
      this.api.get<Page<Rol>>('/roles', { page_size: 100, estado: 'activo' }),
    ).then((page) => this.roles.set(page.items));
  }

  async guardar(): Promise<void> {
    this.guardando.set(true);
    try {
      await firstValueFrom(this.servicio.asignarRoles(this.data.usuario.id, this.rolIds.value));
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible asignar los roles')
          : 'No fue posible asignar los roles';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
