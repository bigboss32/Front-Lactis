import { Component, OnInit, inject, signal } from '@angular/core';
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
import { debounceTime, firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Rol } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { PageHeader } from '../../shared/page-header';
import { RolFormDialog } from './rol-form.dialog';
import { RolPermisosDialog } from './rol-permisos.dialog';
import { RolesService } from './roles.service';

/** Nombre del rol de sistema cuyos permisos no se pueden modificar. */
const ROL_ADMIN_GENERAL = 'Administrador General';

@Component({
  selector: 'app-rol-list',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    PageHeader, EstadoChip, HasPermissionDirective,
  ],
  templateUrl: './rol-list.page.html',
  styles: `
    .nombre-rol {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .icono-sistema {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--mat-sys-on-surface-variant);
    }
    .num { text-align: right; }
  `,
})
export class RolListPage implements OnInit {
  private readonly servicio = inject(RolesService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  readonly adminGeneral = ROL_ADMIN_GENERAL;
  readonly columnas = ['nombre', 'descripcion', 'permisos', 'estado', 'acciones'];
  readonly filas = signal<Rol[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly estado = new FormControl<string | null>(null);

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.estado.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
  }

  ngOnInit(): void {
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

  abrirFormulario(item?: Rol): void {
    this.dialog
      .open(RolFormDialog, { data: { item }, width: item ? '560px' : '840px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Rol guardado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  editarPermisos(item: Rol): void {
    this.dialog
      .open(RolPermisosDialog, { data: { item }, width: '840px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Permisos actualizados', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  eliminar(item: Rol): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar rol',
          mensaje: `¿Eliminar el rol "${item.nombre}"? El registro quedará inactivo.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        await firstValueFrom(this.servicio.remove(item.id));
        this.snackbar.open('Rol eliminado', 'OK', { duration: 3000 });
        this.cargar();
      });
  }
}
