import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Monto } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { EnUnidadPipe, MoneyPipe, pesosExactos } from '../../shared/pipes';
import { AbonoFormDialog } from './abono-form.dialog';
import { AbonosListDialog, ParteAbonada } from './abonos-list.dialog';
import { AdjuntosDialog } from './adjuntos.dialog';
import { CompraFormDialog } from './compra-form.dialog';
import { DocumentoReventaFormDialog } from './documento-form.dialog';
import { ReventaEstadoCuentaProductorDialog } from './estado-cuenta-productor.dialog';
import { ReventaEstadoCuentaDialog } from './estado-cuenta.dialog';
import {
  AbonoReventa,
  CompraQueso,
  DocumentoReventa,
  ReventaService,
  TipoDocumento,
  Unidad,
  VentaQueso,
} from './reventa.service';
import { VentaQuesoFormDialog } from './venta-form.dialog';

/** Cómo se llama cada producto en pantalla. Una sola tabla para los tres. */
const ETIQUETAS: Record<string, string> = {
  queso: 'Queso',
  borona: 'Borona',
  mozzarella: 'Mozzarella',
};

/**
 * UN PRODUCTO de la factura, ya normalizado para la pantalla.
 *
 * Se normaliza en el componente y no en la plantilla, y es lo que hace que el
 * desglose sea idéntico en compras y en ventas: la plantilla nunca elige entre
 * `kilos` y `barras` ni entre `precio_kilo` y `precio_barra`, así que NINGUNA
 * plantilla puede imprimir "8 kg" donde hay 8 barras.
 */
interface RenglonVista {
  /** Id del RENGLÓN (la compra o la venta), que es lo que piden sus rutas. */
  id: string;
  tipo: string;
  etiqueta: string;
  unidad: Unidad;
  cantidad: number;
  precio: number;
  valorTotal: number;
  /** El gasto de vender EN PESOS. Siempre 0 en las compras. */
  gasto: number;
  /** El mismo gasto por unidad ($/kg o $/barra), para poder escribir la cuenta. */
  gastoUnitario: number;
  conceptoGasto: string | null;
  /** Borona que llegó GRATIS con este queso (solo en las compras). */
  borona: number;
  abonado: number;
  /**
   * El saldo del renglón TAL COMO LO MANDA EL SERVIDOR, con su signo: `valor_total
   * − abonado`. Puede ser NEGATIVO cuando se le rebajó el precio después de
   * pagarlo, y el signo es justamente el dato (ver `faltaPagar` y `aFavor`).
   */
  saldo: number;
  /** Lo que falta pagar de ESTE renglón: el saldo acotado en cero. */
  faltaPagar: number;
  /** Lo que se pagó de más en ESTE renglón, en positivo (0 en el caso normal). */
  aFavor: number;
  estado: string;
  anulado: boolean;
  adjuntos: number;
  abonos: AbonoReventa[];
}

/**
 * UNA FACTURA lista para pintar.
 *
 * LAS CIFRAS SON LAS DEL SERVIDOR, no recalculadas aquí: `total`, `abonado` y
 * `anulado` vienen del API, que las obtiene sumando los renglones al leer.
 * `sumaProductos` es `total + anulado`, que por contrato es exactamente la suma
 * del valor de TODOS los renglones que se imprimen abajo, anulados incluidos. Esa
 * es la igualdad que el dueño verifica a mano.
 *
 * `faltaPagar` y `aFavor` son las DOS caras del saldo, separadas: ver
 * `cifrasDelSaldo`. La segunda igualdad que el dueño verifica a mano es
 * `total − abonado + aFavor === faltaPagar`, y el desglose la imprime renglón por
 * renglón para que se pueda comprobar con la calculadora.
 */
interface DocumentoVista {
  doc: DocumentoReventa;
  id: string;
  fecha: string;
  tercero: string;
  observaciones: string | null;
  total: number;
  abonado: number;
  /** Lo que de verdad le falta pagar de esta factura (nunca negativo). */
  faltaPagar: number;
  /** Lo que quedó pagado de MÁS, en positivo. 0 en el caso normal. */
  aFavor: number;
  anulado: number;
  sumaProductos: number;
  /** Suma de los gastos de vender de los renglones vivos (0 en las compras). */
  gastos: number;
  /** Total menos los gastos: lo que la venta deja de verdad. */
  ventaLibre: number;
  estado: string;
  renglones: RenglonVista[];
  /** Cuántos soportes de pago tienen SUS productos, sumados. */
  adjuntos: number;
}

