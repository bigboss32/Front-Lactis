import { Component, DestroyRef, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HttpErrorResponse } from '@angular/common/http';
import { debounceTime, firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Empresa, Usuario } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { PageHeader } from '../../shared/page-header';
import { AsignarRolesDialog } from './asignar-roles.dialog';
import { RestablecerPasswordDialog } from './restablecer-password.dialog';
import { UsuarioFormDialog } from './usuario-form.dialog';
import { UsuariosService } from './usuarios.service';

@Component({
  selector: 'app-usuario-list',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    PageHeader, EstadoChip, HasPermissionDirective,
  ],
  templateUrl: './usuario-list.page.html',
  styles: `
    .banner-empresa {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      margin-bottom: 16px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 25%, transparent);
      color: var(--mat-sys-on-surface);

      mat-icon { color: var(--mat-sys-primary); flex-shrink: 0; }
      .titulo { margin: 0; font-size: 0.95rem; }
      .detalle { margin: 2px 0 0; font-size: 0.8rem; color: var(--mat-sys-on-surface-variant); }
    }
    .roles {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .rol-chip {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      background: color-mix(in srgb, currentColor 12%, transparent);
      color: var(--mat-sys-on-surface-variant);
    }
    .centro { text-align: center; }
    .icono-bloqueado { color: #c62828; }
    .icono-ok { color: var(--mat-sys-on-surface-variant); opacity: 0.5; }
    :host-context(html.dark) .icono-bloqueado { color: #e57373; }
  `,
})
export class UsuarioListPage implements OnInit {
  private readonly servicio = inject(UsuariosService);
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly auth = inject(AuthService);

  readonly columnas = ['nombre', 'username', 'correo', 'roles', 'bloqueado', 'estado', 'acciones'];
  readonly filas = signal<Usuario[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  /** Nombre de la empresa activa para el banner de contexto del superadmin. */
  readonly empresaNombre = signal<string | null>(null);
  /** Última empresa vista por el effect; `undefined` = aún sin primera ejecución. */
  private empresaAnterior: string | null | undefined;

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly estado = new FormControl<string | null>(null);

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.estado.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());

    // Reacciona al cambio de empresa activa del superadmin: refresca banner y lista.
    effect(() => {
      const esSuper = this.auth.esSuperadmin();
      const empresaId = this.auth.empresaActiva();
      untracked(() => {
        if (!esSuper) {
          this.empresaNombre.set(null);
          this.empresaAnterior = empresaId;
          return;
        }
        const cambio = this.empresaAnterior !== undefined && this.empresaAnterior !== empresaId;
        this.empresaAnterior = empresaId;
        void this.cargarNombreEmpresa(empresaId);
        if (cambio) this.recargar();
      });
    });
  }

  /** Obtiene el nombre de la empresa activa; si falla se muestra solo el aviso genérico. */
  private async cargarNombreEmpresa(empresaId: string | null): Promise<void> {
    if (!empresaId) {
      this.empresaNombre.set(null);
      return;
    }
    try {
      const empresa = await firstValueFrom(this.api.get<Empresa>(`/empresas/${empresaId}`));
      if (this.auth.empresaActiva() === empresaId) {
        this.empresaNombre.set(empresa.nombre);
      }
    } catch {
      if (this.auth.empresaActiva() === empresaId) {
        this.empresaNombre.set(null);
      }
    }
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'usuarios',
      { buscar: this.buscar, estado: this.estado },
      this.destroyRef,
    );
    this.cargar();
  }

  recargar(): void {
    this.page.set(1);
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.list({
          page: this.page(),
          page_size: this.pageSize(),
          search: this.buscar.value || null,
          estado: this.estado.value,
        }),
      );
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    this.cargar();
  }

  abrirFormulario(item?: Usuario): void {
    const empresaNombre = !item && this.auth.esSuperadmin() ? this.empresaNombre() : null;
    this.dialog
      .open(UsuarioFormDialog, { data: { item, empresaNombre }, width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Usuario guardado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  asignarRoles(item: Usuario): void {
    this.dialog
      .open(AsignarRolesDialog, { data: { usuario: item }, width: '480px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Roles asignados', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  restablecerPassword(item: Usuario): void {
    this.dialog
      .open(RestablecerPasswordDialog, { data: { usuario: item }, width: '420px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Contraseña restablecida', 'OK', { duration: 3000 });
        }
      });
  }

  async alternarBloqueo(item: Usuario): Promise<void> {
    try {
      if (item.bloqueado) {
        await firstValueFrom(this.servicio.desbloquear(item.id));
        this.snackbar.open('Usuario desbloqueado', 'OK', { duration: 3000 });
      } else {
        await firstValueFrom(this.servicio.bloquear(item.id));
        this.snackbar.open('Usuario bloqueado', 'OK', { duration: 3000 });
      }
      this.cargar();
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible cambiar el bloqueo')
          : 'No fue posible cambiar el bloqueo';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    }
  }

  eliminar(item: Usuario): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar usuario',
          mensaje: `¿Eliminar a "${item.nombre} ${item.apellido}"? El registro quedará inactivo.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        await firstValueFrom(this.servicio.remove(item.id));
        this.snackbar.open('Usuario eliminado', 'OK', { duration: 3000 });
        this.cargar();
      });
  }
}
