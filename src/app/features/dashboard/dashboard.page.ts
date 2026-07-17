import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { ChartData, ChartOptions } from 'chart.js';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Dashboard, Monto, SerieDia } from '../../core/models';
import { AppChart, CHART_COLORS } from '../../shared/chart';
import { PageHeader } from '../../shared/page-header';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';

/** Variación del último día frente al anterior en una serie diaria. */
interface Tendencia {
  direccion: 'sube' | 'baja' | 'igual';
  /** Porcentaje de variación en valor absoluto (0 cuando no hay cambio). */
  porcentaje: number;
}

/** Tarjeta de indicador: el `tipo` decide el pipe de formato en la plantilla. */
interface Kpi {
  titulo: string;
  icono: string;
  color: string;
  valor: Monto;
  tipo: 'litros' | 'kg' | 'money' | 'numero';
  /** Ruta del módulo que se abre al hacer clic en la tarjeta. */
  link: string;
  /** Monto secundario mostrado bajo el valor (formateado con | money). */
  subtituloMoney?: Monto;
  /** Variación frente al día anterior (solo litros y ventas). */
  tendencia?: Tendencia | null;
}

@Component({
  selector: 'app-dashboard-page',
  imports: [
    DatePipe, MatCardModule, MatIconModule, MatButtonModule, MatProgressBarModule,
    MatTooltipModule, RouterLink,
    PageHeader, AppChart, MoneyPipe, CantidadPipe, HasPermissionDirective,
  ],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snackbar = inject(MatSnackBar);

  readonly datos = signal<Dashboard | null>(null);
  readonly cargando = signal(false);

  // ------------------------------------------------------------------- KPIs
  readonly kpis = computed<Kpi[]>(() => {
    const d = this.datos();
    if (!d) return [];
    return [
      {
        titulo: 'Litros hoy', icono: 'water_drop', color: CHART_COLORS[0],
        valor: d.litros_hoy, tipo: 'litros', link: '/recepciones',
        tendencia: this.tendenciaDe(d.litros_por_dia),
      },
      {
        titulo: 'Litros quincena', icono: 'local_shipping', color: CHART_COLORS[5],
        valor: d.litros_quincena, tipo: 'litros', link: '/recepciones',
        subtituloMoney: d.valor_leche_quincena,
      },
      {
        titulo: 'Producción del mes', icono: 'factory', color: CHART_COLORS[4],
        valor: d.produccion_kg_mes, tipo: 'kg', link: '/produccion',
      },
      {
        titulo: 'Ventas del mes', icono: 'point_of_sale', color: CHART_COLORS[1],
        valor: d.ventas_mes, tipo: 'money', link: '/ventas',
        tendencia: this.tendenciaDe(d.ventas_por_dia),
      },
      {
        titulo: 'Gastos del mes', icono: 'receipt_long', color: CHART_COLORS[6],
        valor: d.gastos_mes, tipo: 'money', link: '/gastos',
      },
      {
        titulo: 'Cartera pendiente', icono: 'account_balance_wallet', color: CHART_COLORS[3],
        valor: d.cartera_pendiente, tipo: 'money', link: '/ventas/cartera',
      },
      {
        titulo: 'Liquidaciones por pagar', icono: 'request_quote', color: CHART_COLORS[7],
        valor: d.liquidaciones_por_pagar, tipo: 'money', link: '/liquidaciones',
      },
      {
        titulo: 'Alertas no leídas', icono: 'notifications_active', color: CHART_COLORS[2],
        valor: d.alertas_no_leidas, tipo: 'numero', link: '/notificaciones',
      },
    ];
  });

  // --------------------------------------------------------------- gráficas
  readonly opcionesSinLeyenda: ChartOptions = {
    plugins: { legend: { display: false } },
  };

  readonly opcionesBarraHorizontal: ChartOptions = {
    indexAxis: 'y',
    plugins: { legend: { display: false } },
  };

  readonly litrosChart = computed<ChartData<'line'>>(() => {
    const serie = this.datos()?.litros_por_dia ?? [];
    return {
      labels: serie.map((p) => this.etiquetaDia(p.fecha)),
      datasets: [{
        label: 'Litros',
        data: serie.map((p) => Number(p.valor)),
        borderColor: CHART_COLORS[0],
        backgroundColor: `${CHART_COLORS[0]}33`,
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      }],
    };
  });

  readonly ventasChart = computed<ChartData<'bar'>>(() => {
    const serie = this.datos()?.ventas_por_dia ?? [];
    return {
      labels: serie.map((p) => this.etiquetaDia(p.fecha)),
      datasets: [{
        label: 'Ventas',
        data: serie.map((p) => Number(p.valor)),
        backgroundColor: CHART_COLORS[1],
      }],
    };
  });

  readonly gastosChart = computed<ChartData<'doughnut'>>(() => {
    const serie = this.datos()?.gastos_por_categoria ?? [];
    return {
      labels: serie.map((p) => p.etiqueta),
      datasets: [{
        data: serie.map((p) => Number(p.valor)),
        backgroundColor: CHART_COLORS,
      }],
    };
  });

  readonly topProveedoresChart = computed<ChartData<'bar'>>(() => {
    const serie = this.datos()?.top_proveedores ?? [];
    return {
      labels: serie.map((p) => p.etiqueta),
      datasets: [{
        label: 'Litros',
        data: serie.map((p) => Number(p.valor)),
        backgroundColor: CHART_COLORS[5],
      }],
    };
  });

  readonly produccionChart = computed<ChartData<'doughnut'>>(() => {
    const serie = this.datos()?.produccion_por_tipo ?? [];
    return {
      labels: serie.map((p) => p.etiqueta),
      datasets: [{
        data: serie.map((p) => Number(p.valor)),
        backgroundColor: CHART_COLORS,
      }],
    };
  });

  ngOnInit(): void {
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.datos.set(await firstValueFrom(this.api.get<Dashboard>('/reportes/dashboard')));
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible cargar los indicadores')
          : 'No fue posible cargar los indicadores';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Compara el último punto de la serie con el anterior.
   * Retorna null si no hay al menos 2 puntos o si el % no es calculable
   * (día anterior en cero): en ese caso la vista no muestra nada.
   */
  private tendenciaDe(serie: SerieDia[]): Tendencia | null {
    if (serie.length < 2) return null;
    const ultimo = Number(serie[serie.length - 1].valor);
    const anterior = Number(serie[serie.length - 2].valor);
    if (!Number.isFinite(ultimo) || !Number.isFinite(anterior)) return null;
    if (ultimo === anterior) return { direccion: 'igual', porcentaje: 0 };
    if (anterior === 0) return null;
    const pct = ((ultimo - anterior) / anterior) * 100;
    return { direccion: pct > 0 ? 'sube' : 'baja', porcentaje: Math.abs(pct) };
  }

  /** 'YYYY-MM-DD' → 'dd/MM' para las etiquetas de los ejes. */
  private etiquetaDia(fecha: string): string {
    return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
  }
}
