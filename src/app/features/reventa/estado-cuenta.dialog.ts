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
import { EstadoCuentaCliente, EstadoCuentaVenta, ReventaService } from './reventa.service';

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

export interface EstadoCuentaDialogData {
  cliente: string;
  /** Rango del filtro de la pantalla; si falta alguno, solo se ofrece el histórico. */
  desde: string | null;
  hasta: string | null;
}

/** Qué tanto cubre el estado de cuenta: todo lo que debe o solo el período filtrado. */
type Alcance = 'historico' | 'periodo';

/**
 * Estado de cuenta de un cliente: sus compras, sus pagos y el saldo, para
 * mandárselo por WhatsApp o entregárselo en PDF.
 *
 * OJO: este diálogo es la VISTA PREVIA de lo que va a ver EL CLIENTE, así que
 * NO muestra (ni debe mostrar) datos internos de la quesera: gastos de la venta,
 * venta libre, costos de compra, margen, ganancia ni nada del módulo de compras.
 */
@Component({
  selector: 'app-reventa-estado-cuenta',
  imports: [
    DatePipe, MatDialogModule, MatButtonModule, MatButtonToggleModule, MatIconModule,
    MatProgressBarModule, MatTooltipModule, HasPermissionDirective,
  ],
  template: `
    <h2 mat-dialog-title>Estado de cuenta</h2>

    <mat-dialog-content>
      <p class="cliente">{{ datos()?.cliente || data.cliente }}</p>

      @if (puedePeriodo()) {
        <mat-button-toggle-group
          class="alcance"
          hideSingleSelectionIndicator
          aria-label="Alcance del estado de cuenta"
          [value]="alcance()"
          (change)="cambiarAlcance($event.value)"
        >
          <mat-button-toggle value="historico" matTooltip="Todo lo que el cliente ha comprado y pagado">
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

        <!-- Los rótulos llevan su OPERADOR, igual que el resumen del PDF: sin él,
             un cliente con saldo a favor y cuentas del libro sumaba las cuatro
             tarjetas y le salía el signo contrario a la cifra destacada. El
             cliente reproduce la cuenta con la calculadora, así que tiene que
             estar escrito qué se suma y qué se resta. -->
        <div class="cifras">
          <div class="cifra">
            <span class="etq">Total facturado</span>
            <span class="val">{{ pesos(ec.total_facturado) }}</span>
            <span class="sub">{{ ec.compras }} {{ ec.compras === 1 ? 'compra' : 'compras' }}</span>
          </div>
          <div class="cifra">
            <span class="etq">(-) Total abonado</span>
            <span class="val">{{ pesos(ec.total_abonado) }}</span>
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
          <!-- Tres casos, igual que en el PDF: debe, está al día, o abonó de más
               y tiene plata a favor (ahí el valor se muestra en POSITIVO). -->
          <div class="cifra">
            <span class="etq">{{ rotuloSaldo() }}</span>
            <span
              class="val"
              [class.al-dia]="estadoSaldo() !== 'pendiente'"
              [class.con-saldo]="estadoSaldo() === 'pendiente'"
            >
              {{ pesos(saldoMostrado()) }}
            </span>
            <span class="sub">{{ notaSaldo() }}</span>
          </div>
        </div>

        <!-- Saldo a favor: la cifra destacada va en POSITIVO, así que aquí queda
             escrita la operación CON su signo, con el mismo texto del PDF. Sin
             esto, sumando los renglones a mano daba -$1.500.000 contra un
             destacado de $1.500.000 y parecía un error del documento. -->
        @if (explicacionSaldoAFavor(); as nota) {
          <p class="nota-tabla">{{ nota }}</p>
        }

        <h3>Detalle de compras</h3>
        @if (ec.ventas.length > 0) {
          <div class="tabla-scroll">
            <table class="tabla-datos">
              <caption class="solo-lectores">Detalle de las compras del cliente</caption>
              <thead>
                <!-- Los rótulos de cantidad y precio cambian a neutros SOLO si el
                     cliente tiene mozzarella, igual que en el PDF: un "Kilos" encima
                     de "8 barras" contradiría la celda, pero poner "Cantidad" siempre
                     le cambiaría la vista a todos los clientes de hoy sin necesidad. -->
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Producto</th>
                  <th scope="col">{{ hayBarras() ? 'Cantidad' : 'Kilos' }}</th>
                  <th scope="col">{{ hayBarras() ? 'Precio' : 'Precio/kg' }}</th>
                  <th scope="col">Total</th>
                  <th scope="col">Abonado</th>
                  <th scope="col">Saldo</th>
                </tr>
              </thead>
              <tbody>
                @for (venta of ec.ventas; track $index) {
                  <tr>
                    <td>{{ venta.fecha | date: 'dd/MM/yyyy' }}</td>
                    <!-- Solo el nombre del producto: el chip repetía la palabra
                         ("Borona  Borona") y el PDF muestra únicamente "Borona". -->
                    <td>{{ venta.producto }}</td>
                    <!-- Cada fila con SU unidad, la que manda el backend. Es lo que
                         el cliente reconoce de su propia entrega: "8 barras" y no
                         "0 kg" ni "8 kg". -->
                    <td>{{ cantidadVenta(venta) }}</td>
                    <td>{{ pesos(venta.unidad === 'barra' ? venta.precio_barra : venta.precio_kilo) }}</td>
                    <td>{{ pesos(venta.valor_total) }}</td>
                    <td>{{ pesos(venta.abonado) }}</td>
                    <td>{{ pesos(venta.saldo) }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="2">Totales</td>
                  <!-- Los dos subtotales en RENGLONES SEPARADOS, uno por unidad, y
                       solo el de la unidad que el cliente de verdad compró. No hay
                       una casilla que sume kilos con barras porque esa cifra no
                       significaría nada. -->
                  <td>
                    @if (mostrarTotalKilos()) {
                      <span class="renglon">{{ kilos(ec.total_kilos) }}</span>
                    }
                    @if (hayBarras()) {
                      <span class="renglon">{{ barras(ec.total_barras) }}</span>
                    }
                  </td>
                  <td></td>
                  <td>{{ pesos(ec.total_facturado) }}</td>
                  <td>{{ pesos(ec.total_abonado) }}</td>
                  <!-- El saldo DEL SISTEMA, igual que el PDF: el saldo del
                       encabezado ya trae además la deuda del libro anterior y
                       ponerlo aquí haría que la columna no sumara sus filas. -->
                  <td>{{ pesos(saldoSistema()) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        } @else {
          <p class="sin-datos">Sin compras registradas</p>
        }

        <!-- Saldos de la cuenta anterior: lo que el cliente ya venía debiendo del
             sistema que se usaba antes. Si no hay, la sección no aparece y el
             diálogo queda exactamente igual que siempre (como en el PDF). -->
        @if (saldosAnteriores().length > 0) {
          <h3>Saldos de la cuenta anterior</h3>
          <div class="tabla-scroll">
            <table class="tabla-datos">
              <caption class="solo-lectores">
                Cuentas del sistema anterior que el cliente traía a medio pagar
              </caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Concepto</th>
                  <th scope="col">Total</th>
                  <th scope="col">Abonado</th>
                  <th scope="col">Saldo</th>
                </tr>
              </thead>
              <tbody>
                @for (anterior of saldosAnteriores(); track $index) {
                  <tr>
                    <td>{{ anterior.fecha | date: 'dd/MM/yyyy' }}</td>
                    <td class="concepto">{{ anterior.concepto }}</td>
                    <td>{{ pesos(anterior.valor_total) }}</td>
                    <td>{{ pesos(anterior.abonado) }}</td>
                    <td>{{ pesos(anterior.saldo) }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="2">Totales</td>
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
             pago que sí hizo, así que los tres casos y la nota son los mismos del
             PDF (ver "Pagos recibidos" en build_estado_cuenta_pdf). -->
        <h3>Pagos recibidos</h3>
        @if (ec.pagos.length > 0) {
          <div class="tabla-scroll">
            <table class="tabla-datos">
              <caption class="solo-lectores">Pagos recibidos del cliente</caption>
              <!-- Sin columna de observaciones: la nota del abono es interna de
                   la quesera y esta tabla es la vista previa de lo que ve el
                   cliente, que debe coincidir exactamente con el PDF. -->
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
          <p class="sin-datos">Sin pagos recibidos por compras registradas en este sistema.</p>
        } @else {
          <p class="sin-datos">Sin pagos registrados</p>
        }
        @if (saldosAnteriores().length > 0) {
          <p class="nota-tabla">
            Los abonos que hizo a las cuentas del sistema anterior están en la columna "Abonado"
            de la sección "Saldos de la cuenta anterior".
          </p>
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cerrar</button>

      <button
        mat-stroked-button
        *hasPermission="'reventa:imprimir'"
        matTooltip="Descargar el PDF para entregárselo al cliente"
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
    .cliente {
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

      // Las dos primeras columnas son texto (fecha y producto/concepto): van a
      // la izquierda.
      th:first-child, td:first-child,
      th:nth-child(2), td:nth-child(2) { text-align: left; }

      // El concepto del saldo viejo es texto libre y suele ser largo ("Venta 120
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
      // que en el PDF). Nunca en la misma línea: pegados se leerían como una suma.
      .renglon { display: block; }
    }

    :host-context(html.dark) {
      .val.al-dia { color: #81c784; }
      .val.con-saldo { color: #e57373; }
      .aviso { color: #ffb74d; border-color: color-mix(in srgb, #ffb74d 35%, transparent); }
    }
  `,
})
export class ReventaEstadoCuentaDialog {
  private readonly servicio = inject(ReventaService);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<EstadoCuentaDialogData>(MAT_DIALOG_DATA);

