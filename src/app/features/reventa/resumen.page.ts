import { Component, computed, effect, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ChartData, ChartOptions } from 'chart.js';
import { firstValueFrom } from 'rxjs';

import { Monto } from '../../core/models';
import { AppChart, CHART_COLORS } from '../../shared/chart';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { ReventaFiltroService } from './reventa-filtro.service';
import { ResumenReventa, ReventaService } from './reventa.service';

/** Tablero del negocio de reventa: indicador de temporada, tarjetas y desglose. */
@Component({
  selector: 'app-reventa-resumen',
  imports: [MatIconModule, MatProgressBarModule, MoneyPipe, CantidadPipe, AppChart],
  template: `
    @if (cargando()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (resumen(); as r) {
      @if (temporadaAlDia(r)) {
        <div class="temporada al-dia">
          <mat-icon aria-hidden="true">check_circle</mat-icon>
          <span>
            <strong>Temporada al día.</strong>
            Sin queso pendiente, ni cobros ni pagos: puedes arrancar una nueva.
          </span>
        </div>
      } @else {
        <div class="temporada pendiente">
          <mat-icon aria-hidden="true">pending_actions</mat-icon>
          <span>
            <strong>Para cerrar la temporada falta:</strong>
            @if (esPositivo(r.kilos_disponibles)) {
              <span class="chip">vender o pasar a merma {{ r.kilos_disponibles | cantidad: 'kg' }}</span>
            }
            @if (esPositivo(r.por_cobrar_clientes)) {
              <span class="chip">cobrar {{ r.por_cobrar_clientes | money }}</span>
            }
            @if (esPositivo(r.por_pagar_productores)) {
              <span class="chip">pagar {{ r.por_pagar_productores | money }}</span>
            }
          </span>
        </div>
      }

      <div class="resumen-grid">
        <div class="tarjeta azul">
          <span class="icono"><mat-icon aria-hidden="true">inventory_2</mat-icon></span>
          <span class="textos">
            <span class="cifra">{{ r.kilos_disponibles | cantidad: 'kg' }}</span>
            <span class="titulo">Queso disponible</span>
          </span>
        </div>

        <div class="tarjeta ambar">
          <span class="icono"><mat-icon aria-hidden="true">grain</mat-icon></span>
          <span class="textos">
            <span class="cifra">{{ r.borona_disponible | cantidad: 'kg' }}</span>
            <span class="titulo">Borona disponible</span>
            <span class="detalle">
              vendida en el período: {{ r.kilos_borona_vendidos | cantidad: 'kg' }} ·
              {{ r.total_ventas_borona | money }}
            </span>
          </span>
        </div>

        <div class="tarjeta" [class.verde]="!esNegativo(r.ganancia_estimada)" [class.rojo]="esNegativo(r.ganancia_estimada)">
          <span class="icono">
            <mat-icon aria-hidden="true">{{ esNegativo(r.ganancia_estimada) ? 'trending_down' : 'trending_up' }}</mat-icon>
          </span>
          <span class="textos">
            <span class="cifra">{{ r.ganancia_estimada | money }}</span>
            <span class="titulo">Ganancia neta del período</span>
            <span class="detalle">{{ r.margen_por_kilo | money }}/kg · ya con compra, merma y gastos</span>
          </span>
        </div>

        <div class="tarjeta ambar">
          <span class="icono"><mat-icon aria-hidden="true">agriculture</mat-icon></span>
          <span class="textos">
            <span class="cifra">{{ r.por_pagar_productores | money }}</span>
            <span class="titulo">Por pagar a productores</span>
          </span>
        </div>

        <div class="tarjeta azul">
          <span class="icono"><mat-icon aria-hidden="true">request_quote</mat-icon></span>
          <span class="textos">
            <span class="cifra">{{ r.por_cobrar_clientes | money }}</span>
            <span class="titulo">Por cobrar a clientes</span>
          </span>
        </div>
      </div>

      <div class="desglose">
        <div class="dato">
          <span class="etq">Comprado</span>
          <span class="val">{{ r.kilos_comprados | cantidad: 'kg' }} · {{ r.total_compras | money }}</span>
          <span class="sub">{{ r.precio_promedio_compra | money }}/kg promedio</span>
        </div>
        <div class="dato">
          <span class="etq">Vendido (queso)</span>
          <span class="val">{{ r.kilos_vendidos | cantidad: 'kg' }} · {{ r.total_ventas | money }}</span>
          <span class="sub">{{ r.precio_promedio_venta | money }}/kg promedio</span>
        </div>
        @if (esPositivo(r.merma_estimada)) {
          <div class="dato">
            <span class="etq">Merma aprox.</span>
            <span class="val">{{ r.merma_estimada | cantidad: 'kg' }}</span>
            <span class="sub">comprado − vendido</span>
          </div>
        }
        <div class="dato">
          <span class="etq">Gastos de venta</span>
          <span class="val">{{ r.total_gastos | money }}</span>
          <span class="sub">transporte, etc.</span>
        </div>
        <div class="dato total" [class.neg]="esNegativo(r.ganancia_estimada)">
          <span class="etq">Ganancia neta</span>
          <span class="val">{{ r.ganancia_estimada | money }}</span>
          <span class="sub">vendido − comprado − gastos</span>
        </div>
      </div>

      <div class="graficas">
        <div class="grafica-card">
          <h3>¿Dónde está el queso comprado?</h3>
          <p class="grafica-sub">Del lote comprado en el período</p>
          @if (esPositivo(r.kilos_comprados)) {
            <app-chart type="doughnut" [data]="quesoChart()" [options]="opcionesDoughnut" />
          } @else {
            <p class="sin-datos">Sin compras en el período</p>
          }
        </div>

        <div class="grafica-card">
          <h3>Dinero del período</h3>
          <p class="grafica-sub">Lo que entró (ventas) vs. lo que costó</p>
          <app-chart type="bar" [data]="dineroChart()" [options]="opcionesBar" />
        </div>
      </div>
    } @else if (!cargando()) {
      <div class="sin-datos">No fue posible cargar el resumen del período.</div>
    }
  `,
  styles: `
    :host { display: block; padding-top: 8px; }

    .resumen-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 12px;
      margin-bottom: 8px;
    }

    .tarjeta {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      min-height: 76px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);

      .icono {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        flex-shrink: 0;
        background: color-mix(in srgb, var(--color-tarjeta) 15%, transparent);
        color: var(--color-tarjeta);
      }

      .textos {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .cifra { font-size: 1.4rem; font-weight: 600; line-height: 1.2; }
      .titulo { font-size: 0.85rem; color: var(--mat-sys-on-surface-variant); }
      .detalle { font-size: 0.8rem; font-weight: 500; color: var(--color-tarjeta); }
    }

    .tarjeta.ambar { --color-tarjeta: #b26a00; }
    .tarjeta.azul  { --color-tarjeta: #1565c0; }
    .tarjeta.verde { --color-tarjeta: #2e7d32; }
    .tarjeta.rojo  { --color-tarjeta: #c62828; }

    .tarjeta.verde .cifra, .tarjeta.rojo .cifra { color: var(--color-tarjeta); }

    :host-context(html.dark) {
      .tarjeta.ambar { --color-tarjeta: #ffb74d; }
      .tarjeta.azul  { --color-tarjeta: #64b5f6; }
      .tarjeta.verde { --color-tarjeta: #81c784; }
      .tarjeta.rojo  { --color-tarjeta: #e57373; }
    }

    .desglose {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 4px 0 8px;
    }

    .desglose .dato {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 8px 14px;
      min-width: 130px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 10px;
      background: var(--mat-sys-surface-container-low);
    }

    .desglose .etq { font-size: 0.75rem; color: var(--mat-sys-on-surface-variant); }
    .desglose .val { font-size: 1rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .desglose .sub { font-size: 0.72rem; color: var(--mat-sys-on-surface-variant); }

    .desglose .dato.total { border-color: #2e7d32; }
    .desglose .dato.total .val { color: #2e7d32; }
    .desglose .dato.total.neg { border-color: #c62828; }
    .desglose .dato.total.neg .val { color: #c62828; }

    :host-context(html.dark) {
      .desglose .dato.total { border-color: #81c784; }
      .desglose .dato.total .val { color: #81c784; }
      .desglose .dato.total.neg { border-color: #e57373; }
      .desglose .dato.total.neg .val { color: #e57373; }
    }

    .temporada {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid transparent;
      font-size: 0.9rem;

      mat-icon { flex-shrink: 0; }
      strong { font-weight: 600; }

      .chip {
        display: inline-block;
        margin: 2px 4px 2px 0;
        padding: 1px 9px;
        border-radius: 8px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
    }

    .temporada.al-dia {
      background: color-mix(in srgb, #2e7d32 12%, transparent);
      border-color: color-mix(in srgb, #2e7d32 40%, transparent);
      color: #2e7d32;
    }

    .temporada.pendiente {
      background: color-mix(in srgb, #b26a00 12%, transparent);
      border-color: color-mix(in srgb, #b26a00 35%, transparent);
      color: #b26a00;

      .chip { background: color-mix(in srgb, #b26a00 20%, transparent); }
    }

    :host-context(html.dark) {
      .temporada.al-dia { color: #81c784; border-color: color-mix(in srgb, #81c784 40%, transparent); }
      .temporada.pendiente { color: #ffb74d; border-color: color-mix(in srgb, #ffb74d 35%, transparent); }
    }

    .sin-datos {
      padding: 32px 0;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
    }

    // ------------------------------------------------------- gráficas
    .graficas {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 12px;
      margin-top: 8px;
    }

    .grafica-card {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      padding: 14px 16px;
      background: var(--mat-sys-surface-container-low);

      h3 { margin: 0; font-size: 0.95rem; font-weight: 500; }
      .grafica-sub {
        margin: 2px 0 8px;
        font-size: 0.78rem;
        color: var(--mat-sys-on-surface-variant);
      }
    }
  `,
})
export class ReventaResumenPage {
  private readonly servicio = inject(ReventaService);
  private readonly filtro = inject(ReventaFiltroService);

