import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Monto } from '../../core/models';
import { compartirArchivo, compartirWhatsApp } from '../../shared/compartir';
import { detalleDeError } from '../../shared/errores-ui';
import { EstadoCuentaCompra, EstadoCuentaProductor, ReventaService } from './reventa.service';

/**
 * Formato de cifras del estado de cuenta. A propósito NO usa los pipes globales
 * de la app (| money redondea a pesos enteros y | cantidad a un decimal): este
 * diálogo es la vista previa del PDF y las dos cifras tienen que coincidir al
 * dígito. Replica las reglas de app/utils/export.py: miles con punto, centavos
 * solo cuando existen (y entonces siempre dos), y kilos hasta dos decimales sin
 * ceros de relleno.
 */
function formatearCifra(valor: Monto, minimo: number, maximo: number): string {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '—';
  const decimales = Number.isInteger(numero) ? 0 : maximo;
  return numero.toLocaleString('es-CO', {
    minimumFractionDigits: Number.isInteger(numero) ? 0 : minimo,
    maximumFractionDigits: decimales,
  });
}

export interface EstadoCuentaProductorDialogData {
  productor: string;
  /** Rango del filtro de la pantalla; si falta alguno, solo se ofrece el histórico. */
  desde: string | null;
  hasta: string | null;
}

/** Qué tanto cubre el estado de cuenta: todo lo que se le debe o solo el período filtrado. */
type Alcance = 'historico' | 'periodo';

/** Cómo va la cuenta con el productor (el signo va al revés que en la del cliente). */
type EstadoSaldo = 'por-pagar' | 'al-dia' | 'pagado-de-mas';

/**
 * Estado de cuenta de un productor: lo que se le compró, lo que se le pagó y lo
 * que se le debe, para entregárselo en PDF o mandárselo por WhatsApp y cuadrar
 * cuentas con él.
 *
 * OJO: este diálogo es la VISTA PREVIA de lo que va a ver EL PRODUCTOR, así que
 * NO muestra (ni debe mostrar) nada del otro lado del negocio: a qué precio se
 * revende su queso, el total de ventas, el margen, la ganancia, los gastos de
 * venta ni nombres de clientes. Tampoco los saldos del libro anterior de tipo
 * 'cobrar', que son deudas de CLIENTES con la quesera (el backend ya solo manda
 * los de tipo 'pagar').
 *
 * Y OJO CON LOS SIGNOS, que van al contrario del estado de cuenta del cliente:
 * aquí un saldo POSITIVO significa que LA QUESERA LE DEBE A ÉL. Por eso los
 * rótulos dicen de quién es el saldo, y no un "Saldo pendiente" que se leería
 * invertido.
 */
