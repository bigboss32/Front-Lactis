import { Component, computed, effect, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ChartData, ChartOptions } from 'chart.js';
import { firstValueFrom } from 'rxjs';

import { Monto } from '../../core/models';
import { AppChart, CHART_COLORS } from '../../shared/chart';
import { BarrasPipe, CantidadPipe, EnUnidadPipe, MoneyPipe } from '../../shared/pipes';
import { ReventaFiltroService } from './reventa-filtro.service';
import {
  ExistenciaProducto,
  GananciaProducto,
  GananciaProductor,
  ResumenReventa,
  ReventaService,
  Unidad,
  claveBaseDeFila,
  esDeInventarioAnterior,
  esFilaSinVenta,
  piezaDe,
} from './reventa.service';

/**
 * Los colores de las tarjetas de inventario, en ciclo.
 *
 * El orden es el de siempre —el queso azul, la borona ámbar, la mozzarella verde—
 * porque las tarjetas salen en el orden del catálogo y ese es el orden en que el
 * cliente los tiene. Un producto que él agregue toma el siguiente color; lo que no
 * puede pasar es que dos tarjetas seguidas se vean iguales.
 */
const COLORES_TARJETA = ['azul', 'ambar', 'verde'];

/**
 * Tablero del negocio de reventa: indicador de temporada, tarjetas y desglose.
 *
 * UNA FILA POR PRODUCTO, Y NINGUNA ESCRITA EN EL CÓDIGO. El inventario, el desglose
 * de la ganancia y los chips de "qué falta para cerrar" salen del catálogo del dueño,
 * que es lo que manda el backend en `existencias` y en `por_producto`. Antes eran
 * tres tarjetas y unas filas fijas con los nombres adentro (queso, borona y
 * mozzarella), así que un producto que él agregara —ya agregó "costeño"— no aparecía
 * en ninguna parte de esta pantalla: ni su mercancía, ni su plata, ni su ganancia.
 *
 * DOS CLASES DE UNIDAD, Y NUNCA SUMADAS. Lo que se pesa va en kilos y lo que se
 * cuenta va en piezas; "20 kg + 8 barras" no es un número, así que aquí no hay ni
 * puede haber una tarjeta, un total ni una gráfica que las junte, y la dona de
 * "¿dónde está el queso?" solo grafica kilos (ver `filasDona`). La PLATA sí se suma:
 * los pesos son pesos, vengan de kilos o de piezas, y por eso la ganancia del período
 * es una sola cifra.
 *
 * Y LA REGLA QUE MANDA SOBRE TODAS: el desglose SUMA EXACTO el encabezado. Las cuatro
 * columnas (costo, ingreso, gastos, ganancia) suman las cuatro cifras grandes sin un
 * centavo de diferencia —el backend lo garantiza por construcción y saca aparte, en
 * una fila 'sin_producto', cualquier peso que no quepa—, así que esta pantalla no
 * puede esconder una fila con plata. Ver `filasProducto`.
 */
