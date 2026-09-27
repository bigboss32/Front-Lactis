import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Liquidacion, Monto } from '../../core/models';
import { EstadoChip } from '../../shared/estado-chip';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { PageHeader } from '../../shared/page-header';
import { RangoFechasRapido } from '../../shared/rango-fechas-rapido';
import { detalleDeError } from '../../shared/errores-ui';
import { ordenarFilas } from '../../shared/ordenar-tabla';
import { dateToIso } from '../../shared/date-utils';
import { CantidadPipe, MoneyPipe, pesosExactos } from '../../shared/pipes';
import {
  causaDeLaDeuda,
  deudaBorradaPorReparar,
  porQueSeLePagoDeMas,
} from './cifras-de-la-quincena';
import { CierreGenerar, GenerarQuincenaDialog } from './generar-quincena.dialog';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { periodoDe } from './periodo-liquidacion';
import { LiquidacionesService } from './liquidaciones.service';
import { estadoComoSeLee } from './estado-como-se-lee';
import { PreLiquidacionDialog } from './preliquidacion.dialog';

/** Conteos y saldos por estado para las tarjetas resumen. */
interface ResumenEstados {
  borradores: number;
  aprobadas: number;
  saldoAprobadas: number;
  /** Liquidaciones a las que ya se les abonó algo y todavía deben. */
  parciales: number;
  saldoParciales: number;
  pagadas: number;
  /**
   * LA PLATA QUE VA AL REVÉS: lo que los terceros le quedaron debiendo A LA QUESERA y
   * todavía nadie les ha cobrado.
   *
   * Va aparte de los saldos por pagar y con su propio nombre, y eso no es presentación:
   * revuelta con ellos, restaba. La pregunta que el dueño le hace a la pantalla es
   * "¿cuánta plata tengo que sacar?", y una deuda del proveedor no le baja lo que le
   * tiene que entregar a los demás.
   */
  leQuedaronDebiendo: number;
  /** En cuántas liquidaciones: sin el conteo, la cifra no se puede ir a revisar. */
  liquidacionesQueDeben: number;
  /**
   * Las quincenas a las que la migración de los abonos les borró la deuda, y cuánto suma
   * lo borrado. Cero casi siempre, y cero también si el servidor todavía no las cuenta.
   */
  porReparar: number;
  deudaBorrada: number;
}

/**
 * Una cifra de `GET /liquidaciones/resumen` como número ("130000.00" → 130000). Si
 * falta o no es un número, revienta: `cargarResumen` deja las tarjetas sin pintar en
 * vez de mostrar "$ NaN" o un $0 que nadie mandó.
 */
function cifraDelResumen(valor: Monto | null | undefined): number {
  const numero = valor === null || valor === undefined || valor === '' ? NaN : Number(valor);
  if (!Number.isFinite(numero)) throw new Error(`Cifra del resumen ilegible: ${valor}`);
  return numero;
}