@Component({
  selector: 'app-reventa-estado-cuenta-productor',
  imports: [
    DatePipe, MatDialogModule, MatButtonModule, MatButtonToggleModule, MatIconModule,
    MatProgressBarModule, MatTooltipModule, HasPermissionDirective,
  ],
  template: `
    <h2 mat-dialog-title>Estado de cuenta del productor</h2>

    <mat-dialog-content>
      <p class="productor">{{ datos()?.productor || data.productor }}</p>

      @if (puedePeriodo()) {
        <mat-button-toggle-group
          class="alcance"
          hideSingleSelectionIndicator
          aria-label="Alcance del estado de cuenta"
          [value]="alcance()"
          (change)="cambiarAlcance($event.value)"
        >
          <mat-button-toggle
            value="historico"
            matTooltip="Todo lo que se le ha comprado y pagado al productor"
          >
            Todo el histórico
          </mat-button-toggle>
          <mat-button-toggle value="periodo" [matTooltip]="tooltipPeriodo()">
            Solo el período
          </mat-button-toggle>
        </mat-button-toggle-group>
      }

      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (error(); as mensaje) {
        <!-- role="alert": la caja se inserta después de cargar, así que sin esto
             un lector de pantalla no anuncia que la consulta falló. -->
        <div class="aviso" role="alert">
          <mat-icon aria-hidden="true">info</mat-icon>
          <span>{{ mensaje }}</span>
        </div>
      }

      @if (datos(); as ec) {
        <p class="periodo">
          @if (ec.desde && ec.hasta) {
            Período: {{ ec.desde | date: 'dd/MM/yyyy' }} al {{ ec.hasta | date: 'dd/MM/yyyy' }}
          } @else {
            Todo el histórico
          }
          · Emitido: {{ ec.emitido | date: 'dd/MM/yyyy' }}
        </p>

        <!-- Los rótulos llevan su OPERADOR, igual que el resumen del PDF: el
             productor reproduce la cuenta con la calculadora, así que tiene que
             estar escrito qué se suma y qué se resta para llegar a lo que se le
             debe. -->
        <div class="cifras">
          <div class="cifra">
            <span class="etq">Total comprado</span>
            <span class="val">{{ pesos(ec.total_comprado) }}</span>
            <span class="sub">{{ ec.compras }} {{ ec.compras === 1 ? 'compra' : 'compras' }}</span>
          </div>
          <div class="cifra">
            <span class="etq">(-) Total pagado</span>
            <span class="val">{{ pesos(ec.total_pagado) }}</span>
            <span class="sub">{{ ec.pagos.length }} {{ ec.pagos.length === 1 ? 'pago' : 'pagos' }}</span>
          </div>
          <!-- El renglón que explica de dónde sale el saldo: sin él la cifra
               grande no sale de las dos de al lado. Va en el mismo orden del PDF
               (antes del saldo) y con la misma condición que allá. -->
          @if (tieneSaldoAnterior()) {
            <div class="cifra">
              <span class="etq">(+) Saldo de la cuenta anterior</span>
              <span class="val">{{ pesos(ec.libro_anterior_saldo) }}</span>
              <span class="sub">
                {{ saldosAnteriores().length }}
                {{ saldosAnteriores().length === 1 ? 'cuenta del sistema anterior' : 'cuentas del sistema anterior' }}
              </span>
            </div>
          }
          <!-- Tres casos, igual que en el PDF: se le debe, está al día, o se le
               pagó de más y la diferencia queda a favor de la quesera (ahí el
               valor se muestra en POSITIVO). -->
          <div class="cifra">
            <span class="etq">{{ rotuloSaldo() }}</span>
            <span
              class="val"
              [class.al-dia]="estadoSaldo() !== 'por-pagar'"
              [class.con-saldo]="estadoSaldo() === 'por-pagar'"
            >
              {{ pesos(saldoMostrado()) }}
            </span>
            <span class="sub">{{ notaSaldo() }}</span>
          </div>
        </div>

        <!-- Si se le pagó de más, la cifra destacada va en POSITIVO, así que aquí
             queda escrita la operación CON su signo, con el mismo texto del PDF.
             Sin esto, sumando los renglones a mano da el negativo contra un
             destacado en positivo y parece un error del documento. -->
        @if (explicacionPagadoDeMas(); as nota) {
          <p class="nota-tabla">{{ nota }}</p>
        }

        <h3>Detalle de compras</h3>
        @if (ec.compras_detalle.length > 0) {
          <div class="tabla-scroll">
            <table class="tabla-datos">
              <caption class="solo-lectores">
                Detalle de las compras que se le hicieron al productor
              </caption>
              <!-- Rótulos neutros SOLO si el productor entregó mozzarella, igual
                   que en el PDF: un "Kilos" encima de "12 barras" contradiría la
                   celda, pero cambiárselo a todos los productores de hoy sin
                   necesidad tampoco. -->
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">{{ hayBarras() ? 'Cantidad' : 'Kilos' }}</th>
                  <th scope="col">{{ hayBarras() ? 'Precio' : 'Precio/kg' }}</th>
                  <th scope="col">Total</th>
                  <th scope="col">Abonado</th>
                  <th scope="col">Saldo</th>
                </tr>
              </thead>
              <tbody>
                @for (compra of ec.compras_detalle; track $index) {
                  <tr>
                    <td>{{ compra.fecha | date: 'dd/MM/yyyy' }}</td>
                    <!-- Los kilos son los NETOS, los que se le pagan. La borona
                         que vino con los lotes va en la nota de abajo, no en una
                         columna, igual que en el PDF. Y cada fila lleva SU unidad:
                         el productor tiene que reconocer la entrega que él hizo. -->
                    <td>{{ cantidadCompra(compra) }}</td>
                    <td>{{ pesos(compra.unidad === 'barra' ? compra.precio_barra : compra.precio_kilo) }}</td>
                    <td>{{ pesos(compra.valor_total) }}</td>
                    <td>{{ pesos(compra.abonado) }}</td>
                    <td>{{ pesos(compra.saldo) }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td>Totales</td>
                  <!-- Un subtotal por unidad, en renglones separados. Nunca una
                       casilla que sume kilos con barras. -->
                  <td>
                    @if (mostrarTotalKilos()) {
                      <span class="renglon">{{ kilos(ec.total_kilos) }}</span>
                    }
                    @if (hayBarras()) {
                      <span class="renglon">{{ barras(ec.total_barras) }}</span>
                    }
                  </td>
                  <td></td>
                  <td>{{ pesos(ec.total_comprado) }}</td>
                  <td>{{ pesos(ec.total_pagado) }}</td>
                  <!-- El saldo DEL SISTEMA, igual que el PDF: el saldo del
                       encabezado ya trae además lo del libro anterior y ponerlo
                       aquí haría que la columna no sumara sus filas. -->
                  <td>{{ pesos(saldoSistema()) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <!-- La borona es información suya y es honesto decirla: vino con sus
               lotes pero no se le paga. Va como nota, no como columna, para no
               ensanchar la tabla (mismo criterio del PDF). -->
          @if (notaBorona(); as nota) {
            <p class="nota-tabla">{{ nota }}</p>
          }
        } @else {
          <p class="sin-datos">Sin compras registradas</p>
        }

        <!-- Saldos de la cuenta anterior: lo que se le venía debiendo del sistema
             que se usaba antes (solo los de tipo 'pagar'). Si no hay, la sección
             no aparece y el diálogo queda igual que siempre (como en el PDF). -->
        @if (saldosAnteriores().length > 0) {
          <h3>Saldos de la cuenta anterior</h3>
          <div class="tabla-scroll">
            <table class="tabla-datos">
              <caption class="solo-lectores">
                Cuentas del sistema anterior que se le venían debiendo al productor
              </caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col" class="txt">Concepto</th>
                  <th scope="col">Total</th>
                  <th scope="col">Abonado</th>
                  <th scope="col">Saldo</th>
                </tr>
              </thead>
              <tbody>
                @for (anterior of saldosAnteriores(); track $index) {
                  <tr>
                    <td>{{ anterior.fecha | date: 'dd/MM/yyyy' }}</td>
                    <td class="txt concepto">{{ anterior.concepto }}</td>
                    <td>{{ pesos(anterior.valor_total) }}</td>
                    <td>{{ pesos(anterior.abonado) }}</td>
                    <td>{{ pesos(anterior.saldo) }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="2" class="txt">Totales</td>
                  <td>{{ pesos(ec.libro_anterior_total) }}</td>
                  <td>{{ pesos(ec.libro_anterior_abonado) }}</td>
                  <td>{{ pesos(ec.libro_anterior_saldo) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p class="nota-tabla">
            Estas cuentas vienen del sistema que se usaba antes y no corresponden a compras
            registradas aquí.
          </p>
        }

        <!-- Esta tabla lista SOLO los abonos de las compras de este sistema, igual
             que el PDF: los del libro anterior ya están cuadrados arriba, en la
             columna "Abonado" de su sección, y traerlos también aquí mostraría la
             misma plata dos veces. Lo que no puede hacer el texto es NEGARLE un
             pago que sí se le hizo, así que los tres casos y la nota son los
             mismos del estado de cuenta del cliente. -->
        <h3>Pagos realizados</h3>
        @if (ec.pagos.length > 0) {
          <div class="tabla-scroll">
            <table class="tabla-datos">
              <caption class="solo-lectores">Pagos realizados al productor</caption>
              <!-- Sin columna de observaciones: la nota del abono es interna de
                   la quesera y esta tabla es la vista previa de lo que ve el
                   productor, que debe coincidir exactamente con el PDF. -->
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Valor</th>
                </tr>
              </thead>
              <tbody>
                @for (pago of ec.pagos; track $index) {
                  <tr>
                    <td>{{ pago.fecha | date: 'dd/MM/yyyy' }}</td>
                    <td>{{ pesos(pago.valor) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (saldosAnteriores().length > 0) {
          <p class="sin-datos">Sin pagos por compras registradas en este sistema.</p>
        } @else {
          <p class="sin-datos">Sin pagos registrados</p>
        }
        @if (saldosAnteriores().length > 0) {
          <p class="nota-tabla">
            Los abonos que se le hicieron a las cuentas del sistema anterior están en la columna
            "Abonado" de la sección "Saldos de la cuenta anterior".
          </p>
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cerrar</button>

      <button
        mat-stroked-button
        *hasPermission="'reventa:imprimir'"
        matTooltip="Descargar el PDF para entregárselo al productor"
        [disabled]="!datos() || descargando()"
        (click)="descargarPdf()"
      >
        <mat-icon>picture_as_pdf</mat-icon> Descargar PDF
      </button>

      <button
        mat-stroked-button
        *hasPermission="'reventa:imprimir'"
        matTooltip="Compartir el PDF con el menú del dispositivo"
        [disabled]="!datos() || compartiendo()"
        (click)="compartir()"
      >
        <mat-icon>share</mat-icon> Compartir
      </button>

      <button
        mat-stroked-button
        *hasPermission="'reventa:imprimir'"
        matTooltip="Abre WhatsApp con el resumen en texto"
        [disabled]="!datos()"
        (click)="enviarWhatsApp()"
      >
        <mat-icon>chat</mat-icon> WhatsApp
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .productor {
      margin: 0 0 10px;
      font-size: 1.05rem;
      font-weight: 500;
    }

    .alcance {
      margin-bottom: 12px;
      --mat-standard-button-toggle-height: 34px;
    }

    .periodo {
      margin: 10px 0 4px;
      font-size: 0.78rem;
      color: var(--mat-sys-on-surface-variant);
    }

    h3 {
      margin: 18px 0 8px;
      font-size: 1rem;
      font-weight: 500;
    }

    // -------------------------------------------------------------- cifras
    .cifras {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-top: 8px;
    }

    .cifra {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 12px 14px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);

      .etq {
        font-size: 0.75rem;
        color: var(--mat-sys-on-surface-variant);
      }
      .val {
        font-size: 1.15rem;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .sub {
        font-size: 0.72rem;
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .val.al-dia { color: #2e7d32; }
    .val.con-saldo { color: #c62828; }

    // ------------------------------------------------------------- avisos
    .aviso {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 12px 0;
      padding: 12px 14px;
      border: 1px solid color-mix(in srgb, #b26a00 35%, transparent);
      border-radius: 12px;
      color: #b26a00;
    }

    .sin-datos {
      margin: 8px 0;
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
    }

    // Nota de una línea debajo de una tabla, con el mismo texto del PDF.
    .nota-tabla {
      margin: 6px 0 0;
      font-size: 0.76rem;
      color: var(--mat-sys-on-surface-variant);
    }

    // ------------------------------------------------------------- tablas
    // Scroll horizontal dentro del diálogo: en celular no desborda la pantalla.
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

      // La fecha y las columnas de texto van a la izquierda. En el detalle de
      // compras la segunda columna ya son kilos (no hay columna de producto),
      // así que el texto se marca con .txt en vez de por posición.
      th:first-child, td:first-child,
      th.txt, td.txt { text-align: left; }

      // El concepto del saldo viejo es texto libre y suele ser largo ("Compra 120
      // kg del 3 de mayo"): se envuelve dentro de la celda, como en el PDF, en
      // vez de estirar la tabla.
      td.concepto {
        white-space: normal;
        min-width: 160px;
        font-variant-numeric: normal;
      }

      tfoot td {
        border-top: 1px solid var(--mat-sys-outline);
        border-bottom: none;
        font-weight: 600;
      }

      // Los subtotales de cantidad, uno por unidad y en renglones separados (igual
      // que en el PDF). Pegados en la misma linea se leerian como una suma.
      .renglon { display: block; }
    }

    :host-context(html.dark) {
      .val.al-dia { color: #81c784; }
      .val.con-saldo { color: #e57373; }
      .aviso { color: #ffb74d; border-color: color-mix(in srgb, #ffb74d 35%, transparent); }
    }
  `,
})
export class ReventaEstadoCuentaProductorDialog {
  private readonly servicio = inject(ReventaService);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<EstadoCuentaProductorDialogData>(MAT_DIALOG_DATA);

