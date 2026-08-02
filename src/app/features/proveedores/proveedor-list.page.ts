import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
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

import { ApiService } from '../../core/api.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Page, Proveedor, Ruta } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { EstadoChip } from '../../shared/estado-chip';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { PageHeader } from '../../shared/page-header';
import { MoneyPipe } from '../../shared/pipes';
import { ProveedorFormDialog } from './proveedor-form.dialog';
import { ProveedoresService } from './proveedores.service';

@Component({
  selector: 'app-proveedor-list',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    PageHeader, EstadoChip, MoneyPipe, HasPermissionDirective,
  ],
  templateUrl: './proveedor-list.page.html',
})
export class ProveedorListPage implements OnInit {
  private readonly servicio = inject(ProveedoresService);
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly columnas = ['nombre', 'vereda', 'telefono', 'precio_litro', 'estado', 'acciones'];
  readonly filas = signal<Proveedor[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  readonly rutas = signal<Ruta[]>([]);
  readonly buscar = new FormControl('', { nonNullable: true });
  readonly estado = new FormControl<string | null>(null);
  readonly rutaId = new FormControl<string | null>(null);

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.estado.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    this.rutaId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'proveedores',
      { buscar: this.buscar, estado: this.estado, rutaId: this.rutaId },
      this.destroyRef,
    );
    this.cargar();
    firstValueFrom(
      this.api.get<Page<Ruta>>('/rutas', { page_size: 100, estado: 'activo' }),
    ).then((r) => this.rutas.set(r.items));
  }

  recargar(): void {
    this.page.set(1);
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.filtrar({
          page: this.page(),
          page_size: this.pageSize(),
          search: this.buscar.value || null,
          estado: this.estado.value,
          ruta_id: this.rutaId.value,
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

  abrirFormulario(item?: Proveedor): void {
    this.dialog
      .open(ProveedorFormDialog, { data: { item }, width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Proveedor guardado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  /**
   * Desactivar / reactivar: la acción para el proveedor que dejó de entregar.
   *
   * Es lo que casi siempre se quiere en vez de la caneca. Se le avisa al usuario
   * —en el propio diálogo— que la historia NO se pierde, porque el miedo a
   * perderla es justo lo que hacía que nadie tocara el botón de eliminar.
   */
  cambiarEstado(item: Proveedor): void {
    const inactivo = item.estado === 'inactivo';
    this.dialog
      .open(ConfirmDialog, {
        data: inactivo
          ? {
              titulo: 'Reactivar proveedor',
              mensaje: `¿Reactivar a "${item.nombre}"? Volverá a aparecer para registrarle leche.`,
              accion: 'Reactivar',
              // Reactivar no destruye nada: se fuerza el aspecto neutro para que
              // el diálogo no salga en rojo (el texto trae «activ», que la
              // deducción del ConfirmDialog leería como «desactivar»).
              peligro: false,
            }
          : {
              titulo: 'Desactivar proveedor',
              mensaje:
                `¿Desactivar a "${item.nombre}"? Dejará de aparecer para registrarle ` +
                'leche nueva, pero conserva sus recepciones, liquidaciones y pagos, y ' +
                'lo que se le deba sigue contando. Se puede reactivar cuando vuelva.',
              accion: 'Desactivar',
            },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(
            inactivo ? this.servicio.activar(item.id) : this.servicio.desactivar(item.id),
          );
          this.snackbar.open(
            inactivo ? 'Proveedor reactivado' : 'Proveedor desactivado',
            'OK',
            { duration: 3000 },
          );
          this.cargar();
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible cambiar el estado');
        }
      });
  }

  eliminar(item: Proveedor): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar proveedor',
          mensaje:
            `¿Eliminar a "${item.nombre}"? Solo se puede eliminar un proveedor sin ` +
            'historia. Si ya tiene leche recibida o liquidaciones, use «Desactivar» ' +
            'para apartarlo sin perder sus registros.',
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(this.servicio.remove(item.id));
          this.snackbar.open('Proveedor eliminado', 'OK', { duration: 3000 });
          this.cargar();
        } catch (err) {
          // El backend rebota (422) al proveedor con historia y explica en el
          // mensaje que hay que desactivarlo. Sin este catch, el usuario veía
          // que "no pasaba nada" y no se enteraba del porqué.
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible eliminar el proveedor');
        }
      });
  }
}
