import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, firstValueFrom } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import {
  DeudaCobrada,
  Liquidacion,
  LiquidacionDetalle,
  Monto,
  PagoLiquidacion,
} from '../../core/models';
import { compartirArchivo, compartirWhatsApp } from '../../shared/compartir';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { EstadoChip } from '../../shared/estado-chip';
import { CantidadPipe, MoneyPipe, pesosExactos } from '../../shared/pipes';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { LiquidacionEstadoStepper } from './liquidacion-estado-stepper';
import { comoFecha, periodoDe } from './periodo-liquidacion';
import { LiquidacionesService } from './liquidaciones.service';
import { PagoLiquidacionFormDialog } from './pago-form.dialog';

/**
 * Lee un precio escrito a la colombiana: "1.750" son mil setecientos cincuenta,
 * no uno con setenta y cinco. El punto separa miles y la coma es el decimal, al
 * revés de lo que entiende Number(). Devuelve null si lo tecleado no es un
 * precio utilizable, para no mandarle NaN al backend.
 */
function precioTecleado(texto: string): number | null {
  const limpio = texto.trim().replace(/\s|\$/g, '').replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  const numero = Number(limpio);
  return numero > 0 ? numero : null;
}

/**
 * Los estados en los que EL SERVIDOR acepta recalcular.
 *
 * Hoy solo el borrador: `LiquidacionService.recalcular` rebota cualquier otro, y la
 * pantalla no puede ofrecer un botón que el servidor va a negar (es la misma regla
 * del candado de Recepción diaria, donde el aviso lo escribe el backend).
 *
 * Está aparte y con nombre porque es LA FRONTERA con el backend, no un gusto de la
 * pantalla. El día en que el servidor acepte recalcular una APROBADA —devolviéndola
 * a borrador, que es lo que ya hace `recuadrar` cuando se corrige una recepción de
 * una aprobada— basta agregar 'aprobada' a esta lista: el botón aparece, la ayuda
 * avisa que vuelve a borrador y la confirmación de `confirmarVolverABorrador` se
 * encarga de preguntar ANTES de oprimir. Todo eso ya está escrito y probado.
 */
const ESTADOS_QUE_ACEPTAN_RECALCULO: readonly string[] = ['borrador'];

/**
 * EL RÓTULO DEL RENGLÓN NUEVO, dicho como lo diría el dueño y escrito UNA sola vez.
 *
 * Es el MISMO texto que imprime el comprobante en PDF. Vive en una constante porque se
 * usa en tres lados —el resumen, la nota que explica de dónde salió el descuento y el
 * aviso del recálculo—: si en alguno dijera otra cosa, la pantalla y el papel se
 * estarían contradiciendo sobre una plata que se le quita al proveedor, y esa discusión
 * la pierde el dueño.
 */
export const ROTULO_SALDO_ANTERIOR = 'Lo que quedó debiendo de la quincena pasada';

/**
 * El menos de los renglones que restan: U+2212 (signo de resta), NO el guion del
 * teclado.
 *
 * No es un capricho tipográfico. Estas cifras se leen y se copian, y un guion pegado a
 * la plata ("- $ 24.600") se confunde con una cifra NEGATIVA —que es justo lo que este
 * trabajo vino a evitar en el renglón del saldo—. El signo de resta se lee como una
 * operación: "al total le quito esto".
 */
const MENOS = '−';

/**
 * UN RENGLÓN DEL RESUMEN, ya formateado como se lee en pantalla.
 *
 * El resumen se arma acá y no en la plantilla por una razón concreta: TIENE QUE SUMAR
 * DE ARRIBA ABAJO y los renglones no son los mismos en las dos clases de comprobante
 * (en la del transportador el valor bruto y los descuentos son cero, y en la del
 * proveedor el flete NO se le descuenta a él). Con los renglones escritos a mano en la
 * plantilla, la columna incluía cifras que no entran en la cuenta y el dueño sumaba y
 * no le cuadraba. Armándolo en una lista, el orden y los signos son UNA sola cosa que
 * la plantilla solo pinta, y una prueba puede recorrerla y comprobar la resta.
 */
export interface RenglonResumen {
  /** Cuál cifra es. La plantilla y las pruebas señalan el renglón por acá. */
  clave: string;
  etiqueta: string;
  /** La cifra formateada CON su signo cuando lo lleva: "− $ 49.462,09". */
  texto: string;
  signo: '' | '+' | '−';
  /** Entra en la columna que suma de arriba abajo (los litros y el promedio no). */
  cuenta: boolean;
  destacado: boolean;
  /** La plata va al revés: la debe el tercero, no la quesera. */
  alReves: boolean;
}

/** Un renglón del resumen que el recálculo movió, ya formateado como se lee. */
export interface CambioDeCifra {
  /** El MISMO rótulo del resumen de abajo, para poder cruzar las dos sin traducir. */
  etiqueta: string;
  antes: string;
  despues: string;
}

/** Lo que movió el último recálculo, listo para mostrar. */
export interface CambioDelRecalculo {
  /** La frase de arriba: "El flete pasó de $ 19.906,32 a $ 24.600". */
  titulo: string;
  filas: CambioDeCifra[];
  /** Lo que además hay que hacer (volver a aprobarla). Null si no hay nada. */
  aviso: string | null;
}

/**
 * Una cifra del resumen que se compara antes y después de recalcular.
 *
 * `etiqueta` es el rótulo del resumen y `frase` la forma de decirlo en una
 * oración: el aviso de arriba dice "El flete pasó de … a …", que es como lo dice
 * el dueño, y la tabla dice "Valor transporte", que es como lo dice la pantalla.
 */
interface RenglonComparable {
  etiqueta: string;
  frase: string;
  leer: (liq: Liquidacion) => Monto;
  /** Litros en vez de pesos: se formatea con la unidad y dos decimales. */
  litros?: boolean;
}

