import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
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
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, firstValueFrom } from 'rxjs';

import { UPLOADS_BASE } from '../../core/api.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Vehiculo, VehiculoGasto } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { MoneyPipe } from '../../shared/pipes';
import { RangoFechasRapido } from '../../shared/rango-fechas-rapido';
import { dateToIso } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import {
  CATEGORIAS_GASTO_VEHICULO,
  ETIQUETAS_CATEGORIA_GASTO,
  TransporteGastosService,
} from './transporte-gastos.service';
import { VehiculoGastoFormDialog } from './vehiculo-gasto-form.dialog';
import { VehiculosService } from './vehiculos.service';

/**
 * Pestaña de gastos generales del vehículo: los que no pertenecen a ningún
 * viaje (parqueadero del mes, lavadas, multas…). Los gastos de un viaje se
 * registran y se ven en el detalle del propio viaje.
 */
@Component({
  selector: 'app-gasto-general-list-tab',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule, MatDatepickerModule,
    MoneyPipe, HasPermissionDirective, RangoFechasRapido,
  ],
  templateUrl: './gasto-general-list.tab.html',
  styles: `
    :host { display: block; padding-top: 8px; }
  `,
})
export class GastoGeneralListTab implements OnInit {
  private readonly servicio = inject(TransporteGastosService);
  private readonly vehiculosService = inject(VehiculosService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly uploadsBase = UPLOADS_BASE;
  readonly categorias = CATEGORIAS_GASTO_VEHICULO;
  readonly etiquetasCategoria = ETIQUETAS_CATEGORIA_GASTO;
  readonly columnas = [
    'fecha', 'vehiculo', 'categoria', 'concepto', 'valor', 'odometro',
    'adjunto', 'acciones',
  ];
  readonly filas = signal<VehiculoGasto[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly vehiculos = signal<Vehiculo[]>([]);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly vehiculoId = new FormControl<string | null>(null);
  readonly categoria = new FormControl<string | null>(null);
  readonly desde = new FormControl<Date | null>(null);
  readonly hasta = new FormControl<Date | null>(null);

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    const filtros: AbstractControl[] = [this.vehiculoId, this.categoria, this.desde, this.hasta];
    for (const control of filtros) {
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    }
    // Todos los vehículos (también inactivos): resuelven la placa de registros viejos.
    firstValueFrom(this.vehiculosService.list({ page_size: 100 })).then((pagina) =>
      this.vehiculos.set(pagina.items),
    );
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'transporte.gastosGenerales',
      {
        buscar: this.buscar,
        vehiculoId: this.vehiculoId,
        categoria: this.categoria,
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
    try {
      const respuesta = await firstValueFrom(
        this.servicio.filtrar({
          page: this.page(),
          page_size: this.pageSize(),
          search: this.buscar.value || null,
          vehiculo_id: this.vehiculoId.value,
          categoria: this.categoria.value,
          desde: dateToIso(this.desde.value),
          hasta: dateToIso(this.hasta.value),
          // Solo los gastos sin viaje: los del viaje se manejan en su detalle.
          solo_generales: true,
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

  etiquetaCategoria(categoria: string): string {
    return this.etiquetasCategoria[categoria] ?? categoria;
  }

  placaDe(vehiculoId: string): string {
    const vehiculo = this.vehiculos().find((v) => v.id === vehiculoId);
    return vehiculo?.placa ?? '—';
  }

  kilometros(valor: unknown): string {
    return `${Number(valor).toLocaleString('es-CO')} km`;
  }

  abrirFormulario(item?: VehiculoGasto): void {
    this.dialog
      .open(VehiculoGastoFormDialog, {
        // Sin vehículo del filtro, el propio formulario lo pregunta.
        data: { item, vehiculoId: this.vehiculoId.value ?? undefined },
        width: '640px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Gasto guardado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  eliminar(item: VehiculoGasto): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar gasto',
          mensaje: `¿Eliminar el gasto de ${this.etiquetaCategoria(item.categoria)}? El registro quedará inactivo.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(this.servicio.remove(item.id));
          this.snackbar.open('Gasto eliminado', 'OK', { duration: 3000 });
          this.cargar();
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible eliminar el gasto');
        }
      });
  }
}
