import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { ChartData, ChartOptions } from 'chart.js';
import { firstValueFrom } from 'rxjs';

import { Monto, ResumenTransporte, Vehiculo } from '../../core/models';
import { AppChart, CHART_COLORS } from '../../shared/chart';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { PageHeader } from '../../shared/page-header';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { RangoFechasRapido } from '../../shared/rango-fechas-rapido';
import { dateToIso, hoyDate } from '../../shared/date-utils';
import { detalleDeError } from '../../shared/errores-ui';
import { ETIQUETAS_CATEGORIA_GASTO } from './transporte-gastos.service';
import { VehiculosService } from './vehiculos.service';
import { ViajesService } from './viajes.service';

/** Primer día del mes actual: el rango por defecto del resumen es "este mes". */
function primerDiaDelMes(): Date {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
}

/** Tablero de rentabilidad del transporte: tarjetas del período y gráficas. */
@Component({
  selector: 'app-transporte-resumen',
  imports: [
    ReactiveFormsModule, RouterLink,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule,
    MatDatepickerModule,
    PageHeader, AppChart, MoneyPipe, CantidadPipe, RangoFechasRapido,
  ],
  template: `
    <div class="page">
      <app-page-header
        titulo="Resumen de transporte"
        subtitulo="Rentabilidad de los viajes de la turbo en el período"
      />

      <div class="page-toolbar">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Vehículo</mat-label>
          <mat-select [formControl]="vehiculoId">
            <mat-option [value]="null">Todos</mat-option>
            @for (vehiculo of vehiculos(); track vehiculo.id) {
              <mat-option [value]="vehiculo.id">
                {{ vehiculo.placa }}{{ vehiculo.nombre ? ' — ' + vehiculo.nombre : '' }}
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Desde</mat-label>
          <input matInput [matDatepicker]="pDesde" (click)="pDesde.open()" [formControl]="desde" />
          <mat-datepicker-toggle matSuffix [for]="pDesde" />
          <mat-datepicker #pDesde />
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Hasta</mat-label>
          <input matInput [matDatepicker]="pHasta" (click)="pHasta.open()" [formControl]="hasta" />
          <mat-datepicker-toggle matSuffix [for]="pHasta" />
          <mat-datepicker #pHasta />
        </mat-form-field>
        <app-rango-fechas-rapido [desde]="desde" [hasta]="hasta" />
      </div>

      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" class="barra-carga" />
      }

      @if (errorCarga(); as error) {
        <div class="error-state" role="alert">
          <mat-icon aria-hidden="true">cloud_off</mat-icon>
          <p>{{ error }}</p>
          <button mat-stroked-button type="button" (click)="cargar()">
            <mat-icon>refresh</mat-icon> Reintentar
          </button>
        </div>
      }

      @if (resumen(); as r) {
        <div class="kpi-grid">
          <mat-card class="total-card">
            <p class="titulo">Viajes realizados</p>
            <p class="valor">{{ r.viajes_realizados }}</p>
            <p class="sub">
              {{ r.kilos_transportados | cantidad: 'kg' }} transportados ·
              {{ kilometros(r.kilometros) }} recorridos
            </p>
          </mat-card>

          <mat-card class="total-card">
            <p class="titulo">Ingresos de terceros</p>
            <p class="valor">{{ r.ingresos_terceros | money }}</p>
            <p class="sub">Fletes cobrados a clientes</p>
          </mat-card>

          <mat-card class="total-card">
            <p class="titulo">Queso propio (interno)</p>
            <p class="valor">{{ r.ingresos_internos | money }}</p>
            <p class="sub">Valorado a tarifa por kilo; no genera cartera</p>
          </mat-card>

          <mat-card class="total-card">
            <p class="titulo">Gastos del período</p>
            <p class="valor">{{ totalEgresos(r) | money }}</p>
            <p class="sub">
              Vehículo {{ r.total_gastos | money }} ·
              Conductores {{ r.total_pago_conductores | money }} ·
              Mantenimientos {{ r.total_mantenimientos | money }} ·
              Documentos {{ r.total_documentos | money }}
            </p>
          </mat-card>

          <mat-card class="total-card">
            <p class="titulo">Utilidad neta</p>
            <p class="valor" [class.negativa]="negativo(r.utilidad_neta)">
              {{ r.utilidad_neta | money }}
            </p>
            <p class="sub">
              Operativa {{ r.utilidad_operativa | money }}, menos mantenimientos y documentos
            </p>
          </mat-card>

          <a class="kpi-enlace" routerLink="/transporte/cartera" matTooltip="Abrir la cartera de fletes">
            <mat-card class="total-card">
              <p class="titulo">Por cobrar hoy</p>
              <p class="valor">{{ r.por_cobrar | money }}</p>
              <p class="sub">Cartera total de fletes, no solo del rango</p>
            </mat-card>
          </a>
        </div>

        <div class="chart-grid">
          <mat-card class="chart-card">
            <h3>Ingresos, gastos y utilidad por mes</h3>
            <p class="chart-sub">Meses del rango consultado</p>
            @if (r.serie_mensual.length > 0) {
              <app-chart type="bar" [data]="serieChart()" [options]="opcionesSerie" />
            } @else {
              <p class="sin-datos">Sin movimientos en el período</p>
            }
          </mat-card>

          <mat-card class="chart-card">
            <h3>Gastos del vehículo por categoría</h3>
            <p class="chart-sub">No incluye conductores, mantenimientos ni documentos</p>
            @if (categoriasConGasto().length > 0) {
              <app-chart type="doughnut" [data]="gastosChart()" [options]="opcionesDona" />
            } @else {
              <p class="sin-datos">Sin gastos del vehículo en el período</p>
            }
          </mat-card>
        </div>
      } @else if (!cargando() && !errorCarga()) {
        <div class="empty-state">
          <mat-icon>insights</mat-icon>
          <p>Seleccione el rango de fechas para consultar el resumen</p>
        </div>
      }
    </div>
  `,
  styles: `
    .barra-carga { margin-bottom: 16px; }

    .total-card {
      height: 100%;
      padding: 14px 16px;

      .titulo { margin: 0; font-size: 0.8rem; color: var(--mat-sys-on-surface-variant); }
      .valor { margin: 2px 0 0; font-size: 1.35rem; font-weight: 600; font-variant-numeric: tabular-nums; }
      .sub { margin: 2px 0 0; font-size: 0.78rem; color: var(--mat-sys-on-surface-variant); }
    }

    .negativa { color: var(--mat-sys-error); }

    // La tarjeta de cartera es un enlace: mismo realce al pasar que en el dashboard.
    .kpi-enlace {
      display: block;
      border-radius: 12px;
      color: inherit;
      text-decoration: none;
      cursor: pointer;

      .total-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }

      &:hover .total-card,
      &:focus-visible .total-card {
        transform: translateY(-2px);
        box-shadow: var(--mat-sys-level3, 0 4px 8px 3px rgba(0, 0, 0, 0.15));
      }
    }

    .chart-card {
      padding: 16px;

      h3 { margin: 0; font-size: 0.95rem; font-weight: 500; }

      .chart-sub {
        margin: 2px 0 12px;
        font-size: 0.78rem;
        color: var(--mat-sys-on-surface-variant);
      }

      .sin-datos {
        margin: 0;
        padding: 48px 0;
        text-align: center;
        color: var(--mat-sys-on-surface-variant);
      }
    }
  `,
})
export class TransporteResumenPage implements OnInit {
  private readonly servicio = inject(ViajesService);
  private readonly vehiculosService = inject(VehiculosService);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly resumen = signal<ResumenTransporte | null>(null);
  readonly cargando = signal(false);
  /**
   * Mensaje de la consulta fallida. Mientras esté puesto NO se pintan tarjetas
   * ni gráficas: cifras de rentabilidad viejas sobre un fallo de red se leerían
   * como si fueran del rango recién pedido.
   */
  readonly errorCarga = signal<string | null>(null);
  readonly vehiculos = signal<Vehiculo[]>([]);

