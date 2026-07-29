import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Monto } from '../../core/models';
import { isoToDate } from '../../shared/date-utils';
import { detalleDeError } from '../../shared/errores-ui';
import { PageHeader } from '../../shared/page-header';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import {
  LoteProduccion,
  LotesProduccionPanel,
  ProduccionService,
} from './produccion.service';

function n(valor: Monto | null | undefined): number {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Utilidad por lote de producción: qué dejó el queso que se hizo cada día.
 *
 * Resuelve el problema que el usuario detectó en Contabilidad: el estado de
 * resultados del mes resta TODA la leche que entró contra TODO el queso que se
 * vendió, pero la leche del 1 de julio se convierte en queso que puede venderse 60
 * días después. Las dos cifras no son del mismo queso, así que la utilidad sale
 * negativa sin que el negocio esté perdiendo: la plata está en la bodega.
 *
 * Aquí cada producción lleva su propia cuenta: lo que costó la leche que usó (la
 * leche real, con el precio de cada proveedor), lo que se vendió de ella, y lo que
 * todavía está en bodega —que NO se resta, porque el queso está ahí—.
 */
@Component({
  selector: 'app-produccion-lotes',
  imports: [
    DatePipe, MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule,
    MatTooltipModule, PageHeader, MoneyPipe, CantidadPipe,
  ],
  template: `
    <div class="page">
      <app-page-header
        titulo="Utilidad por lote de producción"
        subtitulo="Qué dejó el queso que se hizo cada día: la leche que usó, lo que se vendió y lo que sigue en bodega"
      />

      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" />
      }

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
            <mat-icon aria-hidden="true">factory</mat-icon>
            <h3>Todavía no hay producciones registradas</h3>
            <p>
              En cuanto registre una producción, aquí aparece ese lote con la leche
              que usó, lo que costó y lo que dejó cuando se venda.
            </p>
          </mat-card>
        } @else {
          <div class="totales">
            <div class="total principal" [class.perdida]="n(p.total_utilidad) < 0">
              <span class="rotulo">
                {{ n(p.total_utilidad) < 0 ? 'Pérdida de lo vendido' : 'Utilidad de lo vendido' }}
              </span>
              <span class="cifra">{{ absoluto(p.total_utilidad) | money }}</span>
              <span class="detalle">
                De {{ p.lotes.length }} {{ p.lotes.length === 1 ? 'lote' : 'lotes' }},
                contando solo el queso que ya salió
              </span>
            </div>
            <div class="total">
              <span class="rotulo">Costo de la leche</span>
              <span class="cifra chica">{{ p.total_costo | money }}</span>
              <span class="detalle">
                {{ p.total_litros | cantidad: 'L' }} → {{ p.total_kilos | cantidad: 'kg' }}
              </span>
            </div>
            <div class="total">
              <span class="rotulo">Queso en bodega</span>
              <span class="cifra chica">{{ p.total_costo_en_bodega | money }}</span>
              <span class="detalle">
                {{ p.total_kilos_en_bodega | cantidad: 'kg' }} · plata invertida, sin vender
              </span>
            </div>
            @if (n(p.litros_sin_usar) > 0) {
              <div class="total">
                <span class="rotulo">Leche sin usar</span>
                <span class="cifra chica">{{ p.costo_litros_sin_usar | money }}</span>
                <span class="detalle">
                  {{ p.litros_sin_usar | cantidad: 'L' }} · todavía sin hacer queso
                </span>
              </div>
            }
          </div>

          <!-- Lo que explica por qué esta cifra no es la de Contabilidad -->
          <mat-card class="explicacion">
            <mat-icon aria-hidden="true">lightbulb</mat-icon>
            <div>
              <strong>Por qué esta utilidad no es la del estado de resultados.</strong>
              Allá se resta toda la leche del mes contra todo el queso vendido en el
              mes, pero el queso del 1 se puede vender 60 días después: no son el
              mismo queso. Aquí cada lote lleva su cuenta, y
              <strong>el queso que sigue en bodega no se resta</strong> — está ahí, no
              se ha perdido. Por eso allá puede salir pérdida y aquí ganancia, y la de
              aquí es la real.
            </div>
          </mat-card>

          <p class="supuesto">
            <mat-icon aria-hidden="true">info</mat-icon>
            <span>
              Como ni la producción ni las ventas dicen de qué tanda salió el queso, el
              sistema reparte <strong>de lo más viejo primero</strong>: los litros que
              usó una producción salen de la leche más vieja, y los kilos despachados
              del lote más viejo de ese mismo tipo de queso. Es como se maneja un
              producto perecedero.
            </span>
          </p>

          @if (n(p.kilos_sin_lote) > 0 || n(p.litros_sin_recepcion) > 0) {
            <mat-card class="aviso ojo">
              <mat-icon aria-hidden="true">report_problem</mat-icon>
              <span>
                @if (n(p.litros_sin_recepcion) > 0) {
                  Hay <strong>{{ p.litros_sin_recepcion | cantidad: 'L' }}</strong> usados
                  en producciones sin leche registrada que los respalde, así que esos
                  lotes salen con menos costo del real.
                }
                @if (n(p.kilos_sin_lote) > 0) {
                  Hay <strong>{{ p.kilos_sin_lote | cantidad: 'kg' }}</strong> de queso
                  vendidos ({{ p.ingreso_sin_lote | money }}) que no salieron de ninguna
                  producción registrada; esa plata <strong>no está sumada</strong> arriba
                  porque no se sabe qué costó.
                }
                Suele pasar cuando se empezó a usar el sistema a mitad de camino.
              </span>
            </mat-card>
          }

          @if (p.lotes.length > 1) {
            <mat-card class="comparacion">
              <h3>Cuánto dejó cada lote</h3>
              <div class="barras">
                @for (l of lotesPorFecha(); track $index) {
                  <div class="barra-fila">
                    <span class="nombre">{{ isoADate(l.fecha) | date: 'd MMM' }}</span>
                    <span class="pista">
                      <span class="relleno" [class.perdida]="n(l.utilidad) < 0"
                            [style.width.%]="anchoBarra(l)"></span>
                    </span>
                    <span class="valor" [class.perdida]="n(l.utilidad) < 0">
                      {{ l.utilidad | money }}
                    </span>
                  </div>
                }
              </div>
            </mat-card>
          }

          <div class="lotes">
            @for (l of p.lotes; track $index) {
              <mat-card class="lote" [class.abierto]="!l.vendido_completo">
                <div class="cabeza">
                  <div class="identidad">
                    <h3>
                      {{ l.tipo_queso }} del {{ isoADate(l.fecha) | date: 'd \\'de\\' MMMM \\'de\\' y' }}
                      @if (l.vendido_completo) {
                        <span class="chip cerrado">Vendido completo</span>
                      } @else {
                        <span class="chip abierto">Queda queso</span>
                      }
                    </h3>
                    <p class="quienes">
                      {{ l.litros_usados | cantidad: 'L' }} de leche →
                      {{ l.kilos_producidos | cantidad: 'kg' }} de queso
                      ({{ rendimientoTexto(l) }})
                      @if (n(l.merma) > 0) {
                        · merma {{ l.merma | cantidad: 'kg' }}
                      }
                    </p>
                  </div>
                  <div class="ganancia" [class.perdida]="n(l.utilidad) < 0">
                    <span class="rotulo">
                      {{ n(l.utilidad) < 0 ? 'Pérdida de lo vendido' : 'Utilidad de lo vendido' }}
                    </span>
                    <span class="cifra">{{ absoluto(l.utilidad) | money }}</span>
                    @if (n(l.kilos_vendidos) > 0) {
                      <span class="detalle">
                        {{ utilidadPorKilo(l) | money }} por kilo vendido
                      </span>
                    }
                  </div>
                </div>

                <div class="cuerpo">
                  <dl class="bloque">
                    <h4>Lo que costó</h4>
                    <div>
                      <dt>Leche</dt>
                      <dd>{{ l.costo_leche | money }}</dd>
                    </div>
                    <div>
                      <dt>(+) Transporte</dt>
                      <dd>{{ l.costo_transporte | money }}</dd>
                    </div>
                    <div class="suma">
                      <dt>Costo del lote</dt>
                      <dd>{{ l.costo_total | money }}</dd>
                    </div>
                    <div>
                      <dt>Por kilo producido</dt>
                      <dd>{{ l.costo_kilo | money }}</dd>
                    </div>
                    @if (n(l.litros_sin_recepcion) > 0) {
                      <div class="ojo">
                        <dt>Litros sin respaldo</dt>
                        <dd>{{ l.litros_sin_recepcion | cantidad: 'L' }}</dd>
                      </div>
                    }
                  </dl>

                  <!-- La cuenta: los renglones SUMAN la cifra grande -->
                  <dl class="bloque">
                    <h4>La cuenta</h4>
                    <div>
                      <dt>Vendido de este lote</dt>
                      <dd>{{ l.ingresos | money }}</dd>
                    </div>
                    <div>
                      <dt>(−) Costo de lo vendido</dt>
                      <dd>{{ l.costo_vendido | money }}</dd>
                    </div>
                    <div class="suma">
                      <dt>{{ n(l.utilidad) < 0 ? 'Pérdida' : 'Utilidad' }}</dt>
                      <dd>{{ l.utilidad | money }}</dd>
                    </div>
                    @if (n(l.kilos_vendidos) > 0) {
                      <div>
                        <dt>Vendido a</dt>
                        <dd>{{ l.precio_venta_kilo | money }}/kg</dd>
                      </div>
                    }
                  </dl>

                  <dl class="bloque">
                    <h4>Dónde está el queso</h4>
                    <div>
                      <dt>Vendido</dt>
                      <dd>{{ l.kilos_vendidos | cantidad: 'kg' }}</dd>
                    </div>
                    @if (n(l.kilos_en_bodega) > 0) {
                      <div class="ojo">
                        <dt>En bodega</dt>
                        <dd>{{ l.kilos_en_bodega | cantidad: 'kg' }}</dd>
                      </div>
                      <div>
                        <dt>Invertido ahí</dt>
                        <dd>{{ l.costo_en_bodega | money }}</dd>
                      </div>
                    }
                  </dl>
                </div>

                @if (n(l.kilos_en_bodega) > 0) {
                  <p class="pendiente">
                    <mat-icon aria-hidden="true">inventory</mat-icon>
                    <span>
                      Quedan {{ l.costo_en_bodega | money }} invertidos en
                      {{ l.kilos_en_bodega | cantidad: 'kg' }} de este lote sin vender.
                      Esa plata <strong>no</strong> se le resta a la utilidad: el queso
                      está ahí.
                    </span>
                  </p>
                }

                <button class="ver-detalle" type="button" (click)="alternar(l)">
                  <mat-icon>{{ abierto(l) ? 'expand_less' : 'expand_more' }}</mat-icon>
                  {{ abierto(l) ? 'Ocultar el detalle' : 'Ver de qué leche salió y a quién se le vendió' }}
                </button>

                @if (abierto(l)) {
                  <div class="detalle">
                    <div class="tabla-envoltura">
                      <h4>De qué leche salió este lote</h4>
                      @if (l.detalle_leche.length === 0) {
                        <p class="vacio-tabla">
                          No hay leche registrada que respalde esta producción.
                        </p>
                      } @else {
                        <table class="tabla">
                          <thead>
                            <tr>
                              <th>Recibida</th>
                              <th>Proveedor</th>
                              <th class="num">Litros</th>
                              <th class="num">Leche</th>
                              <th class="num">Transporte</th>
                              <th class="num">Costó</th>
                            </tr>
                          </thead>
                          <tbody>
                            @for (x of l.detalle_leche; track $index) {
                              <tr>
                                <td>{{ isoADate(x.fecha_recepcion) | date: 'dd/MM/yyyy' }}</td>
                                <td>{{ x.proveedor }}</td>
                                <td class="num">{{ x.litros | cantidad: 'L' }}</td>
                                <td class="num">{{ x.costo_leche | money }}</td>
                                <td class="num">{{ x.costo_transporte | money }}</td>
                                <td class="num">{{ x.costo | money }}</td>
                              </tr>
                            }
                          </tbody>
                          <tfoot>
                            <tr>
                              <th colspan="2">Total del lote</th>
                              <th class="num">{{ litrosConRespaldo(l) | cantidad: 'L' }}</th>
                              <th class="num">{{ l.costo_leche | money }}</th>
                              <th class="num">{{ l.costo_transporte | money }}</th>
                              <th class="num">{{ l.costo_total | money }}</th>
                            </tr>
                          </tfoot>
                        </table>
                      }
                    </div>

                    <div class="tabla-envoltura">
                      <h4>A quién se le vendió</h4>
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
                                <td>{{ v.cliente }}</td>
                                <td class="num">
                                  {{ v.kilos | cantidad: 'kg' }}
                                  @if (v.partida) {
                                    <!-- Sin esto el despacho parecería más pequeño de
                                         lo que fue: el resto salió de otro lote. -->
                                    <span class="nota">
                                      de {{ v.kilos_venta | cantidad: 'kg' }} en total
                                    </span>
                                  }
                                </td>
                                <td class="num">{{ v.precio_kilo | money }}</td>
                                <td class="num">{{ v.ingreso | money }}</td>
                                <td class="num">{{ v.costo | money }}</td>
                                <td class="num" [class.perdida]="n(v.utilidad) < 0">
                                  {{ v.utilidad | money }}
                                </td>
                              </tr>
                            }
                          </tbody>
                          <tfoot>
                            <tr>
                              <th colspan="2">Total del lote</th>
                              <th class="num">{{ l.kilos_vendidos | cantidad: 'kg' }}</th>
                              <th></th>
                              <th class="num">{{ l.ingresos | money }}</th>
                              <th class="num">{{ l.costo_vendido | money }}</th>
                              <th class="num" [class.perdida]="n(l.utilidad) < 0">
                                {{ l.utilidad | money }}
                              </th>
                            </tr>
                          </tfoot>
                        </table>
                      }
                    </div>
                  </div>
                }
              </mat-card>
            }
          </div>
        }
      }
    </div>
  `,
  styles: `
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

    .explicacion {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 16px;
      margin-bottom: 12px;
      background: color-mix(in srgb, var(--mat-sys-primary) 8%, var(--mat-sys-surface));
      font-size: 0.86rem;
      line-height: 1.5;
    }
    .explicacion mat-icon {
      flex: none;
      color: var(--mat-sys-primary);
    }

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

    .supuesto {
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
      /* Un lote sin utilidad deja una raya visible: un ancho de 0 se lee como
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
    .ver-detalle mat-icon { font-size: 20px; width: 20px; height: 20px; }
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
    /* Las tablas se desplazan DENTRO de su caja: con siete columnas de plata no
       caben en una tablet, y sin esto la página entera se movería de lado. */
    .tabla-envoltura { overflow-x: auto; }
    .tabla {
      width: 100%;
      min-width: 660px;
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
    .tabla .num { text-align: right; font-variant-numeric: tabular-nums; }
    .tabla tfoot th {
      border-bottom: 0;
      border-top: 2px solid var(--mat-sys-outline-variant);
      font-weight: 700;
    }
    .tabla .perdida { color: var(--mat-sys-error); }
    .tabla .nota {
      display: block;
      font-size: 0.72rem;
      font-weight: 400;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
    .vacio-tabla {
      margin: 0;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
    }

    @media (prefers-color-scheme: dark) {
      .aviso.ojo, .bloque > div.ojo dd { color: #ffb74d; }
      .chip.cerrado { background: color-mix(in srgb, #81c784 14%, transparent); color: #81c784; }
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
export class ProduccionLotesPage implements OnInit {
  private readonly servicio = inject(ProduccionService);

  readonly panel = signal<LotesProduccionPanel | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  readonly n = n;

  /**
   * Las barras van de la más VIEJA a la más nueva, al contrario que las tarjetas:
   * comparar en el tiempo se lee de izquierda a derecha, pero al buscar un lote lo
   * primero que se busca es el último que se hizo.
   */
  readonly lotesPorFecha = computed(() =>
    [...(this.panel()?.lotes ?? [])].sort((a, b) => a.fecha.localeCompare(b.fecha)),
  );

  private readonly escala = computed(() => {
    const valores = (this.panel()?.lotes ?? []).map((l) => Math.abs(n(l.utilidad)));
    return Math.max(...valores, 0);
  });

  /**
   * Qué lotes tienen el detalle desplegado. La clave es fecha + tipo de queso: en
   * un mismo día se pueden hacer dos tipos distintos, y con solo la fecha se
   * abrirían los dos a la vez.
   */
  private readonly desplegados = signal<ReadonlySet<string>>(new Set());

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    // Sin rango: el reparto necesita toda la historia igual, así que filtrar aquí
    // solo esconderá lotes.
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

  /** Utilidad por kilo VENDIDO (no por kilo producido: lo de bodega no dejó nada). */
  utilidadPorKilo(l: LoteProduccion): number {
    const kilos = n(l.kilos_vendidos);
    return kilos > 0 ? n(l.utilidad) / kilos : 0;
  }

  /**
   * El rendimiento en la unidad que se usa en la planta: litros de leche por kilo
   * de queso. El backend lo manda como kg/litro (0,1) y en la planta se habla de
   * "diez litros por kilo", que es el mismo dato al revés y el que se reconoce.
   */
  rendimientoTexto(l: LoteProduccion): string {
    const kilos = n(l.kilos_producidos);
    const litros = n(l.litros_usados);
    if (kilos <= 0 || litros <= 0) return 'sin rendimiento';
    const porKilo = litros / kilos;
    return `${porKilo.toLocaleString('es-CO', { maximumFractionDigits: 2 })} litros por kilo`;
  }

  /**
   * Litros que sí tienen leche registrada detrás. No es `litros_usados` cuando
   * falta cargar recepciones: si el pie mostrara los usados, las filas no lo
   * sumarían.
   */
  litrosConRespaldo(l: LoteProduccion): number {
    return l.detalle_leche.reduce((s, x) => s + n(x.litros), 0);
  }

  anchoBarra(l: LoteProduccion): number {
    const escala = this.escala();
    if (escala <= 0) return 0;
    return (Math.abs(n(l.utilidad)) / escala) * 100;
  }

  private clave(l: LoteProduccion): string {
    return `${l.fecha}|${l.tipo_queso}`;
  }

  abierto(l: LoteProduccion): boolean {
    return this.desplegados().has(this.clave(l));
  }

  alternar(l: LoteProduccion): void {
    const copia = new Set(this.desplegados());
    if (!copia.delete(this.clave(l))) copia.add(this.clave(l));
    this.desplegados.set(copia);
  }
}