@Component({
  selector: 'app-liquidacion-list',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule, MatDatepickerModule,
    PageHeader, EstadoChip, MoneyPipe, CantidadPipe, HasPermissionDirective,
    RangoFechasRapido, MatSortModule,
  ],
  templateUrl: './liquidacion-list.page.html',
  styles: `
    // ------------------------------------------------- tarjetas resumen
    .resumen-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }

    .tarjeta {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      min-height: 76px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;

      &:hover { background: var(--mat-sys-surface-container); }

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }

      &.activa {
        border-color: var(--color-tarjeta);
        box-shadow: inset 0 0 0 1px var(--color-tarjeta);
        background: color-mix(in srgb, var(--color-tarjeta) 8%, transparent);
      }

      .icono {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        flex-shrink: 0;
        background: color-mix(in srgb, var(--color-tarjeta) 15%, transparent);
        color: var(--color-tarjeta);
      }

      .textos {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .cifra { font-size: 1.4rem; font-weight: 600; line-height: 1.2; }
      .titulo { font-size: 0.85rem; color: var(--mat-sys-on-surface-variant); }
      .detalle { font-size: 0.8rem; font-weight: 500; color: var(--color-tarjeta); }
    }

    /*
     * LA TARJETA QUE NO FILTRA NADA: la de lo que le quedaron debiendo a la quesera.
     *
     * Las otras cuatro son botones que filtran por estado; una deuda del tercero no es un
     * estado (vive en un borrador, en una aprobada o en una pagada), así que esta no tiene
     * a dónde llevar. Se le quita el dedo del cursor y el realce del mouse para que no
     * prometa un clic que no hace nada.
     */
    .tarjeta.pasiva {
      cursor: default;

      &:hover { background: var(--mat-sys-surface-container-low); }
    }

    // Mismos tonos que estado-chip: ámbar/azul/verde. El rojo es el de la fila y la marca
    // de "quedó debiendo" (fila-le-debe): esa plata va al revés y no se puede confundir
    // con las cifras por pagar de las tarjetas de al lado.
    .tarjeta.ambar { --color-tarjeta: #b26a00; }
    .tarjeta.azul  { --color-tarjeta: #1565c0; }
    .tarjeta.verde { --color-tarjeta: #2e7d32; }
    .tarjeta.rojo  { --color-tarjeta: #c62828; }

    :host-context(html.dark) {
      .tarjeta.ambar { --color-tarjeta: #ffb74d; }
      .tarjeta.azul  { --color-tarjeta: #64b5f6; }
      .tarjeta.verde { --color-tarjeta: #81c784; }
      .tarjeta.rojo  { --color-tarjeta: #e57373; }
    }

    // -------------------------------------- borde de fila según estado
    tr.fila-borrador td:first-child { border-left: 4px solid color-mix(in srgb, #b26a00 75%, transparent); }
    tr.fila-aprobada td:first-child { border-left: 4px solid color-mix(in srgb, #1565c0 75%, transparent); }
    // 'parcial' comparte el azul con 'aprobada', igual que en el chip de estado:
    // las dos son "en firme y todavía debiendo".
    tr.fila-parcial td:first-child  { border-left: 4px solid color-mix(in srgb, #1565c0 75%, transparent); }
    tr.fila-pagada td:first-child   { border-left: 4px solid color-mix(in srgb, #2e7d32 75%, transparent); }
    tr.fila-anulada td:first-child  { border-left: 4px solid color-mix(in srgb, #c62828 60%, transparent); }

    :host-context(html.dark) {
      tr.fila-borrador td:first-child { border-left-color: color-mix(in srgb, #ffb74d 75%, transparent); }
      tr.fila-aprobada td:first-child { border-left-color: color-mix(in srgb, #64b5f6 75%, transparent); }
      tr.fila-parcial td:first-child  { border-left-color: color-mix(in srgb, #64b5f6 75%, transparent); }
      tr.fila-pagada td:first-child   { border-left-color: color-mix(in srgb, #81c784 75%, transparent); }
      tr.fila-anulada td:first-child  { border-left-color: color-mix(in srgb, #e57373 60%, transparent); }
    }

    // ------------------------------------------- mini-badge "por pagar"
    .badge-por-pagar,
    .badge-le-debe,
    .badge-saldo-anterior {
      display: inline-block;
      margin-left: 8px;
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 500;
      white-space: nowrap;
      background: color-mix(in srgb, #1565c0 15%, transparent);
      color: #1565c0;
    }

    :host-context(html.dark) .badge-por-pagar { color: #64b5f6; }

    // ------------------------- la plata va al revés: la debe el TERCERO
    // El tono de error del tema, el mismo del renglón "Le queda debiendo" del detalle.
    // No es una alarma de sistema: es que esta cifra no se puede confundir con las de
    // arriba, que son plata por entregar. La fila lleva además su borde (fila-le-debe)
    // para que se distinga de un vistazo sin tener que leer la columna.
    .al-reves { color: var(--mat-sys-error); font-weight: 500; }
    .badge-le-debe {
      background: color-mix(in srgb, var(--mat-sys-error) 14%, transparent);
      color: var(--mat-sys-error);
    }

    // Esta liquidación se COBRÓ una deuda vieja: en ámbar, el mismo tono con que el
    // sistema marca "esto viene de antes / esto está en proceso". Ni rojo (no hay nada
    // mal) ni azul (no es plata por pagar).
    .badge-saldo-anterior {
      background: color-mix(in srgb, #b26a00 15%, transparent);
      color: #b26a00;
    }
    :host-context(html.dark) .badge-saldo-anterior { color: #ffb74d; }

    tr.fila-le-debe td:first-child {
      border-left: 4px solid color-mix(in srgb, #c62828 70%, transparent);
    }
    :host-context(html.dark) tr.fila-le-debe td:first-child {
      border-left-color: color-mix(in srgb, #e57373 70%, transparent);
    }

    // En celular la tabla se vuelve tarjetas y cada celda es un flex de "Etiqueta:
    // valor". La de Saldo puede llevar DOS marcas a la vez —la quincena que se cobró
    // una deuda vieja y volvió a quedar debiendo es el caso de la cadena—, y sin
    // permitir el salto de línea la última se sale de la tarjeta.
    @media (max-width: 700px) {
      td.mat-mdc-cell[data-label='Saldo'] {
        flex-wrap: wrap;
        row-gap: 4px;
      }
    }
  `,
})
export class LiquidacionListPage implements OnInit {
  private readonly servicio = inject(LiquidacionesService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly columnas = [
    'tipo', 'tercero', 'periodo', 'litros', 'valor_total', 'anticipos', 'saldo', 'estado', 'acciones',
  ];
  readonly filas = signal<Liquidacion[]>([]);
  readonly orden = signal<Sort>({ active: '', direction: '' });
  readonly filasOrdenadas = computed(() =>
    ordenarFilas(this.filas(), this.orden(), {
      tercero: (f) => f.proveedor_nombre ?? f.transportador_nombre,
      periodo: (f) => f.periodo_inicio,
      litros: (f) => Number(f.total_litros),
      valor_total: (f) => Number(f.valor_total),
      anticipos: (f) => Number(f.anticipos),
      saldo: (f) => Number(f.saldo),
      // Se ordena por lo que dice el chip: ordenada por `estado`, una "pagada · quedó
      // debiendo" caería entre las aprobadas y la columna se vería desordenada.
      estado: (f) => estadoComoSeLee(f),
    }),
  );
  /** SOLO para el chip: `esPorPagar`, el borde de la fila y las marcas leen `estado`. */
  readonly estadoComoSeLee = estadoComoSeLee;
  readonly total = signal(0);
  readonly cargando = signal(false);
  /**
   * Mensaje de la consulta fallida. Mientras esté puesto NO se muestra el estado
   * vacío: un fallo de red no es lo mismo que no tener nada por liquidar.
   */
  readonly errorCarga = signal<string | null>(null);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly resumen = signal<ResumenEstados | null>(null);

  readonly tipo = new FormControl<string | null>(null);
  readonly estado = new FormControl<string | null>(null);
  readonly desde = new FormControl<Date | null>(null);
  readonly hasta = new FormControl<Date | null>(null);

  constructor() {
    const filtros: AbstractControl[] = [this.tipo, this.estado, this.desde, this.hasta];
    for (const control of filtros) {
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    }
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'liquidaciones',
      { tipo: this.tipo, estado: this.estado, desde: this.desde, hasta: this.hasta },
      this.destroyRef,
    );
    this.cargar();
    void this.cargarResumen();
  }

