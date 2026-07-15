import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Rol } from '../../core/models';
import { PermisosMatriz } from './permisos-matriz';
import { RolesService } from './roles.service';

/** Nombre del rol de sistema cuyos permisos no se pueden modificar. */
const ROL_ADMIN_GENERAL = 'Administrador General';

@Component({
  selector: 'app-rol-permisos',
  imports: [MatDialogModule, MatButtonModule, PermisosMatriz],
  template: `
    <h2 mat-dialog-title>Permisos del rol «{{ data.item.nombre }}»</h2>
    <mat-dialog-content>
      @if (esAdminGeneral) {
        <p class="aviso">
          El rol «Administrador General» tiene siempre todos los permisos y no puede modificarse.
        </p>
      }
      <app-permisos-matriz [(seleccionados)]="permisoIds" [deshabilitado]="esAdminGeneral" />
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        [disabled]="esAdminGeneral || guardando()"
        (click)="guardar()"
      >
        Guardar permisos
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .aviso {
      margin: 0 0 12px;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 0.85rem;
      background: color-mix(in srgb, #b26a00 14%, transparent);
      color: #b26a00;
    }
    :host-context(html.dark) .aviso { color: #ffb74d; }
  `,
})
export class RolPermisosDialog {
  private readonly servicio = inject(RolesService);
  private readonly dialogRef = inject(MatDialogRef<RolPermisosDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item: Rol }>(MAT_DIALOG_DATA);
  readonly esAdminGeneral = this.data.item.nombre === ROL_ADMIN_GENERAL;
  readonly permisoIds = signal<string[]>(this.data.item.permisos.map((permiso) => permiso.id));
  readonly guardando = signal(false);

  async guardar(): Promise<void> {
    if (this.esAdminGeneral) return;
    this.guardando.set(true);
    try {
      await firstValueFrom(this.servicio.asignarPermisos(this.data.item.id, this.permisoIds()));
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible guardar los permisos')
          : 'No fue posible guardar los permisos';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
