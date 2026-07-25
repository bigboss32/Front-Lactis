import { Component, computed, effect, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ChartData, ChartOptions } from 'chart.js';
import { firstValueFrom } from 'rxjs';

import { Monto } from '../../core/models';
import { AppChart, CHART_COLORS } from '../../shared/chart';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { ReventaFiltroService } from './reventa-filtro.service';
import {
  GananciaProducto,
  GananciaProductor,
  ResumenReventa,
  ReventaService,
} from './reventa.service';

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
            <span class="detalle">
              {{ r.margen_por_kilo | money }}/kg vendido · ya con compra, merma y gastos
            </span>
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
        @if (esPositivo(r.kilos_a_borona)) {
          <div class="dato">
            <span class="etq">Pasado a borona</span>
            <span class="val">{{ r.kilos_a_borona | cantidad: 'kg' }}</span>
            <span class="sub">ajustes del período</span>
          </div>
        }
        @if (esPositivo(r.kilos_merma)) {
          <div class="dato">
            <span class="etq">Merma</span>
            <span class="val">{{ r.kilos_merma | cantidad: 'kg' }}</span>
            <span class="sub">pérdida registrada</span>
          </div>
        }
        <div class="dato">
          <span class="etq">Gastos de venta</span>
          <span class="val">{{ r.total_gastos | money }}</span>
          <span class="sub">transporte, etc.</span>
        </div>
      </div>

      <div class="graficas">
        <div class="grafica-card">
          <h3>¿Dónde está el queso comprado?</h3>
          <p class="grafica-sub">
            @if (kilosDeAntes() > 0) {
              Incluye {{ kilosDeAntes() | cantidad: 'kg' }} que venían de temporadas anteriores
            } @else {
              Del lote comprado en el período
            }
          </p>
          @if (filasDona().length > 0) {
            <app-chart type="doughnut" [data]="quesoChart()" [options]="opcionesDoughnut" />
          } @else {
            <p class="sin-datos">Sin movimientos en el período</p>
          }
        </div>

        <div class="grafica-card">
          <h3>Dinero del período</h3>
          <p class="grafica-sub">Lo que entró (ventas) vs. lo que costó</p>
          <app-chart type="bar" [data]="dineroChart()" [options]="opcionesBar" />
        </div>
      </div>

      <div class="graficas">
        <div class="grafica-card">
          <h3>¿A quién le compras mejor?</h3>
          <p class="grafica-sub">Ganancia estimada por productor</p>
          @if (productores().length > 0) {
            <app-chart type="bar" [data]="productoresChart()" [options]="opcionesBarrasProductor" />
          } @else {
            <p class="sin-datos">Sin compras en el período</p>
          }
        </div>

        <div class="grafica-card">
          <h3>Ganancia por producto</h3>
          <p class="grafica-sub">Del lote comprado en el período</p>
          @if (filasProducto().length > 0) {
            <div class="tabla-scroll">
              <table class="tabla-datos">
                <caption class="solo-lectores">Ganancia por producto del período</caption>
                <thead>
                  <tr>
                    <th scope="col">Producto</th>
                    <th scope="col">Kilos</th>
                    <th scope="col">Venta $/kg</th>
                    <th scope="col">Compra $/kg</th>
                    <th scope="col">Gastos</th>
                    <th scope="col">Ganancia</th>
                  </tr>
                </thead>
                <tbody>
                  @for (fila of filasProducto(); track fila.producto) {
                    <tr>
                      <td>
                        <span class="nombre">{{ fila.etiqueta }}</span>
                        <span class="nota">{{ fila.nota }}</span>
                      </td>
                      <td>
                        {{ fila.kilos | cantidad: 'kg' }}
                        @if (vendidosDistintos(fila)) {
                          <span class="nota">vendidos: {{ fila.kilos_vendidos | cantidad: 'kg' }}</span>
                        }
                      </td>
                      <td>{{ sinVenta(fila, fila.precio_venta_kilo) ? '—' : (fila.precio_venta_kilo | money) }}</td>
                      <td>{{ costoKilo(fila) === null ? '—' : (costoKilo(fila) | money) }}</td>
                      <td>{{ sinVenta(fila, fila.gastos) ? '—' : (fila.gastos | money) }}</td>
                      <td [class.positivo]="esPositivo(fila.ganancia)" [class.negativo]="esNegativo(fila.ganancia)">
                        {{ fila.ganancia | money }}
                      </td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="5">Total</td>
                    <td
                      [class.positivo]="esPositivo(r.ganancia_estimada)"
                      [class.negativo]="esNegativo(r.ganancia_estimada)"
                    >
                      {{ r.ganancia_estimada | money }}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          } @else {
            <p class="sin-datos">Sin movimientos en el período</p>
          }
        </div>
      </div>

      <div class="grafica-card tarjeta-ancha">
        <h3>Detalle por productor</h3>
        <p class="grafica-sub">
          Estimado: de cada kilo comprado en el período entraron
          {{ r.valor_realizado_kilo | money }} netos (ventas − gastos). Se reparte entre los kilos
          de cada productor, así que la suma cuadra con la ganancia neta de arriba.
        </p>
        @if (productores().length > 0) {
          <div class="tabla-scroll">
            <table class="tabla-datos">
              <caption class="solo-lectores">Detalle de ganancia estimada por productor</caption>
              <thead>
                <tr>
                  <th scope="col">Productor</th>
                  <th scope="col">Compras</th>
                  <th scope="col">Kilos</th>
                  <th scope="col">Comprado</th>
                  <th scope="col">$/kg comprado</th>
                  <th scope="col">Margen $/kg</th>
                  <th scope="col">Ganancia estimada</th>
                  <th scope="col">Se le debe</th>
                </tr>
              </thead>
              <tbody>
                @for (fila of productores(); track fila.productor) {
                  <tr>
                    <td><span class="nombre">{{ fila.productor }}</span></td>
                    <td>{{ fila.compras }}</td>
                    <td>{{ fila.kilos | cantidad: 'kg' }}</td>
                    <td>{{ fila.total_comprado | money }}</td>
                    <td>{{ fila.precio_promedio | money }}</td>
                    <td [class.positivo]="esPositivo(fila.margen_por_kilo)" [class.negativo]="esNegativo(fila.margen_por_kilo)">
                      {{ fila.margen_por_kilo | money }}
                    </td>
                    <td [class.positivo]="esPositivo(fila.ganancia_estimada)" [class.negativo]="esNegativo(fila.ganancia_estimada)">
                      {{ fila.ganancia_estimada | money }}
                    </td>
                    <td>{{ fila.por_pagar | money }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="sin-datos">Sin compras en el período</p>
        }
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
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin: 4px 0 8px;
    }

    .desglose .dato {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 10px 14px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 10px;
      background: var(--mat-sys-surface-container-low);
    }

    .desglose .etq { font-size: 0.75rem; color: var(--mat-sys-on-surface-variant); }
    .desglose .val { font-size: 1rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .desglose .sub { font-size: 0.72rem; color: var(--mat-sys-on-surface-variant); }

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

    .grafica-card.tarjeta-ancha { margin-top: 12px; }

    // ------------------------------------------------------- tablas de detalle
    // Scroll horizontal dentro de la tarjeta: en pantallas angostas no desborda la página.
    .tabla-scroll { overflow-x: auto; }

    // Título de tabla solo para lectores de pantalla (no se ve).
    .solo-lectores {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .tabla-datos {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;

      th, td {
        padding: 6px 8px;
        border-bottom: 1px solid var(--mat-sys-outline-variant);
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      th {
        font-weight: 500;
        color: var(--mat-sys-on-surface-variant);
      }

      // La primera columna es el nombre: va a la izquierda.
      th:first-child, td:first-child { text-align: left; font-variant-numeric: normal; }

      .nombre { display: block; font-weight: 500; }
      .nota {
        display: block;
        font-size: 0.72rem;
        color: var(--mat-sys-on-surface-variant);
      }

      tfoot td {
        border-top: 1px solid var(--mat-sys-outline);
        border-bottom: none;
        font-weight: 600;
      }
    }

    .tabla-datos .positivo { color: #2e7d32; font-weight: 600; }
    .tabla-datos .negativo { color: #c62828; font-weight: 600; }

    :host-context(html.dark) {
      .tabla-datos .positivo { color: #81c784; }
      .tabla-datos .negativo { color: #e57373; }
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

  /** Contador de peticiones: si el usuario cambia el rango dos veces seguidas, la
   * respuesta de la primera ya no debe pisar la de la última. */
  private peticion = 0;

  private async cargar(desde: string, hasta: string): Promise<void> {
    const mia = ++this.peticion;
    this.cargando.set(true);
    try {
      const datos = await firstValueFrom(this.servicio.resumen(desde, hasta));
      if (mia === this.peticion) this.resumen.set(datos);
    } catch {
      if (mia === this.peticion) this.resumen.set(null);
    } finally {
      if (mia === this.peticion) this.cargando.set(false);
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

  /**
   * Color de cada destino del queso en la dona: verde, ámbar, rojo y azul.
   * Solo el color: la etiqueta la manda el backend en `fila.etiqueta`, para que
   * la leyenda de la dona y la tabla nunca digan nombres distintos.
   */
  private readonly COLOR_DESTINO: Record<string, string> = {
    queso: CHART_COLORS[1],
    borona: CHART_COLORS[2],
    merma: CHART_COLORS[3],
    pendiente: CHART_COLORS[0],
    anterior: CHART_COLORS[5],
  };

  /**
   * Destinos del queso comprado en el período, tomados de por_producto (única
   * fuente de verdad). Se incluye 'anterior' cuando aplica: es un destino real
   * de kilos y sin él las tajadas no explicarían el total que se muestra.
   */
  readonly filasDona = computed<GananciaProducto[]>(() =>
    (this.resumen()?.por_producto ?? []).filter((fila) => Number(fila.kilos) > 0),
  );

  /** Kilos que salieron de inventario de temporadas anteriores (0 si no hubo). */
  readonly kilosDeAntes = computed<number>(() => {
    const fila = (this.resumen()?.por_producto ?? []).find((f) => f.producto === 'anterior');
    return fila ? Number(fila.kilos) : 0;
  });

  /** Dona: a dónde fue el queso (vendido, pasado a borona, merma o aún en inventario). */
  readonly quesoChart = computed<ChartData>(() => {
    const filas = this.filasDona();
    return {
      labels: filas.map((fila) => fila.etiqueta),
      datasets: [
        {
          data: filas.map((fila) => Number(fila.kilos)),
          backgroundColor: filas.map(
            (fila) => this.COLOR_DESTINO[fila.producto] ?? CHART_COLORS[4],
          ),
        },
      ],
    };
  });

  /** Filas del desglose por producto, sin las despreciables (ni kilos ni plata que mostrar). */
  readonly filasProducto = computed<GananciaProducto[]>(() =>
    (this.resumen()?.por_producto ?? []).filter(
      (fila) => Number(fila.kilos) !== 0 || Math.abs(Number(fila.ganancia)) >= 1,
    ),
  );

  /** Productores del período; ya vienen ordenados por ganancia estimada (mayor a menor). */
  readonly productores = computed<GananciaProductor[]>(() => this.resumen()?.por_productor ?? []);

  /** Barras horizontales: ganancia estimada de los 8 productores que más dejaron. */
  readonly productoresChart = computed<ChartData>(() => {
    const filas = this.productores().slice(0, 8);
    const valores = filas.map((fila) => Number(fila.ganancia_estimada));
    return {
      labels: filas.map((fila) => fila.productor),
      datasets: [
        {
          data: valores,
          backgroundColor: valores.map((valor) => (valor < 0 ? CHART_COLORS[3] : CHART_COLORS[1])),
        },
      ],
    };
  });

  /** En merma, pendiente y anterior no hay venta ni gastos: se muestra un guion en vez de $ 0. */
  sinVenta(fila: GananciaProducto, valor: Monto): boolean {
    return Number(valor) === 0 && fila.producto !== 'queso' && fila.producto !== 'borona';
  }

  /**
   * Costo por kilo de la fila. En 'anterior' el costo total es un crédito (se
   * pagó en otro período), así que mostrar el precio de compra en positivo haría
   * que Kilos × $/kg no cuadrara con la ganancia: ahí se muestra un guion.
   */
  costoKilo(fila: GananciaProducto): Monto | null {
    return fila.producto === 'anterior' ? null : fila.costo_kilo;
  }

  /** Kilos vendidos de esa fila, cuando difieren de los kilos del lote (borona). */
  vendidosDistintos(fila: GananciaProducto): boolean {
    return Number(fila.kilos_vendidos) !== Number(fila.kilos);
  }

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

  /** Barras horizontales (indexAxis 'y'): el valor va en el eje X. */
  readonly opcionesBarrasProductor: ChartOptions = {
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (c) => '$ ' + Number(c.parsed.x).toLocaleString('es-CO'),
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        ticks: { callback: (v) => '$ ' + this.pesos.format(Number(v)) },
      },
    },
  };
}