  readonly datos = signal<EstadoCuentaCliente | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly descargando = signal(false);
  readonly compartiendo = signal(false);
  /** Por defecto el saldo real del cliente: todo el histórico. */
  readonly alcance = signal<Alcance>('historico');

  /** Solo se puede acotar al período si la pantalla tiene las dos fechas. */
  readonly puedePeriodo = computed(() => !!(this.data.desde && this.data.hasta));

  /**
   * Cómo está la cuenta. Son TRES casos, no dos: si el cliente abonó de más
   * (pasa al bajarle el precio a una venta ya pagada) el saldo queda negativo, y
   * mostrarle "Saldo -$550.000 · Al día" le dice lo contrario de la realidad.
   */
  readonly estadoSaldo = computed<'pendiente' | 'al-dia' | 'a-favor'>(() => {
    const saldo = Number(this.datos()?.saldo ?? 0);
    if (saldo > 0) return 'pendiente';
    return saldo === 0 ? 'al-dia' : 'a-favor';
  });

  /** El saldo a favor se muestra en POSITIVO, igual que en el PDF. */
  readonly saldoMostrado = computed(() => Math.abs(Number(this.datos()?.saldo ?? 0)));

  /**
   * Lo que queda debiendo SOLO por las compras hechas en este sistema. Es lo que
   * tiene que cerrar la columna "Saldo" del detalle de compras: `saldo` trae
   * además la deuda del libro anterior, y usarlo en esa fila de totales haría que
   * la tabla no sumara. Sin saldos anteriores las dos cifras son iguales.
   */
  readonly saldoSistema = computed(() => {
    const ec = this.datos();
    if (!ec) return 0;
    return Number(ec.total_facturado) - Number(ec.total_abonado);
  });

