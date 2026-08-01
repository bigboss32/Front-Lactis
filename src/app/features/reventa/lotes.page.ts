import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Monto } from '../../core/models';
import { isoToDate } from '../../shared/date-utils';
import { detalleDeError } from '../../shared/errores-ui';
import { PageHeader } from '../../shared/page-header';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import {
  GananciaPorDia,
  LoteResumen,
  LotesPanel,
  ReventaService,
} from './reventa.service';

/**
 * Una fecha en ISO (yyyy-mm-dd) para mandarla al backend.
 *
 * Con 'en-CA' y no con toISOString(): el segundo pasa a UTC y en Colombia
 * (UTC-5) devuelve el día ANTERIOR para cualquier hora antes de las 7 p.m. Una
 * venta del 25 se consultaría como del 24.
 */
function aIso(f: Date): string {
  return f.toLocaleDateString('en-CA');
}

/** El primero del mes corrido. */
function primerDiaDelMes(): Date {
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth(), 1);
}

interface Atajo {
  texto: string;
  rango: () => [Date, Date];
}

/**
 * Los rangos que se piden casi siempre. Con estos rara vez hay que abrir el
 * calendario, que era la queja: tener que teclear las dos fechas cada vez.
 */
const ATAJOS: Atajo[] = [
  { texto: 'Hoy', rango: () => [new Date(), new Date()] },
  {
    texto: 'Últimos 7 días',
    rango: () => {
      const h = new Date();
      return [new Date(h.getFullYear(), h.getMonth(), h.getDate() - 6), h];
    },
  },
  { texto: 'Este mes', rango: () => [primerDiaDelMes(), new Date()] },
  {
    texto: 'Mes pasado',
    rango: () => {
      const h = new Date();
      return [
        new Date(h.getFullYear(), h.getMonth() - 1, 1),
        // Día 0 del mes corriente = el último del anterior
        new Date(h.getFullYear(), h.getMonth(), 0),
      ];
    },
  },
];