  readonly vehiculoId = new FormControl<string | null>(null);
  readonly desde = new FormControl<Date | null>(primerDiaDelMes());
  readonly hasta = new FormControl<Date | null>(hoyDate());

  /** Contador de peticiones: si el usuario cambia el rango dos veces seguidas,
   * la respuesta de la primera ya no debe pisar la de la última. */
  private peticion = 0;

  constructor() {
    const filtros: AbstractControl[] = [this.vehiculoId, this.desde, this.hasta];
    for (const control of filtros) {
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.cargar());
    }
    firstValueFrom(this.vehiculosService.list({ page_size: 100, estado: 'activo' })).then(
      (pagina) => this.vehiculos.set(pagina.items),
    );
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'transporte.resumen',
      { vehiculoId: this.vehiculoId, desde: this.desde, hasta: this.hasta },
      this.destroyRef,
    );
    this.cargar();
  }

  async cargar(): Promise<void> {
    const desde = dateToIso(this.desde.value);
    const hasta = dateToIso(this.hasta.value);
    // El backend exige el rango completo: sin él no hay nada que consultar.
    if (!desde || !hasta) {
      this.resumen.set(null);
      this.errorCarga.set(null);
      return;
    }
    const mia = ++this.peticion;
    this.cargando.set(true);
    this.errorCarga.set(null);
    try {
      const datos = await firstValueFrom(
        this.servicio.resumen(desde, hasta, this.vehiculoId.value),
      );
      if (mia === this.peticion) this.resumen.set(datos);
    } catch (err) {
      if (mia === this.peticion) {
        this.resumen.set(null);
        this.errorCarga.set(
          detalleDeError(
            err,
            'No se pudo cargar el resumen de transporte. Revise la conexión e intente de nuevo.',
          ),
        );
      }
    } finally {
      if (mia === this.peticion) this.cargando.set(false);
    }
  }

  negativo(valor: Monto): boolean {
    return Number(valor) < 0;
  }

  /** Todos los egresos del período: gastos + conductores + mantenimientos + documentos. */
  totalEgresos(r: ResumenTransporte): number {
    return (
      Number(r.total_gastos) +
      Number(r.total_pago_conductores) +
      Number(r.total_mantenimientos) +
      Number(r.total_documentos)
    );
  }

  kilometros(valor: Monto): string {
    return `${Number(valor).toLocaleString('es-CO')} km`;
  }

  /** 'YYYY-MM' → 'MM/YYYY' para las etiquetas del eje. */
  private etiquetaMes(mes: string): string {
    return `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;
  }

  /** Barras mensuales: la serie usa los mismos buckets de la utilidad neta. */
  readonly serieChart = computed<ChartData<'bar'>>(() => {
    const serie = this.resumen()?.serie_mensual ?? [];
    return {
      labels: serie.map((punto) => this.etiquetaMes(punto.mes)),
      datasets: [
        {
          label: 'Ingresos',
          data: serie.map((punto) => Number(punto.ingresos)),
          backgroundColor: CHART_COLORS[1],
        },
        {
          label: 'Gastos',
          data: serie.map((punto) => Number(punto.gastos)),
          backgroundColor: CHART_COLORS[3],
        },
        {
          label: 'Utilidad',
          data: serie.map((punto) => Number(punto.utilidad)),
          backgroundColor: CHART_COLORS[0],
        },
      ],
    };
  });

  /** Categorías con gasto en el período (la dona no pinta tajadas en cero). */
  readonly categoriasConGasto = computed<[string, Monto][]>(() =>
    Object.entries(this.resumen()?.gastos_por_categoria ?? {}).filter(
      ([, valor]) => Number(valor) > 0,
    ),
  );

  readonly gastosChart = computed<ChartData<'doughnut'>>(() => {
    const filas = this.categoriasConGasto();
    return {
      labels: filas.map(([categoria]) => ETIQUETAS_CATEGORIA_GASTO[categoria] ?? categoria),
      datasets: [
        {
          data: filas.map(([, valor]) => Number(valor)),
          backgroundColor: CHART_COLORS,
        },
      ],
    };
  });

  private readonly pesos = new Intl.NumberFormat('es-CO', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  readonly opcionesSerie: ChartOptions = {
    plugins: {
      legend: { position: 'bottom' },
      tooltip: {
        callbacks: {
          label: (c) => `${c.dataset.label}: $ ${Number(c.parsed.y).toLocaleString('es-CO')}`,
        },
      },
    },
    scales: {
      y: {
        ticks: { callback: (v) => '$ ' + this.pesos.format(Number(v)) },
      },
    },
  };

  readonly opcionesDona: ChartOptions = {
    plugins: {
      legend: { position: 'bottom' },
      tooltip: {
        callbacks: {
          label: (c) => `${c.label}: $ ${Number(c.parsed).toLocaleString('es-CO')}`,
        },
      },
    },
  };
}