/**
 * LA LISTA DE FACTURAS de reventa, la misma para comprar y para vender.
 *
 * UNA FACTURA ES UNA FILA, con un chevron que despliega sus productos. Las columnas
 * "Cantidad" y "Precio" de antes no existen y no pueden existir: una factura de tres
 * productos distintos NO TIENE una cantidad ni un precio —"99,11 kg, 12,35 kg y 7
 * barras" no es un número—, y forzarlos en una celda sería justo la mentira que este
 * módulo evita. En su lugar va "Productos", que dice qué trae; el detalle, con la
 * cuenta escrita producto por producto, está a un toque del chevron.
 *
 * UN SOLO COMPONENTE PARA LAS DOS PESTAÑAS, y no dos casi iguales: lo que cambia es
 * el catálogo de rótulos ("Cliente" o "Productor", "por cobrar" o "por pagar"), que
 * la venta tiene gastos, y a qué diálogo de estado de cuenta se va. El desglose de
 * la plata —el que tiene que sumar exacto— es EL MISMO CÓDIGO en las dos, que es la
 * única forma de que no se descuadre en una sola de ellas.
 *
 * LOS SOPORTES CUELGAN DEL PRODUCTO, no de la factura (así están guardados). Con un
 * solo producto el clip va en la fila, como siempre; con varios va en cada producto,
 * dentro del detalle, y la fila muestra cuántos hay en total. No se inventa un
 * "soporte de la factura" que iría a parar a un producto elegido a dedo.
 */