/** Número a partir de un Monto, que llega como texto cuando es Decimal. */
function n(valor: Monto | null | undefined): number {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Ganancia por LOTE de compra: qué dejó cada tanda de queso que se compró.
 *
 * Un lote son todas las compras de una misma fecha: "la compra del 25" es un lote
 * y "las compras del 18" es otro, aunque cada uno tenga varios productores.
 *
 * Las dos cosas que esta pantalla tiene que explicar bien, porque si no el usuario
 * desconfía de los números con razón:
 *
 * 1. De dónde sale el reparto. Las ventas no dicen de qué lote salió el queso, así
 *    que se reparten del lote más viejo al más nuevo (el queso es perecedero y así
 *    se vende). Es un supuesto y se dice en pantalla, no se esconde.
 * 2. Por qué esta ganancia NO es la del Resumen. Aquí se resta el costo de lo que
 *    SE VENDIÓ; el Resumen resta todas las compras del período, vendidas o no. Un
 *    lote comprado ayer y sin vender sale con ganancia 0 aquí y con pérdida allá,
 *    y las dos cifras son correctas.
 */
@Component({
  selector: 'app-reventa-lotes',
  imports: [
    DatePipe, MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule,
    MatTooltipModule, MatFormFieldModule, MatInputModule, MatDatepickerModule,
    PageHeader, MoneyPipe, CantidadPipe,
  ],
  template: `
    <div class="page">
      <app-page-header
        titulo="Ganancia por lote"
        subtitulo="Cada tanda de queso que compró y qué dejó. Un lote son todas las compras de una misma fecha."
      />

      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <!-- Cuánto se ganó en unos días concretos. Es OTRA cuenta que la de los
           lotes de abajo: aquí se pregunta por fechas de VENTA, no por tandas de
           compra. La pidió el dueño tal cual: "cuánto gané en determinados días". -->
      <mat-card class="por-dia">
        <div class="cabecera-dia">
          <div>
            <h3>¿Cuánto gané en estos días?</h3>
            <p>
              De lo que vendió esos días, menos lo que le había costado ese queso
              y menos los fletes. Las compras de esos días no restan aquí: comprar
              no es gastar, es cambiar plata por queso.
            </p>
            <p class="pista-punto">
              <span class="punto"></span>
              En el calendario, los días con punto son en los que entró queso.
            </p>
          </div>
          <div class="rango">
            <!-- UN solo calendario para las dos fechas: se abre, se marca el
                 primer día y el último, y ya. Con dos campos separados había que
                 abrir dos veces y acordarse de cuál era cuál.
                 La cuenta se rehace al marcar el segundo día, sin darle a nada. -->
            <mat-form-field appearance="outline" class="campo-rango">
              <mat-label>Días</mat-label>
              <mat-date-range-input [rangePicker]="calendario">
                <input matStartDate placeholder="Desde" [value]="desde()"
                       (dateChange)="desde.set($event.value)" />
                <input matEndDate placeholder="Hasta" [value]="hasta()"
                       (dateChange)="hasta.set($event.value); cargarDias()" />
              </mat-date-range-input>
              <mat-datepicker-toggle matIconSuffix [for]="calendario" />
              <mat-date-range-picker #calendario [dateClass]="claseDia" />
            </mat-form-field>
          </div>
        </div>

        <!-- Los atajos: con estos casi nunca hay que abrir el calendario. -->
        <div class="atajos">
          @for (a of ATAJOS; track a.texto) {
            <button mat-stroked-button class="atajo" [class.puesto]="atajo() === a.texto"
                    (click)="usarAtajo(a)">
              {{ a.texto }}
            </button>
          }
        </div>

        @if (errorDias()) {
          <p class="error-dia">{{ errorDias() }}</p>
        } @else if (cargandoDias()) {
          <mat-progress-bar mode="indeterminate" />
        } @else if (porDia(); as g) {
          @if (g.dias.length === 0) {
            <p class="vacio-dia">No hubo ventas en esos días.</p>
          } @else {
            <div class="total-dia" [class.perdida]="n(g.ganancia) < 0">
              <span>{{ n(g.ganancia) < 0 ? 'Perdió' : 'Ganó' }}</span>
              <strong>{{ g.ganancia | money }}</strong>
              <small>
                vendiendo {{ g.kilos | cantidad: ' kg' }} en
                {{ g.dias.length }} {{ g.dias.length === 1 ? 'día' : 'días' }}
              </small>
            </div>
            <div class="tabla-dia">
              <table>
                <thead>
                  <tr>
                    <th>Día</th>
                    <th class="num">Kilos</th>
                    <th class="num">Entró</th>
                    <th class="num">(−) Le costó</th>
                    <th class="num">(−) Fletes</th>
                    <th class="num">Ganó</th>
                  </tr>
                </thead>
                <tbody>
                  @for (d of g.dias; track d.fecha) {
                    <tr>
                      <td>{{ isoADate(d.fecha) | date: 'EEE d MMM' }}</td>
                      <td class="num">{{ d.kilos | cantidad: ' kg' }}</td>
                      <td class="num">{{ d.ingresos | money }}</td>
                      <td class="num">{{ d.costo | money }}</td>
                      <td class="num">{{ d.gastos | money }}</td>
                      <td class="num" [class.perdida]="n(d.ganancia) < 0">
                        {{ d.ganancia | money }}
                      </td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th class="num">{{ g.kilos | cantidad: ' kg' }}</th>
                    <th class="num">{{ g.ingresos | money }}</th>
                    <th class="num">{{ g.costo | money }}</th>
                    <th class="num">{{ g.gastos | money }}</th>
                    <th class="num" [class.perdida]="n(g.ganancia) < 0">
                      {{ g.ganancia | money }}
                    </th>
                  </tr>
                </tfoot>
              </table>
            </div>
          }
        }
      </mat-card>


      @if (error()) {
        <mat-card class="aviso malo">
          <mat-icon aria-hidden="true">cloud_off</mat-icon>
          <span>{{ error() }}</span>
          <button mat-stroked-button (click)="cargar()">Reintentar</button>
        </mat-card>
      }

      @let p = panel();
      @if (p) {
        @if (p.lotes.length === 0) {
          <mat-card class="vacio">
            <mat-icon aria-hidden="true">inventory_2</mat-icon>
            <h3>Todavía no hay compras de queso</h3>
            <p>
              En cuanto registre una compra, aquí aparece ese lote con lo que costó,
              lo que se vendió de él y cuánto dejó.
            </p>
          </mat-card>
        } @else {
          <div class="totales">
            <div class="total principal" [class.perdida]="n(p.total_ganancia) < 0">
              <span class="rotulo">{{ n(p.total_ganancia) < 0 ? 'Pérdida de lo vendido' : 'Ganancia de lo vendido' }}</span>
              <span class="cifra">{{ absoluto(p.total_ganancia) | money }}</span>
              <span class="detalle">
                De los {{ p.lotes.length }} {{ p.lotes.length === 1 ? 'lote' : 'lotes' }},
                contando solo lo que ya salió
              </span>
            </div>
            <div class="total">
              <span class="rotulo">Costo de los lotes</span>
              <span class="cifra chica">{{ p.total_costo | money }}</span>
              <span class="detalle">{{ p.total_kilos_comprados | cantidad: 'kg' }} comprados</span>
            </div>
            <div class="total">
              <span class="rotulo">Todavía sin vender</span>
              <span class="cifra chica">{{ p.total_costo_sin_vender | money }}</span>
              <span class="detalle">
                {{ p.total_kilos_sin_vender | cantidad: 'kg' }} · plata invertida, aún en bodega
              </span>
            </div>
            @if (n(p.total_por_pagar) > 0) {
              <div class="total">
                <span class="rotulo">Falta pagar</span>
                <span class="cifra chica">{{ p.total_por_pagar | money }}</span>
                <span class="detalle">a los productores de estos lotes</span>
              </div>
            }
          </div>

          <!-- El supuesto del reparto, dicho de frente -->
          <p class="supuesto">
            <mat-icon aria-hidden="true">info</mat-icon>
            <span>
              Como las ventas no dicen de qué lote salió el queso, el sistema reparte
              cada venta <strong>del lote más viejo primero</strong>, que es como se
              vende el queso. Cada lote se costea con <strong>su</strong> precio de
              compra, y por eso dos lotes vendidos al mismo precio pueden dejar
              distinto.
            </span>
          </p>

          @if (n(p.kilos_sin_lote) > 0 || n(p.borona_sin_lote) > 0) {
            <mat-card class="aviso ojo">
              <mat-icon aria-hidden="true">report_problem</mat-icon>
              <span>
                Hay
                @if (n(p.kilos_sin_lote) > 0) {
                  <strong>{{ p.kilos_sin_lote | cantidad: 'kg' }} de queso</strong>
                }
                @if (n(p.kilos_sin_lote) > 0 && n(p.borona_sin_lote) > 0) { y }
                @if (n(p.borona_sin_lote) > 0) {
                  <strong>{{ p.borona_sin_lote | cantidad: 'kg' }} de borona</strong>
                }
                vendidos ({{ p.ingreso_sin_lote | money }}) que no salieron de ningún
                lote registrado. Pasa cuando una venta quedó con fecha anterior a la
                compra, o cuando se anuló una compra después de haber vendido de ella.
                Esa plata <strong>no está sumada</strong> en la ganancia de arriba,
                porque no se sabe qué costó.
              </span>
            </mat-card>
          }

          @if (p.lotes.length > 1) {
            <mat-card class="comparacion">
              <h3>Cuánto dejó cada lote</h3>
              <div class="barras">
                @for (l of lotesPorFecha(); track l.fecha) {
                  <div class="barra-fila">
                    <span class="nombre">{{ isoADate(l.fecha) | date: 'd MMM' }}</span>
                    <span class="pista">
                      <span class="relleno" [class.perdida]="n(l.ganancia) < 0"
                            [style.width.%]="anchoBarra(l)"></span>
                    </span>
                    <span class="valor" [class.perdida]="n(l.ganancia) < 0">
                      {{ l.ganancia | money }}
                    </span>
                  </div>
                }
              </div>
            </mat-card>
          }

          <div class="lotes">
            @for (l of p.lotes; track l.fecha) {
              <mat-card class="lote" [class.abierto]="!l.cerrado">
                <div class="cabeza">
                  <div class="identidad">
                    <h3>
                      Lote del {{ isoADate(l.fecha) | date: 'd \\'de\\' MMMM \\'de\\' y' }}
                      @if (l.cerrado) {
                        <span class="chip cerrado">Vendido completo</span>
                      } @else {
                        <span class="chip abierto">Queda queso</span>
                      }
                    </h3>
                    <p class="quienes">
                      {{ l.compras }} {{ l.compras === 1 ? 'compra' : 'compras' }}:
                      {{ l.productores.join(', ') }}
                    </p>
                  </div>
                  <div class="ganancia" [class.perdida]="n(l.ganancia) < 0">
                    <span class="rotulo">{{ n(l.ganancia) < 0 ? 'Pérdida de lo vendido' : 'Ganancia de lo vendido' }}</span>
                    <span class="cifra">{{ absoluto(l.ganancia) | money }}</span>
                    @if (n(l.margen_kilo) !== 0) {
                      <span class="detalle">{{ l.margen_kilo | money }} por kilo vendido</span>
                    }
                  </div>
                </div>

                <div class="cuerpo">
                  <!-- Lo que costó -->
                  <dl class="bloque">
                    <h4>Lo que costó</h4>
                    <div>
                      <dt>Kilos comprados</dt>
                      <dd>{{ l.kilos_comprados | cantidad: 'kg' }}</dd>
                    </div>
                    <div>
                      <dt>Precio pagado</dt>
                      <dd>{{ l.costo_kilo | money }}/kg</dd>
                    </div>
                    <div class="suma">
                      <dt>Costo del lote</dt>
                      <dd>{{ l.costo_total | money }}</dd>
                    </div>
                    @if (n(l.por_pagar) > 0) {
                      <div class="ojo">
                        <dt>Falta pagar</dt>
                        <dd>{{ l.por_pagar | money }}</dd>
                      </div>
                    }
                    @if (n(l.borona_recibida) > 0) {
                      <div>
                        <dt>Borona que vino gratis</dt>
                        <dd>{{ l.borona_recibida | cantidad: 'kg' }}</dd>
                      </div>
                    }
                  </dl>

                  <!-- La cuenta de la ganancia. Los renglones SUMAN la cifra
                       grande, con el operador escrito en cada uno. -->
                  <dl class="bloque">
                    <h4>La cuenta</h4>
                    <div>
                      <dt>Vendido de este lote</dt>
                      <dd>{{ l.ingresos | money }}</dd>
                    </div>
                    <div>
                      <dt>(−) Costo de lo vendido</dt>
                      <dd>{{ costoDeLoVendido(l) | money }}</dd>
                    </div>
                    @if (n(l.costo_merma) > 0) {
                      <div>
                        <dt>(−) Merma perdida</dt>
                        <dd>{{ l.costo_merma | money }}</dd>
                      </div>
                    }
                    @if (n(l.gastos) > 0) {
                      <div>
                        <dt>(−) Gastos de venta</dt>
                        <dd>{{ l.gastos | money }}</dd>
                      </div>
                    }
                    <div class="suma">
                      <dt>{{ n(l.ganancia) < 0 ? 'Pérdida' : 'Ganancia' }}</dt>
                      <dd>{{ l.ganancia | money }}</dd>
                    </div>
                  </dl>

                  <!-- A dónde fue el queso del lote -->
                  <dl class="bloque">
                    <h4>A dónde fue</h4>
                    <div>
                      <dt>Vendido como queso</dt>
                      <dd>{{ l.kilos_vendidos | cantidad: 'kg' }}</dd>
                    </div>
                    @if (n(l.kilos_a_borona) > 0) {
                      <div>
                        <dt>Pasado a borona</dt>
                        <dd>{{ l.kilos_a_borona | cantidad: 'kg' }}</dd>
                      </div>
                    }
                    @if (n(l.kilos_merma) > 0) {
                      <div>
                        <dt>Perdido como merma</dt>
                        <dd>{{ l.kilos_merma | cantidad: 'kg' }}</dd>
                      </div>
                    }
                    @if (n(l.kilos_sin_vender) > 0) {
                      <div class="ojo">
                        <dt>Todavía en bodega</dt>
                        <dd>{{ l.kilos_sin_vender | cantidad: 'kg' }}</dd>
                      </div>
                    }
                    @if (n(l.borona_vendida) > 0) {
                      <div>
                        <dt>Borona vendida</dt>
                        <dd>{{ l.borona_vendida | cantidad: 'kg' }}</dd>
                      </div>
                    }
                    @if (n(l.borona_sin_vender) > 0) {
                      <div class="ojo">
                        <dt>Borona en bodega</dt>
                        <dd>{{ l.borona_sin_vender | cantidad: 'kg' }}</dd>
                      </div>
                    }
                  </dl>
                </div>

                @if (n(l.kilos_sin_vender) > 0 || n(l.borona_sin_vender) > 0) {
                  <p class="pendiente">
                    <mat-icon aria-hidden="true">inventory</mat-icon>
                    <span>
                      Quedan {{ l.costo_sin_vender | money }} invertidos en este lote
                      sin vender. Esa plata <strong>no</strong> se le resta a la
                      ganancia de arriba: el queso está ahí, no se ha perdido.
                    </span>
                  </p>
                }

                @if (n(l.kilos_vendidos) > 0) {
                  <p class="precios">
                    Comprado a <strong>{{ l.costo_kilo | money }}/kg</strong> y vendido a
                    <strong>{{ l.precio_venta_kilo | money }}/kg</strong> en promedio.
                  </p>
                }

                <!-- El detalle: quién aportó qué y a quién se le vendió. Va
                     plegado porque en un lote de seis productores son dos tablas
                     y la tarjeta dejaría de leerse de un vistazo. -->
                <button class="ver-detalle" type="button" (click)="alternar(l.fecha)">
                  <mat-icon>{{ abierto(l.fecha) ? 'expand_less' : 'expand_more' }}</mat-icon>
                  {{ abierto(l.fecha) ? 'Ocultar el detalle' : 'Ver quién aportó y a quién se le vendió' }}
                </button>

                @if (abierto(l.fecha)) {
                  <div class="detalle">
                    <div class="tabla-envoltura">
                      <h4>A quién le compró este lote</h4>
                      <table class="tabla">
                        <thead>
                          <tr>
                            <th>Productor</th>
                            <th class="num">Kilos</th>
                            <th class="num">Le pagó</th>
                            <th class="num">Costó</th>
                            <th class="num">Vendidos</th>
                            <th class="num">Margen/kg</th>
                            <th class="num">Dejó</th>
                            <th class="num">Falta pagarle</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (c of l.detalle_compras; track $index) {
                            <tr>
                              <td>
                                {{ c.productor }}
                                @if (n(c.borona_recibida) > 0) {
                                  <span class="nota">
                                    + {{ c.borona_recibida | cantidad: 'kg' }} de borona gratis
                                  </span>
                                }
                              </td>
                              <td class="num">{{ c.kilos | cantidad: 'kg' }}</td>
                              <td class="num">{{ c.precio_kilo | money }}</td>
                              <td class="num">{{ c.valor_total | money }}</td>
                              <td class="num">
                                {{ c.kilos_vendidos | cantidad: 'kg' }}
                                @if (n(c.kilos_sin_vender) > 0) {
                                  <span class="nota ojo">
                                    quedan {{ c.kilos_sin_vender | cantidad: 'kg' }}
                                  </span>
                                }
                              </td>
                              <td class="num">
                                {{ n(c.margen_kilo) === 0 ? '—' : (c.margen_kilo | money) }}
                              </td>
                              <td class="num" [class.perdida]="n(c.ganancia) < 0">
                                {{ c.ganancia | money }}
                              </td>
                              <td class="num" [class.ojo]="n(c.saldo) > 0">
                                {{ n(c.saldo) > 0 ? (c.saldo | money) : '—' }}
                              </td>
                            </tr>
                          }
                        </tbody>
                        <tfoot>
                          <!-- La fila de totales es la del lote, no una suma
                               aparte: las cifras del lote SON la suma de sus
                               compras, así que aquí no puede haber diferencia. -->
                          <tr>
                            <th>Total del lote</th>
                            <th class="num">{{ l.kilos_comprados | cantidad: 'kg' }}</th>
                            <th class="num">{{ l.costo_kilo | money }}</th>
                            <th class="num">{{ l.costo_total | money }}</th>
                            <th class="num">{{ l.kilos_vendidos | cantidad: 'kg' }}</th>
                            <th class="num">{{ n(l.margen_kilo) === 0 ? '—' : (l.margen_kilo | money) }}</th>
                            <th class="num" [class.perdida]="n(l.ganancia) < 0">
                              {{ l.ganancia | money }}
                            </th>
                            <th class="num">{{ n(l.por_pagar) > 0 ? (l.por_pagar | money) : '—' }}</th>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    <div class="tabla-envoltura">
                      <h4>A quién le vendió este lote</h4>
                      @if (l.detalle_ventas.length === 0) {
                        <p class="vacio-tabla">
                          Todavía no se ha vendido nada de este lote.
                        </p>
                      } @else {
                        <table class="tabla">
                          <thead>
                            <tr>
                              <th>Fecha</th>
                              <th>Cliente</th>
                              <th class="num">Kilos de este lote</th>
                              <th class="num">Precio</th>
                              <th class="num">Entró</th>
                              <th class="num">Costó</th>
                              <th class="num">Dejó</th>
                            </tr>
                          </thead>
                          <tbody>
                            @for (v of l.detalle_ventas; track $index) {
                              <tr>
                                <td>{{ isoADate(v.fecha) | date: 'dd/MM/yyyy' }}</td>
                                <td>
                                  {{ v.cliente }}
                                  @if (v.tipo === 'borona') {
                                    <span class="nota">borona</span>
                                  }
                                </td>
                                <td class="num">
                                  {{ v.kilos | cantidad: 'kg' }}
                                  @if (v.partida) {
                                    <!-- Sin esto la venta pareceria mas pequeña de
                                         lo que fue: el resto salio de otro lote. -->
                                    <span class="nota">
                                      de {{ v.kilos_venta | cantidad: 'kg' }} en total
                                    </span>
                                  }
                                </td>
                                <td class="num">{{ v.precio_kilo | money }}</td>
                                <td class="num">{{ v.ingreso | money }}</td>
                                <td class="num">{{ v.costo | money }}</td>
                                <td class="num" [class.perdida]="n(v.ganancia) < 0">
                                  {{ v.ganancia | money }}
                                </td>
                              </tr>
                            }
                          </tbody>
                          <tfoot>
                            <tr>
                              <th colspan="2">Suma de las ventas</th>
                              <th class="num">
                                <!-- Los kilos de las filas incluyen la borona, que
                                     NO sale de los kilos comprados. Si aquí fuera
                                     solo el queso, las filas no sumarían el pie. -->
                                {{ kilosVendidosTotales(l) | cantidad: 'kg' }}
                                @if (n(l.borona_vendida) > 0) {
                                  <span class="nota">
                                    incluye {{ l.borona_vendida | cantidad: 'kg' }} de borona
                                  </span>
                                }
                              </th>
                              <th></th>
                              <th class="num">{{ l.ingresos | money }}</th>
                              <th class="num">{{ costoDeLoVendido(l) | money }}</th>
                              <th class="num" [class.perdida]="gananciaDeVentas(l) < 0">
                                {{ gananciaDeVentas(l) | money }}
                              </th>
                            </tr>
                            @if (n(l.costo_merma) > 0) {
                              <!-- La merma NO sale en ninguna venta (no se vendió),
                                   pero sí se le resta a la ganancia del lote. Sin
                                   estos dos renglones las filas no sumarían el
                                   total y el usuario lo notaría con la
                                   calculadora. -->
                              <tr class="ajuste">
                                <th colspan="6">(−) Merma perdida de este lote</th>
                                <th class="num">-{{ l.costo_merma | money }}</th>
                              </tr>
                              <tr>
                                <th colspan="6">Ganancia del lote</th>
                                <th class="num" [class.perdida]="n(l.ganancia) < 0">
                                  {{ l.ganancia | money }}
                                </th>
                              </tr>
                            }
                          </tfoot>
                        </table>
                      }
                    </div>
                  </div>
                }
              </mat-card>
            }
          </div>

          <p class="pie">
            <strong>Ojo con comparar esta ganancia con la del Resumen:</strong> no son
            la misma cuenta y las dos están bien. Aquí se le resta lo que costó el
            queso <em>que se vendió</em>. El Resumen resta <em>todas</em> las compras
            del período, aunque el queso siga en bodega, así que un lote grande recién
            comprado le sale como pérdida hasta que se venda.
          </p>
        }
      }
    </div>
  `,
  styles: `
    .por-dia {
      margin-bottom: 18px;
      padding: 16px;

      h3 { margin: 0; font-size: 1.05rem; font-weight: 600; }
      p {
        margin: 4px 0 0;
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.86rem;
        line-height: 1.4;
        max-width: 52ch;
      }
    }

    .cabecera-dia {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .rango {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;

      .campo-rango { width: 280px; }
    }

    .atajos {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;

      .atajo {
        font-size: 0.82rem;
        // El puesto se marca con el color de la sección, que aquí es el del
        // negocio: se ve cuál está aplicado sin tener que mirar las fechas.
        &.puesto {
          background: color-mix(in srgb, var(--mat-sys-primary) 16%, transparent);
          font-weight: 600;
        }
      }
    }

    .total-dia {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 10px;
      margin: 14px 0 6px;

      strong { font-size: 1.6rem; font-weight: 600; }
      small { color: var(--mat-sys-on-surface-variant); }
      &.perdida strong { color: #c62828; }
    }
    :host-context(html.dark) .total-dia.perdida strong { color: #ef9a9a; }

    // La tabla se desplaza sola en pantallas angostas en vez de desbordar.
    .tabla-dia {
      overflow-x: auto;

      table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
      th, td { padding: 7px 10px; text-align: left; white-space: nowrap; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      thead th {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--mat-sys-on-surface-variant);
        border-bottom: 1px solid var(--mat-sys-outline-variant);
      }
      tbody tr:nth-child(even) { background: var(--mat-sys-surface-container-low); }
      tfoot th {
        border-top: 2px solid var(--mat-sys-outline-variant);
        font-weight: 600;
      }
      .perdida { color: #c62828; }
    }
    :host-context(html.dark) .tabla-dia .perdida { color: #ef9a9a; }

    .pista-punto {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-top: 8px !important;
      font-size: 0.8rem;
    }
    .punto {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--mat-sys-primary);
      flex-shrink: 0;
    }

    .error-dia, .vacio-dia {
      margin: 14px 0 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .error-dia { color: #c62828; }

    .aviso {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      margin-bottom: 12px;
      font-size: 0.9rem;
      line-height: 1.45;
    }
    .aviso mat-icon { flex: none; }
    .aviso.malo { color: var(--mat-sys-error); }
    .aviso.ojo {
      color: #a06000;
      border: 1px solid color-mix(in srgb, #a06000 25%, transparent);
    }
    .aviso button { margin-left: auto; flex: none; }

    .vacio {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 32px 24px;
      text-align: center;
    }
    .vacio mat-icon {
      font-size: 44px;
      width: 44px;
      height: 44px;
      color: var(--mat-sys-primary);
    }
    .vacio h3 { margin: 0; }
    .vacio p {
      margin: 0;
      max-width: 52ch;
      color: var(--mat-sys-on-surface-variant);
      line-height: 1.5;
    }

    .totales {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    .total {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 14px 16px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
    }
    .total.principal {
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, var(--mat-sys-surface));
      color: var(--mat-sys-primary);
    }
    .total.principal.perdida {
      background: color-mix(in srgb, var(--mat-sys-error) 10%, var(--mat-sys-surface));
      color: var(--mat-sys-error);
    }
    .total .rotulo {
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.85;
    }
    .total .cifra { font-size: 1.5rem; font-weight: 600; line-height: 1.15; }
    .total .cifra.chica { font-size: 1.15rem; }
    .total .detalle { font-size: 0.78rem; color: var(--mat-sys-on-surface-variant); }
    .total.principal .detalle { color: inherit; opacity: 0.8; }

    .supuesto, .pie {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 0 0 12px;
      font-size: 0.83rem;
      line-height: 1.5;
      color: var(--mat-sys-on-surface-variant);
    }
    .supuesto mat-icon {
      font-size: 19px;
      width: 19px;
      height: 19px;
      flex: none;
      margin-top: 1px;
    }
    .pie { margin: 14px 0 0; display: block; }

    .comparacion { padding: 16px; margin-bottom: 12px; }
    .comparacion h3 { margin: 0 0 12px; font-size: 0.95rem; font-weight: 600; }
    .barras { display: flex; flex-direction: column; gap: 8px; }
    .barra-fila {
      display: grid;
      grid-template-columns: minmax(64px, 12%) 1fr minmax(96px, auto);
      align-items: center;
      gap: 10px;
    }
    .barra-fila .nombre { font-size: 0.86rem; white-space: nowrap; }
    .barra-fila .pista {
      height: 14px;
      border-radius: 7px;
      background: var(--mat-sys-surface-container-highest);
      overflow: hidden;
    }
    .barra-fila .relleno {
      display: block;
      height: 100%;
      border-radius: 7px;
      background: var(--mat-sys-primary);
      /* Un lote sin ganancia deja una raya visible: un ancho de 0 se lee como
         "no hay dato" y no como "no dejó nada". */
      min-width: 3px;
    }
    .barra-fila .relleno.perdida { background: var(--mat-sys-error); }
    .barra-fila .valor {
      text-align: right;
      font-size: 0.86rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .barra-fila .valor.perdida { color: var(--mat-sys-error); }

    .lotes { display: flex; flex-direction: column; gap: 12px; }
    .lote { padding: 16px; }
    .lote.abierto { border-left: 3px solid var(--mat-sys-primary); }
    .cabeza {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .identidad h3 {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0;
      font-size: 1.05rem;
    }
    .identidad .quienes {
      margin: 3px 0 0;
      font-size: 0.82rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .chip {
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .chip.cerrado {
      background: color-mix(in srgb, #2e7d32 14%, transparent);
      color: #2e7d32;
    }
    .chip.abierto {
      background: color-mix(in srgb, var(--mat-sys-primary) 16%, transparent);
      color: var(--mat-sys-primary);
    }
    .ganancia {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 10px 14px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, var(--mat-sys-surface));
      color: var(--mat-sys-primary);
      text-align: right;
      flex: none;
    }
    .ganancia.perdida {
      background: color-mix(in srgb, var(--mat-sys-error) 9%, var(--mat-sys-surface));
      color: var(--mat-sys-error);
    }
    .ganancia .rotulo {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.85;
    }
    .ganancia .cifra { font-size: 1.5rem; font-weight: 600; line-height: 1.1; }
    .ganancia .detalle { font-size: 0.74rem; opacity: 0.85; }

    .cuerpo {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 18px;
      margin-top: 16px;
    }
    .bloque { margin: 0; font-size: 0.85rem; }
    .bloque h4 {
      margin: 0 0 6px;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--mat-sys-on-surface-variant);
    }
    .bloque > div {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 3px 0;
    }
    .bloque dt { color: var(--mat-sys-on-surface-variant); }
    .bloque dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .bloque .suma {
      margin-top: 3px;
      padding-top: 5px;
      border-top: 1px solid var(--mat-sys-outline-variant);
      font-weight: 600;
    }
    .bloque .suma dt { color: inherit; }
    .bloque > div.ojo dd { color: #a06000; font-weight: 600; }

    .pendiente {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 14px 0 0;
      padding: 9px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low);
      font-size: 0.82rem;
      line-height: 1.45;
      color: var(--mat-sys-on-surface-variant);
    }
    .pendiente mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex: none;
    }
    .precios {
      margin: 8px 0 0;
      font-size: 0.82rem;
      color: var(--mat-sys-on-surface-variant);
    }

    /* ------------------------------------------------ detalle desplegable */
    .ver-detalle {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 12px 0 0;
      padding: 6px 10px 6px 6px;
      border: 0;
      border-radius: 8px;
      background: none;
      color: var(--mat-sys-primary);
      font: inherit;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
    }
    .ver-detalle:hover { background: var(--mat-sys-surface-container-high); }
    .ver-detalle mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .detalle {
      display: flex;
      flex-direction: column;
      gap: 18px;
      margin-top: 6px;
      padding-top: 12px;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .detalle h4 {
      margin: 0 0 6px;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--mat-sys-on-surface-variant);
    }
    /* Las tablas se desplazan DENTRO de su caja: con ocho columnas de plata no
       caben en una tablet, y sin esto la página entera se movería de lado. */
    .tabla-envoltura { overflow-x: auto; }
    .tabla {
      width: 100%;
      min-width: 720px;
      border-collapse: collapse;
      font-size: 0.82rem;
    }
    .tabla th,
    .tabla td {
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      white-space: nowrap;
    }
    .tabla thead th {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--mat-sys-on-surface-variant);
      white-space: normal;
    }
    .tabla .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .tabla tfoot th {
      border-bottom: 0;
      border-top: 2px solid var(--mat-sys-outline-variant);
      font-weight: 700;
    }
    .tabla tfoot .ajuste th {
      border-top: 0;
      font-weight: 500;
      color: var(--mat-sys-on-surface-variant);
    }
    .tabla .perdida { color: var(--mat-sys-error); }
    .tabla .ojo { color: #a06000; font-weight: 600; }
    /* Las notas van debajo del dato, no al lado: al lado ensanchan la columna y
       empujan la tabla a desplazarse cuando no hace falta. */
    .tabla .nota {
      display: block;
      font-size: 0.72rem;
      font-weight: 400;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
    .tabla .nota.ojo { color: #a06000; }
    .vacio-tabla {
      margin: 0;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
    }

    @media (prefers-color-scheme: dark) {
      .aviso.ojo, .bloque > div.ojo dd { color: #ffb74d; }
      .chip.cerrado { background: color-mix(in srgb, #81c784 14%, transparent); color: #81c784; }
      .tabla .ojo, .tabla .nota.ojo { color: #ffb74d; }
    }

    @media (max-width: 980px) {
      .cuerpo { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 640px) {
      .cuerpo { grid-template-columns: 1fr; gap: 14px; }
      .cabeza { flex-direction: column; }
      .ganancia { align-self: stretch; text-align: left; }
      .barra-fila { grid-template-columns: 1fr minmax(96px, auto); }
      .barra-fila .pista { grid-column: 1 / -1; grid-row: 2; }
    }
  `,
})
export class ReventaLotesPage implements OnInit {
  private readonly servicio = inject(ReventaService);

  readonly panel = signal<LotesPanel | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  /** Para usar `n()` desde la plantilla. */
  readonly n = n;

  /**
   * Las barras van de la más VIEJA a la más nueva, al contrario que las tarjetas:
   * comparar en el tiempo se lee de izquierda a derecha, pero al buscar un lote lo
   * primero que se busca es el último que se compró.
   */
  readonly lotesPorFecha = computed(() =>
    [...(this.panel()?.lotes ?? [])].sort((a, b) => a.fecha.localeCompare(b.fecha)),
  );

  private readonly escala = computed(() => {
    const valores = (this.panel()?.lotes ?? []).map((l) => Math.abs(n(l.ganancia)));
    return Math.max(...valores, 0);
  });

  // ——— Cuánto gané en estos días ———
  // Arranca en el mes corrido, que es lo que la gente quiere ver al entrar.
  readonly desde = signal<Date | null>(primerDiaDelMes());
  readonly hasta = signal<Date | null>(new Date());
  /** Cuál de los atajos está puesto, para marcarlo. Vacío si eligió a mano. */
  readonly atajo = signal<string>('Este mes');

  readonly ATAJOS = ATAJOS;

  /**
   * Los días en que ENTRÓ queso, o sea las fechas de lote. Se marcan con un
   * punto en el calendario: así se ve de un vistazo qué días hay algo que mirar
   * en vez de ir probando fechas a ciegas.
   *
   * Sale del panel que ya está cargado, sin pedir nada más.
   */
  readonly diasConEntrada = computed(
    () => new Set((this.panel()?.lotes ?? []).map((l) => l.fecha)),
  );

  /**
   * Campo y no método: el calendario guarda la referencia, y un método suelto
   * perdería el `this` al llamarlo desde dentro del componente de Material.
   */
  readonly claseDia = (d: Date): string =>
    this.diasConEntrada().has(aIso(d)) ? 'dia-con-entrada' : '';

  usarAtajo(a: Atajo): void {
    const [d, h] = a.rango();
    this.desde.set(d);
    this.hasta.set(h);
    this.atajo.set(a.texto);
    this.cargarDias();
  }
  readonly porDia = signal<GananciaPorDia | null>(null);
  readonly cargandoDias = signal(false);
  readonly errorDias = signal<string | null>(null);

  ngOnInit(): void {
    this.cargar();
    this.cargarDias();
  }

  cargarDias(): void {
    const d = this.desde();
    const h = this.hasta();
    if (!d || !h) return;
    const desde = aIso(d);
    const hasta = aIso(h);
    if (hasta < desde) {
      this.errorDias.set('La fecha final no puede ser anterior a la inicial.');
      this.porDia.set(null);
      return;
    }
    this.cargandoDias.set(true);
    this.errorDias.set(null);
    this.servicio.gananciaPorDia(desde, hasta).subscribe({
      next: (g) => {
        this.porDia.set(g);
        this.cargandoDias.set(false);
      },
      error: (err) => {
        this.errorDias.set(detalleDeError(err, 'No fue posible calcular la ganancia'));
        this.cargandoDias.set(false);
      },
    });
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    // Sin rango: se muestran todos los lotes. El reparto FIFO necesita toda la
    // historia de todos modos, así que filtrar aquí solo esconderían lotes.
    this.servicio.lotes().subscribe({
      next: (p) => {
        this.panel.set(p);
        this.cargando.set(false);
      },
      error: (err) => {
        this.error.set(detalleDeError(err, 'No fue posible consultar los lotes'));
        this.cargando.set(false);
      },
    });
  }

  isoADate(iso: string | null): Date | null {
    return isoToDate(iso);
  }

  absoluto(valor: Monto): number {
    return Math.abs(n(valor));
  }

  /**
   * El costo de todo lo que se vendió del lote: el queso más la borona que venía
   * de queso. Van juntos en un solo renglón para que la cuenta de la tarjeta tenga
   * cuatro líneas y no seis; el detalle de la borona está en la columna de kilos.
   */
  costoDeLoVendido(l: LoteResumen): number {
    return n(l.costo_vendido) + n(l.costo_borona_vendida);
  }

  /**
   * La suma de lo que dejaron las VENTAS del lote. No es la ganancia del lote
   * cuando hubo merma: la merma no sale en ninguna venta porque no se vendió, pero
   * sí se le resta a la ganancia. Se calcula aparte para que el pie de la tabla
   * sume exactamente las filas de arriba, y la merma se muestre como un renglón
   * propio que lleva de una cifra a la otra.
   */
  gananciaDeVentas(l: LoteResumen): number {
    return n(l.ingresos) - this.costoDeLoVendido(l) - n(l.gastos);
  }

  /**
   * Kilos que salieron del lote por venta: queso MÁS borona. `kilos_vendidos` es
   * solo el queso, y las filas de la tabla incluyen las ventas de borona: con el
   * queso solo, las filas no sumarían el pie (33,4 kg de diferencia en un lote con
   * borona, que es justo lo que se nota al sumar la columna).
   */
  kilosVendidosTotales(l: LoteResumen): number {
    return n(l.kilos_vendidos) + n(l.borona_vendida);
  }

  /** Qué lotes tienen el detalle desplegado (por fecha, que es su identidad). */
  private readonly desplegados = signal<ReadonlySet<string>>(new Set());

  abierto(fecha: string): boolean {
    return this.desplegados().has(fecha);
  }

  alternar(fecha: string): void {
    const copia = new Set(this.desplegados());
    if (!copia.delete(fecha)) copia.add(fecha);
    this.desplegados.set(copia);
  }

  anchoBarra(l: LoteResumen): number {
    const escala = this.escala();
    if (escala <= 0) return 0;
    return (Math.abs(n(l.ganancia)) / escala) * 100;
  }
}
