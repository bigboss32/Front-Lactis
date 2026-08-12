import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Monto } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { isoToDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { PageHeader } from '../../shared/page-header';
import { BarrasPipe, CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { ReventaFiltroService } from './reventa-filtro.service';
import { ReventaService, TemporadaResumen, TemporadasPanel } from './reventa.service';
import { TemporadaFormDialog } from './temporada-form.dialog';

/** Número a partir de un Monto, que llega como texto cuando es Decimal. */
function n(valor: Monto | null | undefined): number {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Las temporadas: cada ciclo de compra y reventa con lo que dejó.
 *
 * Es la respuesta a "cuánto gané en una temporada" sin tener que acordarse de las
 * fechas y teclearlas en el filtro. Cada tarjeta lleva un botón que lleva al
 * Resumen ya filtrado a esas fechas, donde está el desglose completo.
 *
 * Ninguna cifra de esta pantalla está guardada en la base: todas salen del mismo
 * motor del Resumen aplicado a las fechas de la temporada. Por eso la ganancia de
 * una temporada y la del Resumen filtrado igual son la misma, y por eso se mueve
 * si mañana se le corrige el precio a una compra vieja.
 */
@Component({
  selector: 'app-reventa-temporadas',
  imports: [
    DatePipe, MatCardModule, MatButtonModule, MatIconModule, MatMenuModule,
    MatProgressBarModule, MatTooltipModule, PageHeader, MoneyPipe, CantidadPipe,
    BarrasPipe,
    HasPermissionDirective,
  ],
  template: `
    <div class="page">
      <app-page-header
        titulo="Temporadas"
        subtitulo="Cada ciclo de compra y reventa con lo que dejó. Las cifras se calculan de las compras y ventas de esas fechas."
      />

      <div class="page-toolbar">
        <span class="spacer"></span>
        <button mat-flat-button *hasPermission="'reventa:crear'" (click)="nueva()">
          <mat-icon>add</mat-icon> Nueva temporada
        </button>
      </div>

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
        @if (p.temporadas.length === 0) {
          <!-- Primera vez: hay que explicar qué es una temporada, porque el
               concepto lo pone el usuario, no el sistema. -->
          <mat-card class="vacio">
            <mat-icon aria-hidden="true">event_repeat</mat-icon>
            <h3>Todavía no hay temporadas</h3>
            <p>
              Una temporada es un ciclo suyo de compra y reventa: le pone un nombre
              (“Semana Santa”, “Diciembre”, “Marzo”) y las fechas en que empezó y
              terminó. El sistema calcula solo cuánto compró, cuánto vendió y cuánto
              ganó en esas fechas.
            </p>
            <p class="fino">
              Puede registrar temporadas <strong>que ya pasaron</strong>: las cifras
              salen de las compras y ventas que ya tiene cargadas, así que aparecen
              de inmediato.
            </p>
            <button mat-flat-button *hasPermission="'reventa:crear'" (click)="nueva()">
              <mat-icon>add</mat-icon> Crear la primera
            </button>
          </mat-card>
        } @else {
          <!-- Resumen de todas: los totales son la suma de las tarjetas de abajo -->
          <div class="totales">
            <div class="total principal" [class.perdida]="n(p.total_ganancia) < 0">
              <span class="rotulo">{{ n(p.total_ganancia) < 0 ? 'Pérdida en total' : 'Ganancia en total' }}</span>
              <span class="cifra">{{ absoluto(p.total_ganancia) | money }}</span>
              <span class="detalle">
                Suma de las {{ p.temporadas.length }}
                {{ p.temporadas.length === 1 ? 'temporada' : 'temporadas' }} de abajo
              </span>
            </div>
            <div class="total">
              <span class="rotulo">Comprado</span>
              <span class="cifra chica">{{ p.total_compras | money }}</span>
              <!-- La plata de arriba es de TODO lo comprado (kilos + barras) y la
                   cantidad de abajo es solo de kilos. Cuando hay mozzarella eso se
                   lee mal —invita a dividir y sacar un precio por kilo que no
                   existe—, así que la cantidad de barras va enseguida, con su
                   unidad y separada por un punto medio, nunca sumada. -->
              <span class="detalle">
                {{ p.total_kilos_comprados | cantidad: 'kg' }}
                @if (barrasCompradas() > 0) {
                  · {{ barrasCompradas() | barras }}
                }
              </span>
            </div>
            <div class="total">
              <span class="rotulo">Vendido</span>
              <span class="cifra chica">{{ p.total_ventas | money }}</span>
              <!-- QUÉ HAY ADENTRO DE ESTA PLATA: todo lo vendido, de todos los
                   productos y de las dos clases de unidad, porque los pesos son
                   pesos. El texto ya no los enumera: la lista de productos es del
                   dueño y puede crecer, y una enumeración escrita aquí dejaría por
                   fuera —callándolo— lo que él agregue. El desglose producto por
                   producto está en el Resumen. -->
              <span class="detalle">todos sus productos</span>
            </div>
            @if (p.mejor && p.temporadas.length > 1) {
              <div class="total">
                <span class="rotulo">La mejor</span>
                <span class="cifra chica texto">{{ p.mejor }}</span>
                <span class="detalle">la que más dejó</span>
              </div>
            }
          </div>

          @if (p.dias_sin_temporada > 0) {
            <!-- Honestidad con el desglose: si hay movimientos por fuera, la suma
                 de las temporadas NO es todo el negocio y hay que decirlo. -->
            <mat-card class="aviso ojo">
              <mat-icon aria-hidden="true">report_problem</mat-icon>
              <span>
                Hay <strong>{{ p.dias_sin_temporada }}</strong>
                {{ p.dias_sin_temporada === 1 ? 'día con movimientos' : 'días con movimientos' }}
                que no caen dentro de ninguna temporada, así que la ganancia de arriba
                no es todo el negocio. Cree una temporada que cubra esas fechas para
                que la cuenta quede completa.
              </span>
            </mat-card>
          }

          @if (p.temporadas.length > 1) {
            <!-- Comparación de un vistazo. Las barras se dibujan con CSS y no con
                 una librería de gráficos: es una sola cifra por temporada y así no
                 se traga el gesto de scroll en la tablet. -->
            <mat-card class="comparacion">
              <h3>Cuánto dejó cada una</h3>
              <div class="barras">
                @for (t of panelOrdenadoPorFecha(); track t.id) {
                  <button class="barra-fila" type="button" (click)="verEnResumen(t)"
                          [matTooltip]="'Ver el detalle de ' + t.nombre + ' en el Resumen'">
                    <span class="nombre">{{ t.nombre }}</span>
                    <span class="pista">
                      <span class="relleno" [class.perdida]="n(t.ganancia) < 0"
                            [style.width.%]="anchoBarra(t)"></span>
                    </span>
                    <span class="valor" [class.perdida]="n(t.ganancia) < 0">
                      {{ t.ganancia | money }}
                    </span>
                  </button>
                }
              </div>
            </mat-card>
          }

          <!-- Una tarjeta por temporada, de la más reciente a la más vieja -->
          <div class="temporadas">
            @for (t of p.temporadas; track t.id) {
              <mat-card class="temporada" [class.abierta]="t.abierta">
                <div class="cabeza">
                  <div class="identidad">
                    <h3>
                      {{ t.nombre }}
                      @if (t.abierta) {
                        <span class="chip corriendo">Abierta</span>
                      } @else if (t.cerrada_de_verdad) {
                        <span class="chip cerrada">Cerrada y cuadrada</span>
                      } @else {
                        <span class="chip pendiente">Cerrada, falta cuadrar</span>
                      }
                    </h3>
                    <p class="fechas">
                      {{ isoADate(t.fecha_inicio) | date: 'd MMM y' }} —
                      @if (t.abierta) {
                        hoy
                      } @else {
                        {{ isoADate(t.fecha_fin) | date: 'd MMM y' }}
                      }
                      · {{ t.dias }} {{ t.dias === 1 ? 'día' : 'días' }}
                    </p>
                  </div>
                  <div class="acciones">
                    <button mat-stroked-button (click)="verEnResumen(t)">
                      <mat-icon>insights</mat-icon> Ver el detalle
                    </button>
                    <button mat-icon-button [matMenuTriggerFor]="menu" aria-label="Más acciones">
                      <mat-icon>more_vert</mat-icon>
                    </button>
                    <mat-menu #menu>
                      @if (t.abierta) {
                        <button mat-menu-item *hasPermission="'reventa:editar'" (click)="cerrar(t)">
                          <mat-icon>event_available</mat-icon> Cerrar la temporada
                        </button>
                      } @else {
                        <button mat-menu-item *hasPermission="'reventa:editar'" (click)="reabrir(t)">
                          <mat-icon>lock_open</mat-icon> Reabrir
                        </button>
                      }
                      <button mat-menu-item *hasPermission="'reventa:editar'" (click)="editar(t)">
                        <mat-icon>edit</mat-icon> Editar nombre y fechas
                      </button>
                      <button mat-menu-item *hasPermission="'reventa:eliminar'" (click)="eliminar(t)">
                        <mat-icon>delete</mat-icon> Eliminar
                      </button>
                    </mat-menu>
                  </div>
                </div>

                <div class="cuerpo">
                  <div class="ganancia" [class.perdida]="n(t.ganancia) < 0">
                    <span class="rotulo">{{ n(t.ganancia) < 0 ? 'Pérdida' : 'Ganancia' }}</span>
                    <span class="cifra">{{ absoluto(t.ganancia) | money }}</span>
                    <span class="detalle">
                      {{ t.margen_por_kilo | money }} por kilo vendido
                    </span>
                  </div>

                  <!-- El desglose tiene que SUMAR la ganancia: vendido - comprado
                       - gastos. Los operadores van escritos porque con tres
                       renglones ya no se adivina cuál se resta. -->
                  <dl class="desglose">
                    <div>
                      <dt>Vendido</dt>
                      <dd>{{ t.total_ventas | money }}</dd>
                    </div>
                    <div>
                      <dt>(−) Comprado</dt>
                      <dd>{{ t.total_compras | money }}</dd>
                    </div>
                    <div>
                      <dt>(−) Gastos de venta</dt>
                      <dd>{{ t.total_gastos | money }}</dd>
                    </div>
                    <div class="suma">
                      <dt>{{ n(t.ganancia) < 0 ? 'Pérdida' : 'Ganancia' }}</dt>
                      <dd>{{ t.ganancia | money }}</dd>
                    </div>
                  </dl>

                  <dl class="desglose kilos">
                    <div>
                      <dt>Comprado</dt>
                      <dd>{{ t.kilos_comprados | cantidad: 'kg' }}</dd>
                    </div>
                    <div>
                      <!-- "Vendido" y ya no "Vendido como queso": suma lo vendido de
                           todos los productos que se pesan y no son subproducto. -->
                      <dt>Vendido</dt>
                      <dd>{{ t.kilos_vendidos | cantidad: 'kg' }}</dd>
                    </div>
                    @if (n(t.kilos_borona_vendidos) > 0) {
                      <!-- Tiene que salir: su plata SÍ está sumada en "Vendido", y
                           sin este renglón la cuenta no se puede rastrear (los kilos
                           de queso no explican el total vendido). No sale de los
                           kilos comprados: la borona llega con el lote sin pagarse,
                           o viene de queso que se pasó a borona. -->
                      <div>
                        <dt>Borona vendida</dt>
                        <dd>{{ t.kilos_borona_vendidos | cantidad: 'kg' }}</dd>
                      </div>
                    }
                    @if (n(t.kilos_a_borona) > 0) {
                      <div>
                        <dt>Pasado a borona</dt>
                        <dd>{{ t.kilos_a_borona | cantidad: 'kg' }}</dd>
                      </div>
                    }
                    @if (n(t.kilos_merma) > 0) {
                      <div>
                        <dt>Merma</dt>
                        <dd>{{ t.kilos_merma | cantidad: 'kg' }}</dd>
                      </div>
                    }
                    @if (n(t.kilos_pendientes) !== 0) {
                      <div [class.ojo]="n(t.kilos_pendientes) > 0">
                        <dt>{{ n(t.kilos_pendientes) > 0 ? 'Sin vender' : 'De temporadas anteriores' }}</dt>
                        <dd>{{ absoluto(t.kilos_pendientes) | cantidad: 'kg' }}</dd>
                      </div>
                    }
                    <!-- LA MOZZARELLA VA EN SUS PROPIOS RENGLONES, en barras: en la
                         misma lista pero sin sumarse con los kilos de arriba. Cada
                         renglón dice su unidad y no hay un total que los junte. Solo
                         aparecen si la temporada tuvo mozzarella, así que las de puro
                         queso se ven exactamente como antes. -->
                    @if (n(t.barras_compradas) > 0 || n(t.barras_vendidas) > 0) {
                      <div>
                        <dt>Mozzarella comprada</dt>
                        <dd>{{ t.barras_compradas | barras }}</dd>
                      </div>
                      <div>
                        <dt>Mozzarella vendida</dt>
                        <dd>{{ t.barras_vendidas | barras }}</dd>
                      </div>
                      @if (n(t.barras_pendientes) !== 0) {
                        <div [class.ojo]="n(t.barras_pendientes) > 0">
                          <dt>
                            {{
                              n(t.barras_pendientes) > 0
                                ? 'Mozzarella sin vender'
                                : 'Barras de temporadas anteriores'
                            }}
                          </dt>
                          <dd>{{ absoluto(t.barras_pendientes) | barras }}</dd>
                        </div>
                      }
                    }
                  </dl>
                </div>

                @if (!t.cerrada_de_verdad) {
                  <p class="falta">
                    <mat-icon aria-hidden="true">pending_actions</mat-icon>
                    <span>
                      Para cerrarla del todo falta:
                      <!-- Las barras van en su propio pedazo del mensaje: sin esto la
                           temporada decía "cerrada de verdad" (o no decía qué falta)
                           con mozzarella todavía en la bodega. -->
                      @if (n(t.kilos_pendientes) > 0) {
                        <strong>vender o pasar a merma {{ t.kilos_pendientes | cantidad: 'kg' }}</strong>
                      }
                      @if (n(t.barras_pendientes) > 0) {
                        @if (n(t.kilos_pendientes) > 0) { · }
                        <strong>vender {{ t.barras_pendientes | barras }} de mozzarella</strong>
                      }
                      @if (n(t.por_cobrar) > 0) {
                        @if (n(t.kilos_pendientes) > 0 || n(t.barras_pendientes) > 0) { · }
                        <strong>cobrar {{ t.por_cobrar | money }}</strong>
                      }
                      @if (n(t.por_pagar) > 0) {
                        @if (n(t.kilos_pendientes) > 0 || n(t.barras_pendientes) > 0 || n(t.por_cobrar) > 0) { · }
                        <strong>pagar {{ t.por_pagar | money }}</strong>
                      }
                    </span>
                  </p>
                }

                @if (t.notas) {
                  <p class="notas">{{ t.notas }}</p>
                }
              </mat-card>
            }
          </div>

          <p class="pie">
            Ninguna de estas cifras está guardada: se calculan de las compras y las
            ventas de cada rango de fechas. Si corrige el precio de una compra vieja,
            la ganancia de su temporada se corrige con ella.
          </p>
        }
      }
    </div>
  `,
  styles: `
    .spacer { flex: 1; }

    /* ---------------------------------------------------------- avisos */
    .aviso {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      margin-bottom: 12px;
      font-size: 0.9rem;
      line-height: 1.4;
    }
    .aviso mat-icon { flex: none; }
    .aviso.malo { color: var(--mat-sys-error); }
    .aviso.ojo {
      color: #a06000;
      border: 1px solid color-mix(in srgb, #a06000 25%, transparent);
    }
    .aviso button { margin-left: auto; flex: none; }

    /* ---------------------------------------------------------- vacío */
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
      max-width: 56ch;
      color: var(--mat-sys-on-surface-variant);
      line-height: 1.5;
    }
    .vacio .fino { font-size: 0.86rem; }
    .vacio button { margin-top: 8px; }

    /* ------------------------------------------------- tira de totales */
    .totales {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
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
    .total .cifra {
      font-size: 1.5rem;
      font-weight: 600;
      line-height: 1.15;
    }
    .total .cifra.chica { font-size: 1.15rem; }
    .total .cifra.texto { font-size: 1rem; font-weight: 500; }
    .total .detalle {
      font-size: 0.78rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .total.principal .detalle { color: inherit; opacity: 0.8; }

    /* ------------------------------------------------------ comparación */
    .comparacion { padding: 16px; margin-bottom: 12px; }
    .comparacion h3 {
      margin: 0 0 12px;
      font-size: 0.95rem;
      font-weight: 600;
    }
    .barras { display: flex; flex-direction: column; gap: 8px; }
    .barra-fila {
      display: grid;
      grid-template-columns: minmax(90px, 26%) 1fr minmax(96px, auto);
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 4px 6px;
      border: 0;
      border-radius: 8px;
      background: none;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .barra-fila:hover { background: var(--mat-sys-surface-container-high); }
    .barra-fila .nombre {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.86rem;
    }
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
      /* Una temporada sin ganancia deja una raya visible en vez de nada: un
         ancho de 0 se lee como "no hay dato" y no como "no dejó nada". */
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

    /* -------------------------------------------------------- tarjetas */
    .temporadas { display: flex; flex-direction: column; gap: 12px; }
    .temporada { padding: 16px; }
    .temporada.abierta {
      border-left: 3px solid var(--mat-sys-primary);
    }
    .cabeza {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
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
    .identidad .fechas {
      margin: 2px 0 0;
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
    .chip.corriendo {
      background: color-mix(in srgb, var(--mat-sys-primary) 16%, transparent);
      color: var(--mat-sys-primary);
    }
    .chip.cerrada {
      background: color-mix(in srgb, #2e7d32 14%, transparent);
      color: #2e7d32;
    }
    .chip.pendiente {
      background: color-mix(in srgb, #a06000 16%, transparent);
      color: #a06000;
    }
    .acciones { display: flex; align-items: center; gap: 4px; }

    .cuerpo {
      display: grid;
      grid-template-columns: minmax(170px, 220px) 1fr 1fr;
      gap: 16px;
      align-items: start;
      margin-top: 14px;
    }
    .ganancia {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 12px 14px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, var(--mat-sys-surface));
      color: var(--mat-sys-primary);
    }
    .ganancia.perdida {
      background: color-mix(in srgb, var(--mat-sys-error) 9%, var(--mat-sys-surface));
      color: var(--mat-sys-error);
    }
    .ganancia .rotulo {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.85;
    }
    .ganancia .cifra {
      font-size: 1.55rem;
      font-weight: 600;
      line-height: 1.1;
    }
    .ganancia .detalle { font-size: 0.76rem; opacity: 0.85; }

    .desglose { margin: 0; font-size: 0.85rem; }
    .desglose > div {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 3px 0;
    }
    .desglose dt { color: var(--mat-sys-on-surface-variant); }
    .desglose dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .desglose .suma {
      margin-top: 3px;
      padding-top: 5px;
      border-top: 1px solid var(--mat-sys-outline-variant);
      font-weight: 600;
    }
    .desglose .suma dt { color: inherit; }
    .desglose > div.ojo dd { color: #a06000; font-weight: 600; }

    .falta {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 12px 0 0;
      padding: 9px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, #a06000 8%, transparent);
      color: #a06000;
      font-size: 0.83rem;
      line-height: 1.4;
    }
    .falta mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex: none;
    }
    .notas {
      margin: 10px 0 0;
      font-size: 0.83rem;
      font-style: italic;
      color: var(--mat-sys-on-surface-variant);
    }
    .pie {
      margin: 14px 0 0;
      font-size: 0.78rem;
      line-height: 1.45;
      color: var(--mat-sys-on-surface-variant);
    }

    /* En modo oscuro los colores fijos (ámbar y verde) no tienen contraste */
    @media (prefers-color-scheme: dark) {
      .aviso.ojo, .chip.pendiente, .falta, .desglose > div.ojo dd { color: #ffb74d; }
      .falta { background: color-mix(in srgb, #ffb74d 10%, transparent); }
      .chip.pendiente { background: color-mix(in srgb, #ffb74d 16%, transparent); }
      .chip.cerrada { background: color-mix(in srgb, #81c784 14%, transparent); color: #81c784; }
    }

    @media (max-width: 900px) {
      .cuerpo { grid-template-columns: 1fr 1fr; }
      .ganancia { grid-column: 1 / -1; }
    }
    @media (max-width: 620px) {
      .cuerpo { grid-template-columns: 1fr; }
      .cabeza { flex-direction: column; }
      .acciones { align-self: stretch; }
      .acciones button:first-child { flex: 1; }
      .barra-fila { grid-template-columns: 1fr minmax(96px, auto); }
      /* En un teléfono la barra no cabe al lado del nombre y del valor: se
         pasa debajo, ocupando el ancho completo. */
      .barra-fila .pista { grid-column: 1 / -1; grid-row: 2; }
    }
  `,
})
export class ReventaTemporadasPage implements OnInit {
  private readonly servicio = inject(ReventaService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly filtro = inject(ReventaFiltroService);

  readonly panel = signal<TemporadasPanel | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  /** Para usar `n()` desde la plantilla. */
  readonly n = n;

  /**
   * Las barras van de la más VIEJA a la más nueva, al contrario que las tarjetas.
   * Comparar en el tiempo se lee de izquierda a derecha y de arriba abajo: la
   * historia al revés se lee mal. Las tarjetas sí van al revés porque ahí lo que
   * se busca primero es la temporada que está corriendo.
   */
  readonly panelOrdenadoPorFecha = computed(() =>
    [...(this.panel()?.temporadas ?? [])].sort((a, b) =>
      a.fecha_inicio.localeCompare(b.fecha_inicio),
    ),
  );

  /** La cifra más grande en valor absoluto: es la escala de las barras. */
  private readonly escala = computed(() => {
    const valores = (this.panel()?.temporadas ?? []).map((t) => Math.abs(n(t.ganancia)));
    return Math.max(...valores, 0);
  });

  /**
   * Barras de mozzarella compradas y vendidas en las temporadas listadas.
   *
   * Se SUMAN DE LAS TARJETAS y no se piden aparte, por el mismo motivo que los
   * totales de plata del backend: si se consultaran por separado, con huecos entre
   * temporadas el total daría más que la suma de la lista y el desglose dejaría de
   * cuadrar, que es justo lo que el usuario revisa con calculadora.
   *
   * Y son barras con barras: nunca se juntan con `total_kilos_comprados`.
   */
  readonly barrasCompradas = computed(() =>
    (this.panel()?.temporadas ?? []).reduce((suma, t) => suma + n(t.barras_compradas), 0),
  );

  readonly barrasVendidas = computed(() =>
    (this.panel()?.temporadas ?? []).reduce((suma, t) => suma + n(t.barras_vendidas), 0),
  );

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.servicio.temporadas().subscribe({
      next: (p) => {
        this.panel.set(p);
        // Se le pasan al filtro compartido para que, al saltar al Resumen, el
        // botón de la barra pueda decir en qué temporada está mirando.
        this.filtro.recordarTemporadas(p.temporadas);
        this.cargando.set(false);
      },
      error: (err) => {
        this.error.set(detalleDeError(err, 'No fue posible consultar las temporadas'));
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

  anchoBarra(t: TemporadaResumen): number {
    const escala = this.escala();
    if (escala <= 0) return 0;
    return (Math.abs(n(t.ganancia)) / escala) * 100;
  }

  /** Lleva al Resumen con el filtro puesto en las fechas de la temporada. */
  verEnResumen(t: TemporadaResumen): void {
    this.filtro.desde.setValue(isoToDate(t.fecha_inicio));
    this.filtro.hasta.setValue(isoToDate(t.fecha_fin));
    void this.router.navigate(['/reventa/resumen']);
  }

  nueva(): void {
    this.dialog
      .open(TemporadaFormDialog, {
        data: { proximoInicio: this.panel()?.proximo_inicio ?? null },
      })
      .afterClosed()
      .subscribe((payload) => {
        if (!payload) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.crearTemporada(payload)),
          'Temporada creada',
          'No fue posible crear la temporada',
        );
      });
  }

  editar(t: TemporadaResumen): void {
    // El panel trae las cifras, no la temporada cruda: se reconstruye lo que el
    // formulario necesita. `fecha_fin` va en null si está abierta, porque en el
    // panel esa fecha viene rellena con HOY para poder mostrar el rango.
    this.dialog
      .open(TemporadaFormDialog, {
        data: {
          temporada: {
            id: t.id,
            nombre: t.nombre,
            fecha_inicio: t.fecha_inicio,
            fecha_fin: t.abierta ? null : t.fecha_fin,
            notas: t.notas,
            abierta: t.abierta,
          },
        },
      })
      .afterClosed()
      .subscribe((payload) => {
        if (!payload) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.editarTemporada(t.id, payload)),
          'Temporada actualizada',
          'No fue posible actualizar la temporada',
        );
      });
  }

  cerrar(t: TemporadaResumen): void {
    const falta = !t.cerrada_de_verdad
      ? ' Ojo: todavía queda queso o plata pendiente de esas fechas, pero puede cerrarla igual y seguir cobrando y pagando.'
      : '';
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Cerrar la temporada',
          mensaje:
            `¿Cerrar “${t.nombre}” con fecha de hoy? Cerrarla no congela las cifras: ` +
            `si después corrige una compra o una venta de esas fechas, la ganancia se ajusta.${falta}`,
          accion: 'Cerrar temporada',
          // No es destructivo: se puede reabrir. Sin esto el texto "cerrar" haría
          // que el botón saliera en rojo como si se fuera a perder algo.
          peligro: false,
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.cerrarTemporada(t.id)),
          'Temporada cerrada',
          'No fue posible cerrar la temporada',
        );
      });
  }

  reabrir(t: TemporadaResumen): void {
    void this.ejecutar(
      () => firstValueFrom(this.servicio.reabrirTemporada(t.id)),
      'Temporada reabierta',
      'No fue posible reabrir la temporada',
    );
  }

  eliminar(t: TemporadaResumen): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar temporada',
          mensaje:
            `¿Eliminar “${t.nombre}”? Se borra solo la temporada, que es el nombre y ` +
            `el rango de fechas. Las compras y las ventas de esas fechas NO se borran.`,
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.eliminarTemporada(t.id)),
          'Temporada eliminada',
          'No fue posible eliminar la temporada',
        );
      });
  }

  private async ejecutar(
    accion: () => Promise<unknown>,
    exito: string,
    respaldo: string,
  ): Promise<void> {
    try {
      await accion();
      this.snackbar.open(exito, 'OK', { duration: 2500 });
      this.cargar();
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, respaldo);
      // Se recarga igual: si el error fue de red pero el servidor sí guardó, la
      // pantalla no puede quedarse mostrando el estado viejo.
      this.cargar();
    }
  }
}