@Component({
  selector: 'app-documento-reventa-list',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    EstadoChip, MoneyPipe, EnUnidadPipe, HasPermissionDirective,
  ],
  templateUrl: './documento-list.tab.html',
  styleUrl: './documento-list.tab.scss',
})
export class DocumentoReventaListTab {
  private readonly servicio = inject(ReventaService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  /** De qué lado está esta pestaña: facturas de compra o facturas de venta. */
  readonly tipo = input.required<TipoDocumento>();
  /** Rango de fechas que controla la página (filtro del período). */
  readonly desde = input<string | null>(null);
  readonly hasta = input<string | null>(null);
  /** Avisa a la página que hubo cambios para recargar el resumen. */
  readonly cambio = output<void>();

  readonly esVenta = computed(() => this.tipo() === 'venta');

  readonly filas = signal<DocumentoReventa[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  /**
   * Mensaje de la consulta fallida. Mientras esté puesto NO se muestra el estado
   * vacío: si el listado no cargó después de registrar un abono, decir que no hay
   * facturas hace que el abono se registre otra vez.
   */
  readonly errorCarga = signal<string | null>(null);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  /** Qué facturas están desplegadas, por id. */
  private readonly desplegadas = signal<ReadonlySet<string>>(new Set());

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly estado = new FormControl<string | null>(null);
  /**
   * El estado de pago que se está mirando, como señal.
   *
   * EL BACKEND NO SABE FILTRAR FACTURAS POR ESTADO, y no es un olvido: el estado de
   * una factura es DERIVADO de los estados de sus productos, no una columna que se
   * pueda comparar en SQL. Así que el filtro se aplica sobre la página que ya está
   * cargada, y la pantalla LO DICE (ver el aviso de la plantilla) en vez de dejar al
   * dueño creyendo que revisó todas sus facturas. Pasando de página se recorren
   * todas; lo que no se puede es contarlas de una.
   */
  private readonly filtroEstado = signal<string | null>(null);

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.estado.valueChanges.pipe(takeUntilDestroyed()).subscribe((valor) => {
      // El estado NO recarga del servidor: filtra lo que ya está en pantalla.
      this.filtroEstado.set(valor);
    });
    // Recuerda los filtros de esta pestaña durante la sesión. Va en un `effect`
    // porque la clave depende del `tipo`, que es un input y no se puede leer en el
    // constructor; el candado es para que se vincule UNA sola vez (dos veces serían
    // dos suscripciones guardando lo mismo).
    //
    // `restaurar` no dispara valueChanges a propósito (la pantalla hace su primera
    // carga aparte), así que el estado restaurado hay que copiarlo a mano a la señal.
    let vinculado = false;
    effect(() => {
      const clave = this.tipo() === 'venta' ? 'reventa-ventas' : 'reventa-compras';
      untracked(() => {
        if (vinculado) return;
        vinculado = true;
        this.estadoFiltros.vincular(
          clave,
          { buscar: this.buscar, estado: this.estado },
          this.destroyRef,
        );
        this.filtroEstado.set(this.estado.value);
      });
    });
    // Carga inicial y recarga cuando la página cambia el rango de fechas.
    effect(() => {
      this.tipo();
      this.desde();
      this.hasta();
      untracked(() => this.recargar());
    });
  }

  // ------------------------------------------------------------------- carga
  recargar(): void {
    this.page.set(1);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorCarga.set(null);
    const opciones = {
      page: this.page(),
      page_size: this.pageSize(),
      search: this.buscar.value || null,
      desde: this.desde(),
      hasta: this.hasta(),
    };
    try {
      // Dos `await` y no un ternario adentro de `firstValueFrom`: las dos ramas
      // devuelven páginas de tipos distintos (facturas de venta o de compra) y
      // TypeScript no puede unificarlas dentro de la llamada.
      const respuesta = this.esVenta()
        ? await firstValueFrom(this.servicio.listarDocumentosVenta(opciones))
        : await firstValueFrom(this.servicio.listarDocumentosCompra(opciones));
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
    } catch (err) {
      // Se limpia lo anterior: si la consulta falló, los saldos que quedaran en
      // pantalla ya no se pueden confirmar y se leerían como si fueran de hoy.
      this.filas.set([]);
      this.total.set(0);
      this.errorCarga.set(
        detalleDeError(
          err,
          this.esVenta()
            ? 'No se pudieron cargar las ventas. Revise la conexión e intente de nuevo.'
            : 'No se pudieron cargar las compras. Revise la conexión e intente de nuevo.',
        ),
      );
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    void this.cargar();
  }

  // --------------------------------------------------------- vista de la tabla
  readonly columnas = computed(() =>
    this.esVenta()
      ? [
          'expandir', 'fecha', 'tercero', 'productos', 'total', 'gastos',
          'venta_libre', 'abonado', 'saldo', 'estado', 'acciones',
        ]
      : ['expandir', 'fecha', 'tercero', 'productos', 'total', 'abonado', 'saldo', 'estado', 'acciones'],
  );

  /** Toda la página, normalizada. */
  readonly vistas = computed<DocumentoVista[]>(() =>
    this.filas().map((doc) => this.aVista(doc)),
  );

  /** Lo que se pinta: la página, recortada por el filtro de estado de pago. */
  readonly visibles = computed(() => {
    const estado = this.filtroEstado();
    const todas = this.vistas();
    return estado ? todas.filter((f) => f.estado === estado) : todas;
  });

  /** Cuántas facturas de esta página esconde el filtro de estado (0 = ninguna). */
  readonly escondidas = computed(() => this.vistas().length - this.visibles().length);

  private aVista(doc: DocumentoReventa): DocumentoVista {
    const renglones =
      doc.tipo === 'venta'
        ? doc.renglones.map((r) => this.renglonDeVenta(r))
        : doc.renglones.map((r) => this.renglonDeCompra(r));
    const total = Number(doc.total);
    const anulado = Number(doc.total_anulado);
    const gastos = renglones.reduce((suma, r) => suma + (r.anulado ? 0 : r.gasto), 0);
    const { faltaPagar, aFavor } = this.cifrasDelSaldo(doc, renglones);
    return {
      doc,
      id: doc.id,
      fecha: doc.fecha,
      tercero: doc.tercero,
      observaciones: doc.observaciones,
      total,
      abonado: Number(doc.abonado),
      faltaPagar,
      aFavor,
      anulado,
      // Por contrato del API: total + total_anulado == la suma del valor de TODOS
      // los renglones que se imprimen abajo. Ver el comentario de DocumentoVista.
      sumaProductos: total + anulado,
      gastos,
      ventaLibre: total - gastos,
      estado: doc.estado_pago,
      renglones,
      adjuntos: renglones.reduce((suma, r) => suma + r.adjuntos, 0),
    };
  }

  /**
   * LAS DOS CIFRAS DEL SALDO DE LA FACTURA: lo que falta pagar y lo que quedó
   * pagado de más. Son dos y no una, y esa es la corrección.
   *
   * `total − abonado` MIENTE cuando a un renglón se le rebajó el precio después de
   * pagarlo (caso permitido a propósito): ese sobrante se le restaba al saldo de
   * los OTROS renglones y la factura decía que le faltaba menos plata de la que de
   * verdad le falta. Lo que falta pagar es la suma de los saldos POSITIVOS —la
   * misma cuenta que acota el abono a la factura y la misma que suma la cartera,
   * las dos acotando en cero el saldo de cada renglón— y lo que sobró va aparte,
   * con su nombre.
   *
   * DE DÓNDE SALEN LAS CIFRAS. Del servidor cuando manda `saldo_a_favor`, que es
   * la señal de que su `saldo` ya viene acotado en cero: ahí la pantalla no
   * recalcula nada y por contrato dice lo mismo que la cartera. Cuando no la manda
   * se derivan de los renglones, que llegan completos en la respuesta, y dan la
   * MISMA cuenta por construcción:
   *
   *     Σ saldo = Σ (valor − abonado) = total − abonado
   *     Σ saldo = Σ max(0, saldo) − Σ max(0, −saldo) = faltaPagar − aFavor
   *
   * o sea que `total − abonado + aFavor === faltaPagar` por los dos caminos, que
   * es justo la igualdad que el desglose imprime para que el dueño la compruebe.
   * Solo cuentan los renglones VIVOS, con el mismo criterio de `total` y `abonado`:
   * la plata de un renglón anulado no entra en ninguna de las dos.
   */
  private cifrasDelSaldo(
    doc: DocumentoReventa,
    renglones: RenglonVista[],
  ): { faltaPagar: number; aFavor: number } {
    if (doc.saldo_a_favor !== undefined && doc.saldo_a_favor !== null) {
      return { faltaPagar: Number(doc.saldo), aFavor: Number(doc.saldo_a_favor) };
    }
    const vivos = renglones.filter((r) => !r.anulado);
    return {
      faltaPagar: vivos.reduce((suma, r) => suma + r.faltaPagar, 0),
      aFavor: vivos.reduce((suma, r) => suma + r.aFavor, 0),
    };
  }

  private renglonDeVenta(r: VentaQueso): RenglonVista {
    // `unidad` la manda el backend (la deduce del tipo): nunca se escoge "el campo
    // que no esté en cero", porque en una venta de barras los de kilos vienen en
    // cero DE VERDAD.
    const deBarras = r.unidad === 'barra';
    return {
      id: r.id,
      tipo: r.tipo,
      etiqueta: ETIQUETAS[r.tipo] ?? r.tipo,
      unidad: r.unidad,
      cantidad: Number(deBarras ? r.barras : r.kilos),
      precio: Number(deBarras ? r.precio_barra : r.precio_kilo),
      valorTotal: Number(r.valor_total),
      gasto: Number(r.gasto_monto),
      gastoUnitario: Number(deBarras ? r.gasto_por_barra : r.gasto_por_kilo),
      conceptoGasto: r.gasto_concepto,
      borona: 0,
      abonado: Number(r.abonado),
      ...this.saldoDelRenglon(r.saldo),
      estado: r.estado,
      anulado: r.estado === 'anulada',
      adjuntos: r.adjuntos_count,
      abonos: r.abonos,
    };
  }

  /**
   * El saldo del renglón partido en sus dos caras, en un solo sitio para que las
   * compras y las ventas no puedan quedar con criterios distintos.
   */
  private saldoDelRenglon(crudo: Monto): {
    saldo: number;
    faltaPagar: number;
    aFavor: number;
  } {
    const saldo = Number(crudo);
    return { saldo, faltaPagar: Math.max(0, saldo), aFavor: Math.max(0, -saldo) };
  }

  private renglonDeCompra(r: CompraQueso): RenglonVista {
    const deBarras = r.unidad === 'barra';
    return {
      id: r.id,
      tipo: r.tipo,
      etiqueta: ETIQUETAS[r.tipo] ?? r.tipo,
      unidad: r.unidad,
      // KILOS BRUTOS y no netos: el valor de la compra es brutos × precio, así que
      // es la cifra con la que la multiplicación escrita del recibo da exacto. Hoy
      // los dos son iguales (ya no se descuenta merma al comprar), pero si alguna
      // fila vieja difiere, la que cuadra la cuenta es esta.
      cantidad: Number(deBarras ? r.barras : r.kilos_brutos),
      precio: Number(deBarras ? r.precio_barra : r.precio_kilo),
      valorTotal: Number(r.valor_total),
      gasto: 0,
      gastoUnitario: 0,
      conceptoGasto: null,
      borona: Number(r.borona_kilos || 0),
      abonado: Number(r.abonado),
      ...this.saldoDelRenglon(r.saldo),
      estado: r.estado,
      anulado: r.estado === 'anulada',
      adjuntos: r.adjuntos_count,
      abonos: r.abonos,
    };
  }

  // ------------------------------------------------------- el chevron y rótulos
  abierto(id: string): boolean {
    return this.desplegadas().has(id);
  }

  alternar(id: string): void {
    this.desplegadas.update((abiertas) => {
      const nuevas = new Set(abiertas);
      if (nuevas.has(id)) nuevas.delete(id);
      else nuevas.add(id);
      return nuevas;
    });
  }

  /** Hasta tres productos en la celda; los demás se cuentan. */
  chips(fila: DocumentoVista): RenglonVista[] {
    return fila.renglones.slice(0, 3);
  }

  masProductos(fila: DocumentoVista): number {
    return Math.max(0, fila.renglones.length - 3);
  }

  conSaldo(fila: DocumentoVista): boolean {
    return fila.faltaPagar > 0 && fila.estado !== 'anulada';
  }

  puedeAbonar(fila: DocumentoVista): boolean {
    return fila.estado !== 'pagada' && fila.estado !== 'anulada';
  }

  puedeAbonarRenglon(r: RenglonVista): boolean {
    return r.estado !== 'pagada' && r.estado !== 'anulada';
  }

  /** Título de los diálogos que cuelgan de la factura. */
  private rotuloFactura(fila: DocumentoVista): string {
    return `${this.esVenta() ? 'Venta a' : 'Compra a'} ${fila.tercero} · ${fila.fecha}`;
  }

  // --------------------------------------------------- lo que se pagó de MÁS
  /*
   * TRES PIEZAS PARA UN SOLO HECHO, y las tres tienen que existir porque un saldo
   * negativo pelado en una tabla no lo entiende nadie:
   *
   *  · el RENGLÓN DEL DESGLOSE (`rotuloPagadoDeMas`), que es el que hace que la
   *    columna cierre: sin él el dueño resta el total menos lo abonado, le da otra
   *    cifra que la que dice "Saldo por cobrar", y a partir de ahí no le cree a
   *    ninguna otra cifra de la pantalla;
   *  · el NOMBRE de la plata (`rotuloAFavor`), el mismo del estado de cuenta y del
   *    PDF, para que el dueño ponga los documentos uno al lado del otro;
   *  · y la EXPLICACIÓN (`explicacionAFavor`), que dice de quién es esa plata, por
   *    qué apareció y por qué NO le baja lo que todavía deben. Es el mismo remedio
   *    del "le queda debiendo" del detalle de la liquidación.
   */

  /**
   * El rótulo del renglón que hace cerrar la columna. Dice de una vez POR QUÉ
   * suma en vez de restar: esa plata no cubre los otros productos, así que vuelve
   * a la cuenta de lo que falta.
   */
  rotuloPagadoDeMas(): string {
    return this.esVenta()
      ? 'Pagado de más por el cliente (no cubre los otros productos)'
      : 'Pagado de más al productor (no cubre los otros productos)';
  }

  /**
   * Cómo se llama esa plata. Los MISMOS rótulos del estado de cuenta y del PDF
   * (ver `rotuloSaldo` en estado-cuenta.dialog.ts y en el del productor): al
   * comprar, lo que se pagó de más queda a favor de la quesera; al vender, a favor
   * del cliente. Nombrarlo distinto en cada pantalla es lo que hace que el dueño
   * crea que son dos platas.
   */
  rotuloAFavor(): string {
    return this.esVenta()
      ? 'Saldo a favor del cliente'
      : 'Pagado de más (a favor de la quesera)';
  }

  /**
   * La frase completa, como la diría el dueño. Null cuando no hay nada que
   * explicar, para que la plantilla no repita la condición.
   *
   * Son DOS situaciones y hay que distinguirlas: con saldo pendiente, lo que hay
   * que decir es que ese sobrante NO le baja lo que falta (si no, el dueño lo
   * resta y le queda debiendo plata a su propio cliente); ya pagada del todo, que
   * no falta nada y encima sobró.
   */
  explicacionAFavor(fila: DocumentoVista): string | null {
    if (fila.aFavor <= 0) return null;
    const cuanto = pesosExactos(fila.aFavor);
    const falta = pesosExactos(fila.faltaPagar);
    if (this.esVenta()) {
      const causa =
        `${fila.tercero} pagó ${cuanto} más de lo que valen los productos que se le ` +
        'abonaron (a alguno se le rebajó el precio después de pagarlo).';
      return fila.faltaPagar > 0
        ? `${causa} Esa plata NO le baja los ${falta} que todavía debe de los otros ` +
            `productos —por eso arriba se vuelve a sumar— y queda a su favor para la ` +
            `próxima compra.`
        : `${causa} Esta factura no tiene nada pendiente: esos ${cuanto} quedan a su ` +
            `favor para la próxima compra.`;
    }
    const causa =
      `A ${fila.tercero} se le pagaron ${cuanto} más de lo que valen los productos ` +
      'que se le abonaron.';
    return fila.faltaPagar > 0
      ? `${causa} Esa plata NO le baja los ${falta} que todavía se le deben de los ` +
          `otros productos —por eso arriba se vuelve a sumar— y queda a favor de la ` +
          `quesera.`
      : `${causa} A esta factura no le queda nada por pagar: esos ${cuanto} quedan a ` +
          `favor de la quesera.`;
  }

  /**
   * El mismo hecho, corto, para el distintivo de la columna "Saldo" del listado.
   * La columna y el detalle tienen que decir lo mismo: una factura pagada de más
   * que en la lista se viera como si le faltara plata sería el descuadre.
   */
  tooltipAFavor(fila: DocumentoVista): string {
    return this.esVenta()
      ? `${pesosExactos(fila.aFavor)} que el cliente pagó de más. Quedan a su favor y ` +
          'NO bajan el saldo por cobrar de esta factura. Despliéguela para ver la cuenta.'
      : `${pesosExactos(fila.aFavor)} que se le pagaron de más al productor. Quedan a ` +
          'favor de la quesera y NO bajan el saldo por pagar de esta factura. ' +
          'Despliéguela para ver la cuenta.';
  }

  // ------------------------------------------------------ acciones de factura
  nueva(): void {
    this.dialog
      .open(DocumentoReventaFormDialog, {
        data: { tipo: this.tipo() },
        width: '760px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((guardada: DocumentoReventa | undefined) => {
        if (!guardada) return;
        this.notificar();
        // El momento de anexar la foto de la transferencia es JUSTO AHORA, con el
        // comprobante todavía en pantalla. Se ofrece desde el mismo aviso: quien no
        // va a adjuntar nada no tiene que cerrar nada.
        //
        // El soporte se anexa al PRIMER producto de la factura, y el título del
        // diálogo lo dice: los soportes cuelgan del producto, y el primero es
        // además donde cae el abono cuando se paga la factura entera (el derrame va
        // en orden). Para ponerlo en otro producto está el clip de cada uno.
        const primero = guardada.renglones[0];
        const mensaje = this.esVenta() ? 'Venta registrada' : 'Compra registrada';
        const aviso = this.snackbar.open(mensaje, 'Anexar soporte', { duration: 8000 });
        if (!primero) return;
        aviso.onAction().subscribe(() =>
          this.abrirAdjuntos(
            primero.id,
            `${this.esVenta() ? 'Venta a' : 'Compra a'} ${guardada.tercero} · ` +
              `${guardada.fecha} · ${ETIQUETAS[primero.tipo] ?? primero.tipo}`,
          ),
        );
      });
  }

  editar(fila: DocumentoVista): void {
    this.dialog
      .open(DocumentoReventaFormDialog, {
        data: { tipo: this.tipo(), item: fila.doc },
        width: '760px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.snackbar.open('Factura actualizada', 'OK', { duration: 3000 });
        this.notificar();
      });
  }

  /**
   * Un abono a la factura ENTERA. El backend lo derrama sobre los productos en su
   * orden (`min(lo que queda, el saldo del producto)` a cada uno), así que no hay
   * ninguna división y la suma de los abonos da el abono exacto.
   *
   * El tope que se le pone al diálogo es `faltaPagar` y no `total − abonado`: es la
   * MISMA cuenta con la que el backend acota el derrame (`capacidad`, el saldo de
   * cada renglón acotado en cero). Con la otra, una factura que tuviera un producto
   * pagado de más rechazaría un abono que el servidor sí acepta.
   */
  abonar(fila: DocumentoVista): void {
    this.dialog
      .open(AbonoFormDialog, {
        data: {
          tipo: this.tipo(),
          id: fila.id,
          documento: true,
          cuantosProductos: fila.renglones.length,
          titulo: this.esVenta() ? `Abono de ${fila.tercero}` : `Abonar a ${fila.tercero}`,
          saldo: fila.faltaPagar,
        },
        width: '480px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.snackbar.open('Abono registrado', 'OK', { duration: 3000 });
        this.notificar();
      });
  }

  /**
   * Los abonos de TODA la factura, con el producto de cada uno.
   *
   * Los productos ANULADOS también van, y marcados: si a uno le habían abonado antes
   * de anularlo, esa plata existe y esconderla haría que el detalle no cuadrara con
   * nada. Marcado, se entiende por qué la suma de la lista puede ser mayor que el
   * "Abonado" de la factura, que solo cuenta los productos vivos.
   */
  verAbonos(fila: DocumentoVista): void {
    const partes: ParteAbonada[] = fila.renglones.map((r) => ({
      id: r.id,
      etiqueta: r.anulado ? `${r.etiqueta} (anulado)` : r.etiqueta,
      abonos: r.abonos,
    }));
    this.dialog
      .open(AbonosListDialog, {
        data: {
          titulo: this.esVenta() ? `Abonos de ${fila.tercero}` : `Abonos a ${fila.tercero}`,
          tipo: this.tipo(),
          partes,
        },
        width: '620px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((cambiado) => {
        if (cambiado) this.notificar();
      });
  }

  /**
   * Estado de cuenta del tercero de la fila: junta TODAS sus facturas (no solo
   * esta) para poder compartírselo en PDF o por WhatsApp.
   */
  estadoCuenta(fila: DocumentoVista): void {
    const comun = { desde: this.desde(), hasta: this.hasta() };
    if (this.esVenta()) {
      this.dialog.open(ReventaEstadoCuentaDialog, {
        data: { cliente: fila.tercero, ...comun },
        width: '720px',
        maxWidth: '95vw',
      });
    } else {
      this.dialog.open(ReventaEstadoCuentaProductorDialog, {
        data: { productor: fila.tercero, ...comun },
        width: '720px',
        maxWidth: '95vw',
      });
    }
  }

  anular(fila: DocumentoVista): void {
    const cuantos = fila.renglones.length;
    const productos = cuantos === 1 ? 'su producto' : `sus ${cuantos} productos`;
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Anular factura',
          mensaje:
            `¿Anular la factura de ${fila.tercero}? Se anulan ${productos} y ` +
            `${this.esVenta() ? 'saldrá de los saldos por cobrar' : 'saldrá de los saldos por pagar'}.`,
          accion: 'Anular',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.anularDocumento(fila.id)),
          'Factura anulada',
          'No fue posible anular la factura',
        );
      });
  }

  eliminar(fila: DocumentoVista): void {
    const cuantos = fila.renglones.length;
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar factura',
          mensaje:
            `¿Eliminar la factura de ${fila.tercero}` +
            `${cuantos > 1 ? ` y sus ${cuantos} productos` : ''}? ` +
            'Esta acción no se puede deshacer.',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.eliminarDocumento(fila.id)),
          'Factura eliminada',
          'No fue posible eliminar la factura',
        );
      });
  }

  // ------------------------------------------------------ acciones de producto
  /**
   * Los soportes de pago de UN producto. Con un solo producto el clip está en la
   * fila (como siempre); con varios está en cada producto, dentro del detalle.
   */
  soportes(fila: DocumentoVista, r: RenglonVista): void {
    const titulo =
      fila.renglones.length === 1
        ? this.rotuloFactura(fila)
        : `${this.rotuloFactura(fila)} · ${r.etiqueta}`;
    this.abrirAdjuntos(r.id, titulo);
  }

  private abrirAdjuntos(renglonId: string, titulo: string): void {
    this.dialog
      .open(AdjuntosDialog, {
        data: { tipo: this.tipo(), id: renglonId, titulo },
        width: '720px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((cambiado) => {
        // Solo si cambió algo: el contador del clip sale del listado.
        if (cambiado) this.notificar();
      });
  }

  /**
   * Corrige la cantidad, el precio o el gasto de UN producto.
   *
   * Se le dice cuántos productos tiene la factura: con más de uno, la fecha y el
   * nombre se cambian en la factura y el diálogo los apaga (el backend los rechaza,
   * ver el 422 de `PUT /ventas/{id}`).
   */
  editarRenglon(fila: DocumentoVista, r: RenglonVista): void {
    const cuantosRenglones = fila.renglones.length;
    const referencia = this.esVenta()
      ? this.dialog.open(VentaQuesoFormDialog, {
          data: { item: this.ventaCruda(fila, r.id), cuantosRenglones },
          width: '560px',
          maxWidth: '95vw',
        })
      : this.dialog.open(CompraFormDialog, {
          data: { item: this.compraCruda(fila, r.id), cuantosRenglones },
          width: '640px',
          maxWidth: '95vw',
        });
    referencia.afterClosed().subscribe((guardado) => {
      if (!guardado) return;
      this.snackbar.open('Producto actualizado', 'OK', { duration: 3000 });
      this.notificar();
    });
  }

  /** Abonar SOLO a este producto, cuando el pago es de un producto y no del total. */
  abonarRenglon(fila: DocumentoVista, r: RenglonVista): void {
    this.dialog
      .open(AbonoFormDialog, {
        data: {
          tipo: this.tipo(),
          id: r.id,
          titulo: `${this.esVenta() ? 'Abono de' : 'Abonar a'} ${fila.tercero} · ${r.etiqueta}`,
          // Acotado en cero por lo mismo: un renglón con saldo a favor dejaría el
          // tope del diálogo en negativo y el formulario nacería inválido. Hoy el
          // botón ya viene deshabilitado (queda en estado 'pagada'), así que esto es
          // el cinturón por si algún día se permite abonarle.
          saldo: r.faltaPagar,
        },
        width: '480px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.snackbar.open('Abono registrado', 'OK', { duration: 3000 });
        this.notificar();
      });
  }

  anularRenglon(fila: DocumentoVista, r: RenglonVista): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: `Anular ${r.etiqueta.toLowerCase()}`,
          mensaje:
            `¿Anular solo ${r.etiqueta.toLowerCase()} de la factura de ${fila.tercero}? ` +
            'La factura se queda con los demás productos y su plata sale del saldo.',
          accion: 'Anular',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () =>
            this.esVenta()
              ? firstValueFrom(this.servicio.anularVenta(r.id))
              : firstValueFrom(this.servicio.anularCompra(r.id)),
          'Producto anulado',
          'No fue posible anular el producto',
        );
      });
  }

  eliminarRenglon(fila: DocumentoVista, r: RenglonVista): void {
    // Borrar el ÚLTIMO producto se lleva la factura: una cabecera sin productos
    // sería una factura fantasma con total cero. Se dice antes de confirmar.
    const ultimo = fila.renglones.length === 1;
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: `Eliminar ${r.etiqueta.toLowerCase()}`,
          mensaje: ultimo
            ? `Es el único producto de esta factura, así que se elimina la factura completa. Esta acción no se puede deshacer.`
            : `¿Eliminar ${r.etiqueta.toLowerCase()} de la factura de ${fila.tercero}? Esta acción no se puede deshacer.`,
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () =>
            this.esVenta()
              ? firstValueFrom(this.servicio.eliminarVenta(r.id))
              : firstValueFrom(this.servicio.eliminarCompra(r.id)),
          'Producto eliminado',
          'No fue posible eliminar el producto',
        );
      });
  }

  /**
   * El renglón CRUDO tal como lo mandó el API, que es lo que necesita el diálogo de
   * corrección (usa campos que la vista normalizada ya no distingue).
   *
   * Se busca en la factura y no se guarda al lado de la vista para no tener el mismo
   * dato en dos sitios; el `find` recorre a lo sumo los productos de una factura.
   */
  private ventaCruda(fila: DocumentoVista, renglonId: string): VentaQueso {
    const doc = fila.doc;
    if (doc.tipo !== 'venta') throw new Error('La factura no es de venta');
    const renglon = doc.renglones.find((r) => r.id === renglonId);
    if (!renglon) throw new Error('El producto no está en la factura');
    return renglon;
  }

  private compraCruda(fila: DocumentoVista, renglonId: string): CompraQueso {
    const doc = fila.doc;
    if (doc.tipo !== 'compra') throw new Error('La factura no es de compra');
    const renglon = doc.renglones.find((r) => r.id === renglonId);
    if (!renglon) throw new Error('El producto no está en la factura');
    return renglon;
  }

  // ------------------------------------------------------------------ comunes
  private notificar(): void {
    void this.cargar();
    this.cambio.emit();
  }

  private async ejecutar(
    accion: () => Promise<unknown>,
    mensaje: string,
    porDefecto: string,
  ): Promise<void> {
    try {
      await accion();
      this.snackbar.open(mensaje, 'OK', { duration: 3000 });
      this.notificar();
    } catch (err) {
      // Anular/registrar SÍ guardan: si el resultado quedó en duda, el aviso se
      // queda hasta que el usuario lo cierre (ver shared/errores-ui.ts).
      avisarErrorAlGuardar(this.snackbar, err, porDefecto);
    }
  }
}
