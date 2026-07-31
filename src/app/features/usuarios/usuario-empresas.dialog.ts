import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { Page, Rol, Usuario } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { UsuariosService } from './usuarios.service';

/** Nombre exacto del rol global del sistema: no se asigna por empresa. */
const ROL_SUPERADMIN = 'Administrador General';

/**
 * Empresas del usuario, con sus roles en cada una (solo lo abre el superadmin).
 *
 * Es la pieza del caso Alirio: administra la empresa 1 pero también trabaja en
 * la 2 con otros roles. Cada fila es una empresa del sistema; marcarla lo hace
 * miembro y el select de al lado dice QUÉ roles tiene ahí (el catálogo de roles
 * es global, lo que cambia por empresa es la asignación).
 */
@Component({
  selector: 'app-usuario-empresas',
  imports: [
    MatDialogModule, MatCheckboxModule, MatFormFieldModule, MatSelectModule,
    MatButtonModule, MatProgressBarModule,
  ],
  template: `
    <h2 mat-dialog-title>Empresas del usuario</h2>
    <mat-dialog-content>
      <p class="detalle">
        Membresías de <strong>{{ data.usuario.nombre }} {{ data.usuario.apellido }}</strong>
        ({{ data.usuario.username }}). Marca las empresas a las que puede entrar y elige los
        roles que tendrá en cada una.
      </p>
      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" />
      } @else {
        @for (empresa of empresas(); track empresa.id) {
          <div class="fila-empresa">
            <mat-checkbox
              [checked]="estaMarcada(empresa.id)"
              (change)="alternarEmpresa(empresa.id, $event.checked)"
            >
              {{ empresa.nombre }}
            </mat-checkbox>
            @if (estaMarcada(empresa.id)) {
              <mat-form-field class="roles-select" subscriptSizing="dynamic">
                <mat-label>Roles</mat-label>
                <mat-select
                  multiple
                  [value]="rolesDe(empresa.id)"
                  (valueChange)="cambiarRoles(empresa.id, $event)"
                >
                  @for (rol of roles(); track rol.id) {
                    <mat-option [value]="rol.id">{{ rol.nombre }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }
          </div>
        }
        @if (faltanRoles()) {
          <p class="error">Cada empresa marcada debe tener al menos un rol.</p>
        } @else if (seleccion().size === 0) {
          <p class="error">Marca al menos una empresa.</p>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        [disabled]="invalido() || cargando() || guardando()"
        (click)="guardar()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .detalle { margin: 0 0 12px; }
    .fila-empresa {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 56px;
      padding: 2px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);

      &:last-of-type { border-bottom: none; }
    }
    .roles-select { width: 230px; flex-shrink: 0; }
    .error {
      margin: 12px 0 0;
      font-size: 0.8rem;
      color: var(--mat-sys-error);
    }
  `,
})
export class UsuarioEmpresasDialog {
  private readonly servicio = inject(UsuariosService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef<UsuarioEmpresasDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ usuario: Usuario }>(MAT_DIALOG_DATA);

  /** Filas del diálogo: el perfil del superadmin trae TODAS las empresas activas. */
  readonly empresas = this.auth.empresasDisponibles;
  readonly roles = signal<Rol[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);

  /**
   * rol_ids elegidos por empresa: solo las empresas MARCADAS están en el Map.
   * Se reemplaza el Map completo en cada cambio para que las señales reaccionen.
   */
  readonly seleccion = signal<Map<string, string[]>>(new Map());

  /** Empresas con las que ABRIÓ el diálogo, para confirmar antes de quitar una. */
  private originales = new Set<string>();
  /** Nombres de las membresías precargadas (por si alguna no está en el perfil). */
  private nombresPrecargados = new Map<string, string>();

  /** ¿Alguna empresa marcada quedó sin roles? */
  readonly faltanRoles = computed(() =>
    [...this.seleccion().values()].some((rolIds) => rolIds.length === 0),
  );

  /** Regla del backend: al menos una empresa y al menos un rol por empresa. */
  readonly invalido = computed(() => this.seleccion().size === 0 || this.faltanRoles());

  constructor() {
    void this.precargar();
  }

  /** Trae en paralelo el catálogo de roles y las membresías actuales del usuario. */
  private async precargar(): Promise<void> {
    try {
      const [pagina, membresias] = await Promise.all([
        firstValueFrom(this.api.get<Page<Rol>>('/roles', { page_size: 100, estado: 'activo' })),
        firstValueFrom(this.servicio.empresasDe(this.data.usuario.id)),
      ]);
      // El rol global no se asigna por empresa (el backend lo rechaza con 422):
      // mostrarlo aquí solo invitaría a un error seguro.
      this.roles.set(pagina.items.filter((rol) => rol.nombre !== ROL_SUPERADMIN));
      const inicial = new Map<string, string[]>();
      for (const membresia of membresias) {
        inicial.set(membresia.empresa_id, membresia.roles.map((rol) => rol.id));
        this.nombresPrecargados.set(membresia.empresa_id, membresia.empresa_nombre);
      }
      this.seleccion.set(inicial);
      this.originales = new Set(inicial.keys());
      this.cargando.set(false);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible cargar las empresas del usuario');
      this.dialogRef.close(false);
    }
  }

  estaMarcada(empresaId: string): boolean {
    return this.seleccion().has(empresaId);
  }

  rolesDe(empresaId: string): string[] {
    return this.seleccion().get(empresaId) ?? [];
  }

  alternarEmpresa(empresaId: string, marcada: boolean): void {
    this.seleccion.update((actual) => {
      const nuevo = new Map(actual);
      if (marcada) nuevo.set(empresaId, nuevo.get(empresaId) ?? []);
      else nuevo.delete(empresaId);
      return nuevo;
    });
  }

  cambiarRoles(empresaId: string, rolIds: string[]): void {
    this.seleccion.update((actual) => {
      const nuevo = new Map(actual);
      nuevo.set(empresaId, rolIds);
      return nuevo;
    });
  }

  async guardar(): Promise<void> {
    if (this.invalido()) return;
    // Quitar una membresía existente le corta el acceso a esa empresa al
    // usuario aunque esté trabajando en ella: se confirma en rojo antes.
    const quitadas = [...this.originales].filter((id) => !this.seleccion().has(id));
    if (quitadas.length > 0) {
      const nombres = quitadas.map((id) => this.nombreDe(id)).join(', ');
      const confirmado = await firstValueFrom(
        this.dialog
          .open(ConfirmDialog, {
            data: {
              titulo: 'Quitar membresías',
              mensaje:
                `${this.data.usuario.nombre} ${this.data.usuario.apellido} dejará de tener ` +
                `acceso a: ${nombres}. ¿Quitar estas membresías?`,
              accion: 'Quitar',
            },
          })
          .afterClosed(),
      );
      if (!confirmado) return;
    }
    this.guardando.set(true);
    try {
      const membresias = [...this.seleccion().entries()].map(([empresa_id, rol_ids]) => ({
        empresa_id,
        rol_ids,
      }));
      await firstValueFrom(this.servicio.asignarEmpresas(this.data.usuario.id, membresias));
      this.dialogRef.close(true);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible asignar las empresas');
    } finally {
      this.guardando.set(false);
    }
  }

  /** Nombre de la empresa: del perfil, o de la precarga si ya no está en la lista. */
  private nombreDe(empresaId: string): string {
    return (
      this.empresas().find((empresa) => empresa.id === empresaId)?.nombre ??
      this.nombresPrecargados.get(empresaId) ??
      empresaId
    );
  }
}
