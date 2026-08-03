import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Monto } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { dateToIso, isoToDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { PageHeader } from '../../shared/page-header';
import { MoneyPipe } from '../../shared/pipes';
import { CicloDespacho, CicloPropuesta, CiclosPanel, ProduccionService } from './produccion.service';

/** Número a partir de un Monto, que llega como texto cuando es Decimal. */
function n(valor: Monto | null | undefined): number {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Kilos con DOS decimales, siempre.
 *
 * POR QUÉ NO SE USA EL PIPE `cantidad` DE TODA LA APP. Ese pipe redondea a un
 * decimal, y aquí cada cifra de kilos está o en una resta o en una columna que
 * tiene que dar el total. Con un decimal, un reparto de 1,77 + 1,70 + 1,85 sale
 * en pantalla como 1,8 + 1,7 + 1,9 = 5,4 contra un total de 5,3: el dueño suma
 * esa columna a mano contra su cuaderno y lo primero que ve es que no cuadra.
 *
 * Dos decimales son los que de verdad guarda la base, así que lo que se ve es lo
 * que hay y las sumas cierran exactas.
 */
const KILOS = new Intl.NumberFormat('es-CO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Pesos para los diálogos, donde no se puede usar el pipe `money`. */
const PESOS = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** Porcentajes con coma decimal: el Decimal del backend llega con punto. */
const PORCENTAJE = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

/**
 * CERRAR EL CICLO DE DESPACHO: el momento en que la resta es honesta.
 *
 * El queso se pesa dos veces —al hacerlo y al venderlo— y entre las dos se seca:
 * una tanda de 130 kg rinde 125 al despacharla. Como en Bogotá se vende por
 * kilos sin saber de qué tanda salieron, esos 5 kg se quedaban en la bodega como
 * queso que no existe, con su costo. El inventario salía inflado y la utilidad
 * mejor de lo que era.
 *
 * Como el despacho va por ciclos de unos siete días, al terminar uno de esas
 * tandas no debería quedar nada, y ahí la resta se puede hacer sin adivinar.
 *
 * LA PANTALLA ESTÁ ARMADA AL REVÉS DE LO NORMAL: lo primero y lo más grande es la
 * PROPUESTA, no la lista. El ciclo se repite cada semana; si hubiera que
 * acordarse de abrirlo, en tres semanas nadie lo haría y los kilos fantasma
 * volverían. Así que el sistema llega con el rango puesto, la cuenta hecha y un
 * botón. La lista de los ciclos ya cerrados va debajo, que es lo que se consulta
 * de vez en cuando.
 *
 * Y la cuenta se MUESTRA ANTES de aceptarla, renglón por renglón, porque es
 * plata que se da por perdida y el dueño la cuadra a mano contra su cuaderno.
 */
@Component({
  selector: 'app-produccion-ciclos',
  imports: [
    DatePipe, MatCardModule, MatButtonModule, MatCheckboxModule, MatIconModule,
    MatMenuModule, MatProgressBarModule, MatTooltipModule, MatFormFieldModule,
    MatInputModule, MatDatepickerModule, PageHeader, MoneyPipe,
    HasPermissionDirective,
  ],
  template: `
    <div class="page">
      <app-page-header
        titulo="Cierre de ciclo de despacho"
        subtitulo="El queso pierde peso al secarse entre que se hace y se vende. Al cerrar el ciclo esa diferencia sale de la bodega y se le carga su costo al lote."
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

      <!-- ================================================== LA PROPUESTA -->
      @let prop = propuesta();
      @if (prop) {
        <mat-card class="propuesta" [class.toca]="prop.toca_cerrar">
          <div class="cabeza">
            <div class="identidad">
              <h3>
                <mat-icon aria-hidden="true">event_repeat</mat-icon>
                {{ prop.nombre_sugerido }}
                @if (prop.toca_cerrar) {
                  <span class="chip toca">Toca cerrar</span>
                }
              </h3>
              <p class="fechas">
                @if (prop.toca_cerrar) {
                  Van {{ prop.dias_desde_ultimo_cierre }} días desde el último cierre.
                  ¿Cierro este ciclo?
                } @else {
                  Van {{ prop.dias_desde_ultimo_cierre }} de los
                  {{ DIAS_DEL_CICLO }} días del ciclo. Puede esperar o cerrarlo ya.
                }
              </p>
            </div>
            <mat-form-field appearance="outline" class="campo-rango">
              <mat-label>Días del ciclo</mat-label>
              <mat-date-range-input [rangePicker]="calendario">
                <input matStartDate placeholder="Desde" [value]="desde()"
                       (dateChange)="fijarDesde($event.value)" />
                <input matEndDate placeholder="Hasta" [value]="hasta()"
                       (dateChange)="fijarHasta($event.value)" />
              </mat-date-range-input>
              <mat-datepicker-toggle matIconSuffix [for]="calendario" />
              <mat-date-range-picker #calendario />
            </mat-form-field>
          </div>

          @if (prop.vacio) {
            <p class="nada">
              <mat-icon aria-hidden="true">check_circle</mat-icon>
              En estas fechas no hay tandas ni despachos. No hay nada que cerrar.
            </p>
          } @else {
            <!-- LA CUENTA. Es lo que el dueño va a aceptar, así que va completa y
                 con los renglones en el orden en que se leen. -->
            <div class="cuenta">
              <dl class="desglose">
                <div>
                  <dt>Se produjeron</dt>
                  <dd>{{ kg(prop.kilos_producidos) }}</dd>
                </div>
                <div>
                  <dt>(−) Salieron vendidos</dt>
                  <dd>{{ kg(prop.kilos_vendidos) }}</dd>
                </div>
                @if (n(prop.kilos_ajuste_manual) > 0) {
                  <div class="ya-contado">
                    <dt>
                      (−) Ya los había bajado usted
                      <mat-icon
                        aria-hidden="true"
                        matTooltip="Ajustes de inventario que usted anotó dentro de estas fechas. Esos kilos ya salieron de la bodega y su costo ya se le restó al lote, así que no se vuelven a cobrar aquí."
                      >info</mat-icon>
                    </dt>
                    <dd>{{ kg(prop.kilos_ajuste_manual) }}</dd>
                  </div>
                }
                <div class="suma">
                  <dt>Diferencia: se secó</dt>
                  <dd>{{ kg(prop.kilos_merma) }}</dd>
                </div>
              </dl>

              <div class="plata" [class.ojo]="n(prop.porcentaje) > 10">
                <span class="rotulo">Lo que vale esa merma</span>
                <span class="cifra">{{ prop.costo_merma | money }}</span>
                <span class="detalle">
                  {{ kg(prop.kilos_merma) }} · el
                  {{ pct(prop.porcentaje) }} de lo que se produjo
                </span>
              </div>
            </div>

            <!-- Los avisos van ANTES del botón: hay que leerlos para llegar a él -->
            @if (prop.advertencias.length > 0) {
              <div class="alertas">
                @for (a of prop.advertencias; track a) {
                  <p class="alerta">
                    <mat-icon aria-hidden="true">report_problem</mat-icon>
                    <span>{{ a }}</span>
                  </p>
                }
                <mat-checkbox [checked]="aceptaAvisos()"
                              (change)="aceptaAvisos.set($event.checked)">
                  Ya lo revisé y quiero cerrar el ciclo de todas formas
                </mat-checkbox>
              </div>
            }

            @if (prop.por_tipo.length > 1) {
              <div class="tabla-envoltura">
                <table class="tabla">
                  <caption>La cuenta de cada tipo de queso, por separado</caption>
                  <thead>
                    <tr>
                      <th>Tipo de queso</th>
                      <th class="num">Produjo</th>
                      <th class="num">Salió</th>
                      <th class="num">Se secó</th>
                      <th class="num">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (t of prop.por_tipo; track t.tipo_queso_id) {
                      <tr>
                        <td>{{ t.tipo_queso }}</td>
                        <td class="num">{{ kg(t.kilos_producidos) }}</td>
                        <td class="num">{{ kg(t.kilos_vendidos) }}</td>
                        <td class="num" [class.malo]="n(t.kilos_merma) < 0">
                          {{ kg(t.kilos_merma) }}
                        </td>
                        <td class="num">{{ pct(t.porcentaje) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }

            @if (prop.por_lote.length > 0) {
              <button mat-button class="ver-reparto" (click)="alternarReparto()">
                <mat-icon>{{ verReparto() ? 'expand_less' : 'expand_more' }}</mat-icon>
                {{ verReparto() ? 'Ocultar' : 'Ver' }} cómo se reparte entre las
                {{ prop.por_lote.length }} tandas
              </button>
              @if (verReparto()) {
                <div class="tabla-envoltura">
                  <table class="tabla">
                    <caption>
                      A cada tanda le toca la parte que le corresponde por sus kilos,
                      no toda al último lote. La columna suma exacto la merma.
                    </caption>
                    <thead>
                      <tr>
                        <th>Tanda</th>
                        <th>Queso</th>
                        <th class="num">Produjo</th>
                        <th class="num">Le tocan</th>
                        <th class="num">Valen</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (l of prop.por_lote; track l.produccion_id) {
                        <tr>
                          <td>{{ isoADate(l.fecha) | date: 'd MMM y' }}</td>
                          <td>{{ l.tipo_queso }}</td>
                          <td class="num">{{ kg(l.kilos_producidos) }}</td>
                          <td class="num">{{ kg(l.kilos_merma) }}</td>
                          <td class="num">{{ l.costo_merma | money }}</td>
                        </tr>
                      }
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colspan="3">Suma</th>
                        <th class="num">{{ kg(prop.kilos_merma) }}</th>
                        <th class="num">{{ prop.costo_merma | money }}</th>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              }
            }

            <div class="acciones-cierre">
              <button
                mat-flat-button
                *hasPermission="'produccion:editar'"
                [disabled]="!puedeCerrar()"
                (click)="cerrar(prop)"
              >
                <mat-icon>task_alt</mat-icon> Cerrar el ciclo y registrar la merma
              </button>
              <span class="nota">
                Al cerrar, esos kilos salen de la bodega y su costo se le resta a
                cada tanda. Se puede deshacer reabriendo el ciclo.
              </span>
            </div>
          }
        </mat-card>
      }

      <!-- ============================================ LOS YA CERRADOS -->
      @let p = panel();
      @if (p) {
        @if (p.ciclos.length === 0) {
          <mat-card class="vacio">
            <mat-icon aria-hidden="true">inventory</mat-icon>
            <h3>Todavía no ha cerrado ningún ciclo</h3>
            <p>
              Un ciclo son las tandas que salen juntas para Bogotá: se acumulan unos
              siete días, se despachan, y vuelve a empezar. Al cerrarlo, el sistema
              resta lo que salió de lo que se produjo y esa diferencia —el queso que
              se secó— sale de la bodega con su costo.
            </p>
            <p class="fino">
              Mientras no se cierre, esos kilos se quedan en el inventario como queso
              que no existe, y la utilidad se ve mejor de lo que es.
            </p>
          </mat-card>
        } @else {
          <div class="totales">
            <div class="total principal">
              <span class="rotulo">Merma registrada en total</span>
              <span class="cifra">{{ p.total_costo_merma | money }}</span>
              <span class="detalle">
                {{ kg(p.total_kilos_merma) }} en
                {{ p.ciclos.length }} {{ p.ciclos.length === 1 ? 'ciclo' : 'ciclos' }}
              </span>
            </div>
            <div class="total">
              <span class="rotulo">Producido en esos ciclos</span>
              <span class="cifra chica">{{ kg(p.total_kilos_producidos) }}</span>
              <span class="detalle">suma de los ciclos de abajo</span>
            </div>
            <div class="total">
              <span class="rotulo">Se secó, en promedio</span>
              <span class="cifra chica">{{ pct(promedio()) }}</span>
              <span class="detalle">de lo que se produjo</span>
            </div>
          </div>

          <div class="ciclos">
            @for (c of p.ciclos; track c.id) {
              <mat-card class="ciclo" [class.abierto]="!c.cerrado">
                <div class="cabeza">
                  <div class="identidad">
                    <h3>
                      {{ c.nombre }}
                      @if (c.cerrado) {
                        <span class="chip cerrado">Cerrado</span>
                      } @else {
                        <span class="chip pendiente">Reabierto, sin merma</span>
                      }
                    </h3>
                    <p class="fechas">
                      {{ isoADate(c.fecha_inicio) | date: 'd MMM y' }} —
                      {{ isoADate(c.fecha_fin) | date: 'd MMM y' }} ·
                      {{ c.dias }} días
                      @if (c.cerrado_at) {
                        <!-- cerrado_at es fecha Y HORA, no una fecha suelta:
                             isoADate solo entiende 'yyyy-MM-dd' y le devolvía
                             null, así que salía "cerrado el" y nada detrás. El
                             DatePipe entiende el ISO completo tal cual. -->
                        · cerrado el {{ c.cerrado_at | date: 'd MMM y' }}
                      }
                    </p>
                  </div>
                  <div class="acciones">
                    <button mat-icon-button [matMenuTriggerFor]="menu"
                            aria-label="Más acciones">
                      <mat-icon>more_vert</mat-icon>
                    </button>
                    <mat-menu #menu="matMenu">
                      @if (c.cerrado) {
                        <button mat-menu-item *hasPermission="'produccion:editar'"
                                (click)="reabrir(c)">
                          <mat-icon>undo</mat-icon>
                          <span>Reabrir y deshacer la merma</span>
                        </button>
                      } @else {
                        <button mat-menu-item *hasPermission="'produccion:eliminar'"
                                (click)="eliminar(c)">
                          <mat-icon>delete</mat-icon>
                          <span>Eliminar el ciclo</span>
                        </button>
                      }
                    </mat-menu>
                  </div>
                </div>

                @if (c.cerrado) {
                  <div class="cuerpo">
                    <div class="plata">
                      <span class="rotulo">Merma aceptada</span>
                      <span class="cifra">{{ c.costo_merma | money }}</span>
                      <span class="detalle">
                        {{ kg(c.kilos_merma) }} · {{ pct(c.porcentaje) }}
                      </span>
                    </div>
                    <dl class="desglose">
                      <div>
                        <dt>Se produjeron</dt>
                        <dd>{{ kg(c.kilos_producidos) }}</dd>
                      </div>
                      <div>
                        <dt>(−) Salieron vendidos</dt>
                        <dd>{{ kg(c.kilos_vendidos) }}</dd>
                      </div>
                      @if (n(c.kilos_ajuste_manual) > 0) {
                        <div>
                          <dt>(−) Bajados a mano</dt>
                          <dd>{{ kg(c.kilos_ajuste_manual) }}</dd>
                        </div>
                      }
                      <div class="suma">
                        <dt>Se secó</dt>
                        <dd>{{ kg(c.kilos_merma) }}</dd>
                      </div>
                    </dl>
                    <dl class="desglose">
                      <div>
                        <dt>Tandas afectadas</dt>
                        <dd>{{ c.por_lote.length }}</dd>
                      </div>
                      <div>
                        <dt>Suma repartida</dt>
                        <dd>{{ kg(sumaRepartida(c)) }}</dd>
                      </div>
                      <div class="suma">
                        <dt>Costo repartido</dt>
                        <dd>{{ c.costo_merma | money }}</dd>
                      </div>
                    </dl>
                  </div>
                } @else {
                  <p class="falta">
                    <mat-icon aria-hidden="true">pending_actions</mat-icon>
                    Este ciclo se reabrió: su merma se deshizo y esos kilos volvieron
                    a la bodega. Puede volver a cerrarlo desde arriba cuando corrija
                    lo que estaba mal; esta fila desaparece sola al hacerlo.
                  </p>
                }

                @if (c.advertencias.length > 0) {
                  @for (a of c.advertencias; track a) {
                    <p class="falta">
                      <mat-icon aria-hidden="true">report_problem</mat-icon>
                      <span>Se cerró con este aviso: {{ a }}</span>
                    </p>
                  }
                }
                @if (c.notas) {
                  <p class="notas">{{ c.notas }}</p>
                }
              </mat-card>
            }
          </div>
        }

        <p class="pie">
          La merma de un cierre se registra como un ajuste de inventario por cada
          tanda, así que la baja aparece igual en el inventario, en la utilidad por
          lote y en el estado de resultados. Reabrir un ciclo deshace esos ajustes y
          todo vuelve a como estaba.
        </p>
      }
    </div>
  `,
  styles: `
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
    .aviso button { margin-left: auto; flex: none; }

    /* ------------------------------------------------------- propuesta */
    /* Es lo primero y lo más grande de la pantalla a propósito: si esto fuera
       una fila más de una lista, nadie cerraría el ciclo nunca. */
    .propuesta {
      padding: 18px;
      margin-bottom: 16px;
      border-left: 3px solid var(--mat-sys-outline-variant);
    }
    .propuesta.toca {
      border-left-color: #a06000;
      background: color-mix(in srgb, #a06000 5%, var(--mat-sys-surface));
    }
    .propuesta .cabeza {
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
      font-size: 1.1rem;
    }
    .identidad h3 mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: var(--mat-sys-primary);
    }
    .identidad .fechas {
      margin: 4px 0 0;
      font-size: 0.86rem;
      color: var(--mat-sys-on-surface-variant);
      line-height: 1.4;
    }
    .campo-rango { width: 260px; }
    .chip {
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .chip.toca {
      background: color-mix(in srgb, #a06000 16%, transparent);
      color: #a06000;
    }
    .chip.cerrado {
      background: color-mix(in srgb, #2e7d32 14%, transparent);
      color: #2e7d32;
    }
    .chip.pendiente {
      background: color-mix(in srgb, #a06000 16%, transparent);
      color: #a06000;
    }

    .nada {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 14px 0 0;
      font-size: 0.88rem;
      color: var(--mat-sys-on-surface-variant);
    }

    /* La cuenta: el desglose a la izquierda y la plata a la derecha */
    .cuenta {
      display: grid;
      grid-template-columns: 1fr minmax(180px, 240px);
      gap: 18px;
      align-items: start;
      margin-top: 16px;
    }
    .desglose { margin: 0; font-size: 0.88rem; }
    .desglose > div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 0;
    }
    .desglose dt {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--mat-sys-on-surface-variant);
    }
    .desglose dt mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
      opacity: 0.6;
      cursor: help;
    }
    .desglose dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .desglose .suma {
      margin-top: 4px;
      padding-top: 6px;
      border-top: 1px solid var(--mat-sys-outline-variant);
      font-weight: 600;
      font-size: 0.95rem;
    }
    .desglose .suma dt { color: inherit; }
    /* El renglón que evita cobrar dos veces: se marca para que se note que el
       sistema ya tuvo en cuenta lo que el dueño había anotado. */
    .desglose .ya-contado dt,
    .desglose .ya-contado dd { color: var(--mat-sys-primary); }

    .plata {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 14px 16px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--mat-sys-error) 8%, var(--mat-sys-surface));
      color: var(--mat-sys-error);
    }
    .plata.ojo {
      background: color-mix(in srgb, #a06000 12%, var(--mat-sys-surface));
      color: #a06000;
    }
    .plata .rotulo {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.85;
    }
    .plata .cifra { font-size: 1.5rem; font-weight: 600; line-height: 1.15; }
    .plata .detalle { font-size: 0.76rem; opacity: 0.85; }

    /* Los avisos van ANTES del botón: hay que pasar por encima para llegar */
    .alertas {
      margin-top: 14px;
      padding: 12px 14px;
      border-radius: 10px;
      background: color-mix(in srgb, #a06000 8%, transparent);
      border: 1px solid color-mix(in srgb, #a06000 25%, transparent);
    }
    .alerta {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 0 0 8px;
      color: #a06000;
      font-size: 0.85rem;
      line-height: 1.45;
    }
    .alerta mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }

    .ver-reparto { margin-top: 10px; font-size: 0.85rem; }
    .acciones-cierre {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .acciones-cierre .nota {
      font-size: 0.79rem;
      color: var(--mat-sys-on-surface-variant);
      line-height: 1.4;
      max-width: 46ch;
    }

    /* ---------------------------------------------------------- tablas */
    .tabla-envoltura { overflow-x: auto; margin-top: 12px; }
    .tabla {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.84rem;
    }
    .tabla caption {
      caption-side: top;
      text-align: left;
      padding-bottom: 6px;
      font-size: 0.79rem;
      color: var(--mat-sys-on-surface-variant);
      line-height: 1.4;
    }
    .tabla th, .tabla td {
      padding: 6px 10px;
      text-align: left;
      white-space: nowrap;
    }
    .tabla thead th {
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--mat-sys-on-surface-variant);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .tabla tbody tr:nth-child(even) { background: var(--mat-sys-surface-container-low); }
    .tabla tfoot th {
      border-top: 1px solid var(--mat-sys-outline-variant);
      font-weight: 600;
    }
    .tabla .num { text-align: right; font-variant-numeric: tabular-nums; }
    .tabla .num.malo { color: var(--mat-sys-error); font-weight: 600; }

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
      max-width: 58ch;
      color: var(--mat-sys-on-surface-variant);
      line-height: 1.5;
    }
    .vacio .fino { font-size: 0.86rem; }

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
      background: color-mix(in srgb, var(--mat-sys-error) 9%, var(--mat-sys-surface));
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

    /* -------------------------------------------------------- tarjetas */
    .ciclos { display: flex; flex-direction: column; gap: 12px; }
    .ciclo { padding: 16px; }
    .ciclo.abierto { border-left: 3px solid #a06000; }
    .ciclo .cabeza {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .acciones { display: flex; align-items: center; gap: 4px; }
    .cuerpo {
      display: grid;
      grid-template-columns: minmax(170px, 220px) 1fr 1fr;
      gap: 16px;
      align-items: start;
      margin-top: 14px;
    }
    .cuerpo .plata .cifra { font-size: 1.35rem; }

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
    .falta mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .notas {
      margin: 10px 0 0;
      font-size: 0.83rem;
      font-style: italic;
      color: var(--mat-sys-on-surface-variant);
    }
    .pie {
      margin: 16px 0 0;
      font-size: 0.78rem;
      line-height: 1.45;
      color: var(--mat-sys-on-surface-variant);
      max-width: 90ch;
    }

    /* En modo oscuro el ámbar y el verde fijos no tienen contraste */
    @media (prefers-color-scheme: dark) {
      .chip.toca, .chip.pendiente, .falta, .alerta, .plata.ojo { color: #ffb74d; }
      .falta, .alertas { background: color-mix(in srgb, #ffb74d 10%, transparent); }
      .alertas { border-color: color-mix(in srgb, #ffb74d 25%, transparent); }
      .chip.toca, .chip.pendiente { background: color-mix(in srgb, #ffb74d 16%, transparent); }
      .chip.cerrado { background: color-mix(in srgb, #81c784 14%, transparent); color: #81c784; }
      .propuesta.toca { background: color-mix(in srgb, #ffb74d 5%, var(--mat-sys-surface)); }
      .propuesta.toca, .ciclo.abierto { border-left-color: #ffb74d; }
      .plata.ojo { background: color-mix(in srgb, #ffb74d 12%, var(--mat-sys-surface)); }
    }

    @media (max-width: 900px) {
      .cuenta { grid-template-columns: 1fr; }
      .cuerpo { grid-template-columns: 1fr 1fr; }
      .cuerpo .plata { grid-column: 1 / -1; }
    }
    @media (max-width: 620px) {
      .cuerpo { grid-template-columns: 1fr; }
      .propuesta .cabeza, .ciclo .cabeza { flex-direction: column; }
      .campo-rango { width: 100%; }
    }
  `,
})
export class ProduccionCiclosPage implements OnInit {
  private readonly servicio = inject(ProduccionService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  readonly panel = signal<CiclosPanel | null>(null);
  readonly propuesta = signal<CicloPropuesta | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  /** Las fechas que el usuario puso a mano; en null manda la propuesta. */
  readonly desde = signal<Date | null>(null);
  readonly hasta = signal<Date | null>(null);
  readonly aceptaAvisos = signal(false);
  readonly verReparto = signal(false);

  /** Para usar `n()` desde la plantilla. */
  readonly n = n;
  readonly DIAS_DEL_CICLO = 7;

  /** Kilos con dos decimales, para que las columnas den el total (ver arriba). */
  kg(valor: Monto | null | undefined): string {
    if (valor === null || valor === undefined || valor === '') return '—';
    return `${KILOS.format(Number(valor))} kg`;
  }

  pesos(valor: Monto | null | undefined): string {
    return PESOS.format(Number(valor ?? 0));
  }

  /** El porcentaje con coma decimal, como se escribe en Colombia. */
  pct(valor: Monto | null | undefined): string {
    return `${PORCENTAJE.format(n(valor))}%`;
  }

  /**
   * El botón de cerrar solo se habilita si hay merma que registrar y, cuando la
   * cuenta trae avisos, si alguien los aceptó. Es plata que se da por perdida.
   */
  readonly puedeCerrar = computed(() => {
    const p = this.propuesta();
    if (!p || p.vacio) return false;
    if (p.advertencias.length > 0) return this.aceptaAvisos();
    return n(p.kilos_merma) > 0;
  });

  /** Cuánto se secó en promedio, sobre el total producido en los ciclos. */
  readonly promedio = computed(() => {
    const p = this.panel();
    const producido = n(p?.total_kilos_producidos);
    if (producido <= 0) return 0;
    return (n(p?.total_kilos_merma) / producido) * 100;
  });

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.servicio.ciclos().subscribe({
      next: (p) => {
        this.panel.set(p);
        // Solo se pisa la propuesta si el usuario no ha tocado las fechas: si no,
        // recargar después de cerrar le borraría el rango que estaba corrigiendo.
        if (this.desde() === null && this.hasta() === null) {
          this.propuesta.set(p.propuesta);
          this.aceptaAvisos.set(false);
        }
        this.cargando.set(false);
      },
      error: (err) => {
        this.error.set(detalleDeError(err, 'No fue posible consultar los ciclos'));
        this.cargando.set(false);
      },
    });
  }

  /** Vuelve a pedir la cuenta con las fechas que el usuario puso. */
  private recalcular(): void {
    const desde = dateToIso(this.desde());
    const hasta = dateToIso(this.hasta());
    // Con media fecha puesta no se consulta: el rango a medias devolvería otra
    // cosa y el dueño creería que la cuenta cambió sola.
    if (!desde || !hasta) return;
    this.cargando.set(true);
    this.error.set(null);
    this.aceptaAvisos.set(false);
    this.servicio.propuestaCiclo(desde, hasta).subscribe({
      next: (p) => {
        this.propuesta.set(p);
        this.cargando.set(false);
      },
      error: (err) => {
        this.error.set(detalleDeError(err, 'No fue posible calcular ese ciclo'));
        this.cargando.set(false);
      },
    });
  }

  fijarDesde(valor: Date | null): void {
    this.desde.set(valor);
    this.recalcular();
  }

  fijarHasta(valor: Date | null): void {
    this.hasta.set(valor);
    this.recalcular();
  }

  alternarReparto(): void {
    this.verReparto.update((v) => !v);
  }

  isoADate(iso: string | null): Date | null {
    return isoToDate(iso);
  }

  sumaRepartida(c: CicloDespacho): number {
    return c.por_lote.reduce((s, l) => s + n(l.kilos_merma), 0);
  }

  cerrar(p: CicloPropuesta): void {
    const aviso = p.advertencias.length
      ? ' OJO: esta cuenta tiene avisos y usted los aceptó.'
      : '';
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Cerrar el ciclo de despacho',
          mensaje:
            `Se van a dar por perdidos ${this.kg(p.kilos_merma)} de queso, que ` +
            `valen ${this.pesos(p.costo_merma)}. Esos kilos salen de la bodega y su ` +
            `costo se le resta a cada tanda, así que la utilidad de esos lotes ` +
            `baja.${aviso} Se puede deshacer reabriendo el ciclo.`,
          accion: 'Cerrar el ciclo',
          // Es una operación de plata, pero no destructiva: se puede reabrir.
          peligro: false,
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () =>
            firstValueFrom(
              this.servicio.cerrarCiclo({
                fecha_inicio: p.fecha_inicio,
                fecha_fin: p.fecha_fin,
                aceptar_advertencias: p.advertencias.length > 0,
              }),
            ),
          'Ciclo cerrado: la merma quedó registrada',
          'No fue posible cerrar el ciclo',
          true,
        );
      });
  }

  reabrir(c: CicloDespacho): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Reabrir el ciclo',
          mensaje:
            `Se va a deshacer la merma de “${c.nombre}”: los ${this.kg(c.kilos_merma)} ` +
            'vuelven a la bodega y su costo vuelve a cada tanda, así que la ' +
            'utilidad de esos lotes sube otra vez a lo que decía antes.',
          accion: 'Reabrir',
          peligro: false,
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.reabrirCiclo(c.id)),
          'Ciclo reabierto: la merma se deshizo',
          'No fue posible reabrir el ciclo',
          true,
        );
      });
  }

  eliminar(c: CicloDespacho): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar el ciclo',
          mensaje:
            `Se borra “${c.nombre}”. No borra ninguna tanda ni ningún despacho: ` +
            'el ciclo es solo un rango de fechas con su cuenta. Al borrarlo, esas ' +
            'fechas quedan libres para volver a cerrarlas.',
          accion: 'Eliminar',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.eliminarCiclo(c.id)),
          'Ciclo eliminado',
          'No fue posible eliminar el ciclo',
          true,
        );
      });
  }

  private async ejecutar(
    accion: () => Promise<unknown>,
    exito: string,
    respaldo: string,
    volverALaPropuesta = false,
  ): Promise<void> {
    try {
      await accion();
      this.snackbar.open(exito, 'OK', { duration: 3000 });
      if (volverALaPropuesta) {
        // Después de cerrar o reabrir, el rango que estaba puesto a mano ya no
        // sirve: hay que volver a lo que el sistema proponga ahora.
        this.desde.set(null);
        this.hasta.set(null);
      }
      this.cargar();
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, respaldo);
      // Se recarga igual: si el error fue de red pero el servidor sí guardó, la
      // pantalla no puede quedarse mostrando el estado viejo.
      this.desde.set(null);
      this.hasta.set(null);
      this.cargar();
    }
  }
}