  readonly resumen = signal<ResumenReventa | null>(null);
  readonly cargando = signal(false);

  constructor() {
    // Recarga el resumen cuando cambia el rango de fechas compartido.
    effect(() => {
      const desde = this.filtro.desdeIso();
      const hasta = this.filtro.hastaIso();
      if (desde && hasta) void this.cargar(desde, hasta);
      else this.resumen.set(null);
    });
  }

  private async cargar(desde: string, hasta: string): Promise<void> {
    this.cargando.set(true);
    try {
      this.resumen.set(await firstValueFrom(this.servicio.resumen(desde, hasta)));
    } catch {
      this.resumen.set(null);
    } finally {
      this.cargando.set(false);
    }
  }

  esNegativo(valor: Monto): boolean {
    return Number(valor) < 0;
  }

  esPositivo(valor: Monto): boolean {
    return Number(valor) > 0;
  }

  temporadaAlDia(r: ResumenReventa): boolean {
    return (
      !this.esPositivo(r.kilos_disponibles) &&
      !this.esPositivo(r.por_cobrar_clientes) &&
      !this.esPositivo(r.por_pagar_productores)
    );
  }

  /** Dona: del queso comprado en el período, cuánto se vendió y cuánto queda sin vender. */
  readonly quesoChart = computed<ChartData>(() => {
    const r = this.resumen();
    const comprado = Number(r?.kilos_comprados ?? 0);
    const vendido = Number(r?.kilos_vendidos ?? 0);
    const sinVender = Math.max(comprado - vendido, 0);
    return {
      labels: ['Vendido', 'Sin vender'],
      datasets: [{ data: [vendido, sinVender], backgroundColor: [CHART_COLORS[1], CHART_COLORS[2]] }],
    };
  });

  /** Barra: ventas vs. compras vs. gastos del período (la diferencia es la ganancia). */
  readonly dineroChart = computed<ChartData>(() => {
    const r = this.resumen();
    return {
      labels: ['Ventas', 'Compras', 'Gastos'],
      datasets: [
        {
          data: [
            Number(r?.total_ventas ?? 0),
            Number(r?.total_compras ?? 0),
            Number(r?.total_gastos ?? 0),
          ],
          backgroundColor: [CHART_COLORS[1], CHART_COLORS[3], CHART_COLORS[2]],
        },
      ],
    };
  });

  readonly opcionesDoughnut: ChartOptions = {
    plugins: {
      legend: { position: 'bottom' },
      tooltip: {
        callbacks: {
          label: (c) => `${c.label}: ${Number(c.parsed).toLocaleString('es-CO')} kg`,
        },
      },
    },
  };

  private readonly pesos = new Intl.NumberFormat('es-CO', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  readonly opcionesBar: ChartOptions = {
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (c) => '$ ' + Number(c.parsed.y).toLocaleString('es-CO'),
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { callback: (v) => '$ ' + this.pesos.format(Number(v)) },
      },
    },
  };
}