@Component({
  selector: 'app-reventa-resumen',
  imports: [
    MatIconModule, MatProgressBarModule, MoneyPipe, CantidadPipe, BarrasPipe,
    EnUnidadPipe, AppChart,
  ],
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
            Sin mercancía pendiente de ningún producto, ni cobros ni pagos: puedes arrancar una
            nueva.
          </span>
        </div>
      } @else if (soloFaltaLibroAnterior(r)) {
        <!-- La temporada SÍ está cerrada: lo único pendiente son las cuentas
             viejas del sistema anterior, que no salieron de este queso. Decir
             "para cerrar la temporada falta cobrar" se leería como que quedó
             una venta de esta temporada sin cobrar. -->
        <div class="temporada al-dia">
          <mat-icon aria-hidden="true">check_circle</mat-icon>
          <span>
            <strong>Temporada al día.</strong>
            Sin mercancía pendiente y sin cobros ni pagos de esta temporada. Lo que queda es del
            libro anterior:
            @if (esPositivo(cobrarDelLibro(r))) {
              <span class="chip">cobrar {{ cobrarDelLibro(r) | money }}</span>
            }
            @if (esPositivo(pagarDelLibro(r))) {
              <span class="chip">pagar {{ pagarDelLibro(r) | money }}</span>
            }
          </span>
        </div>
      } @else {
        <div class="temporada pendiente">
          <mat-icon aria-hidden="true">pending_actions</mat-icon>
          <span>
            <strong>Para cerrar la temporada falta:</strong>
            <!-- UN CHIP POR PRODUCTO CON MERCANCÍA, cada uno en su unidad y NUNCA
                 sumados entre sí: "20 kg + 8 barras" no es un número. Antes eran dos
                 chips fijos —el queso y la mozzarella—, así que un producto que el
                 dueño agregara podía tener la bodega llena y la pantalla decía
                 "Temporada al día. Puedes arrancar una nueva". -->
            @for (existencia of conMercancia(); track existencia.producto) {
              <span class="chip">
                vender {{ existencia.disponible | enUnidad: unidadDeExistencia(existencia) }}
                de {{ existencia.etiqueta }}
              </span>
            }
            @if (esPositivo(r.por_cobrar_clientes)) {
              <span class="chip">
                cobrar {{ r.por_cobrar_clientes | money }}
                @if (esPositivo(cobrarDelLibro(r))) {
                  <span class="del-libro">({{ cobrarDelLibro(r) | money }} del libro anterior)</span>
                }
              </span>
            }
            @if (esPositivo(r.por_pagar_productores)) {
              <span class="chip">
                pagar {{ r.por_pagar_productores | money }}
                @if (esPositivo(pagarDelLibro(r))) {
                  <span class="del-libro">({{ pagarDelLibro(r) | money }} del libro anterior)</span>
                }
              </span>
            }
          </span>
        </div>
      }

      <div class="resumen-grid">
        <!-- UNA TARJETA DE INVENTARIO POR PRODUCTO, cada una en SU unidad y ninguna
             sumada con otra: kilos con kilos y piezas con piezas. Antes eran tres
             tarjetas fijas (queso, borona y mozzarella) y la mercancía de cualquier
             producto que el dueño agregara no aparecía en ninguna pantalla. Salen
             todas, aunque estén en cero, porque "no hay" es una respuesta que él
             necesita ver. -->
        @for (existencia of existencias(); track existencia.producto; let i = $index) {
          <div class="tarjeta {{ colorDeTarjeta(i) }}">
            <span class="icono">
              <mat-icon aria-hidden="true">
                {{ existencia.unidad === 'kg' ? 'inventory_2' : 'view_in_ar' }}
              </mat-icon>
            </span>
            <span class="textos">
              <span class="cifra">
                {{ existencia.disponible | enUnidad: unidadDeExistencia(existencia) }}
              </span>
              <span class="titulo">{{ existencia.etiqueta }} disponible</span>
              @if (vendidoDelPeriodo(existencia); as vendido) {
                <span class="detalle">
                  vendido en el período:
                  {{ vendidosDe(vendido) | enUnidad: unidadDeFila(vendido) }} ·
                  {{ vendido.ingreso | money }}
                </span>
              }
            </span>
          </div>
        }

        <div class="tarjeta" [class.verde]="!esNegativo(r.ganancia_estimada)" [class.rojo]="esNegativo(r.ganancia_estimada)">
          <span class="icono">
            <mat-icon aria-hidden="true">{{ esNegativo(r.ganancia_estimada) ? 'trending_down' : 'trending_up' }}</mat-icon>
          </span>
          <span class="textos">
            <span class="cifra">{{ r.ganancia_estimada | money }}</span>
            <span class="titulo">Ganancia neta del período</span>
            <!-- La cifra grande SÍ suma las dos unidades (son pesos), pero el
                 margen unitario NO se puede sumar: se muestran los dos, cada uno
                 con su unidad. Un solo "$/kg" que llevara adentro la plata de las
                 barras no diría nada del queso. -->
            <span class="detalle">
              {{ r.margen_por_kilo | money }}/kg vendido
              @if (hayMozzarella(r)) {
                · {{ r.margen_por_barra | money }}/barra vendida
              }
              · ya con compra, merma y gastos
            </span>
          </span>
        </div>

        <div class="tarjeta ambar">
          <span class="icono"><mat-icon aria-hidden="true">agriculture</mat-icon></span>
          <span class="textos">
            <span class="cifra">{{ r.por_pagar_productores | money }}</span>
            <span class="titulo">Por pagar a productores</span>
            <!-- De dónde sale la suma: la cifra grande ya trae las cuentas viejas. -->
            @if (esPositivo(pagarDelLibro(r))) {
              <span class="detalle">
                incluye {{ pagarDelLibro(r) | money }} del libro anterior
              </span>
            }
          </span>
        </div>

        <div class="tarjeta azul">
          <span class="icono"><mat-icon aria-hidden="true">request_quote</mat-icon></span>
          <span class="textos">
            <span class="cifra">{{ r.por_cobrar_clientes | money }}</span>
            <span class="titulo">Por cobrar a clientes</span>
            @if (esPositivo(cobrarDelLibro(r))) {
              <span class="detalle">
                incluye {{ cobrarDelLibro(r) | money }} del libro anterior
              </span>
            }
          </span>
        </div>
      </div>

      <div class="desglose">
        <!-- CADA CIFRA DE PLATA AL LADO DE SU PROPIA CANTIDAD, y nunca una plata que
             lleve adentro la de otra unidad: "211 kg · $11.016.579" invita a dividir
             y a sacar un precio por kilo que no existe.

             La plata de estas dos primeras baldosas se SUMA DE LAS FILAS EN KILOS del
             desglose de abajo (ver plataDeLosKilos). Antes era una resta —el total
             menos el pedazo de la mozzarella—, y esa resta dejó de ser cierta el día
             que el catálogo permitió un segundo producto por unidad: la plata de las
             panelas se quedaba sumada dentro de una cifra rotulada "en kilos". -->
        <div class="dato">
          <span class="etq">Comprado (en kilos)</span>
          <span class="val">
            {{ r.kilos_comprados | cantidad: 'kg' }} · {{ compradoEnKilos() | money }}
          </span>
          <span class="sub">{{ r.precio_promedio_compra | money }}/kg promedio</span>
        </div>
        @if (hayMozzarella(r)) {
          <div class="dato">
            <span class="etq">Comprado (mozzarella)</span>
            <span class="val">
              {{ r.barras_compradas | barras }} · {{ r.total_compras_mozzarella | money }}
            </span>
            <span class="sub">{{ r.precio_promedio_compra_barra | money }}/barra promedio</span>
          </div>
        }
        <div class="dato">
          <span class="etq">Vendido (en kilos)</span>
          <span class="val">
            {{ kilosVendidosTotales() | cantidad: 'kg' }} · {{ vendidoEnKilos() | money }}
          </span>
          <span class="sub">
            {{ r.precio_promedio_venta | money }}/kg promedio, sin los subproductos
          </span>
        </div>
        @if (hayMozzarella(r)) {
          <div class="dato">
            <span class="etq">Vendido (mozzarella)</span>
            <span class="val">
              {{ r.barras_vendidas | barras }} · {{ r.total_ventas_mozzarella | money }}
            </span>
            <span class="sub">{{ r.precio_promedio_venta_barra | money }}/barra promedio</span>
          </div>
        }
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
          <!-- Solo los del período: la lista completa trae además a los que
               únicamente se les debe del libro anterior, y con 0 kilos y $0 de
               ganancia encabezaban el ranking sin haberle vendido nada. -->
          @if (productoresConCompras().length > 0) {
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
                <!-- Los encabezados de las columnas de cantidad y precio son
                     neutros porque la tabla mezcla renglones de kilos y de barras:
                     un "Kilos" fijo mentiría sobre los de mozzarella. La unidad va
                     en CADA CELDA, sacada del campo unidad que manda el backend. -->
                <thead>
                  <tr>
                    <th scope="col">Producto</th>
                    <th scope="col">Cantidad</th>
                    <th scope="col">Venta por unidad</th>
                    <th scope="col">Compra por unidad</th>
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
                        {{ cantidadDe(fila) | enUnidad: unidadDeFila(fila) }}
                        @if (vendidosDistintos(fila)) {
                          <span class="nota">
                            vendidos: {{ vendidosDe(fila) | enUnidad: unidadDeFila(fila) }}
                          </span>
                        }
                      </td>
                      <td>
                        {{ sinVenta(fila, precioVenta(fila)) ? '—' : (precioVenta(fila) | money) }}
                        @if (!sinVenta(fila, precioVenta(fila))) {
                          <span class="por-unidad">/{{ rotuloUnidad(fila) }}</span>
                        }
                      </td>
                      <td>
                        {{ costoUnitario(fila) === null ? '—' : (costoUnitario(fila) | money) }}
                        @if (costoUnitario(fila) !== null) {
                          <span class="por-unidad">/{{ rotuloUnidad(fila) }}</span>
                        }
                      </td>
                      <td>{{ sinVenta(fila, fila.gastos) ? '—' : (fila.gastos | money) }}</td>
                      <!-- Con centavos si los hay (no | money): esta columna tiene
                           que sumar su propio pie con calculadora. -->
                      <td [class.positivo]="esPositivo(fila.ganancia)" [class.negativo]="esNegativo(fila.ganancia)">
                        {{ pesosExactos(fila.ganancia) }}
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
                      {{ pesosExactos(r.ganancia_estimada) }}
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
        <!-- Sin compras en el período el reparto NO existe: esa ganancia salió de
             queso comprado antes, así que la columna suma $0 a propósito y el
             subtítulo no puede prometer que cuadra con la tarjeta de arriba. -->
        <p class="grafica-sub">
          @if (sinComprasEnPeriodo(r)) {
            En este período no se le compró a nadie, así que la tabla no explica la ganancia: esa
            plata salió de queso comprado antes. Aquí solo se muestra a quién se le debe hoy, con
            ganancia $0 porque no se le compró nada en el período.
          } @else {
            Estimado: de cada kilo comprado en el período entraron
            {{ r.valor_realizado_kilo | money }} netos (ventas − gastos). Se reparte entre los
            kilos de cada productor, así que la suma cuadra con la ganancia neta de arriba.
            @if (hayMozzarella(r)) {
              La mozzarella se reparte por su lado: de cada barra comprada entraron
              {{ r.valor_realizado_barra | money }} netos. Las dos partes se suman en la
              ganancia porque son pesos; las cantidades no, que son unidades distintas.
            }
          }
        </p>
        @if (productores().length > 0) {
          <div class="tabla-scroll">
            <table class="tabla-datos">
              <caption class="solo-lectores">Detalle de ganancia estimada por productor</caption>
              <!-- Kilos y barras son DOS COLUMNAS, nunca una sumada. Las de barras
                   solo aparecen si hay mozzarella, para no meterle tres columnas de
                   ceros a una tabla que ya es ancha. -->
              <thead>
                <tr>
                  <th scope="col">Productor</th>
                  <th scope="col">Compras</th>
                  <th scope="col">Kilos</th>
                  @if (hayMozzarella(r)) {
                    <th scope="col">Barras</th>
                  }
                  <th scope="col">Comprado</th>
                  <th scope="col">$/kg comprado</th>
                  @if (hayMozzarella(r)) {
                    <th scope="col">$/barra comprada</th>
                  }
                  <th scope="col">Margen $/kg</th>
                  @if (hayMozzarella(r)) {
                    <th scope="col">Margen $/barra</th>
                  }
                  <th scope="col">Ganancia estimada</th>
                  <th scope="col">Se le debe</th>
                </tr>
              </thead>
              <tbody>
                @for (fila of productores(); track fila.productor) {
                  <tr>
                    <td>
                      <span class="nombre">{{ fila.productor }}</span>
                      <!-- Sin esta nota la fila es una hilera de ceros sin
                           explicación. El texto NO puede decir "solo cuenta
                           anterior": la deuda puede venir de una compra vieja
                           DEL SISTEMA (de mayo, por ejemplo) y no del libro
                           anterior, y el backend manda las dos sumadas en la
                           columna "Se le debe". Lo cierto en los dos casos es
                           que no se le compró nada en el período. -->
                      @if (sinComprasDelPeriodo(fila)) {
                        <span class="nota">sin compras en el período</span>
                      }
                    </td>
                    <td>{{ fila.compras }}</td>
                    <!-- Un guion y no "0 kg" cuando el productor no vendió de esa
                         unidad: un cero en una columna de cantidad se lee como "le
                         compramos y no pesó nada". -->
                    <td>{{ esPositivo(fila.kilos) ? (fila.kilos | cantidad: 'kg') : '—' }}</td>
                    @if (hayMozzarella(r)) {
                      <td>{{ esPositivo(fila.barras) ? (fila.barras | barras) : '—' }}</td>
                    }
                    <td>{{ fila.total_comprado | money }}</td>
                    <td>{{ esPositivo(fila.kilos) ? (fila.precio_promedio | money) : '—' }}</td>
                    @if (hayMozzarella(r)) {
                      <td>
                        {{ esPositivo(fila.barras) ? (fila.precio_promedio_barra | money) : '—' }}
                      </td>
                    }
                    <td [class.positivo]="esPositivo(fila.margen_por_kilo)" [class.negativo]="esNegativo(fila.margen_por_kilo)">
                      {{ esPositivo(fila.kilos) ? (fila.margen_por_kilo | money) : '—' }}
                    </td>
                    @if (hayMozzarella(r)) {
                      <td [class.positivo]="esPositivo(fila.margen_por_barra)" [class.negativo]="esNegativo(fila.margen_por_barra)">
                        {{ esPositivo(fila.barras) ? (fila.margen_por_barra | money) : '—' }}
                      </td>
                    }
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

      .chip { background: color-mix(in srgb, #2e7d32 20%, transparent); }
    }

    // Cuánto de la cifra del chip viene del libro anterior. Va dentro del propio
    // chip para que la aclaración no se despegue de la cifra que explica.
    .temporada .chip .del-libro {
      margin-left: 4px;
      font-weight: 400;
      font-size: 0.85em;
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

      // La unidad del precio, pegada a la cifra: "$14.800 /barra". En pequeño para
      // que no compita con el número, pero visible: es lo que evita leer un precio
      // por barra como si fuera por kilo.
      .por-unidad { font-size: 0.72rem; color: var(--mat-sys-on-surface-variant); }

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

  /**
   * Pesos para la columna "Ganancia" y su pie: miles con punto y centavos SOLO
   * cuando existen (y entonces siempre dos), con el signo antes del $, igual que
   * `pesos()` de app/utils/export.py.
   *
   * A propósito NO usa | money: ese pipe redondea cada cifra a pesos enteros por
   * separado, así que en un período con centavos las filas visibles se veían
   * sumando -$4.999 contra un pie de -$5.000 cuando los datos SÍ cuadran
   * (1.666,66 − 3.333,34 − 3.333,34 + 0,01 = −5.000,01). El usuario revisa este
   * desglose con calculadora: la columna tiene que sumar lo que dice el pie.
   */
  pesosExactos(valor: Monto): string {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return '—';
    const absoluto = Math.abs(numero);
    const decimales = Number.isInteger(absoluto) ? 0 : 2;
    return `${numero < 0 ? '-' : ''}$ ${absoluto.toLocaleString('es-CO', {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    })}`;
  }

  esPositivo(valor: Monto): boolean {
    return Number(valor) > 0;
  }

  /**
   * ¿Hay mozzarella en este negocio? Decide si la pantalla muestra sus tarjetas,
   * columnas y renglones.
   *
   * Mira las barras COMPRADAS o VENDIDAS del período Y las DISPONIBLES (que son
   * históricas). Las disponibles son la clave: un período en el que no se compró ni
   * se vendió mozzarella, pero con barras todavía en la bodega, tiene que seguir
   * mostrando su tarjeta y su chip de "falta vender" — si no, la mercancía
   * desaparece de la pantalla por haber cambiado el filtro de fechas.
   */
  hayMozzarella(r: ResumenReventa): boolean {
    return (
      this.monto(r.barras_compradas) !== 0 ||
      this.monto(r.barras_vendidas) !== 0 ||
      this.monto(r.barras_disponibles) !== 0
    );
  }

  /**
   * LA PLATA DE LO QUE SE PESA, sumada de las filas del desglose que están en kilos.
   *
   * ANTES ERA UNA RESTA —"el total menos el pedazo de la mozzarella"— y esa resta
   * dejó de ser cierta el día que el catálogo permitió un segundo producto por
   * unidad: la plata de las panelas no es de la mozzarella, así que se quedaba
   * sumada dentro de una cifra rotulada "en kilos". Sumando las filas de kilos del
   * desglose la cifra es exacta por construcción y sigue siendo la misma de siempre
   * en un negocio de queso, borona y mozzarella.
   */
  private plataDeLosKilos(campo: 'costo' | 'ingreso'): number {
    return (
      (this.resumen()?.por_producto ?? [])
        // La fila de la red de seguridad NO entra: es plata que no se pudo clasificar
        // en ningún producto, y decir que es "en kilos" sería justamente clasificarla
        // a dedo. Llega marcada en kilos porque el backend arma esa fila con el
        // constructor de las de kilos, no porque se sepa que lo sea. No desaparece de
        // ninguna parte: sale entera en su propia fila del desglose de abajo, que es
        // el que suma el encabezado.
        .filter((fila) => fila.unidad === 'kg' && fila.producto !== 'sin_producto')
        .reduce((suma, fila) => suma + this.monto(fila[campo]), 0)
    );
  }

  compradoEnKilos(): number {
    return this.plataDeLosKilos('costo');
  }

  vendidoEnKilos(): number {
    return this.plataDeLosKilos('ingreso');
  }

  /**
   * TODOS LOS KILOS VENDIDOS del período: los de los productos que se compran más los
   * de los subproductos.
   *
   * Va al lado de la plata de las ventas en kilos, que también los incluye a los dos.
   * Con `kilos_vendidos` a secas —que deja por fuera los subproductos— la baldosa
   * mostraba una cantidad más chica que la plata que tenía al lado, y dividir a mano
   * daba un precio por kilo inflado.
   */
  kilosVendidosTotales(): number {
    const r = this.resumen();
    return r ? this.monto(r.kilos_vendidos) + this.monto(r.kilos_borona_vendidos) : 0;
  }

  /**
   * EL INVENTARIO, PRODUCTO POR PRODUCTO Y CADA UNO EN SU UNIDAD.
   *
   * Es la lista `existencias` del backend, que trae una fila por producto del
   * catálogo —aunque esté en cero, porque "no hay" es una respuesta— más cualquier
   * producto que aparezca en los movimientos sin estar en el catálogo.
   *
   * SI EL BACKEND TODAVÍA NO LA MANDA se arman los tres de siempre con los tres
   * campos de siempre, que dicen exactamente lo mismo: así esta pantalla sirve con
   * las dos versiones del servidor y se ve igual que antes mientras llega la nueva.
   */
  readonly existencias = computed<ExistenciaProducto[]>(() => {
    const r = this.resumen();
    if (!r) return [];
    if (r.existencias?.length) return r.existencias;
    const deSiempre: ExistenciaProducto[] = [
      { producto: 'queso', etiqueta: 'Queso', unidad: 'kg', disponible: r.kilos_disponibles },
      { producto: 'borona', etiqueta: 'Borona', unidad: 'kg', disponible: r.borona_disponible },
    ];
    if (this.hayMozzarella(r)) {
      deSiempre.push({
        producto: 'mozzarella',
        etiqueta: 'Mozzarella',
        unidad: 'unidad',
        disponible: r.barras_disponibles,
      });
    }
    return deSiempre;
  });

  /** 'kg', 'barra' o 'unidad': cómo se rotula la cantidad de ese producto. */
  unidadDeExistencia(fila: ExistenciaProducto): Unidad {
    return fila.unidad === 'kg' ? 'kg' : piezaDe(fila.producto);
  }

  /** Los productos que TIENEN mercancía en bodega: los que faltan por mover. */
  readonly conMercancia = computed<ExistenciaProducto[]>(() =>
    this.existencias().filter((fila) => this.esPositivo(fila.disponible)),
  );

  /**
   * Lo que se vendió de ESE producto en el período, sacado de su fila del desglose.
   * Nulo cuando el producto no tuvo ventas: entonces la tarjeta no dice nada, en vez
   * de estrenar un "vendido: 0" que no aporta.
   */
  vendidoDelPeriodo(fila: ExistenciaProducto): GananciaProducto | null {
    const suya = (this.resumen()?.por_producto ?? []).find(
      (f) => f.producto === fila.producto,
    );
    if (!suya) return null;
    return Number(this.vendidosDe(suya)) !== 0 || Number(suya.ingreso) !== 0 ? suya : null;
  }

  /** El color de la tarjeta de inventario: los mismos tres de siempre, en ciclo. */
  colorDeTarjeta(indice: number): string {
    return COLORES_TARJETA[indice % COLORES_TARJETA.length];
  }

  /**
   * Temporada al día: sin mercancía pendiente DE NINGÚN PRODUCTO y sin cobros ni
   * pagos.
   *
   * MIRA TODOS LOS PRODUCTOS, uno por uno y cada uno en su unidad, y no las dos
   * cifras de siempre. Preguntando solo por el queso y por la mozzarella, la
   * pantalla decía "Temporada al día. Puedes arrancar una nueva" con la bodega
   * llena de un producto que el dueño agregó él mismo — que es exactamente la
   * mentira que ya se había arreglado una vez para la mozzarella.
   */
  temporadaAlDia(r: ResumenReventa): boolean {
    return (
      this.conMercancia().length === 0 &&
      !this.esPositivo(r.por_cobrar_clientes) &&
      !this.esPositivo(r.por_pagar_productores)
    );
  }

  /**
   * La temporada quedó cerrada y lo único pendiente son las cuentas del libro
   * anterior: no hay queso por mover y, quitando esas cuentas viejas, no queda
   * nada por cobrar ni por pagar de lo que se compró y se vendió aquí.
   *
   * Si el backend todavía no manda las cifras del libro anterior, `monto()` las
   * lee como cero y este caso nunca se cumple: el indicador se comporta igual
   * que antes.
   */
  soloFaltaLibroAnterior(r: ResumenReventa): boolean {
    if (this.temporadaAlDia(r)) return false;
    // Nada por mover DE NINGÚN PRODUCTO: si queda mercancía de cualquiera, lo
    // pendiente no es solo el libro anterior.
    if (this.conMercancia().length > 0) return false;
    const cobrarDelSistema = this.monto(r.por_cobrar_clientes) - this.monto(r.por_cobrar_libro_anterior);
    const pagarDelSistema = this.monto(r.por_pagar_productores) - this.monto(r.por_pagar_libro_anterior);
    return cobrarDelSistema <= 0 && pagarDelSistema <= 0;
  }

  /**
   * Cuánto de la cifra grande "Por cobrar a clientes" se le puede atribuir al
   * libro anterior: el MÍNIMO entre las dos, nunca el saldo del libro a secas.
   * Si un cliente abonó de más, el pedazo del sistema queda NEGATIVO y el libro
   * pasa por encima del total (por cobrar $400.000 con $500.000 del libro): el
   * desglose quedaría por encima de la cifra que explica.
   */
  cobrarDelLibro(r: ResumenReventa): number {
    return Math.min(this.monto(r.por_cobrar_libro_anterior), this.monto(r.por_cobrar_clientes));
  }

  /** Lo mismo del otro lado: lo del libro no puede superar lo que hay por pagar. */
  pagarDelLibro(r: ResumenReventa): number {
    return Math.min(this.monto(r.por_pagar_libro_anterior), this.monto(r.por_pagar_productores));
  }

  /** Monto como número; 0 si la respuesta no trae el campo (backend más viejo). */
  private monto(valor: Monto | null | undefined): number {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : 0;
  }

  /**
   * Color de cada destino del queso en la dona: verde, ámbar, rojo y azul.
   * Solo el color: la etiqueta la manda el backend en `fila.etiqueta`, para que
   * la leyenda de la dona y la tabla nunca digan nombres distintos.
   *
   * LOS CINCO DE SIEMPRE CONSERVAN SU COLOR —el dueño ya sabe que la tajada roja es
   * la merma— y a cualquier producto que él agregue se le da uno de la paleta según
   * su lugar en la dona (ver `colorDeDestino`). Antes, todos los productos nuevos
   * caían en el mismo color de respaldo y dos tajadas distintas se veían iguales.
   */
  private readonly COLOR_DESTINO: Record<string, string> = {
    queso: CHART_COLORS[1],
    borona: CHART_COLORS[2],
    merma: CHART_COLORS[3],
    pendiente: CHART_COLORS[0],
    anterior: CHART_COLORS[5],
  };

  private colorDeDestino(fila: GananciaProducto, indice: number): string {
    return this.COLOR_DESTINO[fila.producto] ?? CHART_COLORS[(indice + 4) % CHART_COLORS.length];
  }

  /**
   * Destinos del queso comprado en el período, tomados de por_producto (única
   * fuente de verdad). Se incluye 'anterior' cuando aplica: es un destino real
   * de kilos y sin él las tajadas no explicarían el total que se muestra.
   *
   * LA MOZZARELLA NO ENTRA EN ESTA DONA, y no es un olvido: la dona reparte un
   * total de KILOS entre sus destinos, y una tajada de barras metida ahí haría que
   * el círculo represente "kilos + barras", que no es ninguna cantidad. Los
   * renglones de barras se filtran solos porque su campo `kilos` viene en cero
   * —así están construidos—, pero se filtra además por unidad para que quede
   * dicho a propósito y no por casualidad. Su cantidad se ve en la tarjeta de
   * "Mozzarella disponible" y en la tabla de ganancia por producto.
   */
  readonly filasDona = computed<GananciaProducto[]>(() =>
    (this.resumen()?.por_producto ?? []).filter(
      (fila) => fila.unidad === 'kg' && Number(fila.kilos) > 0,
    ),
  );

  /**
   * Kilos que salieron de inventario de temporadas anteriores (0 si no hubo).
   *
   * SE SUMAN LOS DE TODOS LOS PRODUCTOS QUE SE PESAN, no solo la fila llamada
   * 'anterior': cada grupo de costeo tiene la suya ('anterior' la del queso,
   * '{clave}_anterior' la de los demás), y con un segundo producto en kilos la
   * pantalla decía "0" mientras la dona sí mostraba sus tajadas.
   */
  readonly kilosDeAntes = computed<number>(() =>
    (this.resumen()?.por_producto ?? [])
      .filter((f) => f.unidad === 'kg' && esDeInventarioAnterior(f.producto))
      .reduce((suma, f) => suma + Number(f.kilos), 0),
  );

  /** Dona: a dónde fue el queso (vendido, pasado a borona, merma o aún en inventario). */
  readonly quesoChart = computed<ChartData>(() => {
    const filas = this.filasDona();
    return {
      labels: filas.map((fila) => fila.etiqueta),
      datasets: [
        {
          data: filas.map((fila) => Number(fila.kilos)),
          backgroundColor: filas.map((fila, indice) => this.colorDeDestino(fila, indice)),
        },
      ],
    };
  });

  /**
   * Filas del desglose por producto. SE ESCONDE SOLO LA QUE ESTÁ COMPLETAMENTE EN
   * CEROS: sin cantidad, sin ingreso, sin costo, sin gastos y sin ganancia.
   *
   * LA REGLA ES "NINGUNA FILA CON PLATA SE ESCONDE", y está escrita al derecho —se
   * exige que TODO esté en cero para esconder— y no al revés. Es lo que hace que las
   * cuatro columnas del desglose sigan sumando exacto el encabezado, que es lo que el
   * dueño verifica con calculadora.
   *
   * DOS FORMAS DE ESCONDER PLATA QUE ESTE FILTRO YA NO PERMITE:
   *  · La de antes escondía las filas sin cantidad y con ganancia 0. Pero una fila
   *    puede tener ganancia 0 y aun así mover plata —$300.000 de ingreso contra
   *    $300.000 de costo—, y ahí las columnas de ingreso y de costo dejaban de sumar
   *    el encabezado sin que nada lo dijera.
   *  · Y la fila 'sin_producto' es justamente esa: plata que el backend no pudo
   *    acomodar en ninguna fila de producto y saca aparte para que se vea. Esconderla
   *    sería tapar el único aviso que hay de que algo se rompió.
   */
  readonly filasProducto = computed<GananciaProducto[]>(() =>
    (this.resumen()?.por_producto ?? []).filter(
      (fila) =>
        // La cantidad se mira EN SU PROPIA UNIDAD: un renglón que se cuenta tiene
        // `kilos` en cero siempre, así que preguntando solo por los kilos se
        // esconderían las piezas vendidas con ganancia exactamente 0.
        Number(this.cantidadDe(fila)) !== 0 ||
        Number(fila.ingreso) !== 0 ||
        Number(fila.costo) !== 0 ||
        Number(fila.gastos) !== 0 ||
        Number(fila.ganancia) !== 0,
    ),
  );

  /** La cantidad de la fila EN SU UNIDAD: kilos o piezas, nunca las dos. */
  cantidadDe(fila: GananciaProducto): Monto {
    return fila.unidad === 'kg' ? fila.kilos : fila.barras;
  }

  /** Lo VENDIDO de la fila, en su unidad. */
  vendidosDe(fila: GananciaProducto): Monto {
    return fila.unidad === 'kg' ? fila.kilos_vendidos : fila.barras_vendidas;
  }

  /**
   * La unidad con la que se rotula la fila: 'kg', 'barra' o 'unidad'.
   *
   * El backend manda 'barra' en TODA fila que se cuente —es la unidad con la que
   * nació el módulo—, así que aquí se le pregunta a la clave del producto cómo se
   * llama SU pieza: la de la mozzarella es una barra y la de cualquier otro producto
   * por unidad es una unidad. Poner "/barra" debajo del precio de una panela sería
   * inventarle al dueño una unidad que él no usa.
   */
  unidadDeFila(fila: GananciaProducto): Unidad {
    return fila.unidad === 'kg' ? 'kg' : piezaDe(claveBaseDeFila(fila.producto));
  }

  /** La palabra suelta para el sufijo de las columnas de precio. */
  rotuloUnidad(fila: GananciaProducto): string {
    const unidad = this.unidadDeFila(fila);
    return unidad === 'kg' ? 'kg' : unidad;
  }

  /** El precio de venta unitario de la fila, en su unidad. */
  precioVenta(fila: GananciaProducto): Monto {
    return fila.unidad === 'kg' ? fila.precio_venta_kilo : fila.precio_venta_barra;
  }

  /**
   * Filas del detalle por productor; ya vienen ordenadas por ganancia estimada
   * (mayor a menor). Incluye a los que solo se les debe del libro anterior: van
   * en ceros pero con su deuda, para que la columna "Se le debe" sume lo que dice
   * la tarjeta de arriba.
   */
  readonly productores = computed<GananciaProductor[]>(() => this.resumen()?.por_productor ?? []);

  /**
   * Los productores a los que SÍ se les compró en el período: son los del
   * ranking. Que la lista traiga filas ya no significa que hubo compras, así que
   * el "Sin compras en el período" de la gráfica se decide con esta.
   */
  readonly productoresConCompras = computed<GananciaProductor[]>(() =>
    // Cuenta las DOS unidades: a quien solo se le compró mozzarella se le compró
    // igual, y dejarlo fuera del ranking por no tener kilos sería esconder al
    // proveedor de un producto entero.
    this.productores().filter((fila) => Number(fila.kilos) > 0 || Number(fila.barras) > 0),
  );

  /**
   * La fila está en la tabla solo por lo que se le debe: no tuvo compras en el
   * período. Puede ser deuda de una compra vieja del sistema, del libro anterior
   * o de las dos (el backend las manda sumadas en `por_pagar`).
   */
  sinComprasDelPeriodo(fila: GananciaProductor): boolean {
    // `compras` cuenta las de las dos unidades, así que basta con él para no
    // rotular como "sin compras" a un productor de pura mozzarella. Se conserva la
    // comprobación de los kilos por si llegara una fila con conteo pero sin
    // cantidad, y se le agrega la de las barras por simetría.
    return Number(fila.kilos) === 0 && Number(fila.barras) === 0 && fila.compras === 0;
  }

  /**
   * El período no tuvo compras. Entonces el detalle por productor NO PUEDE
   * explicar la ganancia del período: esa plata salió de inventario comprado
   * ANTES, y repartirla entre gente a la que no se le compró sería inventarla.
   * Por eso el backend deja esas filas con ganancia $0 y el subtítulo cambia.
   *
   * Se deduce de `kilos_comprados`, que ya viene en el resumen y es EL MISMO
   * divisor con el que el backend reparte el neto del período: no hace falta un
   * campo nuevo, que además podría quedar en desacuerdo con los kilos.
   */
  sinComprasEnPeriodo(r: ResumenReventa): boolean {
    // Las DOS unidades: un período de pura mozzarella tiene `kilos_comprados` en
    // cero, y sin esta segunda condición la pantalla diría "en este período no se le
    // compró a nadie" justo debajo de una tabla con las compras de barras.
    return !this.esPositivo(r.kilos_comprados) && !this.esPositivo(r.barras_compradas);
  }

  /** Barras horizontales: ganancia estimada de los 8 productores que más dejaron. */
  readonly productoresChart = computed<ChartData>(() => {
    const filas = this.productoresConCompras().slice(0, 8);
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

  /**
   * En la merma, los residuos y la red de seguridad no hay venta: un $0 ahí se
   * muestra con un guion, porque significa "aquí no hubo venta" y no "se vendió en
   * cero".
   *
   * SE PREGUNTA POR LA CLASE DE FILA (`esFilaSinVenta`) y no contra una lista de
   * productos que sí se venden. La lista de antes tenía escritos los tres de siempre,
   * así que un producto que el dueño agregara caía por descuido en el trato de "aquí
   * no hubo venta" y su fila mostraba guiones donde tenía cifras.
   */
  sinVenta(fila: GananciaProducto, valor: Monto): boolean {
    return Number(valor) === 0 && esFilaSinVenta(fila.producto);
  }

  /**
   * Costo unitario de la fila, EN SU UNIDAD. En los residuos que vienen de un
   * inventario anterior el costo total es un crédito (se pagó en otro período), así
   * que mostrar el precio de compra en positivo haría que Cantidad × $/unidad no
   * cuadrara con la ganancia: ahí se muestra un guion.
   *
   * Se pregunta por la CLASE de fila y no por sus dos nombres viejos: cada producto
   * del catálogo tiene su propia fila de inventario anterior.
   */
  costoUnitario(fila: GananciaProducto): Monto | null {
    if (esDeInventarioAnterior(fila.producto)) return null;
    return fila.unidad === 'kg' ? fila.costo_kilo : fila.costo_barra;
  }

  /** Lo vendido de esa fila difiere de lo comprado que fue a ese destino (borona). */
  vendidosDistintos(fila: GananciaProducto): boolean {
    return Number(this.vendidosDe(fila)) !== Number(this.cantidadDe(fila));
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