  readonly datos = signal<EstadoCuentaProductor | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly descargando = signal(false);
  readonly compartiendo = signal(false);
  /** Por defecto lo que de verdad se le debe al productor: todo el histórico. */
  readonly alcance = signal<Alcance>('historico');

  /** Solo se puede acotar al período si la pantalla tiene las dos fechas. */
  readonly puedePeriodo = computed(() => !!(this.data.desde && this.data.hasta));

  /**
   * Cómo está la cuenta. Son TRES casos, no dos: si a un productor se le pagó de
   * más (pasa al bajarle el precio a una compra ya pagada) el saldo queda
   * negativo, y mostrarle "Se le debe -$550.000" le dice lo contrario de la
   * realidad. Aquí un saldo POSITIVO es plata que la quesera le debe A ÉL.
   */
  readonly estadoSaldo = computed<EstadoSaldo>(() => {
    const saldo = Number(this.datos()?.saldo ?? 0);
    if (saldo > 0) return 'por-pagar';
    return saldo === 0 ? 'al-dia' : 'pagado-de-mas';
  });

  /** Lo que se le pagó de más se muestra en POSITIVO, igual que en el PDF. */
  readonly saldoMostrado = computed(() => Math.abs(Number(this.datos()?.saldo ?? 0)));

  /**
   * Lo que se le debe SOLO por las compras hechas en este sistema. Es lo que
   * tiene que cerrar la columna "Saldo" del detalle de compras: `saldo` trae
   * además lo del libro anterior, y usarlo en esa fila de totales haría que la
   * tabla no sumara. Sin saldos anteriores las dos cifras son iguales.
   */
  readonly saldoSistema = computed(() => {
    const ec = this.datos();
    if (!ec) return 0;
    return Number(ec.total_comprado) - Number(ec.total_pagado);
  });

