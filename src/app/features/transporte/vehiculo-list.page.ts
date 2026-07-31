import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { AlertasTransporte, Vehiculo } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { PageHeader } from '../../shared/page-header';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { VehiculoDetailDialog } from './vehiculo-detail.dialog';
import { VehiculoFormDialog } from './vehiculo-form.dialog';
import { VehiculosService } from './vehiculos.service';

/** Conteo de alertas de documentos de un vehículo (para los badges). */
interface ConteoDocumentos {
  vencidos: number;
  porVencer: number;
}

@Component({
  selector: 'app-vehiculo-list',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    PageHeader, EstadoChip, MoneyPipe, CantidadPipe, HasPermissionDirective,
  ],
  templateUrl: './vehiculo-list.page.html',
  styles: `
    .fila-click { cursor: pointer; }
    .fila-click:hover td { background: color-mix(in srgb, currentColor 5%, transparent); }

    // Badges de documentos: mismo molde de color que el chip de estado.
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
    }
    .badge + .badge { margin-left: 4px; }
    .badge.rojo  { background: color-mix(in srgb, #c62828 18%, transparent); color: #c62828; }
    .badge.ambar { background: color-mix(in srgb, #b26a00 18%, transparent); color: #b26a00; }
    :host-context(html.dark) {
      .badge.rojo  { color: #e57373; }
      .badge.ambar { color: #ffb74d; }
    }
  `,
})
export class VehiculoListPage implements OnInit {
  private readonly servicio = inject(VehiculosService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly columnas = [
    'placa', 'nombre', 'marca', 'capacidad', 'tarifa_kilo', 'odometro',
    'documentos', 'estado', 'acciones',
  ];
  readonly filas = signal<Vehiculo[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  private readonly alertas = signal<AlertasTransporte | null>(null);
  /** Función de consulta: badges de documentos vencidos / por vencer por vehículo. */
  readonly documentosDe = computed(() => {
    const mapa = new Map<string, ConteoDocumentos>();
    for (const documento of this.alertas()?.documentos ?? []) {
      const conteo = mapa.get(documento.vehiculo_id) ?? { vencidos: 0, porVencer: 0 };
      if (documento.estado === 'vencido') conteo.vencidos++;
      else conteo.porVencer++;
      mapa.set(documento.vehiculo_id, conteo);
    }
    return (id: string): ConteoDocumentos => mapa.get(id) ?? { vencidos: 0, porVencer: 0 };
  });

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly estado = new FormControl<string | null>(null);

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.estado.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    this.cargarAlertas();
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'transporte.vehiculos',
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

  /** Los badges son informativos: si la consulta falla, la lista sale sin ellos. */
  private cargarAlertas(): void {
    firstValueFrom(this.servicio.alertas())
      .then((alertas) => this.alertas.set(alertas))
      .catch(() => undefined);
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    this.cargar();
  }

  abrirFormulario(item?: Vehiculo): void {
    this.dialog
      .open(VehiculoFormDialog, { data: { item }, width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Vehículo guardado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  abrirFicha(vehiculo: Vehiculo): void {
    this.dialog
      .open(VehiculoDetailDialog, { data: { vehiculo }, width: '760px' })
      .afterClosed()
      .subscribe((huboCambios) => {
        if (huboCambios) {
          this.cargar();
          this.cargarAlertas();
        }
      });
  }

  eliminar(item: Vehiculo): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar vehículo',
          mensaje: `¿Eliminar el vehículo "${item.placa}"? Solo es posible si no tiene viajes registrados; el registro quedará inactivo.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(this.servicio.remove(item.id));
          this.snackbar.open('Vehículo eliminado', 'OK', { duration: 3000 });
          this.cargar();
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible eliminar el vehículo');
        }
      });
  }
}
