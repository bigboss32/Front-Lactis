import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { debounceTime, firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Monto, Vehiculo, Viaje } from '../../core/models';
import { EstadoChip } from '../../shared/estado-chip';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { PageHeader } from '../../shared/page-header';
import { MoneyPipe } from '../../shared/pipes';
import { RangoFechasRapido } from '../../shared/rango-fechas-rapido';
import { dateToIso } from '../../shared/date-utils';
import { detalleDeError } from '../../shared/errores-ui';
import { ordenarFilas } from '../../shared/ordenar-tabla';
import { TransporteTabs } from './transporte-tabs';
import { VehiculosService } from './vehiculos.service';
import { ViajeFormDialog } from './viaje-form.dialog';
import { ETIQUETAS_ESTADO_VIAJE, ViajesService } from './viajes.service';

@Component({
  selector: 'app-viaje-list',
  imports: [
    ReactiveFormsModule, DatePipe,
    MatCardModule, MatTableModule, MatPaginatorModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatIconModule,
    MatProgressBarModule, MatTooltipModule, MatDatepickerModule,
    PageHeader, EstadoChip, MoneyPipe, HasPermissionDirective,
    RangoFechasRapido, MatSortModule, TransporteTabs,
  ],
  templateUrl: './viaje-list.page.html',
  styles: `
    .fila-click { cursor: pointer; }
    .fila-click:hover td { background: color-mix(in srgb, currentColor 5%, transparent); }
    .negativa { color: var(--mat-sys-error); }
  `,
})
export class ViajeListPage implements OnInit {
  private readonly servicio = inject(ViajesService);
  private readonly vehiculosService = inject(VehiculosService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  readonly etiquetasEstado = ETIQUETAS_ESTADO_VIAJE;
  readonly columnas = [
    'numero', 'fecha_salida', 'ruta', 'vehiculo', 'conductor',
    'ingresos', 'gastos', 'utilidad', 'estado',
  ];
  readonly filas = signal<Viaje[]>([]);
  readonly orden = signal<Sort>({ active: '', direction: '' });
  readonly filasOrdenadas = computed(() =>
    ordenarFilas(this.filas(), this.orden(), {
      ruta: (f) => `${f.origen} ${f.destino}`,
      vehiculo: (f) => f.vehiculo_placa,
      conductor: (f) => f.conductor_nombre,
      ingresos: (f) => Number(f.total_ingresos),
      gastos: (f) => Number(f.total_gastos_viaje),
      utilidad: (f) => Number(f.utilidad),
    }),
  );
  readonly total = signal(0);
  readonly cargando = signal(false);
  /**
   * Mensaje de la consulta fallida. Mientras esté puesto NO se muestra el
   * estado vacío: un fallo de red no es lo mismo que no tener viajes.
   */
  readonly errorCarga = signal<string | null>(null);
  readonly vehiculos = signal<Vehiculo[]>([]);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly estado = new FormControl<string | null>(null);
  readonly vehiculoId = new FormControl<string | null>(null);
  readonly desde = new FormControl<Date | null>(null);
  readonly hasta = new FormControl<Date | null>(null);

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    const filtros: AbstractControl[] = [this.estado, this.vehiculoId, this.desde, this.hasta];
    for (const control of filtros) {
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    }
    firstValueFrom(this.vehiculosService.list({ page_size: 100, estado: 'activo' })).then(
      (pagina) => this.vehiculos.set(pagina.items),
    );
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'transporte.viajes',
      {
        buscar: this.buscar,
        estado: this.estado,
        vehiculoId: this.vehiculoId,
        desde: this.desde,
        hasta: this.hasta,
      },
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
    this.errorCarga.set(null);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.list({
          page: this.page(),
          page_size: this.pageSize(),
          search: this.buscar.value || null,
          estado: this.estado.value,
          vehiculo_id: this.vehiculoId.value,
          desde: dateToIso(this.desde.value),
          hasta: dateToIso(this.hasta.value),
        }),
      );
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
    } catch (err) {
      // Se limpia lo anterior: cifras viejas se leerían como si fueran de hoy.
      this.filas.set([]);
      this.total.set(0);
      this.errorCarga.set(
        detalleDeError(
          err,
          'No se pudieron cargar los viajes. Revise la conexión e intente de nuevo.',
        ),
      );
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    this.cargar();
  }

  negativo(valor: Monto): boolean {
    return Number(valor) < 0;
  }

  etiquetaEstado(estado: string): string {
    return this.etiquetasEstado[estado] ?? estado;
  }

  nuevoViaje(): void {
    this.dialog
      .open(ViajeFormDialog, { width: '640px' })
      .afterClosed()
      .subscribe((viaje?: Viaje) => {
        if (!viaje) return;
        this.snackbar.open('Viaje registrado', 'OK', { duration: 3000 });
        // Directo al detalle: lo que sigue es cargarle los fletes y los gastos.
        this.router.navigate(['/transporte/viajes', viaje.id]);
      });
  }

  abrirDetalle(viaje: Viaje): void {
    this.router.navigate(['/transporte/viajes', viaje.id]);
  }
}