@Component({
  selector: 'app-liquidacion-detail',
  imports: [
    DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule,
    MatTableModule, MatTooltipModule, EstadoChip, MoneyPipe, CantidadPipe, HasPermissionDirective,
    LiquidacionEstadoStepper, SpinnerBoton,
  ],
  templateUrl: './liquidacion-detail.dialog.html',
  styles: `
    .info {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 32px;
      margin-bottom: 8px;
    }
    .etiqueta {
      display: block;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }
    h3 {
      margin: 16px 0 8px;
      font-size: 1rem;
      font-weight: 500;
    }
    table { width: 100%; }
    .num { text-align: right; }
    .sin-datos {
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
      margin: 8px 0;
    }
    /* "(borrada)" al lado del nombre de la ruta: se tiene que ver, pero no puede
       competir con las cifras del renglón. */
    .borrada {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
    .resumen {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 32px;
      max-width: 420px;
    }
    /* Las cifras NO se parten nunca: "− $ 120.000" cortado entre el signo y la plata se
       lee como dos cosas distintas. El rótulo sí puede envolver —"Lo que quedó debiendo
       de la quincena pasada" no cabe en una línea en un celular— y para eso está el
       1fr de la primera columna. */
    .resumen .num { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .resumen .destacado { font-weight: 600; }
    /* En celular el diálogo va a lo ancho de la pantalla: 32px entre el rótulo y la
       cifra le roban el espacio al rótulo largo y lo parten en cuatro líneas. */
    @media (max-width: 560px) {
      .resumen {
        gap: 4px 12px;
        max-width: none;
      }
    }
    /* El renglón "Le queda debiendo": la plata va al revés de lo normal (la debe el
       tercero, no la quesera), así que se marca en el color de error del tema. No es
       una alarma de sistema; es que el dueño no puede confundirlo con algo por pagar. */
    .resumen .al-reves { color: var(--mat-sys-error); }
    /*
     * La frase que explica el saldo negativo, debajo del resumen y no dentro: el
     * resumen es una rejilla de rótulo + cifra, y una explicación de dos líneas no es
     * ninguna de las dos. Mismo tratamiento que la nota del estado de cuenta cuando al
     * cliente se le cobró de más.
     */
    .nota-le-debe {
      max-width: 420px;
      margin: 10px 0 0;
      font-size: 0.8125rem;
      line-height: 1.35;
      color: var(--mat-sys-error);
    }
    /*
     * DE DÓNDE VINO EL DESCUENTO DE LA QUINCENA PASADA, y —con el mismo aire— por qué el
     * saldo quedó en cero.
     *
     * En el color normal del texto y NO en el rojo de .nota-le-debe: acá no hay nada
     * mal ni nadie debiendo, es la explicación de un renglón que sí se cobró. Pintarla
     * de rojo la haría leer como una alarma sobre un descuento correcto.
     */
    .nota-saldo-anterior,
    .nota-saldo-cero {
      max-width: 420px;
      margin: 10px 0 0;
      font-size: 0.8125rem;
      line-height: 1.35;
      color: var(--mat-sys-on-surface-variant);
    }
    /* Las quincenas que dejaron la deuda, cuando fueron varias: sus cifras suman el
       renglón del resumen y el dueño las cuadra a mano, así que van una por línea. */
    .origenes-deuda {
      max-width: 420px;
      margin: 4px 0 0;
      padding-left: 20px;
      font-size: 0.8125rem;
      line-height: 1.5;
      color: var(--mat-sys-on-surface-variant);
    }
    /* El flete de la leche del proveedor: un dato, no un descuento suyo. Mismo tono
       discreto que la nota de arriba, porque tampoco es una alerta. */
    .nota-flete {
      max-width: 420px;
      margin: 10px 0 0;
      font-size: 0.8125rem;
      line-height: 1.35;
      color: var(--mat-sys-on-surface-variant);
    }

    .ayuda-precio {
      margin: 6px 0 0;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }

    /* ---------------------------------------- precio por litro editable */
    /*
     * El botón se ve como texto normal: la fila no debe parecer un formulario.
     * La pista de que se puede tocar aparece al pasar el mouse o al enfocar, que
     * es cuando el usuario ya está preguntándose si se puede.
     */
    .precio-editable {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      margin: -2px -6px;
      font: inherit;
      color: inherit;
      background: transparent;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-variant-numeric: tabular-nums;
    }
    .precio-editable:hover,
    .precio-editable:focus-visible {
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
    }
    .precio-editable .lapiz {
      font-size: 16px;
      width: 16px;
      height: 16px;
      opacity: 0;
      color: var(--mat-sys-primary);
      transition: opacity 120ms ease;
    }
    .precio-editable:hover .lapiz,
    .precio-editable:focus-visible .lapiz { opacity: 1; }
    /* En pantalla táctil no hay hover: si el lápiz nunca se ve, nadie descubre
       que la cifra se puede corregir. */
    @media (hover: none) {
      .precio-editable .lapiz { opacity: 0.6; }
    }

    .precio-edicion {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      justify-content: flex-end;
    }
    .precio-edicion input {
      width: 96px;
      padding: 4px 6px;
      font: inherit;
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--mat-sys-on-surface);
      background: var(--mat-sys-surface);
      border: 1px solid var(--mat-sys-primary);
      border-radius: 4px;
    }
    .precio-edicion input:disabled { opacity: 0.7; }

    /* ------------------------------------------ lo que movió el recálculo */
    /*
     * Se queda en pantalla hasta que el usuario lo cierre, y arriba del desglose
     * nuevo: el dueño cuadra estas cifras a mano y un aviso de tres segundos no
     * le alcanza para anotar de cuánto a cuánto se movió el flete.
     */
    .cambio-recalculo {
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      color: var(--mat-sys-primary);
      font-size: 0.85rem;
    }
    .cambio-titulo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
      line-height: 1.4;
    }
    .cambio-titulo mat-icon {
      flex: none;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .cambio-titulo button {
      flex: none;
      margin-left: auto;
    }
    .cambio-cifras {
      display: grid;
      grid-template-columns: 1fr auto auto auto;
      gap: 2px 10px;
      margin: 8px 0 0;
      font-variant-numeric: tabular-nums;
    }
    /* display: contents deja cada renglón como UN elemento del DOM —así se lee
       entero, en pantalla y en las pruebas— sin romper la alineación de la
       grilla, que es la que pone las dos columnas de cifras a la derecha. */
    .cambio-fila { display: contents; }
    .cambio-encabezado {
      font-size: 0.7rem;
      opacity: 0.75;
    }
    .cambio-cifras .flecha { opacity: 0.7; }
    .cambio-aviso {
      margin: 8px 0 0;
      font-weight: 500;
    }

    /* El candado de "ya salió plata", con el mismo aire que el aviso del candado
       de Recepción diaria: es un texto largo y se tiene que leer de un tirón. */
    .ayuda-precio.con-candado {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      line-height: 1.45;
    }
    .ayuda-precio.con-candado mat-icon {
      flex: none;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    /* Se dice POR QUÉ no se puede recalcular en vez de que el botón desaparezca
       sin explicación, igual que el "No se puede eliminar" del día ya pagado. */
    .nota-recalcular {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      opacity: 0.75;
    }
    .nota-recalcular mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
  `,
})
export class LiquidacionDetailDialog {
  private readonly servicio = inject(LiquidacionesService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly auth = inject(AuthService);

  readonly data = inject<{ item: Liquidacion }>(MAT_DIALOG_DATA);

  readonly liq = signal<Liquidacion>(this.data.item);
  readonly procesando = signal(false);
  readonly descargando = signal(false);
  readonly compartiendo = signal(false);

  /** Día cuyo precio se está editando (su id), o null si no hay ninguno. */
  readonly editandoId = signal<string | null>(null);
  /** Día cuyo precio se está guardando: mientras tanto el campo queda quieto. */
  readonly guardandoId = signal<string | null>(null);
  /** Lo tecleado en el campo abierto, tal cual, sin interpretar todavía. */
  readonly textoPrecio = signal('');

  readonly tercero = computed(
    () => this.liq().proveedor_nombre ?? this.liq().transportador_nombre ?? '—',
  );

  /**
   * El precio solo se corrige en BORRADOR y solo en liquidaciones de proveedor.
   *
   * Aprobada o pagada quiere decir que ese precio ya se le pagó a alguien, y en
   * la del transportador la cifra de esa columna es la tarifa del flete del día
   * —otra cosa—. El backend rechaza los dos casos igual: esto es para que el
   * campo ni siquiera se ofrezca.
   */
  readonly puedeEditarPrecio = computed(
    () =>
      this.liq().estado === 'borrador' &&
      this.liq().tipo === 'proveedor' &&
      this.auth.hasPermission('liquidaciones', 'editar'),
  );

  /**
   * La columna "Ruta" solo aparece cuando los renglones de verdad traen ruta.
   *
   * En el comprobante del transportador los renglones son por DÍA Y RUTA: si hizo
   * Nápoles y Mira Valle el mismo martes, ese martes trae DOS renglones a tarifas
   * distintas (cada uno cuadra litros × precio = valor, que es lo que el dueño
   * revisa a mano). Sin esta columna se verían dos veces el mismo día sin
   * explicación y parecería un renglón repetido.
   *
   * Se agrega según los datos y no según el tipo: el comprobante del proveedor no
   * trae ruta, y uno viejo del transportador —generado antes de este cambio—
   * tampoco, así que en esos la columna no estorba.
   */
  readonly columnasDetalle = computed(() =>
    this.hayRutas()
      ? ['fecha', 'ruta', 'litros', 'precio_litro', 'valor']
      : ['fecha', 'litros', 'precio_litro', 'valor'],
  );
  readonly columnasPagos = ['fecha', 'valor', 'observaciones', 'acciones'];

  private readonly hayRutas = computed(() =>
    this.liq().detalles.some((detalle) => !!detalle.ruta_id || !!detalle.ruta_nombre),
  );

  /** Si ya se le abonó algo: manda el historial, no el estado. */
  readonly tienePagos = computed(() => this.liq().pagos.length > 0);

  /**
   * EL SALDO QUEDÓ POR DEBAJO DE CERO: el tercero le quedó debiendo AL NEGOCIO.
   *
   * Pasa cuando los anticipos que ya se le entregaron suman más que lo que produjo la
   * quincena, y pasa de verdad: $180.000 de leche contra $300.000 de anticipo, o una
   * tarifa de flete que se corrige hacia abajo después de haberle adelantado la
   * gasolina.
   *
   * La cifra la manda el backend en positivo (`le_queda_debiendo`) y no se recalcula
   * acá: es la MISMA que imprime el comprobante en PDF bajo el rótulo "LE QUEDA
   * DEBIENDO", y dos restas para el mismo hecho terminan mostrando cifras distintas.
   * Se compara con `Number` porque los montos llegan como texto (Decimal del backend).
   */
  readonly leQuedaDebiendo = computed(() => Number(this.liq().le_queda_debiendo ?? 0) > 0);

  /**
   * LO QUE SE LE COBRA EN ESTA QUINCENA DE LO QUE QUEDÓ DEBIENDO EN LAS PASADAS.
   *
   * Cero (y el renglón no sale) en la inmensa mayoría de los comprobantes: quedar
   * debiendo es la excepción. Mientras el backend no mande el campo llega en
   * `undefined` y esto da cero, así que la pantalla se ve igual que hoy.
   */
  readonly saldoAnterior = computed(() => Number(this.liq().saldo_anterior ?? 0));
  readonly cobraSaldoAnterior = computed(() => this.saldoAnterior() > 0);

  /**
   * EL RESUMEN COMPLETO, EN EL ORDEN EN QUE SE RESTA Y CON LOS MISMOS RENGLONES DEL PDF.
   *
   * Lo que arregla, y que el dueño reclamó con estas palabras —"suma y resta de arriba
   * abajo y no me cuadra"—:
   *
   *  · "Anticipos aplicados" y "Pagado" estaban ARRIBA de VALOR TOTAL. Son descuentos
   *    del total: leídos antes que él no hay nada de dónde restarlos. Ahora el orden es
   *    el de la cuenta: bruto, + bonificaciones, − descuentos, VALOR TOTAL, − anticipos,
   *    − lo que quedó debiendo de la quincena pasada, − pagado, y el saldo al final;
   *  · en la del PROVEEDOR sobraba "Valor transporte". Ese flete no se le descuenta a él
   *    —se le paga al transportador, y tiene su propio comprobante—, así que metido en
   *    la columna la descuadraba. Se dice aparte y con esas palabras (ver `notaFlete`);
   *  · en la del TRANSPORTADOR sobraban "Valor bruto", "Bonificaciones" y "Descuentos",
   *    que en su comprobante son siempre cero: tres renglones en $0 entre los que sí
   *    cuentan. Su PDF nunca los imprimió.
   *
   * La invariante que esta lista tiene que cumplir SIEMPRE, y que hay una prueba que la
   * mide leyendo la pantalla: los renglones con `cuenta` puestos, aplicados con su
   * signo, caen EXACTO en VALOR TOTAL primero y en el saldo del final después.
   */
  readonly renglonesResumen = computed<RenglonResumen[]>(() => {
    const l = this.liq();
    const esProveedor = l.tipo === 'proveedor';
    const filas: RenglonResumen[] = [];

    const plata = (
      clave: string,
      etiqueta: string,
      valor: Monto | null | undefined,
      signo: '' | '+' | '−' = '',
      extra: Partial<RenglonResumen> = {},
    ): void => {
      const cifra = this.enPesos(valor);
      filas.push({
        clave,
        etiqueta,
        texto: signo ? `${signo} ${cifra}` : cifra,
        signo,
        cuenta: true,
        destacado: false,
        alReves: false,
        ...extra,
      });
    };

    // Los litros y el promedio encabezan el resumen como en el PDF, pero NO entran en
    // la columna de plata: son la medida de la quincena, no una cifra que se sume.
    filas.push({
      clave: 'litros',
      etiqueta: 'Total litros',
      texto: this.enLitros(l.total_litros),
      signo: '',
      cuenta: false,
      destacado: false,
      alReves: false,
    });
    if (esProveedor) {
      filas.push({
        clave: 'precio_promedio',
        etiqueta: 'Precio promedio',
        texto: this.enPesos(l.precio_promedio),
        signo: '',
        cuenta: false,
        destacado: false,
        alReves: false,
      });
      plata('valor_bruto', 'Valor bruto', l.valor_bruto);
      plata('bonificaciones', 'Bonificaciones', l.bonificaciones, '+');
      plata('descuentos', 'Descuentos', l.descuentos, MENOS);
    } else {
      // En su comprobante el flete ES el bruto: de ahí arranca la cuenta.
      plata('valor_transporte', 'Valor transporte', l.valor_transporte);
    }

    plata('valor_total', 'Valor total', l.valor_total, '', { destacado: true });
    plata('anticipos', 'Anticipos aplicados', l.anticipos, MENOS);
    // El renglón NUEVO, y solo cuando de verdad se le cobró algo de atrás. Con el mismo
    // rótulo del PDF: el dueño pone los dos documentos uno al lado del otro.
    if (this.cobraSaldoAnterior()) {
      plata('saldo_anterior', ROTULO_SALDO_ANTERIOR, l.saldo_anterior, MENOS);
    }
    // "Pagado" solo cuando de verdad se abonó algo, igual que en el PDF.
    if (this.tienePagos()) plata('pagado', 'Pagado', l.pagado, MENOS);

    // EL RENGLÓN DE CIERRE cambia de rótulo cuando la cuenta queda por debajo de cero:
    // ahí la plata la debe el tercero y la cifra va en POSITIVO. Un menos pegado a un
    // total destacado se lee como "hay que pagar una cifra negativa".
    if (this.leQuedaDebiendo()) {
      plata('le_queda_debiendo', 'Le queda debiendo', l.le_queda_debiendo, '', {
        destacado: true,
        alReves: true,
      });
    } else {
      plata('saldo', 'Saldo a pagar', l.saldo, '', { destacado: true });
    }
    return filas;
  });

  /**
   * EL FLETE DE LA LECHE DEL PROVEEDOR, dicho aparte y explicando por qué no se resta.
   *
   * Esta cifra estaba dentro de la columna del resumen y la descuadraba: el dueño la
   * restaba del valor total y le sobraba plata. No se le descuenta al proveedor —el
   * flete se le paga al transportador, que tiene su propio comprobante—, así que se
   * queda como dato, fuera de la cuenta y con la razón escrita al lado.
   *
   * Null cuando no hay flete o cuando es la del transportador (ahí el flete ES la
   * cuenta, y ya va como primer renglón).
   */
  readonly notaFlete = computed<string | null>(() => {
    const l = this.liq();
    if (l.tipo !== 'proveedor' || Number(l.valor_transporte ?? 0) <= 0) return null;
    return (
      `El flete de esta leche costó ${this.enPesos(l.valor_transporte)}. No se le ` +
      `descuenta a ${this.tercero()}: eso se le paga al transportador, que tiene su ` +
      `propio comprobante. Por eso no entra en la cuenta de arriba.`
    );
  });

  /**
   * La frase completa, como la diría el dueño: "Henri le queda debiendo $4.955,77".
   *
   * Va aparte del renglón del resumen y no en lugar de él: el renglón es una celda de
   * rótulo + cifra (y la tabla se lee de dos en dos), así que la explicación —con el
   * nombre de la persona y el motivo— va en su propia línea debajo. Es el mismo
   * remedio del estado de cuenta del productor cuando al cliente se le cobró de más.
   *
   * Devuelve null cuando no hay nada que explicar, para que la plantilla no tenga que
   * repetir la condición.
   */
  readonly explicacionLeQuedaDebiendo = computed<string | null>(() => {
    if (!this.leQuedaDebiendo()) return null;
    const l = this.liq();
    // LA CAUSA. Cuando esta misma quincena ya venía cargando una deuda vieja, hay que
    // nombrarla: sin ella la frase acusa a los anticipos de una diferencia que no es
    // toda suya, y el dueño suma "anticipos contra valor total" y no le da.
    const causa = this.cobraSaldoAnterior()
      ? `los anticipos aplicados (${this.enPesos(l.anticipos)}) más lo que ya venía ` +
        `debiendo de antes (${this.enPesos(l.saldo_anterior)}) suman más que el valor ` +
        `total de esta liquidación (${this.enPesos(l.valor_total)})`
      : `los anticipos aplicados (${this.enPesos(l.anticipos)}) suman más que el valor ` +
        `total de esta liquidación (${this.enPesos(l.valor_total)})`;
    // Y LA CADENA, cuando esta quincena cobró una deuda y volvió a quedar debiendo: lo
    // que viaja a la siguiente YA INCLUYE la vieja. Decirlo evita la pregunta que
    // seguiría —"¿entonces se le está cobrando dos veces?"— con plata de por medio.
    const cadena = this.cobraSaldoAnterior()
      ? ` En esos ${this.enPesos(l.le_queda_debiendo)} ya está incluido lo que traía ` +
        `debiendo de antes, así que no se le cobra dos veces.`
      : '';
    return (
      `${this.tercero()} le queda debiendo ${this.enPesos(l.le_queda_debiendo)}: ` +
      `${causa}. No hay nada que pagarle. ${this.queSigueConLaDeuda()}${cadena}`
    );
  });

  /**
   * DÓNDE SE LE COBRÓ ESA DEUDA — o que todavía está pendiente, o que ya no se cobra.
   *
   * Es la punta que faltaba. Antes esta liquidación decía "esa diferencia se le cobra o
   * se le descuenta en la próxima quincena": una PROMESA que nadie cumplía, porque
   * ningún documento la cobraba. Ahora sí se cobra, así que este texto tiene que decir
   * qué pasó DE VERDAD, y son tres situaciones que el dueño necesita distinguir:
   *
   *  · YA SE COBRÓ: se nombra la liquidación que la cobró CON SU PERÍODO, que es cómo él
   *    identifica un comprobante (un id no le dice nada). También es lo que tiene que
   *    saber si algún día quiere anular esta: primero hay que anular esa;
   *  · ANULADA: acá la promesa era FALSA y hay que decirlo. El servidor no le cobra la
   *    deuda de una liquidación anulada a nadie (la busca entre las que no están
   *    anuladas ni borradas: ver `deudas_sin_cobrar` en el backend), así que si esta
   *    quincena se anuló, esos pesos no los va a recoger ninguna liquidación futura. Lo
   *    que hay que hacer es volver a generarla;
   *  · TODAVÍA NO: se dice PENDIENTE y con qué rótulo va a aparecer allá, para que
   *    cuando vea el descuento en la próxima quincena lo reconozca. Con el "después de
   *    esta" porque es literal lo que hace el servidor: solo se cobra en una liquidación
   *    cuyo período empiece DESPUÉS de que este termine, así que liquidar una quincena
   *    vieja no se la cobra. Y VIAJA IGUAL SI ESTA SIGUE EN BORRADOR —eso es la regla
   *    nueva del servidor, y antes se perdía la deuda de los borradores—, así que se dice
   *    con esas palabras: quien ve un borrador en negativo asume que "todavía no cuenta".
   *
   * Si el backend manda el enlace pero no las fechas, se dice sin el período en vez de
   * callarse: "ya se cobró" sin fecha sigue siendo mejor que una promesa falsa.
   */
  private queSigueConLaDeuda(): string {
    if (this.deudaYaCobrada()) {
      const periodo = this.periodoDondeSeCobro();
      return periodo
        ? `Esa diferencia YA se le cobró en la liquidación del ${periodo}.`
        : 'Esa diferencia YA se le cobró en una liquidación posterior.';
    }
    if (this.liq().estado === 'anulada') {
      return (
        'Esta liquidación está ANULADA, así que esa diferencia no se le cobra en ninguna ' +
        'parte: vuelva a generar la quincena si hay que cobrársela.'
      );
    }
    // El borrador se nombra aparte porque es la sorpresa: sus cifras todavía se pueden
    // corregir y aun así su deuda ya viaja a la próxima quincena que se liquide.
    const aunqueBorrador =
      this.liq().estado === 'borrador'
        ? ' Se le cobra aunque esta liquidación siga en borrador.'
        : '';
    return (
      'Esa diferencia queda PENDIENTE: se le cobra en la próxima quincena que se le ' +
      `liquide después de esta, donde va a aparecer como «${ROTULO_SALDO_ANTERIOR}».` +
      aunqueBorrador
    );
  }

  /**
   * DE DÓNDE SALIÓ EL DESCUENTO, en la liquidación que SE LO COBRA.
   *
   * La otra punta. Un renglón que le quita $120.000 al proveedor sin decir de dónde
   * viene es lo que hace que el dueño desconfíe del sistema —y con razón: es plata que
   * no sale de ninguna recepción de esta quincena—. Acá se nombra la quincena que la
   * dejó y se dice que se cobra UNA sola vez.
   *
   * Null cuando no se cobró nada, que es el caso de casi todos los comprobantes.
   */
  readonly explicacionSaldoAnterior = computed<string | null>(() => {
    if (!this.cobraSaldoAnterior()) return null;
    const l = this.liq();
    const cifra = this.enPesos(l.saldo_anterior);
    const origenes = this.origenesSaldoAnterior();
    const deDonde =
      origenes.length === 1
        ? `en la liquidación del ${origenes[0].periodo}`
        : origenes.length > 1
          ? `en ${origenes.length} liquidaciones pasadas`
          : // Sin el detalle (el backend manda la cifra pero no las quincenas) se dice
            // lo que se sabe. Callar el renglón sería peor: el descuento ya está hecho.
            'en una quincena pasada';
    return (
      `Los ${cifra} de «${ROTULO_SALDO_ANTERIOR}» son lo que ${this.tercero()} quedó ` +
      `debiendo ${deDonde}, cuando los anticipos que se le habían entregado sumaron más ` +
      `que su quincena. Se le cobran acá, una sola vez.`
    );
  });

  /**
   * Las quincenas que dejaron la deuda, una por renglón: período y cuánto puso cada una.
   *
   * En lista y no dentro de la frase porque pueden ser varias —dos quincenas seguidas en
   * negativo se cobran juntas— y sus cifras tienen que SUMAR el renglón del resumen: así
   * el dueño comprueba el descuento como comprueba el desglose diario.
   */
  readonly origenesSaldoAnterior = computed<{ id: string; periodo: string; valor: string }[]>(() =>
    (this.liq().deudas_cobradas ?? []).map((origen: DeudaCobrada) => ({
      id: origen.id,
      periodo: periodoDe(origen),
      valor: this.enPesos(origen.le_queda_debiendo),
    })),
  );

  /** ¿La deuda que ESTA dejó ya se la cobró otra liquidación? Entonces está congelada. */
  readonly deudaYaCobrada = computed(() => !!this.liq().deuda_trasladada_a_id);

  /** El período de la liquidación que se cobró la deuda, o null si no vino nombrada. */
  private periodoDondeSeCobro(): string | null {
    const otra = this.liq().deuda_trasladada_a;
    return otra ? periodoDe(otra) : null;
  }

  constructor() {
    // Recarga la liquidación para asegurar que los detalles estén completos.
    firstValueFrom(this.servicio.getById(this.data.item.id))
      .then((liq) => this.liq.set(liq))
      .catch(() => undefined);
  }

  // ------------------------------------------- corregir el precio de un día
  /**
   * Escape cierra el campo, y al cerrarlo el navegador puede disparar el blur
   * del input que acaba de desaparecer. Esta marca evita que ese blur guarde lo
   * que el usuario justamente acaba de cancelar.
   */
  private cancelando = false;

  editarPrecio(detalle: LiquidacionDetalle): void {
    if (!this.puedeEditarPrecio() || this.guardandoId()) return;
    this.cancelando = false;
    this.textoPrecio.set(String(Number(detalle.precio_litro)));
    this.editandoId.set(detalle.id);
  }

  cancelarPrecio(): void {
    this.cancelando = true;
    this.editandoId.set(null);
  }

  alEscribirPrecio(valor: string): void {
    this.textoPrecio.set(valor);
  }

  /**
   * Al salir del campo se guarda, como en la hoja de cálculo de la que viene el
   * dueño: si hace clic afuera después de teclear, espera que quede. Escape
   * sigue siendo la forma de arrepentirse.
   */
  alSalirDelPrecio(detalle: LiquidacionDetalle): void {
    if (this.cancelando) {
      this.cancelando = false;
      return;
    }
    void this.guardarPrecio(detalle);
  }

  async guardarPrecio(detalle: LiquidacionDetalle): Promise<void> {
    if (this.guardandoId()) return;
    const precio = precioTecleado(this.textoPrecio());

    // Sin cambio real, cerrar el campo y no molestar al servidor.
    if (precio === null || precio === Number(detalle.precio_litro)) {
      if (precio === null) {
        this.snackbar.open('Escriba el precio por litro en pesos, por ejemplo 1750', 'OK', {
          duration: 4000,
        });
        return; // el campo se queda abierto para corregir lo tecleado
      }
      this.editandoId.set(null);
      return;
    }

    this.guardandoId.set(detalle.id);
    try {
      const actualizada = await firstValueFrom(
        this.servicio.actualizarPrecioDetalle(this.liq().id, detalle.id, precio),
      );
      // La cifra en pantalla es SIEMPRE la que devolvió el servidor: nunca se
      // pinta el precio nuevo por adelantado. Si el guardado falla, lo que se ve
      // sigue siendo lo que de verdad está guardado.
      this.liq.set(actualizada);
      this.editandoId.set(null);
      // Corregir un día mueve las cifras: el "antes → ahora" del recálculo anterior
      // ya no es el de la pantalla.
      this.cambio.set(null);
      this.snackbar.open('Precio actualizado', 'OK', { duration: 3000 });
    } catch (err) {
      // El campo se queda ABIERTO con lo tecleado: así se ve que ese día quedó
      // sin guardar, en vez de volver a la cifra vieja como si nada.
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible cambiar el precio de ese día');
    } finally {
      this.guardandoId.set(null);
    }
  }

  /**
   * Recalcular se ofrece donde el servidor lo acepta, con permiso de editar.
   *
   * Sirve para dos casos que se ven igual desde afuera: el anticipo que se
   * registró DESPUÉS de generar la liquidación (el resumen quedaba en "Anticipos
   * aplicados $0" y no había cómo recogerlo) y la TARIFA MAL TECLEADA del
   * transportador —el caso del dueño—: la corrigió en la ficha y el comprobante
   * siguió mostrando la cifra vieja, porque sus renglones son la foto del día en
   * que se generó.
   *
   * Los estados los manda `ESTADOS_QUE_ACEPTAN_RECALCULO`, que es el contrato del
   * backend y no una decisión de esta pantalla. Con plata ya entregada no se
   * ofrece —el servidor rebota, y con razón—, pero tampoco desaparece en
   * silencio: ver `motivoNoRecalcular`.
   */
  readonly puedeRecalcular = computed(
    () =>
      ESTADOS_QUE_ACEPTAN_RECALCULO.includes(this.liq().estado) &&
      !this.tienePagos() &&
      this.auth.hasPermission('liquidaciones', 'editar'),
  );

  /**
   * Por qué NO se puede recalcular, en palabras y con la salida que sí funciona.
   *
   * Devuelve null cuando no hay nada que explicar: si se puede, si el usuario no
   * tiene el permiso (nunca vio el botón) o si está anulada (ahí no hay nada que
   * recalcular y el chip de estado ya lo dice).
   */
  readonly motivoNoRecalcular = computed(() => {
    if (this.puedeRecalcular() || !this.auth.hasPermission('liquidaciones', 'editar')) return null;
    const liq = this.liq();
    // VA PRIMERO, y no es un detalle de orden: con la deuda ya cobrada en otro
    // comprobante, el consejo de más abajo ("anúlela y vuelva a generarla") es
    // exactamente lo que el servidor también rebota. Dejar ese texto acá mandaría al
    // dueño a dar vueltas entre dos botones que los dos le dicen que no.
    if (this.deudaYaCobrada()) return this.avisoDeudaCongelada('recalcular');
    if (liq.estado === 'pagada') {
      return (
        `Este comprobante ya está pagado (${this.enPesos(liq.pagado)}): sus cifras quedan ` +
        'en firme y no se pueden recalcular.'
      );
    }
    if (liq.estado === 'parcial' || this.tienePagos()) {
      return (
        `Ya se le abonó ${this.enPesos(liq.pagado)} contra estas cifras: quedan en firme y ` +
        'no se pueden recalcular. Si de verdad hay que rehacerlas, primero elimine el abono.'
      );
    }
    // Aprobada SIN pagos: no hay plata entregada, pero el servidor solo recalcula
    // borradores, así que el botón no se puede ofrecer. Se dice cuál es la salida
    // que sí funciona en vez de dejarlo buscando un botón que no está. (Si el
    // backend pasa a aceptarla, este texto desaparece solo: ver
    // ESTADOS_QUE_ACEPTAN_RECALCULO.)
    if (liq.estado === 'aprobada') {
      return (
        'Está aprobada y Recalcular solo trabaja sobre borradores. Si sus cifras quedaron ' +
        'mal —por ejemplo una tarifa que se corrigió después—, anúlela y vuelva a generarla: ' +
        'todavía no se le ha pagado nada.'
      );
    }
    return null;
  });

  /**
   * "NO SE PUEDE, Y PRIMERO HAY QUE ANULAR ESA OTRA": el aviso de la deuda congelada.
   *
   * En cuanto la deuda de esta liquidación se cobró en otra, el servidor rebota anular y
   * recalcular: cambiarle el total le cambiaría el descuento a un comprobante ya
   * emitido, y el dueño terminaría con dos papeles que no cuadran. Lo importante del
   * mensaje no es el "no": es NOMBRAR la liquidación que hay que anular primero, porque
   * sin eso el usuario queda atascado sin saber por dónde salir. Está redactado con las
   * mismas palabras que el error del backend, a propósito: si el usuario alcanza a
   * oprimir el botón desde otra pantalla, el mensaje que recibe es el mismo.
   */
  private avisoDeudaCongelada(verbo: 'anular' | 'recalcular'): string {
    const periodo = this.periodoDondeSeCobro();
    const donde = periodo ? `la liquidación del ${periodo}` : 'otra liquidación';
    return (
      `No se puede ${verbo} esta liquidación: lo que ${this.tercero()} quedó debiendo ` +
      `(${this.enPesos(this.liq().le_queda_debiendo)}) ya se le cobró en ${donde}. Anule ` +
      'primero esa liquidación —así esta deuda vuelve a quedar libre— y vuelva a intentarlo.'
    );
  }

  /**
   * ANULAR: el servidor lo rebota cuando la deuda de esta ya se cobró en otra.
   *
   * Es la mitad de pantalla del candado nuevo. Sin esto el botón seguía ahí, el usuario
   * lo oprimía, confirmaba "¿anular esta liquidación?" —una confirmación que da miedo— y
   * recibía un error después de haber dicho sí.
   */
  readonly puedeAnular = computed(
    () =>
      (this.liq().estado === 'borrador' || this.liq().estado === 'aprobada') &&
      !this.deudaYaCobrada() &&
      this.auth.hasPermission('liquidaciones', 'administrar'),
  );

  /** Por qué no se puede anular. Null cuando se puede o cuando el botón nunca estuvo. */
  readonly motivoNoAnular = computed(() => {
    const estado = this.liq().estado;
    if (estado !== 'borrador' && estado !== 'aprobada') return null;
    if (!this.auth.hasPermission('liquidaciones', 'administrar')) return null;
    return this.deudaYaCobrada() ? this.avisoDeudaCongelada('anular') : null;
  });

  /**
   * PAGAR: no se le paga a quien QUEDÓ DEBIENDO. El servidor lo rebota.
   *
   * Antes el botón aparecía igual —el estado seguía siendo 'aprobada'— y el diálogo de
   * pago abría con el saldo prellenado, que en este caso es una cifra NEGATIVA. El
   * dueño oprimía "Pagar" sobre un comprobante donde no hay nada que entregar.
   *
   * Y ojo con lo que este botón hacía antes de este trabajo: marcaba la liquidación
   * PAGADA sin que saliera un peso, y eso trababa los días de esa quincena en Recepción
   * diaria para siempre. Ahora el backend lo rebota y la quincena se queda en 'aprobada'
   * —que es lo que es— hasta que su deuda se cobre en la siguiente.
   */
  readonly puedePagar = computed(
    () =>
      (this.liq().estado === 'aprobada' || this.liq().estado === 'parcial') &&
      Number(this.liq().saldo ?? 0) > 0 &&
      this.auth.hasPermission('liquidaciones', 'administrar'),
  );

  /**
   * EL SALDO QUEDÓ EXACTO EN CERO: no hay plata por entregar, y nadie quedó debiendo.
   *
   * Es el caso que dejaba una liquidación IMPOSIBLE DE CERRAR. `puedePagar` exigía
   * saldo > 0, así que una quincena de $180.000 con $180.000 de anticipo —o una donde el
   * anticipo más la deuda arrastrada cubren justo el total— perdía el botón y se quedaba
   * en 'aprobada' para siempre, con sus días abiertos a que alguien les cambiara las
   * cifras meses después.
   *
   * Y ACÁ EL SERVIDOR SÍ ACEPTA, que es lo que decide si la pantalla lo ofrece: el
   * `marcar_pagada` del backend rebota únicamente cuando el tercero quedó DEBIENDO
   * (`le_queda_debiendo > 0`); con el saldo en cero pasa por su rama de "no hay pago que
   * registrar" y la deja PAGADA. Lo que no acepta es un ABONO (`registrar_pago` rebota
   * con saldo <= 0), así que este camino NO puede pasar por el diálogo de pago —abriría
   * con $0 prellenado, el formulario inválido y el botón muerto—: va derecho al
   * `POST /pagar`. Ver `cerrarSinPago`.
   */
  readonly saldoEnCero = computed(() => Number(this.liq().saldo ?? 0) === 0);

  /**
   * LA QUINCENA ESTÁ SALDADA Y TODAVÍA ABIERTA: es la situación, sin mirar permisos.
   *
   * El estado importa: TODA liquidación pagada tiene el saldo en cero, y ahí no hay nada
   * que decidir ni que explicar. Lo que este trabajo destrabó es la que quedó en cero
   * SIN cerrarse —'aprobada' (o 'parcial', que el servidor acepta igual)—, que era la que
   * se quedaba abierta para siempre.
   */
  readonly quincenaSaldadaSinCerrar = computed(
    () =>
      (this.liq().estado === 'aprobada' || this.liq().estado === 'parcial') &&
      this.saldoEnCero(),
  );

  /** Cerrar la quincena que no hay que pagar: la misma situación más el permiso de Pagar. */
  readonly puedeCerrarSinPago = computed(
    () =>
      this.quincenaSaldadaSinCerrar() && this.auth.hasPermission('liquidaciones', 'administrar'),
  );

  /**
   * POR QUÉ ESTA QUINCENA NO HAY QUE PAGARLA, nombrando TODO lo que hizo el cero.
   *
   * El texto viejo decía siempre "los anticipos ya entregados cubren exactamente la
   * quincena", y eso ERA MENTIRA cuando el cero lo hacía la deuda arrastrada: en una
   * quincena de $144.482 con $139.526,23 de anticipo y $4.955,77 de deuda vieja, el
   * dueño leía que los anticipos la cubrían, iba a buscarlos y le faltaban casi cinco
   * mil pesos. La frase se arma con los renglones que DE VERDAD suman el valor total
   * —los mismos del resumen y del PDF, en el mismo orden—, así que siempre cuadra.
   */
  readonly explicacionSaldoEnCero = computed<string | null>(() => {
    if (!this.quincenaSaldadaSinCerrar()) return null;
    const l = this.liq();
    const partes: string[] = [];
    if (Number(l.anticipos ?? 0) > 0) {
      partes.push(`los anticipos aplicados (${this.enPesos(l.anticipos)})`);
    }
    if (this.cobraSaldoAnterior()) {
      partes.push(`lo que ya venía debiendo de antes (${this.enPesos(l.saldo_anterior)})`);
    }
    if (this.tienePagos()) partes.push(`lo que ya se le pagó (${this.enPesos(l.pagado)})`);
    if (partes.length === 0) {
      return (
        `No hay nada que entregarle a ${this.tercero()}: el valor total de esta quincena ` +
        `es ${this.enPesos(l.valor_total)}.`
      );
    }
    const cuenta =
      partes.length === 1
        ? partes[0]
        : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
    // El verbo concuerda con lo que se está nombrando, no con cuántas cosas son: "los
    // anticipos aplicados … CUBREN" aunque sean el único renglón, y "lo que ya venía
    // debiendo … CUBRE". Una concordancia mala en la pantalla del dueño se lee como
    // descuido, y esta frase habla de plata que no se le entregó a nadie.
    const plural = partes.length > 1 || Number(l.anticipos ?? 0) > 0;
    return (
      `No hay nada que entregarle a ${this.tercero()}: ${cuenta} ` +
      `${plural ? 'cubren' : 'cubre'} EXACTO el valor total de la quincena ` +
      `(${this.enPesos(l.valor_total)}), así que el saldo quedó en ${this.enPesos('0')}.`
    );
  });

  /** Por qué no se puede pagar, cuando el botón se esperaría y no está. */
  readonly motivoNoPagar = computed(() => {
    const liq = this.liq();
    if (this.puedePagar() || this.puedeCerrarSinPago()) return null;
    if (!this.auth.hasPermission('liquidaciones', 'administrar')) return null;
    if (liq.estado !== 'aprobada' && liq.estado !== 'parcial') return null;
    if (this.leQuedaDebiendo()) {
      const cierre = this.deudaYaCobrada()
        ? 'Esa deuda ya se le cobró en otra liquidación.'
        : 'Esa deuda se le cobra en la próxima quincena que se le liquide.';
      return (
        `No hay nada que pagarle: ${this.tercero()} quedó debiendo ` +
        `${this.enPesos(liq.le_queda_debiendo)} porque los anticipos que se le entregaron ` +
        `suman más que esta quincena. ${cierre}`
      );
    }
    // Ya no queda ningún caso por explicar: con saldo en cero hay botón (ver
    // `puedeCerrarSinPago`) y con saldo por pagar también. Se devuelve null en vez de un
    // texto de relleno, que es lo que dejaría a la pantalla diciendo "no hay nada que
    // pagar" al lado de un botón para cerrarla.
    return null;
  });

  /** El tooltip del botón dice para qué sirve y, si aplica, lo que va a costar. */
  readonly tooltipRecalcular = computed(() => {
    const liq = this.liq();
    const base =
      liq.tipo === 'transportador'
        ? 'Vuelve a calcular el flete con las tarifas de hoy del transportador y los anticipos pendientes'
        : 'Vuelve a cuadrar la liquidación con los precios y los anticipos de hoy';
    return liq.estado === 'aprobada' ? `${base}. Está aprobada: volverá a borrador` : base;
  });

  /** Lo que movió el último recálculo, o null si no se ha recalculado (o ya se cerró). */
  readonly cambio = signal<CambioDelRecalculo | null>(null);

  cerrarCambio(): void {
    this.cambio.set(null);
  }

  /**
   * Recalcula y DICE CUÁNTO CAMBIÓ.
   *
   * El total de antes se toma de lo que está en pantalla —que es lo que el dueño
   * está mirando— antes de llamar al servidor, así que no hace falta que la API
   * devuelva nada extra. Antes esto avisaba "quedaron aplicados los anticipos
   * pendientes" siempre, aunque no hubiera cambiado un peso: el dueño oprimía y
   * se quedaba sin saber si su corrección de la tarifa había entrado.
   */
  async recalcular(): Promise<void> {
    const antes = this.liq();
    // Se pregunta ANTES de oprimir, no después: recalcular una APROBADA la devuelve
    // a borrador y hay que volver a darle el visto bueno; enterarse cuando ya se ve
    // el chip en "borrador" es enterarse tarde.
    //
    // Hoy el servidor no acepta la aprobada (ver ESTADOS_QUE_ACEPTAN_RECALCULO), así
    // que el botón no se ofrece ahí y por aquí no pasa nadie. El guardia se queda
    // puesto —y probado— porque es la mitad de la pantalla que le falta a ese
    // cambio: sin él, el día que el backend la acepte, la liquidación aprobada del
    // dueño amanecería en borrador sin que nadie le hubiera avisado.
    if (antes.estado === 'aprobada' && !(await this.confirmarVolverABorrador())) return;

    this.procesando.set(true);
    try {
      const despues = await firstValueFrom(this.servicio.recalcular(antes.id));
      // Lo que se pinta es SIEMPRE lo que respondió el servidor, y la comparación
      // se hace contra lo que estaba en pantalla: las dos cifras del aviso son
      // reales, ninguna se calcula aquí.
      this.liq.set(despues);
      const cambio = this.compararCifras(antes, despues);
      this.cambio.set(cambio);
      this.snackbar.open(cambio.aviso ? `${cambio.titulo}. ${cambio.aviso}` : cambio.titulo, 'OK', {
        duration: 9000,
      });
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible recalcular la liquidación');
    } finally {
      this.procesando.set(false);
    }
  }

  /** Le avisa que la aprobada va a volver a borrador. Cerrar sin confirmar = no. */
  private async confirmarVolverABorrador(): Promise<boolean> {
    const liq = this.liq();
    const conQue =
      liq.tipo === 'transportador'
        ? 'las tarifas de hoy del transportador y los anticipos registrados'
        : 'los precios y los anticipos registrados hoy';
    const confirmado = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            titulo: 'Esta liquidación está aprobada',
            mensaje:
              `Recalcular vuelve a calcular las cifras de ${this.tercero()} con ${conQue}. ` +
              'Como ya está aprobada, VOLVERÁ A BORRADOR y tendrá que revisarla y aprobarla ' +
              'otra vez. Todavía no se le ha pagado nada, así que no se mueve plata entregada.',
            accion: 'Recalcular',
            // Explícito: el mensaje dice "borrador" y el detector de verbos
            // destructivos del diálogo lo tomaría por "borrar" y lo pintaría de
            // rojo. Recalcular no borra nada.
            peligro: false,
          },
        })
        .afterClosed(),
    );
    return confirmado === true;
  }

  /**
   * Las cifras del resumen que se comparan, en el orden en que se leen.
   *
   * En la del TRANSPORTADOR el flete va primero porque es su cifra —y la del caso
   * real: una tarifa mal tecleada—, y por eso encabeza el aviso. Ahí el valor
   * total ES el flete, así que no se repite como renglón aparte: dos veces la
   * misma plata con dos rótulos distintos se lee como un descuadre.
   */
  private renglonesComparables(tipo: Liquidacion['tipo']): RenglonComparable[] {
    const litros: RenglonComparable = {
      etiqueta: 'Total litros',
      frase: 'Los litros pasaron',
      leer: (liq) => liq.total_litros,
      litros: true,
    };
    const anticipos: RenglonComparable = {
      etiqueta: 'Anticipos aplicados',
      frase: 'Los anticipos aplicados pasaron',
      leer: (liq) => liq.anticipos,
    };
    /*
     * EL SALDO ANTERIOR NO LO RECALCULA NADIE: no sale de las recepciones, es plata que
     * se arrastra de una quincena pasada y ya quedó cobrada acá. Se compara igual, y a
     * propósito: si algún día se moviera, el dueño tiene que verlo en la cara —es un
     * descuento sobre su comprobante—, no descubrirlo cuadrando el papel a mano. Si no se
     * mueve (lo normal), el renglón no aparece en el aviso.
     */
    const saldoAnterior: RenglonComparable = {
      etiqueta: ROTULO_SALDO_ANTERIOR,
      frase: 'Lo que quedó debiendo de la quincena pasada pasó',
      leer: (liq) => liq.saldo_anterior ?? '0',
    };
    const saldo: RenglonComparable = {
      etiqueta: 'Saldo a pagar',
      frase: 'El saldo a pagar pasó',
      leer: (liq) => liq.saldo,
    };
    if (tipo === 'transportador') {
      return [
        {
          etiqueta: 'Valor transporte',
          frase: 'El flete pasó',
          leer: (liq) => liq.valor_transporte,
        },
        litros,
        anticipos,
        saldoAnterior,
        saldo,
      ];
    }
    return [
      { etiqueta: 'Valor bruto', frase: 'El valor bruto pasó', leer: (liq) => liq.valor_bruto },
      litros,
      {
        // El rótulo es el de la NOTA de abajo y no "Valor transporte", que era el del
        // renglón que este trabajo le quitó al resumen del proveedor: a él el flete no
        // se le descuenta, y el aviso no puede nombrar un renglón que ya no está.
        etiqueta: 'Flete de esta leche',
        frase: 'El flete de esta leche pasó',
        leer: (liq) => liq.valor_transporte,
      },
      anticipos,
      { etiqueta: 'Valor total', frase: 'El valor total pasó', leer: (liq) => liq.valor_total },
      saldoAnterior,
      saldo,
    ];
  }

  /**
   * Una cifra en CENTAVOS ENTEROS, para comparar.
   *
   * En centavos y no restando decimales porque la coma flotante se desvía por
   * fracciones de centavo y ahí saldrían cambios que no existen: "$ 44.506,32
   * pasó a $ 44.506,32". Los litros entran igual (la base los guarda con dos
   * decimales), y el nombre queda cojo pero la cuenta es la misma.
   */
  private enCentavos(valor: Monto | null | undefined): number {
    return Math.round(Number(valor ?? 0) * 100);
  }

  /**
   * ¿Cambiaron los RENGLONES aunque los totales hayan quedado iguales?
   *
   * Pasa de verdad: el reparto de centavos entre las recepciones de un día se
   * puede mover sin que el total del comprobante cambie, y un día que traía un
   * solo renglón puede quedar partido en dos rutas. Decirle "no cambió nada" con
   * el desglose distinto sería mentira, y el desglose es lo que él suma a mano.
   */
  private desgloseCambio(antes: Liquidacion, despues: Liquidacion): boolean {
    const firma = (liq: Liquidacion): string =>
      liq.detalles
        .map((detalle) =>
          [
            detalle.fecha,
            detalle.ruta_nombre ?? '',
            // Normalizado a centavos: "82" y "82.00" son la misma cifra y no
            // pueden contar como un renglón que cambió.
            this.enCentavos(detalle.litros),
            this.enCentavos(detalle.precio_litro),
            this.enCentavos(detalle.valor),
          ].join('|'),
        )
        .join('\n');
    return firma(antes) !== firma(despues);
  }

  private compararCifras(antes: Liquidacion, despues: Liquidacion): CambioDelRecalculo {
    const filas: CambioDeCifra[] = [];
    let titulo = '';
    for (const renglon of this.renglonesComparables(despues.tipo)) {
      const cifraAntes = renglon.leer(antes);
      const cifraDespues = renglon.leer(despues);
      if (this.enCentavos(cifraAntes) === this.enCentavos(cifraDespues)) continue;
      const como = (valor: Monto): string =>
        renglon.litros ? this.enLitros(valor) : this.enPesos(valor);
      filas.push({
        etiqueta: renglon.etiqueta,
        antes: como(cifraAntes),
        despues: como(cifraDespues),
      });
      // La primera cifra que cambió encabeza el aviso; las demás quedan en la
      // tabla. Por eso el orden de `renglonesComparables` no es casual.
      if (!titulo) titulo = `${renglon.frase} de ${como(cifraAntes)} a ${como(cifraDespues)}`;
    }

    if (filas.length === 0) {
      titulo = this.desgloseCambio(antes, despues)
        ? 'Recalculado: se reorganizó el desglose y las cifras grandes quedaron iguales'
        : 'Recalculado: las cifras ya estaban al día, no cambió nada';
    }

    return {
      titulo,
      filas,
      aviso:
        antes.estado === 'aprobada' && despues.estado === 'borrador'
          ? 'Volvió a borrador: revísela y apruébela otra vez.'
          : null,
    };
  }

  aprobar(): void {
    void this.ejecutar(() => this.servicio.aprobar(this.liq().id), 'Liquidación aprobada');
  }

  /**
   * Abre el diálogo de pago con el saldo pendiente prellenado.
   *
   * Antes este botón pagaba todo de un golpe sin preguntar. Ahora pasa por el
   * diálogo porque el dueño lo pidió así: "a un proveedor se le puede pagar y
   * quedar debiendo otra parte". Pagar completo sigue siendo un Enter.
   */
  pagar(): void {
    this.dialog
      .open(PagoLiquidacionFormDialog, {
        data: { id: this.liq().id, tercero: this.tercero(), saldo: this.liq().saldo },
        width: '520px',
      })
      .afterClosed()
      .subscribe((actualizada?: Liquidacion) => {
        if (!actualizada) return;
        // Lo que se pinta es SIEMPRE lo que respondió el servidor, nunca una
        // cifra calculada aquí: si algo salió distinto, se ve lo que de verdad
        // quedó guardado. (La lista se recarga sola al cerrar este diálogo.)
        this.liq.set(actualizada);
        this.snackbar.open(
          actualizada.estado === 'pagada'
            ? 'Pago registrado: la liquidación queda pagada'
            : `Pago registrado. Queda debiendo ${this.enPesos(actualizada.saldo)}`,
          'OK',
          { duration: 5000 },
        );
      });
  }

  /**
   * El tooltip del botón que cierra la quincena sin plata: por qué, y qué va a pasar.
   *
   * Las dos mitades importan. El "por qué" sale de `explicacionSaldoEnCero`, que nombra
   * los renglones que hicieron el cero (y no solo los anticipos, que era la mentira). El
   * "qué va a pasar" es que los días quedan trabados: es la consecuencia que el dueño
   * reclamó por los dos lados —"un día no debería quedar trabado si no salió plata", pero
   * "tampoco se puede dejar una quincena cerrada abierta a que le cambien las cifras"—.
   */
  readonly tooltipCerrarSinPago = computed(
    () =>
      `${this.explicacionSaldoEnCero() ?? ''} Márquela pagada para cerrarla: queda en el ` +
      'historial y sus días dejan de poder corregirse.',
  );

  /**
   * CIERRA LA QUINCENA QUE NO HAY QUE PAGAR: la marca pagada sin registrar ningún pago.
   *
   * NO PASA POR EL DIÁLOGO DE PAGO a propósito. Ese diálogo registra un abono y el
   * servidor rebota los abonos cuando el saldo no es positivo; además abriría con $0
   * prellenado, un formulario inválido y el botón muerto: un callejón sin salida. Este
   * camino es el `POST /pagar` (el `marcar_pagada` del backend), que con el saldo en cero
   * pasa por su rama de "no hay pago que registrar" y la deja PAGADA.
   *
   * Se pregunta ANTES porque cerrarla traba los días de la quincena en Recepción diaria y
   * de 'pagada' no se puede anular: enterarse después es enterarse tarde.
   */
  async cerrarSinPago(): Promise<void> {
    const confirmado = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            titulo: 'Esta quincena no hay que pagarla',
            mensaje:
              `${this.explicacionSaldoEnCero()} Marcarla PAGADA la cierra sin registrar ` +
              'ningún pago —por acá no sale plata— y desde ese momento sus días ya no se ' +
              'pueden corregir en Recepción diaria. Si todavía hay algo por revisar, ' +
              'déjela aprobada.',
            accion: 'Marcar pagada',
            // Explícito: cerrar una quincena saldada no destruye nada, y el rojo del
            // diálogo está reservado para lo que borra o anula datos.
            peligro: false,
          },
        })
        .afterClosed(),
    );
    if (confirmado !== true) return;
    await this.ejecutar(
      () => this.servicio.pagar(this.liq().id),
      'Liquidación cerrada: quedó pagada y no había plata por entregar',
    );
  }

  /**
   * Elimina un pago mal registrado. El backend baja el `pagado`, devuelve el
   * saldo y recalcula el estado (de pagada a parcial, o de parcial a aprobada).
   */
  eliminarPago(pago: PagoLiquidacion): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar pago',
          mensaje:
            `¿Eliminar el pago de ${this.enPesos(pago.valor)}? El saldo volverá a subir ` +
            'por ese valor. Esta acción no se puede deshacer.',
          accion: 'Eliminar',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => this.servicio.eliminarPago(this.liq().id, pago.id),
          'Pago eliminado: el saldo quedó al día',
        );
      });
  }

  /**
   * La misma cifra que pinta la tabla, para los textos que no pasan por la
   * plantilla (avisos y confirmaciones).
   *
   * Antes iba con `toLocaleString()` a secas, que deja "1.250,5" y hasta tres
   * decimales: el aviso decía una cifra y el resumen de al lado otra.
   */
  private enPesos(monto: unknown): string {
    return pesosExactos(monto as Monto);
  }

  /**
   * Los litros como los pinta la tabla: dos decimales y la unidad.
   *
   * Es el mismo pipe de la plantilla, instanciado una sola vez, para que el aviso
   * del recálculo y el resumen de WhatsApp no puedan decir "82 L" donde la
   * columna dice "81,99 L".
   */
  private readonly litrosPipe = new CantidadPipe();

  private enLitros(monto: unknown): string {
    return this.litrosPipe.transform(monto as Monto, 'L', 2);
  }

  anular(): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Anular liquidación',
          mensaje:
            '¿Anular esta liquidación? Las recepciones y anticipos del período quedarán disponibles para volver a liquidar.',
          accion: 'Anular',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(() => this.servicio.anular(this.liq().id), 'Liquidación anulada');
      });
  }

  async descargarPdf(): Promise<void> {
    this.descargando.set(true);
    try {
      await firstValueFrom(this.servicio.descargarPdf(this.liq().id));
    } catch (err) {
      // Con `catch {` se perdía el mensaje que el interceptor sí había generado
      // ("Sin conexión…", "El servidor tardó demasiado…") y quedaba un texto fijo
      // que no dice qué pasó ni qué hacer.
      this.snackbar.open(detalleDeError(err, 'No fue posible descargar el PDF'), 'OK', {
        duration: 5000,
      });
    } finally {
      this.descargando.set(false);
    }
  }

  async compartir(): Promise<void> {
    this.compartiendo.set(true);
    try {
      const blob = await firstValueFrom(this.servicio.pdfBlob(this.liq().id));
      const nombre = `liquidacion_${this.tercero()}.pdf`.replace(/\s+/g, '_');
      const resultado = await compartirArchivo(
        blob,
        nombre,
        `Liquidación de ${this.tercero()}`,
        `Recibo de liquidación de ${this.tercero()}`,
      );
      if (resultado === 'descargado') {
        this.snackbar.open(
          'Tu dispositivo no permite compartir directamente; se descargó el PDF',
          'OK',
          { duration: 4000 },
        );
      }
    } catch (err) {
      this.snackbar.open(detalleDeError(err, 'No fue posible compartir el recibo'), 'OK', {
        duration: 5000,
      });
    } finally {
      this.compartiendo.set(false);
    }
  }

  /**
   * Abre WhatsApp con un resumen en texto de la liquidación.
   *
   * SALE DEL MISMO RESUMEN QUE PINTA LA PANTALLA (`renglonesResumen`), renglón por
   * renglón y en el mismo orden. Antes este mensaje traía cuatro cifras escogidas a
   * mano —litros, valor total y el saldo— y le faltaban los descuentos del medio: el
   * tercero recibía un "Valor total: $44.506,32 / Le queda debiendo: $4.955,77" que no
   * se puede cuadrar, porque los anticipos que explican la diferencia no estaban.
   * Ahora el chat, la pantalla y el papel dicen lo mismo y en el mismo orden; el
   * renglón nuevo de lo que quedó debiendo de la quincena pasada entra solo.
   *
   * Y el último renglón cambia igual que en la pantalla y en el PDF cuando la cuenta
   * queda por debajo de cero: acá el mensaje llega SUELTO, sin la tabla alrededor, así
   * que un "Saldo a pagar: -$120.000,00" reenviado al proveedor es peor todavía.
   */
  enviarWhatsApp(): void {
    const l = this.liq();
    const renglones = this.renglonesResumen()
      .map((renglon) => `${renglon.etiqueta}: ${renglon.texto}`)
      .join('\n');
    const texto =
      `*Liquidación de ${this.tercero()}*\n` +
      `Período: ${comoFecha(l.periodo_inicio)} al ${comoFecha(l.periodo_fin)}\n` +
      renglones;
    compartirWhatsApp(texto);
  }

  private async ejecutar(
    accion: () => Observable<Liquidacion>,
    mensaje: string,
  ): Promise<void> {
    // El aviso del recálculo habla de un antes y un ahora que dejan de ser los de
    // la pantalla en cuanto se aprueba, se paga o se anula: se cierra.
    this.cambio.set(null);
    this.procesando.set(true);
    try {
      const actualizada = await firstValueFrom(accion());
      this.liq.set(actualizada);
      this.snackbar.open(mensaje, 'OK', { duration: 3000 });
    } catch (err) {
      // Aprobar/pagar/anular SÍ guardan: si el resultado quedó en duda, el aviso
      // se queda hasta que el usuario lo cierre.
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible completar la acción');
    } finally {
      this.procesando.set(false);
    }
  }
}
