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
import { LoteResumen, LotesPanel, ReventaService } from './reventa.service';

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
    MatTooltipModule, PageHeader, MoneyPipe, CantidadPipe,
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

  ngOnInit(): void {
    this.cargar();
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

  anchoBarra(l: LoteResumen): number {
    const escala = this.escala();
    if (escala <= 0) return 0;
    return (Math.abs(n(l.ganancia)) / escala) * 100;
  }
}