  /** Cuentas que el cliente traía del sistema anterior (vacío para casi todos). */
  readonly saldosAnteriores = computed(() => this.datos()?.saldos_anteriores ?? []);

  /**
   * Si el resumen lleva el renglón del libro anterior. La condición es la MISMA
   * del PDF (`if saldos_anteriores` en build_estado_cuenta_pdf): que el cliente
   * traiga cuentas del sistema anterior, no que el saldo de esas cuentas sea
   * distinto de cero. Una cuenta vieja ya pagada por completo sale en la tabla y
   * el PDF le imprime su renglón en $0; esconderlo aquí dejaba la vista previa
   * con un renglón menos que el documento que recibe el cliente.
   */
  readonly tieneSaldoAnterior = computed(() => this.saldosAnteriores().length > 0);

  /**
   * Pesos con el mismo formato que el PDF: $1.008.175,85 y $100.000.
   *
   * El signo va ANTES del $, como en `pesos()` de export.py ("-$550.000"): con
   * "$ -550.000" la vista previa y el PDF no escribían igual el saldo a favor.
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
   * Barras con el mismo formato que el PDF: "8 barras", "1 barra". Sin decimales
   * (una barra es una barra) y pluralizado, porque esto lo lee el cliente y
   * "1 barras" se ve como un error del sistema.
   */
  barras(valor: Monto): string {
    const numero = Math.round(Number(valor) || 0);
    return `${formatearCifra(numero, 0, 0)} ${Math.abs(numero) === 1 ? 'barra' : 'barras'}`;
  }

  /** ¿El cliente compró mozzarella? Decide los rótulos y el subtotal de barras. */
  readonly hayBarras = computed(() => {
    const ec = this.datos();
    if (!ec) return false;
    return Number(ec.total_barras) > 0 || ec.ventas.some((v) => v.unidad === 'barra');
  });

  /**
   * El subtotal de kilos se muestra si hay kilos, o si NO hay barras (para que un
   * cliente de puro queso siga viendo "0 kg" como siempre en lugar de una celda
   * vacía). En un cliente de pura mozzarella se calla: un "0 kg" al lado de "8
   * barras" invita a leerlo como que le faltó peso.
   */
  readonly mostrarTotalKilos = computed(() => {
    const ec = this.datos();
    if (!ec) return true;
    return Number(ec.total_kilos) > 0 || !this.hayBarras();
  });