  /** Cuentas que se le venían debiendo del sistema anterior (vacío para casi todos). */
  readonly saldosAnteriores = computed(() => this.datos()?.saldos_anteriores ?? []);

  /**
   * Si el resumen lleva el renglón del libro anterior. La condición es la MISMA
   * del PDF: que el productor traiga cuentas del sistema anterior, no que el
   * saldo de esas cuentas sea distinto de cero. Una cuenta vieja ya pagada por
   * completo sale en la tabla y el PDF le imprime su renglón en $0; esconderlo
   * aquí dejaría la vista previa con un renglón menos que el documento.
   */
  readonly tieneSaldoAnterior = computed(() => this.saldosAnteriores().length > 0);

  /**
   * Kilos de borona que vinieron con sus lotes. No se le pagan (por eso no entran
   * en los kilos netos ni en el total), pero son información suya y el PDF los
   * dice en una nota al pie de la tabla.
   */
  readonly boronaKilos = computed(() =>
    (this.datos()?.compras_detalle ?? []).reduce(
      (suma, compra) => suma + Number(compra.borona_kilos ?? 0),
      0,
    ),
  );

  /** La nota de la borona, con el mismo texto del PDF. Null si no vino ninguna. */
  readonly notaBorona = computed<string | null>(() => {
    const borona = this.boronaKilos();
    if (!(borona > 0)) return null;
    return (
      `Con los lotes vinieron además ${this.kilos(borona)} de borona, que no se pagan ` +
      'y por eso no suman en el total.'
    );
  });

