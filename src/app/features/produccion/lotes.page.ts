import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Monto } from '../../core/models';
import { dateToIso, isoToDate } from '../../shared/date-utils';
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

/** El primero del mes corrido. */
function primerDiaDelMes(): Date {
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth(), 1);
}

interface Atajo {
  texto: string;
  /** `null` = sin rango, o sea toda la historia. */
  rango: () => [Date, Date] | null;
}

/**
 * Los rangos que se piden casi siempre, igual que en la pantalla de reventa. Con
 * estos rara vez hay que abrir el calendario.
 *
 * "Todo" va de primero y es el que arranca puesto: esta pantalla mostraba toda la
 * historia y si al entrar apareciera recortada a un mes, el dueño creería que se
 * perdieron datos. Además es la única forma de volver a verlo todo después de
 * haber filtrado.
 */
const ATAJOS: Atajo[] = [
  { texto: 'Todo', rango: () => null },
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
 *
 * EL RANGO DE FECHAS ES POR FECHA DE PRODUCCIÓN, no de venta. La pregunta que
 * responde la pantalla es "cuánto dejaron los lotes que hice estos días", así que
 * un lote de julio sigue siendo de julio aunque termine de venderse en septiembre;
 * si se filtrara por fecha de venta, un mismo lote se partiría entre varios meses
 * y ya no se podría hablar de "la utilidad de ese lote". Se dice en pantalla para
 * que nadie tenga que adivinarlo. (Para la otra pregunta —"cuánto entró estos
 * días"— está el estado de resultados, que sí va por fecha de venta.)
 *
 * Y el filtro recorta lo que se MUESTRA y se SUMA, nunca el cálculo: el reparto
 * FIFO necesita toda la historia para saber qué había en bodega. Eso lo garantiza
 * el backend, que reparte completo y filtra al final.
 */
@Component({
  selector: 'app-produccion-lotes',
  imports: [
    DatePipe, NgTemplateOutlet, MatCardModule, MatButtonModule, MatIconModule,
    MatProgressBarModule, MatTooltipModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, PageHeader, MoneyPipe, CantidadPipe,
  ],
  template: `
    <div class="page">
      <app-page-header
        titulo="Utilidad por lote de producción"
        subtitulo="Qué dejó el queso que se hizo cada día: la leche que usó, lo que se vendió y lo que sigue en bodega"
      />

      <!-- ─────────────────────────── El filtro de fechas.
           Un solo calendario de rango y los atajos, igual que en reventa: la
           consulta se rehace sola al marcar el segundo día, sin botón. -->
      <mat-card class="filtro">
        <div class="cabecera-filtro">
          <div>
            <h3>¿Qué lotes quiere ver?</h3>
            <p>
              Se cuentan los lotes por el día en que <strong>se hizo el queso</strong>,
              no por el día en que se vendió: así "lo que dejó el lote" sigue siendo
              del lote, aunque se termine de vender meses después. Todas las cifras
              de abajo se recalculan con lo que escoja.
            </p>
            <p class="pista-punto">
              <span class="punto"></span>
              En el calendario, los días con punto son en los que se hizo queso.
            </p>
          </div>
          <div class="rango">
            <mat-form-field appearance="outline" class="campo-rango">
              <mat-label>Días de producción</mat-label>
              <mat-date-range-input [rangePicker]="calendario">
                <input matStartDate placeholder="Desde" [value]="desde()"
                       (dateChange)="fijarDesde($event.value)" />
                <input matEndDate placeholder="Hasta" [value]="hasta()"
                       (dateChange)="fijarHasta($event.value)" />
              </mat-date-range-input>
              <mat-datepicker-toggle matIconSuffix [for]="calendario" />
              <mat-date-range-picker #calendario [dateClass]="claseDia" />
            </mat-form-field>
          </div>
        </div>

        <div class="atajos">
          @for (a of ATAJOS; track a.texto) {
            <button mat-stroked-button class="atajo" [class.puesto]="atajo() === a.texto"
                    (click)="usarAtajo(a)">
              {{ a.texto }}
            </button>
          }
        </div>

        @if (errorRango()) {
          <p class="error-rango">{{ errorRango() }}</p>
        }
      </mat-card>

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
            @if (hayFiltro()) {
              <!-- Vacío POR EL FILTRO, no porque no haya datos. Sin esta
                   distinción parecería que se perdió la información. -->
              <h3>No se hizo queso en esos días</h3>
              <p>
                Los lotes que ya tenía siguen ahí; lo único que pasa es que ninguno
                se produjo dentro del rango que escogió.
              </p>
              <button mat-stroked-button (click)="usarAtajo(ATAJOS[0])">
                Ver todos los lotes
              </button>
            } @else {
              <h3>Todavía no hay producciones registradas</h3>
              <p>
                En cuanto registre una producción, aquí aparece ese lote con la leche
                que usó, lo que costó y lo que dejó cuando se venda.
              </p>
            }
          </mat-card>
        } @else {
          <!-- ─────────────────────────── El resumen, encadenado.
               Antes eran cinco tarjetas sueltas y no se sabía cuáles sumaban con
               cuáles. Ahora hay dos cuentas, cada una suma EXACTO su renglón
               final, y el "costo de lo vendido" es la bisagra que las une: es lo
               que se le resta a la utilidad y a la vez el pedazo del costo del
               lote que ya salió de la bodega. -->
          <section class="resumen">
            <div class="total principal" [class.perdida]="n(p.total_utilidad) < 0">
              <span class="rotulo">
                {{ n(p.total_utilidad) < 0 ? 'Pérdida de lo vendido' : 'Utilidad de lo vendido' }}
              </span>
              <span class="cifra">{{ absoluto(p.total_utilidad) | money }}</span>
              <!-- Se dice el rango con todas sus letras: la cifra grande cambia
                   al filtrar y tiene que verse de qué días es. -->
              <span class="detalle">
                De {{ p.lotes.length }} {{ p.lotes.length === 1 ? 'lote hecho' : 'lotes hechos' }}
                @if (desde() && hasta()) {
                  entre el {{ desde() | date: 'd MMM' }} y el {{ hasta() | date: 'd MMM \\'de\\' y' }}.
                } @else {
                  en toda la historia.
                }
                @if (lotesSinVenta().length > 0) {
                  {{ lotesConVenta().length }}
                  {{ lotesConVenta().length === 1 ? 'ya vendió' : 'ya vendieron' }} algo;
                  {{ lotesSinVenta().length }}
                  {{ lotesSinVenta().length === 1 ? 'sigue entero' : 'siguen enteros' }} en bodega.
                } @else {
                  Contando solo el queso que ya salió.
                }
              </span>
            </div>

            <mat-card class="cuentas">
              <dl class="bloque">
                <h4>
                  De dónde sale esa utilidad
                  <span class="marca periodo">de los lotes del rango</span>
                </h4>
                <div>
                  <dt>Se vendió de estos lotes</dt>
                  <dd>{{ p.total_ingresos | money }}</dd>
                </div>
                <div>
                  <dt>(−) Costó ese queso</dt>
                  <dd>{{ p.total_costo_vendido | money }}</dd>
                </div>
                @if (n(p.total_gastos) > 0) {
                  <div>
                    <dt>(−) Transporte de los despachos</dt>
                    <dd>{{ p.total_gastos | money }}</dd>
                  </div>
                }
                @if (n(p.total_costo_de_baja) > 0) {
                  <div>
                    <dt>(−) Se dañó o se ajustó</dt>
                    <dd>{{ p.total_costo_de_baja | money }}</dd>
                  </div>
                }
                <div class="suma">
                  <dt>{{ n(p.total_utilidad) < 0 ? 'Pérdida' : 'Utilidad' }} de lo vendido</dt>
                  <dd>{{ p.total_utilidad | money }}</dd>
                </div>
                <p class="pie-bloque">
                  Son {{ p.total_kilos_vendidos | cantidad: 'kg' }} despachados de los
                  {{ p.total_kilos | cantidad: 'kg' }} que se hicieron.
                </p>
              </dl>

              <dl class="bloque">
                <h4>
                  Dónde está la plata de esa leche
                  <span class="marca hoy">foto de hoy</span>
                </h4>
                <div>
                  <dt>
                    Ya se vendió
                    <span class="enlace-cuenta">es lo que se resta a la izquierda</span>
                  </dt>
                  <dd>{{ p.total_costo_vendido | money }}</dd>
                </div>
                <div class="ojo">
                  <dt>(+) Sigue en bodega</dt>
                  <dd>{{ p.total_costo_en_bodega | money }}</dd>
                </div>
                @if (n(p.total_costo_de_baja) > 0) {
                  <div>
                    <dt>(+) Se dañó o se ajustó</dt>
                    <dd>{{ p.total_costo_de_baja | money }}</dd>
                  </div>
                }
                <div class="suma">
                  <dt>Costó la leche de estos lotes</dt>
                  <dd>{{ p.total_costo | money }}</dd>
                </div>
                <p class="pie-bloque">
                  {{ p.total_litros | cantidad: 'L' }} de leche se volvieron
                  {{ p.total_kilos | cantidad: 'kg' }} de queso. Quedan
                  {{ p.total_kilos_en_bodega | cantidad: 'kg' }} en bodega, y esa plata
                  <strong>no</strong> se le resta a la utilidad: el queso está ahí.
                </p>
              </dl>
            </mat-card>
          </section>

          @if (n(p.litros_sin_usar) > 0) {
            <!-- Va aparte y no como una sexta tarjeta: no es de ningún lote, así
                 que no suma con nada de arriba, y es de toda la historia. -->
            <p class="aparte">
              <mat-icon aria-hidden="true">water_drop</mat-icon>
              <span>
                Aparte de todo lo anterior hay
                <strong>{{ p.litros_sin_usar | cantidad: 'L' }}</strong> de leche
                recibida que todavía no se ha convertido en queso:
                <strong>{{ p.costo_litros_sin_usar | money }}</strong>. No entra en
                ninguna de las dos cuentas porque no es de ningún lote, y es de
                <strong>toda la historia</strong>, no del rango.
              </span>
            </p>
          }

          <!-- ─────────────────────────── Las explicaciones, plegadas.
               No se pueden borrar (son las que evitan que el dueño compare esta
               utilidad con la de Contabilidad y desconfíe), pero ocupaban media
               pantalla antes de dejar ver un dato. Ahora están a un clic. -->
          <button class="ver-explicacion" type="button" (click)="alternarExplicacion()">
            <mat-icon>{{ explicacion() ? 'expand_less' : 'help_outline' }}</mat-icon>
            {{
              explicacion()
                ? 'Ocultar la explicación'
                : 'Por qué esta utilidad no es la de Contabilidad, y cómo se reparte el queso'
            }}
          </button>

          @if (explicacion()) {
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
          }

          @if (n(p.kilos_existencia_sin_costo) > 0) {
            <mat-card class="aviso ojo">
              <mat-icon aria-hidden="true">price_change</mat-icon>
              <span>
                Hay <strong>{{ p.kilos_existencia_sin_costo | cantidad: 'kg' }}</strong>
                de queso que se cargaron a mano <strong>sin ponerle costo</strong>. Esos
                kilos salen como si le hubieran costado cero, así que la utilidad de
                arriba se ve mejor de lo que es. Si le pone el costo a esas entradas de
                inventario, la cifra queda real.
              </span>
            </mat-card>
          }

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

          <!-- ─────────────────────────── Comparación entre lotes.
               Solo los que ya vendieron algo: los demás dejaban una fila en $0 por
               cabeza y llenaban la lista sin decir nada. Y cada fila lleva tipo de
               queso y kilos, porque varias producciones del mismo día se veían
               como filas repetidas y parecían un error del sistema. -->
          @if (lotesConVenta().length > 1) {
            <mat-card class="comparacion">
              <h3>Cuánto dejó cada lote</h3>
              <p class="sub-comparacion">
                Del más viejo al más nuevo. Solo los que ya vendieron algo; varias
                producciones del mismo día son lotes distintos y por eso se repite la
                fecha.
              </p>
              <div class="barras">
                @for (l of lotesConVentaPorFecha(); track $index) {
                  <div class="barra-fila">
                    <span class="nombre">
                      {{ isoADate(l.fecha) | date: 'd MMM' }}
                      <span class="sub-nombre">
                        {{ l.tipo_queso }} · {{ l.kilos_producidos | cantidad: 'kg' }}
                      </span>
                    </span>
                    <span class="pista">
                      <span class="relleno" [class.perdida]="n(l.utilidad) < 0"
                            [style.width.%]="anchoBarra(l)"></span>
                    </span>
                    <span class="valor" [class.perdida]="n(l.utilidad) < 0">
                      {{ l.utilidad | money }}
                    </span>
                  </div>
                }
                <!-- El dueño suma esta columna a mano: el total tiene que estar
                     aquí abajo y ser el MISMO de la tarjeta de arriba. -->
                <div class="barra-fila total-barras">
                  <span class="nombre">
                    Total
                    <span class="sub-nombre">la misma cifra de la tarjeta de arriba</span>
                  </span>
                  <span class="pista sin-pista"></span>
                  <span class="valor" [class.perdida]="sumaUtilidades() < 0">
                    {{ sumaUtilidades() | money }}
                  </span>
                </div>
              </div>
              @if (lotesSinVenta().length > 0) {
                <p class="nota-sin-venta">
                  No se listan aquí
                  <strong>{{ lotesSinVenta().length }}</strong>
                  {{ lotesSinVenta().length === 1 ? 'lote' : 'lotes' }} que todavía no
                  han vendido nada: cada uno dejaría una fila en $0 y no cambian el
                  total. Están abajo, agrupados.
                </p>
              }
            </mat-card>
          }

          <div class="lotes">
            @for (l of lotesConVenta(); track $index) {
              <ng-container *ngTemplateOutlet="tarjetaLote; context: { $implicit: l }" />
            }
          </div>

          <!-- ─────────────────────────── Los lotes que no han vendido nada.
               Es información útil (dice cuánta plata hay parada en bodega) pero es
               OTRA cosa que "cuánto dejó": mezclados, llenaban la lista de filas en
               $0. Van agrupados y plegados. -->
          @if (lotesSinVenta().length > 0) {
            <button class="grupo-sin-venta" type="button" (click)="alternarSinVenta()">
              <mat-icon>{{ verSinVenta() ? 'expand_less' : 'expand_more' }}</mat-icon>
              <span class="texto-grupo">
                <strong>
                  {{ lotesSinVenta().length }}
                  {{ lotesSinVenta().length === 1 ? 'lote' : 'lotes' }} sin vender
                  todavía
                </strong>
                <span class="detalle-grupo">
                  {{ kilosSinVenta() | cantidad: 'kg' }} en bodega ·
                  {{ costoSinVenta() | money }} invertidos. No dejaron utilidad
                  porque no ha salido nada, y eso <strong>no</strong> es pérdida.
                </span>
              </span>
            </button>

            @if (verSinVenta()) {
              <div class="lotes">
                @for (l of lotesSinVenta(); track $index) {
                  <ng-container *ngTemplateOutlet="tarjetaLote; context: { $implicit: l }" />
                }
              </div>
            }
          }
        }
      }

      <!-- La tarjeta de un lote. Va en una plantilla porque se pinta en dos
           listas (los que vendieron y los que no) y duplicarla sería garantizar
           que un día se arreglen distinto. -->
      <ng-template #tarjetaLote let-l>
        <mat-card class="lote" [class.abierto]="!l.vendido_completo">
          <div class="cabeza">
            <div class="identidad">
              <h3>
                {{ l.tipo_queso }} del {{ isoADate(l.fecha) | date: 'd \\'de\\' MMMM \\'de\\' y' }}
                @if (l.origen === 'existencia') {
                  <span class="chip existencia">Ya estaba en bodega</span>
                }
                @if (l.vendido_completo) {
                  <span class="chip cerrado">Vendido completo</span>
                } @else if (n(l.kilos_vendidos) > 0) {
                  <span class="chip abierto">Queda queso</span>
                } @else {
                  <span class="chip parado">Sin vender todavía</span>
                }
              </h3>
              @if (l.origen === 'existencia') {
                <!-- No tiene leche detrás, y decir "0 litros de leche" haría
                     creer que salió de la nada. Se dice de dónde vino. -->
                <p class="quienes">
                  {{ l.kilos_producidos | cantidad: 'kg' }} cargados a mano,
                  no salieron de una producción registrada
                  @if (l.referencia) {
                    · {{ l.referencia }}
                  }
                </p>
              } @else {
                <p class="quienes">
                  {{ l.litros_usados | cantidad: 'L' }} de leche →
                  {{ l.kilos_producidos | cantidad: 'kg' }} de queso
                  ({{ rendimientoTexto(l) }})
                  @if (n(l.merma) > 0) {
                    · merma {{ l.merma | cantidad: 'kg' }}
                  }
                </p>
              }
            </div>
            <div class="ganancia" [class.perdida]="n(l.utilidad) < 0"
                 [class.neutra]="n(l.kilos_vendidos) === 0 && n(l.kilos_de_baja) === 0">
              <span class="rotulo">
                @if (n(l.kilos_vendidos) === 0 && n(l.kilos_de_baja) === 0) {
                  Sin vender
                } @else {
                  {{ n(l.utilidad) < 0 ? 'Pérdida de lo vendido' : 'Utilidad de lo vendido' }}
                }
              </span>
              <span class="cifra">{{ absoluto(l.utilidad) | money }}</span>
              @if (n(l.kilos_vendidos) > 0) {
                <span class="detalle">
                  {{ utilidadPorKilo(l) | money }} por kilo vendido
                </span>
              } @else {
                <span class="detalle">todo el queso sigue en bodega</span>
              }
            </div>
          </div>

          <div class="cuerpo">
            <dl class="bloque">
              <h4>Lo que costó</h4>
              @if (l.origen === 'existencia') {
                <div>
                  <dt>Cargado a mano</dt>
                  <dd>{{ l.costo_total | money }}</dd>
                </div>
              } @else {
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
              }
              <div>
                <dt>Por kilo en la planta</dt>
                <dd>{{ l.costo_kilo | money }}</dd>
              </div>
              @if (n(l.gastos) > 0) {
                <!-- La cifra que pidió el usuario: lo que vale el kilo puesto
                     en Bogotá o donde se haya despachado. -->
                <div class="destacado">
                  <dt>Por kilo puesto allá</dt>
                  <dd>{{ l.costo_puesto_kilo | money }}</dd>
                </div>
              }
              @if (l.sin_costo) {
                <div class="ojo">
                  <dt>Sin costo cargado</dt>
                  <dd>ojo</dd>
                </div>
              }
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
              @if (n(l.gastos) > 0) {
                <div>
                  <dt>(−) Transporte del despacho</dt>
                  <dd>{{ l.gastos | money }}</dd>
                </div>
              }
              @if (n(l.costo_de_baja) > 0) {
                <!-- Lo que se dañó sí es pérdida de este lote: salió sin
                     dejar un peso. -->
                <div>
                  <dt>(−) Se dañó o se ajustó</dt>
                  <dd>{{ l.costo_de_baja | money }}</dd>
                </div>
              }
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
              @if (n(l.kilos_de_baja) > 0) {
                <div class="ojo">
                  <dt>Se dañó o se ajustó</dt>
                  <dd>{{ l.kilos_de_baja | cantidad: 'kg' }}</dd>
                </div>
              }
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
                @if (l.origen === 'existencia') {
                  <p class="vacio-tabla">
                    Este queso ya estaba en bodega y se cargó a mano, así que no
                    hay leche registrada detrás. Su costo es el que se cargó:
                    <strong>{{ l.costo_total | money }}</strong>
                    @if (l.sin_costo) {
                      — y quedó en cero, así que la utilidad de este lote sale
                      mejor de lo que es.
                    }
                  </p>
                } @else if (l.detalle_leche.length === 0) {
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
                        <th class="num">Transporte</th>
                        <th class="num">Puesto allá</th>
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
                          <td class="num">
                            {{ n(v.gasto) > 0 ? (v.gasto | money) : SIN_DATO }}
                          </td>
                          <td class="num">{{ v.costo_puesto_kilo | money }}</td>
                          <td class="num" [class.perdida]="n(v.utilidad) < 0">
                            {{ v.utilidad | money }}
                          </td>
                        </tr>
                      }
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colspan="2">Suma de las ventas</th>
                        <th class="num">{{ l.kilos_vendidos | cantidad: 'kg' }}</th>
                        <th></th>
                        <th class="num">{{ l.ingresos | money }}</th>
                        <th class="num">{{ l.costo_vendido | money }}</th>
                        <th class="num">
                          {{ n(l.gastos) > 0 ? (l.gastos | money) : SIN_DATO }}
                        </th>
                        <th class="num">{{ l.costo_puesto_kilo | money }}</th>
                        <th class="num" [class.perdida]="utilidadDeVentas(l) < 0">
                          {{ utilidadDeVentas(l) | money }}
                        </th>
                      </tr>
                      @if (n(l.costo_de_baja) > 0) {
                        <!-- Lo que se dañó NO sale en ninguna venta (no se
                             vendió), pero sí se le resta al lote. Sin estos dos
                             renglones las filas no sumarían el total y el
                             usuario lo notaría con la calculadora. -->
                        <tr class="ajuste">
                          <th colspan="8">(−) Se dañó o se ajustó</th>
                          <th class="num">-{{ l.costo_de_baja | money }}</th>
                        </tr>
                        <tr>
                          <th colspan="8">Utilidad del lote</th>
                          <th class="num" [class.perdida]="n(l.utilidad) < 0">
                            {{ l.utilidad | money }}
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
      </ng-template>
    </div>
  `,
  styles: `
    // ------------------------------------------------------ filtro de fechas
    .filtro {
      margin-bottom: 16px;
      padding: 16px;
    }
    .filtro h3,
    .comparacion h3 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .comparacion h3 { margin-bottom: 4px; font-size: 0.95rem; }
    .filtro p {
      margin: 4px 0 0;
      max-width: 56ch;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.86rem;
      line-height: 1.45;
    }
    .cabecera-filtro {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .rango { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rango .campo-rango { width: 280px; }
    .atajos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .atajos .atajo { font-size: 0.82rem; }
    // El puesto se marca con el color de la sección (Operación, morado): se ve
    // cuál está aplicado sin tener que leer las fechas.
    .atajos .atajo.puesto {
      background: color-mix(in srgb, var(--mat-sys-primary) 16%, transparent);
      font-weight: 600;
    }
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
    .error-rango { margin: 12px 0 0; color: var(--mat-sys-error); font-size: 0.86rem; }

    // Las tarjetas de una línea con icono: los avisos y la explicación larga.
    .aviso,
    .explicacion {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      margin-bottom: 12px;
      font-size: 0.9rem;
      line-height: 1.45;
    }
    .aviso mat-icon,
    .explicacion mat-icon { flex: none; }
    .aviso.malo { color: var(--mat-sys-error); }
    .aviso.ojo {
      color: #a06000;
      border: 1px solid color-mix(in srgb, #a06000 25%, transparent);
    }
    .aviso button { margin-left: auto; flex: none; }

    .explicacion {
      align-items: flex-start;
      background: color-mix(in srgb, var(--mat-sys-primary) 8%, var(--mat-sys-surface));
      font-size: 0.86rem;
      line-height: 1.5;
    }
    .explicacion mat-icon { color: var(--mat-sys-primary); }

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

    // ------------------------------------------------------------- resumen
    // La cifra grande a la izquierda y las dos cuentas que la explican a la
    // derecha: así se ve de dónde sale y qué suma con qué.
    .resumen {
      display: grid;
      grid-template-columns: minmax(200px, 260px) 1fr;
      gap: 12px;
      margin-bottom: 12px;
      align-items: stretch;
    }
    .total {
      display: flex;
      flex-direction: column;
      justify-content: center;
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
    // El rótulo de la cifra grande de arriba y el de la de cada lote son el
    // mismo elemento visual, así que van juntos.
    .total .rotulo,
    .ganancia .rotulo {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.85;
    }
    .total .cifra { font-size: 1.8rem; font-weight: 600; line-height: 1.15; }
    .total .detalle { font-size: 0.78rem; margin-top: 4px; }
    .total.principal .detalle { color: inherit; opacity: 0.8; }

    .cuentas {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      padding: 14px 16px;
    }
    .cuentas .bloque h4 {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    // La marca del encabezado de cada cuenta. "Del rango" y "foto de hoy" son
    // cosas distintas y por eso se marcan distinto: el queso en bodega es de HOY,
    // no del rango que se escogió, y confundirlos descuadra la lectura.
    .marca { font-size: 0.64rem; text-transform: none; }
    .enlace-cuenta {
      display: block;
      font-size: 0.72rem;
      font-style: italic;
      opacity: 0.85;
    }

    .supuesto {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 0 0 12px;
      font-size: 0.83rem;
      line-height: 1.5;
      color: var(--mat-sys-on-surface-variant);
    }

    .comparacion { padding: 16px; margin-bottom: 12px; }
    // Los renglones de letra chica y gris que acompañan a un bloque.
    .sub-comparacion,
    .nota-sin-venta,
    .pie-bloque,
    .grupo-sin-venta .detalle-grupo {
      font-size: 0.8rem;
      line-height: 1.45;
      color: var(--mat-sys-on-surface-variant);
    }
    .sub-comparacion { margin: 0 0 12px; }
    .nota-sin-venta { margin: 12px 0 0; }
    .pie-bloque { margin: 8px 0 0; font-size: 0.78rem; }
    .barras { display: flex; flex-direction: column; gap: 8px; }
    .barra-fila {
      display: grid;
      grid-template-columns: minmax(120px, 22%) 1fr minmax(96px, auto);
      align-items: center;
      gap: 10px;
    }
    .barra-fila .nombre { font-size: 0.86rem; white-space: nowrap; }
    // El tipo de queso y los kilos van bajo la fecha: sin esto, tres
    // producciones del mismo día se veían como tres filas repetidas.
    .barra-fila .sub-nombre {
      display: block;
      font-size: 0.72rem;
      color: var(--mat-sys-on-surface-variant);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .barra-fila .pista {
      height: 14px;
      border-radius: 7px;
      background: var(--mat-sys-surface-container-highest);
      overflow: hidden;
    }
    .barra-fila .pista.sin-pista { background: none; }
    .barra-fila .relleno {
      display: block;
      height: 100%;
      border-radius: 7px;
      background: var(--mat-sys-primary);
      // Un lote sin utilidad deja una raya visible: un ancho de 0 se lee como
      // "no hay dato" y no como "no dejó nada".
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
    .total-barras {
      margin-top: 4px;
      padding-top: 8px;
      border-top: 2px solid var(--mat-sys-outline-variant);
    }
    .total-barras .nombre { font-weight: 700; }
    .total-barras .valor { font-size: 1rem; }

    // Grupo de lotes que no han vendido nada. Borde punteado a propósito: no es
    // una tarjeta más, es una gaveta con lo que todavía no tiene resultado.
    // (lo demás lo hereda del grupo de cajitas grises, más abajo)
    .grupo-sin-venta {
      width: 100%;
      margin: 12px 0;
      border: 1px dashed var(--mat-sys-outline-variant);
      font-family: inherit;
    }
    .grupo-sin-venta:hover { background: var(--mat-sys-surface-container-high); }
    .grupo-sin-venta mat-icon { color: var(--mat-sys-primary); }
    .grupo-sin-venta strong { color: var(--mat-sys-on-surface); }
    .grupo-sin-venta .texto-grupo { display: flex; flex-direction: column; gap: 2px; }

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
    // Los chips del lote y las marcas de las cuentas son la misma pastilla.
    .chip,
    .marca {
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
    .chip.abierto,
    .marca.periodo {
      background: color-mix(in srgb, var(--mat-sys-primary) 16%, transparent);
      color: var(--mat-sys-primary);
    }
    // Gris a propósito: ni haber vendido todavía, ni ser una foto de hoy, es
    // bueno ni malo.
    .chip.parado,
    .chip.existencia,
    .marca.hoy {
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant);
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
    // Un lote sin vender no dejó $0 "de utilidad": todavía no dejó nada. En
    // morado se leería como un resultado, y en rojo como una pérdida.
    .ganancia.neutra {
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface-variant);
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
    .bloque h4,
    .detalle h4 {
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
    // El kilo puesto en destino es la cifra que se busca en este bloque.
    .bloque > div.destacado dd {
      color: var(--mat-sys-primary);
      font-weight: 700;
    }

    // Las cajitas grises de "icono + texto": lo que queda en bodega de un lote,
    // la leche que todavía no es queso, y la gaveta de los lotes sin vender.
    .pendiente,
    .aparte,
    .grupo-sin-venta {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 9px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low);
      font-size: 0.82rem;
      line-height: 1.45;
      color: var(--mat-sys-on-surface-variant);
      text-align: left;
    }
    .pendiente { margin: 14px 0 0; }
    .aparte { margin: 0 0 12px; }
    .grupo-sin-venta { padding: 12px 14px; border-radius: 12px; cursor: pointer; }
    .pendiente mat-icon,
    .aparte mat-icon,
    .supuesto mat-icon,
    .grupo-sin-venta mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }

    // Los dos botones de "desplegar": el del detalle de un lote y el de las
    // explicaciones largas. Van juntos para que no se arreglen distinto.
    .ver-detalle,
    .ver-explicacion {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px 6px 6px;
      border: 0;
      border-radius: 8px;
      background: none;
      color: var(--mat-sys-primary);
      font: inherit;
      font-size: 0.85rem;
      font-weight: 500;
      text-align: left;
      cursor: pointer;
    }
    .ver-detalle { margin: 12px 0 0; }
    .ver-explicacion { margin: 0 0 12px; }
    .ver-detalle:hover,
    .ver-explicacion:hover { background: var(--mat-sys-surface-container-high); }
    .ver-detalle mat-icon,
    .ver-explicacion mat-icon { font-size: 20px; width: 20px; height: 20px; flex: none; }
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
    // Las tablas se desplazan DENTRO de su caja: con siete columnas de plata no
    // caben en una tablet, y sin esto la página entera se movería de lado.
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
    .tabla tfoot .ajuste th {
      border-top: 0;
      font-weight: 500;
      color: var(--mat-sys-on-surface-variant);
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

    @media (max-width: 1100px) {
      .resumen { grid-template-columns: 1fr; }
    }
    @media (max-width: 980px) {
      .cuerpo { grid-template-columns: 1fr 1fr; }
      .cuentas { grid-template-columns: 1fr; gap: 14px; }
    }
    @media (max-width: 640px) {
      .cuerpo { grid-template-columns: 1fr; gap: 14px; }
      .cabeza { flex-direction: column; }
      .ganancia { align-self: stretch; text-align: left; }
      .barra-fila { grid-template-columns: 1fr minmax(96px, auto); }
      .barra-fila .pista { grid-column: 1 / -1; grid-row: 2; }
      .rango .campo-rango { width: 100%; }
    }
  `,
})
export class ProduccionLotesPage implements OnInit {
  private readonly servicio = inject(ProduccionService);

  readonly panel = signal<LotesProduccionPanel | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  readonly n = n;
  readonly ATAJOS = ATAJOS;

  // ——— El rango de fechas ———
  // Arranca sin rango (toda la historia), que es lo que esta pantalla mostraba
  // antes: si al entrar apareciera recortada, el dueño creería que se perdió algo.
  readonly desde = signal<Date | null>(null);
  readonly hasta = signal<Date | null>(null);
  /** Cuál de los atajos está puesto, para marcarlo. Vacío si escogió a mano. */
  readonly atajo = signal<string>('Todo');
  readonly errorRango = signal<string | null>(null);

  readonly hayFiltro = computed(() => this.desde() !== null && this.hasta() !== null);

  /**
   * Los días en que se HIZO queso, para marcarlos con un punto en el calendario:
   * así se ve de un vistazo qué días hay algo que mirar en vez de ir probando
   * fechas a ciegas.
   *
   * Solo se refresca cuando la consulta viene SIN filtro. Si se tomara del panel
   * ya filtrado, al escoger un mes el calendario dejaría de marcar los demás meses
   * y justo dejaría de servir para lo único que sirve.
   */
  private readonly diasConProduccion = signal<ReadonlySet<string>>(new Set());

  /**
   * Campo y no método: el calendario guarda la referencia, y un método suelto
   * perdería el `this` al llamarlo desde dentro del componente de Material.
   */
  readonly claseDia = (d: Date): string =>
    this.diasConProduccion().has(dateToIso(d)) ? 'dia-con-entrada' : '';

  /**
   * Los lotes que ya vendieron algo (o que tuvieron una baja): son los únicos que
   * tienen un resultado que mirar. Los demás salían como filas en $0 que llenaban
   * la lista sin aportar.
   */
  readonly lotesConVenta = computed(() =>
    (this.panel()?.lotes ?? []).filter(
      (l) => n(l.kilos_vendidos) > 0 || n(l.kilos_de_baja) > 0,
    ),
  );

  /** Los que todavía no han vendido nada: su queso está entero en bodega. */
  readonly lotesSinVenta = computed(() =>
    (this.panel()?.lotes ?? []).filter(
      (l) => n(l.kilos_vendidos) === 0 && n(l.kilos_de_baja) === 0,
    ),
  );

  readonly kilosSinVenta = computed(() =>
    this.lotesSinVenta().reduce((s, l) => s + n(l.kilos_en_bodega), 0),
  );
  readonly costoSinVenta = computed(() =>
    this.lotesSinVenta().reduce((s, l) => s + n(l.costo_en_bodega), 0),
  );

  /**
   * El total de la lista de barras. Es la suma de las filas que se ven, no el
   * total del panel: el dueño suma esa columna a mano y las dos cifras tienen que
   * dar lo mismo. Cuadran porque los lotes que se dejaron fuera no han vendido
   * nada y su utilidad es exactamente cero.
   */
  readonly sumaUtilidades = computed(() =>
    this.lotesConVenta().reduce((s, l) => s + n(l.utilidad), 0),
  );

  /**
   * Las barras van de la más VIEJA a la más nueva, al contrario que las tarjetas:
   * comparar en el tiempo se lee de izquierda a derecha, pero al buscar un lote lo
   * primero que se busca es el último que se hizo.
   */
  readonly lotesConVentaPorFecha = computed(() =>
    [...this.lotesConVenta()].sort((a, b) => a.fecha.localeCompare(b.fecha)),
  );

  private readonly escala = computed(() => {
    const valores = this.lotesConVenta().map((l) => Math.abs(n(l.utilidad)));
    return Math.max(...valores, 0);
  });

  /**
   * Qué lotes tienen el detalle desplegado.
   *
   * Se guarda el LOTE mismo y no una clave armada con sus datos. Antes la clave
   * era fecha + tipo de queso, y eso se rompe justo en el caso que el dueño
   * reportó: el 19 de julio se hicieron DOS tandas de queso campesino, son dos
   * lotes distintos con la misma fecha y el mismo tipo, y al abrir el detalle de
   * uno se abrían los dos. Los objetos sí son distintos.
   *
   * Al recargar el panel el conjunto queda con objetos viejos y todo se cierra,
   * que es lo que se espera cuando la lista cambió.
   */
  private readonly desplegados = signal<ReadonlySet<LoteProduccion>>(new Set());

  /** Si están abiertas las dos explicaciones largas y el grupo de los sin vender. */
  readonly explicacion = signal(false);
  readonly verSinVenta = signal(false);

  ngOnInit(): void {
    this.cargar();
  }

  fijarDesde(valor: Date | null): void {
    this.desde.set(valor);
    // No se consulta todavía: falta el segundo día del rango.
    this.atajo.set('');
  }

  fijarHasta(valor: Date | null): void {
    this.hasta.set(valor);
    this.atajo.set('');
    // Al marcar el segundo día la consulta se rehace sola, sin botón "Calcular".
    this.cargar();
  }

  usarAtajo(a: Atajo): void {
    const rango = a.rango();
    this.desde.set(rango ? rango[0] : null);
    this.hasta.set(rango ? rango[1] : null);
    this.atajo.set(a.texto);
    this.cargar();
  }

  alternarExplicacion(): void {
    this.explicacion.set(!this.explicacion());
  }

  alternarSinVenta(): void {
    this.verSinVenta.set(!this.verSinVenta());
  }

  cargar(): void {
    // `dateToIso` arma la fecha con los componentes LOCALES. Con toISOString() se
    // pasaría a UTC y en Colombia (UTC-5) devolvería el día ANTERIOR a cualquier
    // hora antes de las 7 p.m.: un lote del 25 se consultaría como del 24.
    const desde = dateToIso(this.desde());
    const hasta = dateToIso(this.hasta());

    // Rango a medias (marcó el primer día y falta el último): no se consulta, se
    // espera. Consultar con una sola fecha traería medio rango sin que lo pidan.
    if ((desde === null) !== (hasta === null)) {
      this.errorRango.set(null);
      return;
    }
    if (desde && hasta && hasta < desde) {
      this.errorRango.set('La fecha final no puede ser anterior a la inicial.');
      return;
    }

    this.errorRango.set(null);
    this.cargando.set(true);
    this.error.set(null);
    // El filtro recorta lo que se MUESTRA y se SUMA, no el cálculo: el reparto de
    // lo más viejo primero necesita toda la historia para saber qué había en
    // bodega, y de eso se encarga el backend.
    this.servicio.lotes(desde, hasta).subscribe({
      next: (p) => {
        this.panel.set(p);
        if (desde === null && hasta === null) {
          this.diasConProduccion.set(new Set(p.lotes.map((l) => l.fecha)));
        }
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
   * La suma de lo que dejaron las VENTAS del lote. No es la utilidad del lote
   * cuando hubo baja: lo que se dañó no sale en ninguna venta porque no se vendió,
   * pero sí se le resta. Se calcula aparte para que el pie de la tabla sume
   * exactamente las filas de arriba, y la baja se muestre como un renglón propio
   * que lleva de una cifra a la otra.
   */
  utilidadDeVentas(l: LoteProduccion): number {
    return n(l.ingresos) - n(l.costo_vendido) - n(l.gastos);
  }

  /** Guion para las celdas sin dato, como constante para no meterlo en la plantilla. */
  readonly SIN_DATO = '—';

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

  abierto(l: LoteProduccion): boolean {
    return this.desplegados().has(l);
  }

  alternar(l: LoteProduccion): void {
    const copia = new Set(this.desplegados());
    if (!copia.delete(l)) copia.add(l);
    this.desplegados.set(copia);
  }
}