  /** La cantidad de una venta, en su unidad. La unidad la manda el backend. */
  cantidadVenta(venta: EstadoCuentaVenta): string {
    return venta.unidad === 'barra' ? this.barras(venta.barras) : this.kilos(venta.kilos);
  }

  /** Mismos rótulos del resumen del PDF (allá van en mayúsculas por el estilo). */
  readonly rotuloSaldo = computed(() =>
    this.estadoSaldo() === 'a-favor' ? 'Saldo a favor del cliente' : 'Saldo pendiente',
  );

  /** El "Estado" que imprime el PDF en el bloque de datos del cliente. */
  readonly notaSaldo = computed(() => {
    switch (this.estadoSaldo()) {
      case 'pendiente':
        return 'Con saldo';
      case 'al-dia':
        return 'Al día';
      default:
        return 'Saldo a favor';
    }
  });

  /**
   * La operación escrita cuando el saldo queda a favor del cliente, con el MISMO
   * texto del PDF. Null en el caso normal (con deuda o al día), igual que allá.
   */
  readonly explicacionSaldoAFavor = computed<string | null>(() => {
    const ec = this.datos();
    if (!ec || Number(ec.saldo) >= 0) return null;
    let operacion = `${this.pesos(ec.total_facturado)} - ${this.pesos(ec.total_abonado)}`;
    if (this.tieneSaldoAnterior()) {
      operacion += ` + ${this.pesos(ec.libro_anterior_saldo)}`;
    }
    return (
      `La cuenta da ${operacion} = ${this.pesos(ec.saldo)}, es decir que queda a ` +
      'favor suyo: por eso arriba aparece en positivo.'
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
      const ec = await firstValueFrom(this.servicio.estadoCuenta(this.data.cliente, desde, hasta));
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
      // El nombre de respaldo lleva el del cliente: si la cabecera
      // Content-Disposition no llega (cross-origin sin expose_headers, un proxy
      // que la filtre), el archivo NO puede quedar como "estado_cuenta.pdf" para
      // todos los clientes: es la forma fácil de mandarle a uno la cartera de otro.
      const nombre = this.nombreArchivo(this.datos()?.cliente ?? this.data.cliente);
      await firstValueFrom(
        this.servicio.descargarEstadoCuenta(this.data.cliente, desde, hasta, nombre),
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
    const cliente = this.datos()?.cliente ?? this.data.cliente;
    const { desde, hasta } = this.rango();
    this.compartiendo.set(true);
    try {
      const blob = await firstValueFrom(
        this.servicio.estadoCuentaPdfBlob(this.data.cliente, desde, hasta),
      );
      const resultado = await compartirArchivo(
        blob,
        this.nombreArchivo(cliente),
        `Estado de cuenta de ${cliente}`,
        `Estado de cuenta de ${cliente}`,
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
    // mismo operador del resumen del PDF: sin él el cliente resta Total −
    // Abonado y le sobra plata sin explicación. Este mensaje va AL CLIENTE, así
    // que los renglones tienen que SUMAR la cifra que se le cobra.
    const anterior = this.tieneSaldoAnterior()
      ? `(+) Saldo de la cuenta anterior: ${money(ec.libro_anterior_saldo)}\n`
      : '';
    // Con saldo a favor va además la operación con su signo, la misma frase del
    // PDF: la cifra de abajo se muestra en positivo y sin esta línea el cliente
    // suma los renglones y le sale al revés.
    const explicacion = this.explicacionSaldoAFavor();
    const texto =
      `*Estado de cuenta - ${ec.cliente}*\n` +
      `Período: ${periodo}\n` +
      `Compras: ${ec.compras} · Total facturado: ${money(ec.total_facturado)}\n` +
      `(-) Total abonado: ${money(ec.total_abonado)}\n` +
      anterior +
      `${this.rotuloSaldo()}: ${money(this.saldoMostrado())}` +
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
  private nombreArchivo(cliente: string): string {
    const limpio = cliente.trim().replace(/\s+/g, '_').replace(/[^\w-]/g, '');
    return `estado_cuenta_${limpio || 'cliente'}.pdf`;
  }

  private mensajeError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404) {
        // Un cliente sin ventas pero con deuda del libro anterior SÍ tiene estado
        // de cuenta, así que el respaldo no puede hablar solo de ventas.
        return (
          err.error?.error?.detail ??
          'El cliente no tiene ventas ni cuentas del libro anterior registradas'
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