  /**
   * Pesos con el mismo formato que el PDF: $1.008.175,85 y $100.000.
   *
   * El signo va ANTES del $, como en `pesos()` de export.py ("-$550.000"): con
   * "$ -550.000" la vista previa y el PDF no escribían igual la cifra.
   */
  pesos(valor: Monto): string {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return '—';
    return `${numero < 0 ? '-' : ''}$ ${formatearCifra(Math.abs(numero), 2, 2)}`;
  }

  /** Kilos con el mismo formato que el PDF: 10,34 kg, 51,7 kg y 100 kg. */
  kilos(valor: Monto): string {
    return `${formatearCifra(valor, 1, 2)} kg`;
  }

  /**
   * Barras con el mismo formato que el PDF: "12 barras", "1 barra". Sin decimales
   * y pluralizado, por lo mismo que en el documento del cliente.
   */
  barras(valor: Monto): string {
    const numero = Math.round(Number(valor) || 0);
    return `${formatearCifra(numero, 0, 0)} ${Math.abs(numero) === 1 ? 'barra' : 'barras'}`;
  }

  /** ¿El productor entregó mozzarella? Decide los rótulos y el subtotal de barras. */
  readonly hayBarras = computed(() => {
    const ec = this.datos();
    if (!ec) return false;
    return (
      Number(ec.total_barras) > 0 || ec.compras_detalle.some((c) => c.unidad === 'barra')
    );
  });

