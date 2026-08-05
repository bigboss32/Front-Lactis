import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { Monto } from '../../core/models';
import { dateToIso, hoyDate, isoToDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { EnUnidadPipe, MoneyPipe } from '../../shared/pipes';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import {
  DocumentoReventa,
  DocumentoReventaPayload,
  DocumentoReventaUpdatePayload,
  MAX_RENGLONES,
  RenglonCompraPayload,
  RenglonVentaPayload,
  ReventaService,
  TipoCompra,
  TipoDocumento,
  TipoVenta,
  Unidad,
} from './reventa.service';

/** Precio de venta de queso sugerido por kilo (del cuaderno del dueño). */
const PRECIO_VENTA_SUGERIDO = 19500;

/**
 * Redondea a centavos, EXACTAMENTE como el backend redondea cada renglón antes de
 * sumarlos (`(cantidad * precio).quantize(DOS_DECIMALES)`).
 *
 * Importa que se redondee renglón por renglón y no al final: si aquí se sumara
 * primero y se redondeara después, el recibo podría mostrar un peso de diferencia
 * contra lo que guarda el servidor, y el desglose dejaría de sumar exacto la cifra
 * grande. El dueño cuadra esas cuentas a mano.
 */
function aCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Un producto que puede ir en un renglón, CON SU UNIDAD PEGADA.
 *
 * La unidad no la elige el usuario en un campo aparte: viene con el producto, que
 * es como funciona el negocio (la mozzarella entra y sale por barra, el queso se
 * pesa). Es la misma regla que el backend tiene en `unidad_de`, escrita una sola
 * vez de este lado.
 */
interface ProductoDeRenglon {
  /** El `tipo` que viaja al backend. */
  tipo: TipoVenta;
  etiqueta: string;
  unidad: Unidad;
  /** Precio por unidad que se propone al escogerlo. null = no se propone nada. */
  sugerido: number | null;
}

/**
 * Qué se puede vender. El queso sugiere su precio de siempre; la borona y la
 * mozzarella NO sugieren ninguno: el precio de una barra no tiene nada que ver con
 * el de un kilo de queso, y dejar 19.500 puesto en un campo "por barra" invitaría a
 * guardarlo sin pensar.
 */
const PRODUCTOS_VENTA: ProductoDeRenglon[] = [
  { tipo: 'queso', etiqueta: 'Queso', unidad: 'kg', sugerido: PRECIO_VENTA_SUGERIDO },
  { tipo: 'borona', etiqueta: 'Borona', unidad: 'kg', sugerido: null },
  { tipo: 'mozzarella', etiqueta: 'Mozzarella', unidad: 'barra', sugerido: null },
];

/** Qué se le compra al productor. La borona no se compra: llega con el queso. */
const PRODUCTOS_COMPRA: ProductoDeRenglon[] = [
  { tipo: 'queso', etiqueta: 'Queso', unidad: 'kg', sugerido: null },
  { tipo: 'mozzarella', etiqueta: 'Mozzarella', unidad: 'barra', sugerido: null },
];

/** En qué se mide un producto. Una sola función para la pregunta. */
function unidadDe(tipo: string | null | undefined): Unidad {
  return tipo === 'mozzarella' ? 'barra' : 'kg';
}

/**
 * La cantidad tiene que caber en la unidad DEL PRODUCTO DE SU MISMO RENGLÓN.
 *
 * Las barras se cuentan por unidades completas y el backend RECHAZA "8,5 barras"
 * (no las redondea), así que el formulario no puede ofrecer algo que se va a
 * devolver con error. Se valida contra el hermano `producto` del renglón, no contra
 * un estado del componente: así el renglón 2 puede ser de barras mientras el 1 es
 * de kilos, que es todo el punto de esta pantalla.
 */
function cantidadDeLaUnidad(control: AbstractControl): ValidationErrors | null {
  const grupo = control.parent;
  if (!grupo) return null;
  const valor = Number(control.value);
  // Vacío o no numérico ya lo dicen `required` y `min`: aquí no se repite.
  if (control.value === null || control.value === '' || !Number.isFinite(valor)) return null;
  if (unidadDe(grupo.get('producto')?.value) !== 'barra') return null;
  return Number.isInteger(valor) ? null : { barrasEnteras: true };
}

/** Lo que el diálogo recibe: de qué clase es la factura y, si se edita, cuál. */
export interface DocumentoFormData {
  tipo: TipoDocumento;
  item?: DocumentoReventa;
}

/**
 * LA FACTURA DE REVENTA: una compra o una venta CON VARIOS PRODUCTOS.
 *
 * Se ve como un RECIBO y no como un formulario, y a propósito: la cabecera son dos
 * campos (cuándo y a quién), debajo van los productos uno por renglón —producto,
 * cantidad, precio, la plata del renglón y una papelera— y al pie la cuenta escrita.
 * Los gastos de vender arrancan PLEGADOS porque la enorme mayoría de las ventas no
 * lleva ninguno. El resultado es que una factura de tres productos tiene MENOS
 * campos a la vista que la de un solo producto de antes.
 *
 * LA UNIDAD VIENE CON EL PRODUCTO. Al escogerlo, el sufijo de la cantidad pasa a kg
 * o a barras, el rótulo del precio con él y el campo acepta o rechaza decimales
 * solo. Por eso aquí NO hay dos pares de campos con uno apagado esperando la otra
 * unidad, ni un `_sincronizarUnidad` que los prenda y los apague.
 *
 * EL PIE TIENE QUE SUMAR EXACTO. Cada renglón se redondea a centavos igual que en
 * el servidor (ver `aCentavos`) y el total es la suma de esos renglones impresos y
 * de nada más. El dueño lo cuadra a mano y un centavo de diferencia es un defecto.
 *
 * UN SOLO COMPONENTE PARA LAS DOS CLASES DE FACTURA, y no dos casi iguales: lo que
 * cambia entre comprar y vender es el catálogo de productos, el rótulo del tercero
 * y que la venta tiene gastos y pago de contado. Todo lo demás —los renglones, la
 * unidad por producto, el recibo, el candado de los abonos— es idéntico, y tenerlo
 * escrito dos veces es tenerlo arreglado una sola el día que haya que arreglarlo.
 */
@Component({
  selector: 'app-documento-reventa-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatCheckboxModule,
    MatTooltipModule, MatDatepickerModule, MatAutocompleteModule,
    MoneyPipe, EnUnidadPipe, MilesInputDirective, SpinnerBoton,
  ],
  templateUrl: './documento-form.dialog.html',
  styles: `
    .cabecera {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 4px 16px;
      padding-top: 8px;
    }

    .seccion {
      margin: 8px 0 2px;
      font-size: 1rem;
      font-weight: 500;
    }

    .ayuda {
      margin: 0 0 10px;
      font-size: 0.84rem;
      line-height: 1.45;
      color: var(--mat-sys-on-surface-variant);
    }

    /* Un renglón del recibo: producto, cantidad, precio, su plata y la papelera.
       Misma rejilla que las líneas de producto de la venta de la quesera, para que
       las dos pantallas se lean igual. */
    .renglon {
      display: grid;
      grid-template-columns: minmax(140px, 1.4fr) 110px 140px 120px 40px;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }

    .subtotal-renglon {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    /* En celular y tablet las cinco columnas no caben en el diálogo: el renglón se
       reacomoda como tarjeta apilada. 900px = el mismo corte del resto del sistema. */
    @media (max-width: 900px) {
      .renglon {
        grid-template-columns: 1fr 1fr;
        grid-template-areas:
          'producto producto'
          'cantidad precio'
          'subtotal borrar';
        gap: 8px 12px;
        padding: 12px;
        margin-bottom: 12px;
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 10px;
      }
      .renglon > *:nth-child(1) { grid-area: producto; }
      .renglon > *:nth-child(2) { grid-area: cantidad; }
      .renglon > *:nth-child(3) { grid-area: precio; }
      .renglon .subtotal-renglon {
        grid-area: subtotal;
        text-align: left;
        align-self: center;
        font-weight: 600;
      }
      .renglon > button { grid-area: borrar; justify-self: end; }
    }

    .agregar { margin: 4px 0 12px; }

    /* El plegable de los gastos: una línea que se lee como un renglón más y dice
       cuánto hay adentro sin obligar a abrirlo. */
    .plegable {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      margin: 4px 0 12px;
      padding: 10px 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 10px;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;

      &:hover { background: var(--mat-sys-surface-container-high); }
      .rotulo { flex: 1; }
      mat-icon { flex: none; color: var(--mat-sys-on-surface-variant); }
    }

    .pastilla {
      padding: 1px 10px;
      border-radius: 10px;
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      background: color-mix(in srgb, #b26a00 18%, transparent);
      color: #b26a00;
    }
    .pastilla.neutra {
      font-weight: 500;
      background: color-mix(in srgb, currentColor 12%, transparent);
      color: var(--mat-sys-on-surface-variant);
    }
    :host-context(html.dark) .pastilla { color: #ffb74d; }

    .gastos {
      margin: -4px 0 12px;
      padding: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 10px;

      .concepto { width: 100%; margin-bottom: 12px; }
    }

    /* La tarifa de un producto: su nombre, cuánto por unidad y lo que suma. */
    .gasto-renglon {
      display: grid;
      grid-template-columns: minmax(90px, 1fr) 150px 120px;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;

      .nombre { color: var(--mat-sys-on-surface-variant); }
      .gasto-total {
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
    }
    @media (max-width: 900px) {
      .gasto-renglon {
        grid-template-columns: 1fr auto;
        grid-template-areas:
          'nombre nombre'
          'tarifa total';
      }
      .gasto-renglon .nombre { grid-area: nombre; font-weight: 600; }
      .gasto-renglon mat-form-field { grid-area: tarifa; }
      .gasto-renglon .gasto-total { grid-area: total; align-self: center; }
    }

    /* EL RECIBO. Alineado a la derecha y con cifras tabulares, para poder recorrer
       la columna con el dedo y sumarla. */
    .cuenta {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      margin: 12px 0 16px;
      padding-top: 10px;
      border-top: 1px solid var(--mat-sys-outline-variant);

      .renglon-cuenta {
        display: flex;
        gap: 24px;
        font-size: 0.88rem;
        span { color: var(--mat-sys-on-surface-variant); }
        strong { min-width: 120px; text-align: right; font-variant-numeric: tabular-nums; }
      }
      .total-final {
        margin-top: 4px;
        padding-top: 6px;
        font-size: 1.05rem;
        border-top: 1px solid var(--mat-sys-outline-variant);
        span { color: var(--mat-sys-on-surface); }
      }
      /* Los gastos van DESPUÉS del total y separados: antes se leerían como que
         están incluidos en lo que paga el cliente. */
      .bloque-gastos {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        margin-top: 4px;
        padding-top: 6px;
        border-top: 1px solid var(--mat-sys-outline-variant);
      }
      .aparte {
        display: flex;
        gap: 24px;
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.86rem;
        strong { min-width: 120px; text-align: right; font-variant-numeric: tabular-nums; }
      }
      .cuenta-gasto { font-size: 0.8rem; }
      .sin-cuenta {
        align-self: stretch;
        margin: 0;
        font-size: 0.86rem;
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .obs { width: 100%; }
    mat-checkbox { display: block; margin: 4px 0 8px; }
    .nota-contado { color: var(--mat-sys-on-surface-variant); font-size: 0.86rem; }

    /* Aviso de factura con abonos: los campos de los productos quedan a la vista
       pero apagados, así que hay que decir por qué ANTES de que intente escribir. */
    .aviso-abonos {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font-size: 0.86rem;
      line-height: 1.45;

      mat-icon { flex: none; font-size: 20px; width: 20px; height: 20px; }
    }

    // Aviso de que se van a perder soportes: ámbar, porque es una advertencia sobre
    // algo que se borra y no una explicación de cómo funciona la pantalla.
    .aviso-soportes {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: color-mix(in srgb, #b26a00 16%, transparent);
      color: var(--mat-sys-on-surface);
      font-size: 0.86rem;
      line-height: 1.45;

      mat-icon { flex: none; font-size: 20px; width: 20px; height: 20px; color: #b26a00; }
    }

    :host-context(html.dark) .aviso-soportes mat-icon { color: #ffb74d; }
  `,
})
export class DocumentoReventaFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<DocumentoReventaFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<DocumentoFormData>(MAT_DIALOG_DATA);
  readonly esVenta = this.data.tipo === 'venta';
  readonly editando = !!this.data.item;
  readonly maxRenglones = MAX_RENGLONES;

  /**
   * La factura ya tiene plata recibida (o pagada). Los abonos cuelgan de los
   * PRODUCTOS, así que rehacerlos sería mover pagos ya recibidos a productos
   * distintos de los que el dueño tenía al frente. El backend lo rechaza con un
   * 422; aquí se apagan los campos y se dice por qué, que es mejor que dejarlo
   * escribir para devolverle un error después.
   */
  readonly conAbonos = Number(this.data.item?.abonado ?? 0) > 0;
  readonly abonado: Monto = this.data.item?.abonado ?? 0;

  readonly catalogo = this.esVenta ? PRODUCTOS_VENTA : PRODUCTOS_COMPRA;
  readonly guardando = signal(false);
  readonly gastosAbiertos = signal(false);
  /** Nombres ya usados (clientes o productores), para autocompletar. */
  private readonly nombres = signal<string[]>([]);

  /** "Nueva venta" / "Editar compra": el verbo va primero, que es lo que se busca. */
  readonly titulo = `${this.editando ? 'Editar' : 'Nueva'} ${this.esVenta ? 'venta' : 'compra'}`;
  /** El botón dice QUÉ va a pasar, no "Guardar" a secas. */
  readonly rotuloGuardar = this.editando
    ? 'Guardar cambios'
    : `Registrar ${this.esVenta ? 'venta' : 'compra'}`;

  readonly form = this.fb.group({
    fecha: [hoyDate(), Validators.required],
    tercero: ['', [Validators.required, Validators.minLength(2)]],
    observaciones: [''],
    /** El concepto es UNO para la factura: es el mismo flete de todo el despacho. */
    gasto_concepto: [''],
    pagada_de_contado: [false],
    renglones: this.fb.array([this.nuevoRenglon()]),
  });

  /** Re-emite en cada cambio para recalcular el recibo en vivo. */
  private readonly cambios = toSignal(this.form.valueChanges);

  get renglones() {
    return this.form.controls.renglones;
  }

  constructor() {
    firstValueFrom(this.servicio.sugerencias())
      .then((s) => this.nombres.set(this.esVenta ? s.clientes : s.productores))
      .catch(() => undefined);

    if (this.data.item) this.cargar(this.data.item);
    protegerCambios(this.dialogRef, () => this.form);
  }

  // --------------------------------------------------------------- renglones
  /**
   * Un renglón vacío: el producto por omisión, la cantidad y el precio EN BLANCO
   * (no en cero).
   *
   * En blanco y no en cero a propósito: un cero guardado sin darse cuenta es plata
   * que no se le cobra a nadie, y encima con `min(0.01)` el cero deja el formulario
   * inválido sin que se vea por qué. Vacío salta el `required` y se ve el mensaje.
   * La excepción es el precio del queso al vender, que sí se propone porque es el
   * mismo de siempre y el dueño lo confirma de un vistazo.
   */
  private nuevoRenglon(datos?: {
    producto?: TipoVenta;
    cantidad?: number | null;
    precio?: number | null;
    gasto?: number | null;
    borona?: number;
  }) {
    const producto = datos?.producto ?? this.catalogoInicial();
    return this.fb.group({
      producto: [producto, Validators.required],
      cantidad: [
        datos?.cantidad ?? null,
        [Validators.required, Validators.min(0.01), cantidadDeLaUnidad],
      ],
      precio: [
        datos?.precio ?? this.sugeridoDe(producto),
        [Validators.required, Validators.min(0.01)],
      ],
      /** La tarifa del gasto POR UNIDAD de este producto. Solo la venta la usa. */
      gasto: [datos?.gasto ?? null, [Validators.min(0)]],
      /**
       * Borona que llegó GRATIS con este queso (solo en las compras). No tiene
       * campo en la pantalla y aquí viaja escondida a propósito: rehacer los
       * renglones sin ella le borraría al negocio borona que ya tiene en la
       * bodega, y esa borona sí se vende.
       */
      borona: [datos?.borona ?? 0],
    });
  }

  /** El producto que trae puesto un renglón nuevo: el primero del catálogo. */
  private catalogoInicial(): TipoVenta {
    return this.catalogo[0].tipo;
  }

  private sugeridoDe(tipo: TipoVenta): number | null {
    return this.catalogo.find((p) => p.tipo === tipo)?.sugerido ?? null;
  }

  /**
   * `markAsDirty` A MANO, y no es cosmético: `push`/`removeAt` NO ensucian el
   * formulario, y de ese "sucio" dependen dos cosas —que al cerrar el diálogo se
   * avise de los cambios sin guardar, y que al editar se sepa si hay que REHACER los
   * productos (ver `paraEditar`)—. Sin esto, un producto agregado se perdía al
   * guardar sin decir nada.
   */
  agregarRenglon(): void {
    if (this.renglones.length >= MAX_RENGLONES) return;
    this.renglones.push(this.nuevoRenglon());
    this.renglones.markAsDirty();
  }

  /** Nunca deja la factura sin productos: una factura de cero renglones no existe. */
  quitarRenglon(indice: number): void {
    if (this.renglones.length <= 1) return;
    this.renglones.removeAt(indice);
    this.renglones.markAsDirty();
  }

  /**
   * Cambió el producto de un renglón, y con él SU UNIDAD.
   *
   * Se hace desde `(selectionChange)` y no suscribiéndose a `valueChanges`: así
   * corre solo cuando lo cambia el USUARIO y no cuando el formulario se llena con
   * una factura guardada, que era la forma de pisarle el precio a lo que ya estaba
   * registrado.
   *
   * El precio y la tarifa del gasto se limpian porque cambian de unidad: un
   * "$19.500 por kilo" convertido en "$19.500 por barra" es otra plata, y un
   * "$700 por kilo" cobrado sobre barras no significa nada.
   */
  productoCambio(indice: number, tipo: TipoVenta): void {
    const fila = this.renglones.at(indice);
    fila.controls.precio.setValue(this.sugeridoDe(tipo));
    fila.controls.gasto.setValue(null);
    // La cantidad se revalida contra la unidad nueva: un "2,5" que era válido en
    // kilos deja de serlo en barras, y hay que decirlo en el momento.
    fila.controls.cantidad.updateValueAndValidity();
  }

  esDeBarras(indice: number): boolean {
    return unidadDe(this.renglones.at(indice).controls.producto.value) === 'barra';
  }

  etiquetaDe(indice: number): string {
    const tipo = this.renglones.at(indice).controls.producto.value;
    return this.catalogo.find((p) => p.tipo === tipo)?.etiqueta ?? 'Producto';
  }

  alternarGastos(): void {
    this.gastosAbiertos.update((abierto) => !abierto);
  }

  readonly terceros = computed(() => {
    this.cambios();
    const texto = (this.form.controls.tercero.value ?? '').toLowerCase().trim();
    const todos = this.nombres();
    const filtrados = texto ? todos.filter((n) => n.toLowerCase().includes(texto)) : todos;
    return filtrados.slice(0, 20);
  });

  // ----------------------------------------------------------------- la plata
  /**
   * La cantidad tal como la va a guardar el servidor: los kilos redondeados a los
   * DOS decimales que caben en la base, las barras tal cual (son enteras).
   *
   * Se normaliza antes de multiplicar porque el servidor también lo hace: si aquí
   * se multiplicara por 10,005 y allá por 10,01, el recibo mostraría una plata y
   * la base guardaría otra.
   */
  private cantidadReal(producto: TipoVenta, cantidad: number | null): number {
    const valor = Number(cantidad || 0);
    if (!Number.isFinite(valor)) return 0;
    return unidadDe(producto) === 'barra' ? valor : aCentavos(valor);
  }

  /**
   * La plata de cada renglón, redondeada a centavos una por una (ver `aCentavos`).
   *
   * UN RENGLÓN CON UNA CANTIDAD IMPOSIBLE NO TIENE PLATA QUE SUMAR y vale cero acá:
   * "2,5 barras" no es una cantidad, así que imprimir "3 barras × $21.999 =
   * $54.997,50" —redondeando el rótulo pero no la cuenta— sería una multiplicación
   * que no da. Mientras eso pase el botón Guardar está apagado, así que no hay forma
   * de guardar una factura a la que le falte un renglón de la cuenta.
   */
  readonly subtotales = computed(() => {
    this.cambios();
    return this.renglones.controls.map((fila) => {
      if (fila.controls.cantidad.invalid) return 0;
      const v = fila.getRawValue();
      return aCentavos(this.cantidadReal(v.producto, v.cantidad) * Number(v.precio || 0));
    });
  });

  /**
   * El total: la SUMA de los renglones ya redondeados. Es la misma cuenta del
   * servidor y la misma que imprime el recibo de abajo, renglón por renglón.
   */
  readonly total = computed(() => this.subtotales().reduce((suma, valor) => suma + valor, 0));

  /** El gasto de cada renglón EN PESOS: su tarifa por unidad × su cantidad. */
  readonly gastosRenglon = computed(() => {
    this.cambios();
    return this.renglones.controls.map((fila) => {
      // Mismo criterio que en `subtotales`: sin una cantidad posible no hay cuenta.
      if (fila.controls.cantidad.invalid) return 0;
      const v = fila.getRawValue();
      return aCentavos(this.cantidadReal(v.producto, v.cantidad) * Number(v.gasto || 0));
    });
  });

  readonly gastoTotal = computed(() =>
    this.gastosRenglon().reduce((suma, valor) => suma + valor, 0),
  );

  readonly conceptoGasto = computed(() => {
    this.cambios();
    return this.form.controls.gasto_concepto.value?.trim() || 'Gastos de vender';
  });

  /**
   * Cuántos soportes de pago se van a perder si se guarda con los productos
   * cambiados.
   *
   * Rehacer los productos se lleva sus soportes del almacenamiento (ver
   * `paraEditar`), así que se avisa ANTES de guardar y se manda al camino que no los
   * toca: el lápiz de cada producto en la lista, que corrige la cantidad y el precio
   * por el `PUT` del renglón y deja las fotos donde están.
   */
  readonly soportesEnRiesgo = computed(() => {
    this.cambios();
    if (!this.data.item || this.conAbonos || !this.renglones.dirty) return 0;
    // Anotado con la forma mínima: los renglones son de compra o de venta, y lo
    // único que hace falta de ellos es el contador de soportes.
    const renglones: { adjuntos_count: number }[] = this.data.item.renglones;
    return renglones.reduce((suma, r) => suma + (r.adjuntos_count || 0), 0);
  });

  /**
   * El desglose que se IMPRIME al pie: un renglón por producto con su cuenta
   * escrita. Se arma acá y no en la plantilla para que el total sea literalmente la
   * suma de estos renglones.
   *
   * Se dejan por fuera los que todavía valen cero (el usuario acabó de agregar el
   * renglón y no ha escrito nada): suman cero, así que no rompen la igualdad, y
   * solo harían ruido en la cuenta.
   */
  readonly desglose = computed(() => {
    const totales = this.subtotales();
    return this.renglones.controls
      .map((fila, indice) => {
        const v = fila.getRawValue();
        return {
          etiqueta: this.catalogo.find((p) => p.tipo === v.producto)?.etiqueta ?? 'Producto',
          unidad: unidadDe(v.producto),
          cantidad: this.cantidadReal(v.producto, v.cantidad),
          precio: Number(v.precio || 0),
          total: totales[indice],
        };
      })
      .filter((r) => r.total > 0);
  });

  /** Lo mismo para los gastos: cada producto con su tarifa y lo que suma. */
  readonly desgloseGastos = computed(() => {
    const totales = this.gastosRenglon();
    return this.renglones.controls
      .map((fila, indice) => {
        const v = fila.getRawValue();
        return {
          etiqueta: this.catalogo.find((p) => p.tipo === v.producto)?.etiqueta ?? 'Producto',
          unidad: unidadDe(v.producto),
          cantidad: this.cantidadReal(v.producto, v.cantidad),
          porUnidad: Number(v.gasto || 0),
          total: totales[indice],
        };
      })
      .filter((g) => g.total > 0);
  });

  // ----------------------------------------------------------------- edición
  /**
   * Llena el formulario con una factura guardada.
   *
   * La cantidad y el precio se leen del par de campos de LA UNIDAD del renglón
   * (`unidad` la manda el backend), nunca escogiendo "el que no sea cero": en una
   * venta de barras los campos de kilos vienen en cero de verdad.
   *
   * En las compras la cantidad es `kilos_brutos` y NO `kilos_netos`: brutos es lo
   * que se le compró y lo que hay que volver a mandar; netos es una cifra derivada.
   */
  private cargar(documento: DocumentoReventa): void {
    this.form.patchValue({
      fecha: isoToDate(documento.fecha) ?? hoyDate(),
      tercero: documento.tercero,
      observaciones: documento.observaciones ?? '',
    });

    this.renglones.clear();
    if (documento.tipo === 'venta') {
      for (const r of documento.renglones) {
        const deBarras = r.unidad === 'barra';
        this.renglones.push(
          this.nuevoRenglon({
            producto: r.tipo,
            cantidad: Number(deBarras ? r.barras : r.kilos),
            precio: Number(deBarras ? r.precio_barra : r.precio_kilo),
            gasto: Number(deBarras ? r.gasto_por_barra : r.gasto_por_kilo) || null,
          }),
        );
      }
      // El concepto se adopta del primer renglón que traiga uno: es el mismo flete
      // de toda la factura. Solo es un rótulo, no mueve plata.
      const conConcepto = documento.renglones.find((r) => r.gasto_concepto);
      if (conConcepto?.gasto_concepto) {
        this.form.controls.gasto_concepto.setValue(conConcepto.gasto_concepto);
      }
      // La sección se abre sola si la factura YA trae gastos: si no, el dueño
      // abriría una venta con flete y no vería por ninguna parte de dónde sale la
      // diferencia entre el total y lo que le queda.
      if (this.gastoTotal() > 0) this.gastosAbiertos.set(true);
    } else {
      for (const r of documento.renglones) {
        const deBarras = r.unidad === 'barra';
        this.renglones.push(
          this.nuevoRenglon({
            producto: r.tipo,
            cantidad: Number(deBarras ? r.barras : r.kilos_brutos),
            precio: Number(deBarras ? r.precio_barra : r.precio_kilo),
            borona: Number(r.borona_kilos || 0),
          }),
        );
      }
    }

    if (this.conAbonos) {
      // Se dejan VISIBLES pero apagados, no escondidos: el dueño necesita seguir
      // viendo qué le vendió mientras corrige la fecha o el nombre.
      this.renglones.disable();
      this.form.controls.gasto_concepto.disable();
    }
  }

  // ---------------------------------------------------------------- guardar
  /**
   * Los renglones tal como los espera el backend: SOLO el par de campos de la
   * unidad del producto, y los del otro par no viajan ni en cero.
   *
   * No es una preferencia de estilo: es lo que hace imposible que un intento previo
   * en kilos se cuele en un renglón de barras. El backend lo rechazaría con el
   * CHECK de la tabla, pero un 500 de la base no le dice nada al dueño.
   */
  private renglonesDeVenta(nota: string | null): RenglonVentaPayload[] {
    const concepto = this.form.controls.gasto_concepto.value?.trim() || null;
    const filas = this.renglones.getRawValue();
    const notaDelRenglon = this.notaDelUnico(filas.length, nota);
    return filas.map((v) => {
      const cantidad = this.cantidadReal(v.producto, v.cantidad);
      const precio = Number(v.precio || 0);
      const gasto = Number(v.gasto || 0);
      return unidadDe(v.producto) === 'barra'
        ? {
            tipo: v.producto,
            barras: cantidad,
            precio_barra: precio,
            gasto_por_barra: gasto,
            gasto_concepto: concepto,
            observaciones: notaDelRenglon,
          }
        : {
            tipo: v.producto,
            kilos: cantidad,
            precio_kilo: precio,
            gasto_por_kilo: gasto,
            gasto_concepto: concepto,
            observaciones: notaDelRenglon,
          };
    });
  }

  private renglonesDeCompra(nota: string | null): RenglonCompraPayload[] {
    const filas = this.renglones.getRawValue();
    const notaDelRenglon = this.notaDelUnico(filas.length, nota);
    return filas.map((v) => {
      const cantidad = this.cantidadReal(v.producto, v.cantidad);
      const precio = Number(v.precio || 0);
      // El catálogo de compra solo ofrece queso y mozzarella, así que el producto
      // de un renglón de compra siempre es un `TipoCompra`.
      const tipo = v.producto as TipoCompra;
      return unidadDe(tipo) === 'barra'
        ? { tipo, barras: cantidad, precio_barra: precio, observaciones: notaDelRenglon }
        : {
            tipo,
            kilos_brutos: cantidad,
            precio_kilo: precio,
            // La borona que llegó gratis con este queso, tal como estaba. Ver el
            // control `borona` de `nuevoRenglon`.
            borona_kilos: Number(v.borona || 0),
            observaciones: notaDelRenglon,
          };
    });
  }

  /**
   * La nota que le toca a CADA renglón.
   *
   * En una factura de UN SOLO producto la nota de la factura ES la nota del
   * producto, así que se le copia. Es lo mismo que hace la puerta plana del backend
   * (`CompraQuesoService.crear` manda la nota a los dos lados), y está aquí para que
   * una venta de un producto quede guardada igual sin importar por dónde se
   * registró. Con VARIOS productos no se le copia a ninguno: la nota es de la
   * factura, y repetirla tres veces sería afirmar que cada producto trae esa
   * observación.
   */
  private notaDelUnico(cuantosRenglones: number, nota: string | null): string | null {
    return cuantosRenglones === 1 ? nota : null;
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const v = this.form.getRawValue();
      const cabecera = {
        fecha: dateToIso(v.fecha),
        tercero: v.tercero.trim(),
        observaciones: v.observaciones || null,
      };
      const guardada = await firstValueFrom(
        this.data.item
          ? this.servicio.editarDocumento(this.data.item.id, this.paraEditar(cabecera))
          : this.servicio.crearDocumento(this.paraCrear(cabecera)),
      );
      // Se devuelve la factura guardada y no un simple `true`: quien abrió el
      // diálogo la necesita para ofrecer «Anexar soporte» justo después, que es
      // cuando el dueño tiene a mano la foto de la transferencia. Sigue siendo un
      // valor "verdadero" para quien solo mira si se guardó.
      this.dialogRef.close(guardada);
    } catch (err) {
      avisarErrorAlGuardar(
        this.snackbar,
        err,
        this.esVenta ? 'No fue posible guardar la venta' : 'No fue posible guardar la compra',
      );
    } finally {
      this.guardando.set(false);
    }
  }

  private paraCrear(cabecera: {
    fecha: string;
    tercero: string;
    observaciones: string | null;
  }): DocumentoReventaPayload {
    if (this.esVenta) {
      return {
        tipo: 'venta',
        ...cabecera,
        renglones: this.renglonesDeVenta(cabecera.observaciones),
        pagada_de_contado: this.form.controls.pagada_de_contado.value,
      };
    }
    return {
      tipo: 'compra',
      ...cabecera,
      renglones: this.renglonesDeCompra(cabecera.observaciones),
    };
  }

  /**
   * Edición.
   *
   * `renglones` SOLO VIAJA SI EL USUARIO TOCÓ LOS PRODUCTOS, y eso no es una
   * optimización: mandar la lista significa REHACERLOS, y rehacerlos BORRA LOS
   * SOPORTES DE PAGO anexados a los productos que se van (se los lleva del
   * almacenamiento, no queda ni el archivo). Si mandáramos la lista siempre,
   * corregirle la fecha a una factura le borraría al dueño las fotos de las
   * transferencias sin que nada se lo dijera.
   *
   * No viaja tampoco cuando la factura tiene abonos: el backend no lo permite y de
   * este lado los productos están apagados.
   */
  private paraEditar(cabecera: {
    fecha: string;
    tercero: string;
    observaciones: string | null;
  }): DocumentoReventaUpdatePayload {
    const rehacer = !this.conAbonos && this.renglones.dirty;
    if (this.esVenta) {
      return {
        tipo: 'venta',
        ...cabecera,
        renglones: rehacer ? this.renglonesDeVenta(cabecera.observaciones) : null,
      };
    }
    return {
      tipo: 'compra',
      ...cabecera,
      renglones: rehacer ? this.renglonesDeCompra(cabecera.observaciones) : null,
    };
  }
}
