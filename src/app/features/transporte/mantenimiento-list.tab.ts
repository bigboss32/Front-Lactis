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
import { Vehiculo, VehiculoMantenimiento } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { MoneyPipe } from '../../shared/pipes';
import { RangoFechasRapido } from '../../shared/rango-fechas-rapido';
import { dateToIso, isoToDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MantenimientoFormDialog } from './mantenimiento-form.dialog';
import { ETIQUETAS_TIPO_MANTENIMIENTO, MantenimientosService } from './mantenimientos.service';
import { VehiculosService } from './vehiculos.service';

/** Pestaña de mantenimientos del vehículo, con chip de urgencia del "próximo". */
@Component({
  selector: 'app-mantenimiento-list-tab',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule, MatDatepickerModule,
    EstadoChip, MoneyPipe, HasPermissionDirective, RangoFechasRapido,
  ],
  templateUrl: './mantenimiento-list.tab.html',
  styles: `
    :host { display: block; padding-top: 8px; }

    // El texto del próximo y su chip de urgencia van uno bajo el otro.
    .proximo {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class MantenimientoListTab implements OnInit {
  private readonly servicio = inject(MantenimientosService);
  private readonly vehiculosService = inject(VehiculosService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly uploadsBase = UPLOADS_BASE;
  readonly etiquetasTipo = ETIQUETAS_TIPO_MANTENIMIENTO;
  readonly columnas = [
    'fecha', 'vehiculo', 'tipo', 'descripcion', 'taller', 'odometro',
    'valor', 'proximo', 'adjunto', 'acciones',
  ];
  readonly filas = signal<VehiculoMantenimiento[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly vehiculos = signal<Vehiculo[]>([]);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly vehiculoId = new FormControl<string | null>(null);
  readonly tipo = new FormControl<string | null>(null);
  readonly desde = new FormControl<Date | null>(null);
  readonly hasta = new FormControl<Date | null>(null);

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    const filtros: AbstractControl[] = [this.vehiculoId, this.tipo, this.desde, this.hasta];
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
      'transporte.mantenimientos',
      {
        buscar: this.buscar,
        vehiculoId: this.vehiculoId,
        tipo: this.tipo,
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
          tipo: this.tipo.value,
          desde: dateToIso(this.desde.value),
          hasta: dateToIso(this.hasta.value),
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

  etiquetaTipo(tipo: string): string {
    return this.etiquetasTipo[tipo] ?? tipo;
  }

  placaDe(vehiculoId: string): string {
    const vehiculo = this.vehiculos().find((v) => v.id === vehiculoId);
    return vehiculo?.placa ?? '—';
  }

  kilometros(valor: unknown): string {
    return `${Number(valor).toLocaleString('es-CO')} km`;
  }

  /** "Próximo" del mantenimiento, para la celda: fecha y/o odómetro. */
  proximoTexto(mantenimiento: VehiculoMantenimiento): string {
    const partes: string[] = [];
    if (mantenimiento.proxima_fecha) {
      partes.push(mantenimiento.proxima_fecha.slice(0, 10).split('-').reverse().join('/'));
    }
    if (mantenimiento.proximo_odometro !== null) {
      partes.push(this.kilometros(mantenimiento.proximo_odometro));
    }
    return partes.join(' · ');
  }

  /**
   * Urgencia del próximo mantenimiento, calculada en el cliente con los mismos
   * umbrales de las alertas del backend (30 días / 500 km): vencido si ya se
   * pasó la fecha o el odómetro, "por vencer" si está cerca, vigente si no.
   * Null cuando el registro no tiene "próximo" definido (no hay qué vigilar).
   */
  urgenciaDe(mantenimiento: VehiculoMantenimiento): string | null {
    let dias: number | null = null;
    if (mantenimiento.proxima_fecha) {
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const proxima = isoToDate(mantenimiento.proxima_fecha);
      if (proxima) dias = Math.round((proxima.getTime() - hoy.getTime()) / 86_400_000);
    }
    let km: number | null = null;
    if (mantenimiento.proximo_odometro !== null) {
      const vehiculo = this.vehiculos().find((v) => v.id === mantenimiento.vehiculo_id);
      if (vehiculo) {
        km = Number(mantenimiento.proximo_odometro) - Number(vehiculo.odometro_actual);
      }
    }
    if (dias === null && km === null) return null;
    if ((dias !== null && dias < 0) || (km !== null && km < 0)) return 'vencido';
    if ((dias !== null && dias <= 30) || (km !== null && km <= 500)) return 'por vencer';
    return 'vigente';
  }

  abrirFormulario(item?: VehiculoMantenimiento): void {
    this.dialog
      .open(MantenimientoFormDialog, {
        data: { item, vehiculoId: this.vehiculoId.value ?? undefined },
        width: '720px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Mantenimiento guardado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  eliminar(item: VehiculoMantenimiento): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar mantenimiento',
          mensaje: `¿Eliminar el mantenimiento "${item.descripcion}"? El registro quedará inactivo.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(this.servicio.remove(item.id));
          this.snackbar.open('Mantenimiento eliminado', 'OK', { duration: 3000 });
          this.cargar();
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible eliminar el mantenimiento');
        }
      });
  }
}