  /**
   * El subtotal de kilos se muestra si hay kilos, o si no hay barras (para que un
   * productor de puro queso siga viendo lo de siempre). En uno de pura mozzarella
   * se calla: un "0 kg" al lado de "12 barras" se leería como peso faltante.
   */
  readonly mostrarTotalKilos = computed(() => {
    const ec = this.datos();
    if (!ec) return true;
    return Number(ec.total_kilos) > 0 || !this.hayBarras();
  });

  /** La cantidad de una compra, en su unidad. La unidad la manda el backend. */
  cantidadCompra(compra: EstadoCuentaCompra): string {
    return compra.unidad === 'barra' ? this.barras(compra.barras) : this.kilos(compra.kilos);
  }

  /**
   * Mismos rótulos del resumen del PDF (allá van en mayúsculas por el estilo).
   * Dicen DE QUIÉN es el saldo a propósito: un "Saldo pendiente" a secas se lee
   * como si el productor debiera, que es justo al contrario.
   */
  readonly rotuloSaldo = computed(() =>
    this.estadoSaldo() === 'pagado-de-mas'
      ? 'Pagado de más (a favor de la quesera)'
      : 'Saldo a favor del productor',
  );

  /** El "Estado" que imprime el PDF en el bloque de datos del productor. */
  readonly notaSaldo = computed(() => {
    switch (this.estadoSaldo()) {
      case 'por-pagar':
        return 'Con saldo a favor suyo';
      case 'al-dia':
        return 'Al día';
      default:
        return 'Se le pagó de más';
    }
  });