  recargar(): void {
    this.page.set(1);
    this.cargar();
    void this.cargarResumen();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorCarga.set(null);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.list({
          page: this.page(),
          page_size: this.pageSize(),
          tipo: this.tipo.value,
          estado: this.estado.value,
          desde: dateToIso(this.desde.value),
          hasta: dateToIso(this.hasta.value),
        }),
      );
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
          'No se pudieron cargar las liquidaciones. Revise la conexión e intente de nuevo.',
        ),
      );
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * LAS TARJETAS LAS CUENTA EL SERVIDOR, en una sola consulta (`GET
   * /liquidaciones/resumen`) y con los filtros de tipo y fechas de la lista —no el de
   * estado, que es el que las tarjetas controlan—.
   *
   * Antes se pedían cuatro listas de hasta 200 filas y se contaba aquí. El total venía
   * completo pero las filas no: con más de 200 pagadas en el período, la deuda vieja de
   * enero ($120.000 que nadie ha cobrado) quedaba en la página 2 y la tarjeta "Le
   * quedaron debiendo" desaparecía. Las reglas —lo que dice el chip, solo saldos
   * positivos en "por pagar", sin anuladas ni deudas ya cobradas— viven ahora en el
   * backend, que es el que ve todas las filas.
   *
   * Si la respuesta falla o trae una cifra que no se puede leer, no se pintan tarjetas:
   * una tarjeta en $0 afirmaría que nadie debe nada.
   */
  async cargarResumen(): Promise<void> {
    try {
      const r = await firstValueFrom(
        this.servicio.resumen({
          tipo: this.tipo.value,
          desde: dateToIso(this.desde.value),
          hasta: dateToIso(this.hasta.value),
        }),
      );
      // Las de la deuda borrada son opcionales (una respuesta vieja no las trae) y ahí se
      // leen como cero. Pero si el servidor dice que hay alguna, la cifra tiene que venir
      // legible: "2 quincenas por reparar · $ NaN" no se le puede mostrar al dueño.
      const porReparar = r.por_reparar == null ? 0 : cifraDelResumen(r.por_reparar);
      const deudaBorrada = porReparar > 0 ? cifraDelResumen(r.deuda_borrada) : 0;
      this.resumen.set({
        borradores: cifraDelResumen(r.borradores),
        aprobadas: cifraDelResumen(r.aprobadas),
        saldoAprobadas: cifraDelResumen(r.saldo_aprobadas),
        parciales: cifraDelResumen(r.parciales),
        saldoParciales: cifraDelResumen(r.saldo_parciales),
        pagadas: cifraDelResumen(r.pagadas),
        leQuedaronDebiendo: cifraDelResumen(r.le_quedaron_debiendo),
        liquidacionesQueDeben: cifraDelResumen(r.liquidaciones_que_deben),
        porReparar,
        deudaBorrada,
      });
    } catch {
      this.resumen.set(null);
    }
  }

  /**
   * "Reintentar" del estado de error: si falló la lista, lo más probable es que
   * también fallaran las tarjetas resumen, así que se vuelven a pedir las dos.
   */
  reintentar(): void {
    this.cargar();
    void this.cargarResumen();
  }

  /** Clic en una tarjeta resumen: aplica (o quita) el filtro de estado. */
  filtrarPorEstado(estado: string): void {
    this.estado.setValue(this.estado.value === estado ? null : estado);
  }

  /**
   * Saldo pendiente real: liquidación en firme (aprobada o con abonos) a la que
   * todavía se le debe algo. La 'parcial' cuenta: se le pagó una parte y el
   * resto sigue siendo deuda; dejarla por fuera escondería plata por pagar.
   */
  esPorPagar(fila: Liquidacion): boolean {
    return (
      (fila.estado === 'aprobada' || fila.estado === 'parcial') &&
      Number(fila.saldo) > 0 &&
      // Con la deuda borrada ese saldo trae sumado lo que el tercero debe, y el servidor
      // no deja pagarlo: "por pagar" sería falso (tampoco entra en la tarjeta).
      !this.tieneDeudaBorrada(fila)
    );
  }

  /**
   * La migración de los abonos le borró la deuda y HAY QUE REPARARLA: lo dice el servidor,
   * no `pagado`. Es la misma pregunta de su `por_reparar`, que no cuenta las anuladas: una
   * anulada no se repara, y la marca "por reparar" en la fila no cuadraría con la tarjeta.
   */
  tieneDeudaBorrada(fila: Liquidacion): boolean {
    return deudaBorradaPorReparar(fila);
  }

  /** Qué es la marca "deuda borrada", con la cifra del servidor. */
  tooltipDeudaBorrada(fila: Liquidacion): string {
    return (
      'Viene de antes de que existieran los abonos, y el sistema de esa época le borró los ' +
      `${pesosExactos(fila.deuda_borrada_por_la_migracion)} que ${this.tercero(fila)} ` +
      'quedaba debiendo. Hay que repararla antes de corregirla o pagarla'
    );
  }

  /** El tooltip de la tarjeta de las quincenas con la deuda borrada. */
  tooltipPorReparar(cuantas: number, total: number): string {
    return (
      `${cuantas === 1 ? 'Una quincena' : `${cuantas} quincenas`} de antes de los abonos a ` +
      'las que el sistema de esa época les borró lo que el tercero quedaba debiendo: ' +
      `${pesosExactos(total)} en total. Hay que repararlas antes de corregirlas o pagarlas, y ` +
      'mientras tanto no entran en la plata por pagar de las otras tarjetas. En la lista ' +
      'llevan la marca «deuda borrada · por reparar»'
    );
  }

  /**
   * AL REVÉS: es el TERCERO el que quedó debiendo a la quesera.
   *
   * Pasa cuando los anticipos que se le entregaron sumaron más que su quincena. La
   * cifra la manda el backend en positivo (`le_queda_debiendo`), la misma del detalle
   * y del comprobante en PDF: acá no se le voltea el signo a nada.
   */
  leQuedaDebiendo(fila: Liquidacion): boolean {
    return Number(fila.le_queda_debiendo ?? 0) > 0;
  }

  /** Esa deuda YA se la cobró otra liquidación, así que no vuelve a viajar. */
  deudaYaCobrada(fila: Liquidacion): boolean {
    return !!fila.deuda_trasladada_a_id;
  }

  /**
   * LA MARCA DE LA COLUMNA SALDO, y tiene que decir lo que VA A PASAR con esa plata.
   *
   * Son tres situaciones distintas y la marca sola las separa de un vistazo, sin abrir el
   * comprobante ni leer el tooltip:
   *
   *  · pendiente: la próxima liquidación que se le genere la cobra;
   *  · cobrada: ya está descontada en otra (y esta quedó congelada: anularla rebota);
   *  · anulada: NO SE COBRA EN NINGUNA PARTE. Es el caso en el que la promesa era falsa.
   *    El servidor busca las deudas entre las liquidaciones que no están anuladas ni
   *    borradas, así que lo que quedó debiendo un comprobante anulado no lo recoge nadie.
   */
  marcaLeQuedaDebiendo(fila: Liquidacion): string {
    if (this.deudaYaCobrada(fila)) return 'quedó debiendo · cobrada';
    if (fila.estado === 'anulada') return 'quedó debiendo · no se cobra';
    // Y LA CUARTA, que llegó con la corrección de una quincena pagada: acá al productor
    // NO se le adelantó nada, se le ENTREGÓ de más. La marca lo separa de una vez porque
    // es plata que YA SALIÓ de la caja —no un anticipo que estaba previsto— y el dueño la
    // busca en otro lado: en el comprobante corregido, no en la lista de anticipos.
    if (causaDeLaDeuda(fila) !== 'anticipos') return 'se le pagó de más';
    return 'quedó debiendo';
  }

  /**
   * Lo que el dueño necesita saber de una deuda del tercero: QUÉ VA A PASAR con ella.
   *
   * Antes esto prometía siempre "se le cobra en la próxima liquidación que se le genere",
   * y era una promesa a ciegas. Ahora dice lo que el servidor de verdad hace:
   *
   *  · YA COBRADA: se nombra la liquidación que se la cobró CON SU PERÍODO, que es cómo el
   *    dueño identifica un comprobante —un id no le dice nada—, y es lo que necesita saber
   *    si algún día quiere anular esta (primero hay que anular esa: el servidor la rebota);
   *  · ANULADA: la promesa era MENTIRA. De una liquidación anulada no viaja nada, así que
   *    esos pesos no los va a cobrar ninguna liquidación futura; hay que volver a generar
   *    la quincena;
   *  · PENDIENTE: se le cobra en la próxima quincena que se le liquide DESPUÉS DE ESTA.
   *    Va con el "después de esta" porque es literal lo que hace el servidor: solo se cobra
   *    en una liquidación cuyo período empiece después de que este termine, así que
   *    liquidar una quincena vieja no se la cobra. Y viaja AUNQUE ESTA SIGA EN BORRADOR,
   *    que es la sorpresa: quien ve un borrador en negativo asume que "todavía no cuenta".
   */
  tooltipLeQuedaDebiendo(fila: Liquidacion): string {
    const cifra = pesosExactos(fila.le_queda_debiendo);
    const quien = this.tercero(fila);
    if (this.deudaYaCobrada(fila)) {
      const otra = fila.deuda_trasladada_a;
      return otra
        ? `${quien} quedó debiendo ${cifra}, y ya se le cobró en la liquidación del ${periodoDe(otra)}`
        : `${quien} quedó debiendo ${cifra}, y ya se le cobró en otra liquidación`;
    }
    if (fila.estado === 'anulada') {
      return (
        `Esta liquidación está anulada: los ${cifra} que ${quien} quedó debiendo acá no se ` +
        'le cobran en ninguna parte. Vuelva a generar la quincena si hay que cobrárselos'
      );
    }
    const aunqueBorrador =
      fila.estado === 'borrador' ? '. Viaja aunque esta siga en borrador' : '';
    // EL SOBREPAGO POR CORRECCIÓN NO ES UN ANTICIPO, y la frase de abajo lo daba por
    // hecho. Acá la plata YA SALIÓ de la caja contra este mismo comprobante: se le
    // entregaron $500.000 y la quincena corregida quedó en $400.000. Se recupera igual
    // —descontándolo de la quincena siguiente— pero hay que decir de dónde salió, porque
    // el dueño va a ir a buscar un anticipo que no existe.
    if (causaDeLaDeuda(fila) !== 'anticipos') {
      return (
        `A ${quien} se le pagó de más: ${porQueSeLePagoDeMas(fila, pesosExactos)}, así que ` +
        `quedó debiendo ${cifra}. Esa plata se le descuenta en la próxima quincena que se ` +
        `le liquide después de esta${aunqueBorrador}`
      );
    }
    return (
      `${quien} quedó debiendo ${cifra}: se le cobra en la próxima quincena que se le ` +
      `liquide después de esta${aunqueBorrador}`
    );
  }

  /**
   * EL TOOLTIP DE LA TARJETA de lo que le quedaron debiendo a la quesera.
   *
   * Dice las dos cosas que la cifra no dice sola: que NO es plata por pagar —va aparte de
   * los saldos justamente por eso— y que se recoge sola en la próxima quincena de cada
   * tercero, así que no hay que ir a cobrarla a mano.
   */
  tooltipLeQuedaronDebiendo(total: number, cuantas: number): string {
    return (
      `${pesosExactos(total)} que los terceros le quedaron debiendo a la quesera en ` +
      `${cuantas === 1 ? 'una liquidación' : `${cuantas} liquidaciones`} del período, y que ` +
      'todavía nadie les ha cobrado. NO es plata por pagar: se le descuenta a cada uno en ' +
      'la próxima quincena que se le liquide'
    );
  }

  /** Esta liquidación se cobró lo que el tercero quedó debiendo en quincenas pasadas. */
  cobraSaldoAnterior(fila: Liquidacion): boolean {
    return Number(fila.saldo_anterior ?? 0) > 0;
  }

  /**
   * Por qué el saldo de esta fila no es Valor total menos Anticipos.
   *
   * En la lista no hay columna para el saldo anterior —serían nueve columnas de plata
   * en un celular—, así que la diferencia se explica acá. La cuenta completa, renglón
   * por renglón, está en el detalle y en el PDF.
   */
  tooltipSaldoAnterior(fila: Liquidacion): string {
    return (
      `En esta quincena se le cobraron ${pesosExactos(fila.saldo_anterior)} que ` +
      `${this.tercero(fila)} había quedado debiendo de una quincena pasada`
    );
  }

  private tercero(fila: Liquidacion): string {
    return fila.proveedor_nombre ?? fila.transportador_nombre ?? 'El tercero';
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    this.cargar();
  }

  /**
   * Abre el diálogo de generar y avisa lo que pasó.
   *
   * EL AVISO DE ACÁ NO PUEDE DECIR SOLO CUÁNTAS SE GENERARON. La corrida se puede saltar
   * a un tercero (un período cruzado) y seguir con los demás: un "Se generaron 5
   * liquidaciones" a secas le dice al dueño que ya liquidó a todos cuando quedó leche sin
   * comprobante. El detalle —a quién y por qué— lo muestra el propio diálogo, que se
   * queda abierto hasta que el dueño lo acepta; acá se nombra el faltante para que quede
   * en la pantalla que sí se queda.
   */
  abrirGenerar(): void {
    this.dialog
      .open(GenerarQuincenaDialog, { width: '520px' })
      .afterClosed()
      .subscribe((cierre: CierreGenerar | undefined) => {
        if (!cierre) return;
        const { generadas, omitidos } = cierre;
        const hechas =
          generadas === 0
            ? 'No había recepciones pendientes por liquidar en el período'
            : `Se generaron ${generadas} liquidaciones`;
        const faltan = omitidos
          ? ` · ${omitidos === 1 ? 'a 1 tercero le falta' : `a ${omitidos} terceros les falta`}`
          : '';
        // El aviso del faltante no se va solo: es plata sin liquidar, y "OK" lo cierra
        // cuando el dueño lo haya leído. El caso feliz se queda con sus 4 segundos.
        this.snackbar.open(`${hechas}${faltan}`, omitidos ? 'Entendido' : 'OK', {
          duration: omitidos ? 12000 : 4000,
        });
        if (generadas > 0) this.recargar();
      });
  }

  abrirPreliquidacion(): void {
    this.dialog.open(PreLiquidacionDialog, { width: '620px' });
  }

  verDetalle(fila: Liquidacion): void {
    this.dialog
      .open(LiquidacionDetailDialog, { data: { item: fila }, width: '760px' })
      .afterClosed()
      .subscribe(() => {
        this.cargar();
        void this.cargarResumen();
      });
  }
}