  /**
   * El mismo saldo, rotulado para el texto de WhatsApp. Ahí no hay tabla ni
   * contexto alrededor, así que se dice sin rodeos qué significa la cifra: el
   * productor tiene que poder sumar los renglones y saber si es plata que se le
   * debe o que se le pagó de más.
   */
  readonly rotuloSaldoWhatsApp = computed(() => {
    switch (this.estadoSaldo()) {
      case 'por-pagar':
        return 'Saldo a favor del productor (se le debe)';
      case 'al-dia':
        return 'Saldo a favor del productor (está al día)';
      default:
        return 'Pagado de más (queda a favor de la quesera)';
    }
  });

  /**
   * La operación escrita cuando se le pagó de más, con el MISMO texto del PDF.
   * Null en el caso normal (se le debe o está al día), igual que allá.
   */
  readonly explicacionPagadoDeMas = computed<string | null>(() => {
    const ec = this.datos();
    if (!ec || Number(ec.saldo) >= 0) return null;
    let operacion = `${this.pesos(ec.total_comprado)} - ${this.pesos(ec.total_pagado)}`;
    if (this.tieneSaldoAnterior()) {
      operacion += ` + ${this.pesos(ec.libro_anterior_saldo)}`;
    }
    return (
      `La cuenta da ${operacion} = ${this.pesos(ec.saldo)}, es decir que se le pagaron ` +
      `${this.pesos(this.saldoMostrado())} más de lo que valen sus compras: por eso arriba ` +
      'aparece en positivo a favor de la quesera.'
    );
  });

  readonly tooltipPeriodo = computed(
    () => `Solo del ${this.fechaCorta(this.data.desde)} al ${this.fechaCorta(this.data.hasta)}`,
  );

  /** Contador de peticiones: si el alcance cambia dos veces, la primera respuesta no pisa la última. */
  private peticion = 0;

  constructor() {
    void this.cargar();
  }

  cambiarAlcance(valor: Alcance): void {
    if (valor === this.alcance()) return;
    this.alcance.set(valor);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const mia = ++this.peticion;
    this.cargando.set(true);
    this.error.set(null);
    try {
      const { desde, hasta } = this.rango();
      const ec = await firstValueFrom(
        this.servicio.estadoCuentaProductor(this.data.productor, desde, hasta),
      );
      if (mia !== this.peticion) return;
      this.datos.set(ec);
    } catch (err) {
      if (mia !== this.peticion) return;
      this.datos.set(null);
      this.error.set(this.mensajeError(err));
    } finally {
      if (mia === this.peticion) this.cargando.set(false);
    }
  }

  async descargarPdf(): Promise<void> {
    const { desde, hasta } = this.rango();
    this.descargando.set(true);
    try {
      // El nombre de respaldo lleva el del productor: si la cabecera
      // Content-Disposition no llega (cross-origin sin expose_headers, un proxy
      // que la filtre), el archivo NO puede quedar como "estado_cuenta_productor.pdf"
      // para todos: es la forma fácil de entregarle a uno la cuenta de otro.
      const nombre = this.nombreArchivo(this.datos()?.productor ?? this.data.productor);
      await firstValueFrom(
        this.servicio.descargarEstadoCuentaProductor(this.data.productor, desde, hasta, nombre),
      );
    } catch (err) {
      // Con `catch {` se perdía el mensaje que el interceptor sí había generado
      // ("Sin conexión…", "El servidor tardó demasiado…").
      this.snackbar.open(detalleDeError(err, 'No fue posible descargar el PDF'), 'OK', {
        duration: 5000,
      });
    } finally {
      this.descargando.set(false);
    }
  }

  async compartir(): Promise<void> {
    const productor = this.datos()?.productor ?? this.data.productor;
    const { desde, hasta } = this.rango();
    this.compartiendo.set(true);
    try {
      const blob = await firstValueFrom(
        this.servicio.estadoCuentaProductorPdfBlob(this.data.productor, desde, hasta),
      );
      const resultado = await compartirArchivo(
        blob,
        this.nombreArchivo(productor),
        `Estado de cuenta de ${productor}`,
        `Estado de cuenta de ${productor}`,
      );
      if (resultado === 'descargado') {
        this.snackbar.open(
          'Tu dispositivo no permite compartir directamente; se descargó el PDF',
          'OK',
          { duration: 4000 },
        );
      }
    } catch (err) {
      this.snackbar.open(
        detalleDeError(err, 'No fue posible compartir el estado de cuenta'),
        'OK',
        { duration: 5000 },
      );
    } finally {
      this.compartiendo.set(false);
    }
  }

  /** Abre WhatsApp con un resumen corto en texto (el PDF va por "Compartir"). */
  enviarWhatsApp(): void {
    const ec = this.datos();
    if (!ec) return;
    const money = (valor: unknown) => this.pesos(valor as Monto);
    const periodo =
      ec.desde && ec.hasta
        ? `${this.fechaCorta(ec.desde)} al ${this.fechaCorta(ec.hasta)}`
        : 'todo el histórico';
    // El renglón del libro anterior va ANTES del saldo, con el mismo rótulo y el
    // mismo operador del resumen del PDF: sin él el productor resta Comprado −
    // Pagado y le falta plata sin explicación. Este mensaje va AL PRODUCTOR, así
    // que los renglones tienen que SUMAR la cifra que se le debe.
    const anterior = this.tieneSaldoAnterior()
      ? `(+) Saldo de la cuenta anterior: ${money(ec.libro_anterior_saldo)}\n`
      : '';
    // Si se le pagó de más va además la operación con su signo, la misma frase
    // del PDF: la cifra de abajo se muestra en positivo y sin esta línea el
    // productor suma los renglones y le sale al revés.
    const explicacion = this.explicacionPagadoDeMas();
    const texto =
      `*Estado de cuenta - ${ec.productor}*\n` +
      `Período: ${periodo}\n` +
      `Compras: ${ec.compras} · Total comprado: ${money(ec.total_comprado)}\n` +
      `(-) Total pagado: ${money(ec.total_pagado)}\n` +
      anterior +
      `${this.rotuloSaldoWhatsApp()}: ${money(this.saldoMostrado())}` +
      (explicacion ? `\n${explicacion}` : '');
    compartirWhatsApp(texto);
  }

  /** Rango que se le pide al backend según el alcance elegido. */
  private rango(): { desde: string | null; hasta: string | null } {
    if (this.alcance() === 'periodo' && this.puedePeriodo()) {
      return { desde: this.data.desde, hasta: this.data.hasta };
    }
    return { desde: null, hasta: null };
  }

  /** Fecha ISO (YYYY-MM-DD) a dd/mm/aaaa, sin depender de la zona horaria. */
  private fechaCorta(iso: string | null): string {
    if (!iso) return '—';
    return iso.slice(0, 10).split('-').reverse().join('/');
  }

  /** Nombre del PDF: espacios a guion bajo y sin caracteres raros. */
  private nombreArchivo(productor: string): string {
    const limpio = productor.trim().replace(/\s+/g, '_').replace(/[^\w-]/g, '');
    return `estado_cuenta_productor_${limpio || 'productor'}.pdf`;
  }

  private mensajeError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404) {
        // Un productor sin compras pero con saldo del libro anterior SÍ tiene
        // estado de cuenta, así que el respaldo no puede hablar solo de compras.
        return (
          err.error?.error?.detail ??
          'El productor no tiene compras ni cuentas del libro anterior registradas'
        );
      }
      if (err.status === 0) {
        // El detalle del interceptor va primero: distingue "sin señal" de "se
        // perdió la conexión a mitad", que no son lo mismo.
        return (
          err.error?.error?.detail ??
          'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.'
        );
      }
      return err.error?.error?.detail ?? 'No fue posible cargar el estado de cuenta';
    }
    return 'No fue posible cargar el estado de cuenta';
  }
}
