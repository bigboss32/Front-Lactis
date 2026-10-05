import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
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
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import {
  Page,
  Proveedor,
  Recepcion,
  ResumenPeriodo,
  Ruta,
  trabadoSinPlataEntregada,
} from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { PageHeader } from '../../shared/page-header';
import { FiltroPorOpciones, OpcionDeFiltro } from '../../shared/filtro-por-opciones';
import { quincenaDeLaFecha, quincenaExacta, rangoQuincena } from '../../shared/quincena';
import { SelectorQuincena } from '../../shared/selector-quincena';
import { ordenarFilas } from '../../shared/ordenar-tabla';
import { dateToIso, isoToDate } from '../../shared/date-utils';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { avisoDelGuardado } from './aviso-del-guardado';
import { CierreRecepcion, RecepcionFormDialog } from './recepcion-form.dialog';
import { RecepcionGrillaTab } from './recepcion-grilla.tab';
import { RecepcionesService } from './recepciones.service';

/**
 * La quincena de hoy, ENTERA (1–15 o 16–fin de mes). Antes era "del 1 (o del 16) hasta hoy",
 * pero el filtro de quincena marca un botón solo cuando las fechas son una quincena justa, y
 * un rango que se queda en hoy no marcaba ninguno: la barra no habría dicho qué se filtraba.
 */
function quincenaActual(): { desde: Date; hasta: Date } {
  const { anio, mes, quincena } = quincenaDeLaFecha();
  const rango = rangoQuincena(anio, mes, quincena);
  return { desde: isoToDate(rango.inicio)!, hasta: isoToDate(rango.fin)! };
}

@Component({
  selector: 'app-recepcion-list',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule, MatTabsModule,
    PageHeader, MoneyPipe, CantidadPipe, DatePipe, HasPermissionDirective,
    RecepcionGrillaTab, SelectorQuincena, FiltroPorOpciones, MatSortModule,
  ],
  templateUrl: './recepcion-list.page.html',
  styles: `
    .tab-panel { padding-top: 16px; }
    .tab-icono { margin-right: 8px; }

    .resumen-card {
      margin-bottom: 16px;
      padding: 16px;
    }
    .resumen-titulo {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 12px;
      font-weight: 500;
    }
    .resumen-rango {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.85rem;
    }
    .resumen-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }
    .resumen-nota {
      flex-basis: 100%;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.78rem;
      font-weight: 400;
    }
    .error-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 32px 16px;
      text-align: center;
    }
    .error-state mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--mat-sys-error); }
    .error-state p { margin: 0; }
    .error-state .aclara { font-size: 0.85rem; color: var(--mat-sys-on-surface-variant); }
    .stat { display: flex; flex-direction: column; }
    .stat .valor { font-size: 1.15rem; font-weight: 600; }
    .stat .etiqueta { color: var(--mat-sys-on-surface-variant); font-size: 0.8rem; }
    /* Métricas derivadas (con transporte): se resaltan en color primario */
    .stat.destacado .valor { color: var(--mat-sys-primary); }

    .liq {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.85rem;
      white-space: nowrap;
    }
    .liq mat-icon { font-size: 18px; width: 18px; height: 18px; }
    /* Verde = plata entregada, y es la única que traba el día. */
    .liq.pagada { color: #2e7d32; }
    /* Ámbar = ya está en una liquidación pero todavía se puede corregir; es el
       mismo color de aviso de la franja de la grilla y del diálogo. */
    .liq.en-liquidacion { color: #b26a00; }
    .liq.pendiente { color: var(--mat-sys-on-surface-variant); }
    :host-context(html.dark) .liq.pagada { color: #81c784; }
    :host-context(html.dark) .liq.en-liquidacion { color: #ffb74d; }
  `,
})
export class RecepcionListPage implements OnInit {
  private readonly servicio = inject(RecepcionesService);
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  /** Pestaña de grilla: se recarga cuando se guarda o elimina desde el listado. */
  private readonly grillaTab = viewChild(RecepcionGrillaTab);

  readonly columnas = [
    'fecha', 'proveedor', 'litros', 'precio_litro', 'valor_bruto',
    'descuentos', 'valor_neto', 'liquidacion', 'acciones',
  ];
  readonly filas = signal<Recepcion[]>([]);
  readonly orden = signal<Sort>({ active: '', direction: '' });
  readonly filasOrdenadas = computed(() =>
    ordenarFilas(this.filas(), this.orden(), {
      proveedor: (f) => f.proveedor_nombre,
      litros: (f) => Number(f.cantidad_litros),
      precio_litro: (f) => Number(f.precio_litro),
      valor_bruto: (f) => Number(f.valor_bruto),
      descuentos: (f) => Number(f.descuentos),
      valor_neto: (f) => Number(f.valor_neto),
      liquidacion: (f) => f.liquidacion_estado,
    }),
  );
  readonly total = signal(0);
  readonly cargando = signal(false);
  /** La última consulta de la lista falló: el texto, o null si no. Esconde la tabla (ver la plantilla). */
  readonly errorCarga = signal<string | null>(null);
  /**
   * Hay proveedor, ruta o búsqueda puestos en la lista. El RESUMEN de arriba es del período y no
   * recibe esos filtros (el servidor no los acepta): con alguno puesto, sus cifras no son las
   * de la lista de abajo, y se dice.
   */
  readonly conFiltros = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly resumen = signal<ResumenPeriodo | null>(null);
  readonly proveedores = signal<Proveedor[]>([]);
  readonly rutas = signal<Ruta[]>([]);
  /** Las rutas como botones, igual que el estado de las liquidaciones: el valor es el id. */
  readonly opcionesDeRuta = computed<OpcionDeFiltro[]>(() =>
    this.rutas().map((ruta) => ({ valor: ruta.id, etiqueta: ruta.nombre })),
  );

  /** Total pagado en el período: leche (valor neto) + transporte. */
  readonly totalConTransporte = computed(() => {
    const r = this.resumen();
    return r ? Number(r.valor_neto) + Number(r.valor_transporte) : 0;
  });

  /** Costo por litro puesto: (leche + transporte) / litros del período. */
  readonly precioPromedioConTransporte = computed(() => {
    const r = this.resumen();
    if (!r) return 0;
    const litros = Number(r.total_litros);
    return litros > 0 ? (Number(r.valor_neto) + Number(r.valor_transporte)) / litros : 0;
  });

  readonly desde = new FormControl<Date | null>(quincenaActual().desde);
  readonly hasta = new FormControl<Date | null>(quincenaActual().hasta);
  readonly proveedorId = new FormControl<string | null>(null);
  readonly rutaId = new FormControl<string | null>(null);
  readonly buscar = new FormControl('', { nonNullable: true });

  constructor() {
    this.desde.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.hasta.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.proveedorId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    this.rutaId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'recepciones',
      {
        buscar: this.buscar,
        rutaId: this.rutaId,
        proveedorId: this.proveedorId,
        desde: this.desde,
        hasta: this.hasta,
      },
      this.destroyRef,
    );
    // LAS FECHAS GUARDADAS DE ANTES SOLO SE CONSERVAN SI SON UNA QUINCENA (o ninguna fecha,
    // que es "sin filtro de fechas" elegido a propósito). La pantalla anterior dejaba escribir
    // cualquier rango ("Hoy", "Este mes", fechas sueltas) y la sesión lo recuerda: restaurado
    // ahora, la lista saldría de esos 4 días con la barra sin marcar ninguna quincena, y se
    // leería una cifra parcial como si fuera todo. Se vuelve a la quincena de hoy.
    const hayFechas = this.desde.value !== null || this.hasta.value !== null;
    if (hayFechas && !quincenaExacta(this.desde.value, this.hasta.value)) {
      const hoy = quincenaActual();
      this.desde.setValue(hoy.desde, { emitEvent: false });
      this.hasta.setValue(hoy.hasta, { emitEvent: false });
    }
    this.cargar();
    this.cargarResumen();
    // Aquí el selector de proveedor es un FILTRO DE CONSULTA, no un campo para
    // registrar algo nuevo: por eso van también los inactivos. Si se pidieran
    // solo los activos, al desactivar a un proveedor su historia de recepciones
    // quedaría imposible de buscar en esta pantalla, que es justo lo contrario
    // de lo que se busca al apartarlo. En el formulario de recepción —donde sí
    // se registra leche nueva— sigue yendo estado=activo.
    firstValueFrom(
      this.api.get<Page<Proveedor>>('/proveedores', { page_size: 100 }),
    ).then((respuesta) => {
      this.proveedores.set(respuesta.items);
      // Igual con el proveedor guardado, solo si llegó la lista entera (con más de 100 puede
      // faltar en la primera página sin que haya dejado de existir).
      const guardado = this.proveedorId.value;
      if (guardado && respuesta.items.length < 100 && !respuesta.items.some((p) => p.id === guardado)) {
        this.proveedorId.setValue(null);
      }
    });
    firstValueFrom(
      this.api.get<Page<Ruta>>('/rutas', { page_size: 100, estado: 'activo' }),
    ).then((respuesta) => {
      this.rutas.set(respuesta.items);
      // Una ruta guardada de la sesión anterior que ya no es ninguna opción (se desactivó) NO se
      // deja puesta: filtraba la lista sin que ningún botón la marcara.
      const guardada = this.rutaId.value;
      if (guardada && !respuesta.items.some((ruta) => ruta.id === guardada)) {
        this.rutaId.setValue(null);
      }
    });
  }

  recargar(): void {
    this.page.set(1);
    this.cargar();
    this.cargarResumen();
  }

  /**
   * Cada consulta anota su turno y solo la del último escribe en pantalla: cambiar de
   * quincena de seguido dejaba que la respuesta de la anterior, si llegaba de última, se
   * quedara con la lista y con el resumen mientras la barra marcaba otra quincena.
   */
  private turnoDeLaLista = 0;
  private turnoDelResumen = 0;

  async cargar(): Promise<void> {
    const turno = ++this.turnoDeLaLista;
    this.cargando.set(true);
    this.errorCarga.set(null);
    this.conFiltros.set(!!this.proveedorId.value || !!this.rutaId.value || !!this.buscar.value);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.filtrar({
          page: this.page(),
          page_size: this.pageSize(),
          proveedor_id: this.proveedorId.value,
          ruta_id: this.rutaId.value,
          search: this.buscar.value || null,
          desde: dateToIso(this.desde.value),
          hasta: dateToIso(this.hasta.value),
        }),
      );
      if (turno !== this.turnoDeLaLista) return;
      // Después de borrar o de mover días, la página donde se estaba puede haber quedado fuera de
      // rango: sin filas pero con total, y el mensaje decía "no hay recepciones". Se va a la última.
      if (respuesta.items.length === 0 && respuesta.total > 0 && this.page() > 1) {
        this.page.set(Math.max(1, Math.ceil(respuesta.total / this.pageSize())));
        await this.cargar();
        return;
      }
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
    } catch (err) {
      if (turno !== this.turnoDeLaLista) return;
      // Se limpia lo anterior: si la consulta falló, las filas que quedaran en pantalla ya no son
      // las de estos filtros y se leerían como si lo fueran (o como "no hay nada").
      this.filas.set([]);
      this.total.set(0);
      this.errorCarga.set(
        detalleDeError(err, 'No se pudieron cargar las recepciones. Revise la conexión e intente de nuevo.'),
      );
    } finally {
      if (turno === this.turnoDeLaLista) this.cargando.set(false);
    }
  }

  async cargarResumen(): Promise<void> {
    const turno = ++this.turnoDelResumen;
    const desde = dateToIso(this.desde.value);
    const hasta = dateToIso(this.hasta.value);
    if (!desde || !hasta) {
      this.resumen.set(null);
      return;
    }
    try {
      const resumen = await firstValueFrom(this.servicio.resumenPeriodo(desde, hasta));
      if (turno === this.turnoDelResumen) this.resumen.set(resumen);
    } catch {
      if (turno === this.turnoDelResumen) this.resumen.set(null);
    }
  }

  reintentar(): void {
    this.cargar();
    this.cargarResumen();
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    this.cargar();
  }

  /** Al guardar desde la grilla, sincroniza el listado y el resumen. */
  alCambiarGrilla(): void {
    this.cargar();
    this.cargarResumen();
  }

  /**
   * BORRAR sí sigue siendo todo o nada, y con razón: no cambia un campo, saca el
   * día de las DOS liquidaciones a la vez. Basta con que a uno de los dos
   * terceros se le haya pagado para que su comprobante quede con un renglón sin
   * recepción detrás.
   */
  noSePuedeEliminar(fila: Recepcion): boolean {
    return fila.leche_pagada || fila.flete_pagado;
  }

  /**
   * EL PORQUÉ LO ESCRIBE EL BACKEND (`candado_aviso`) siempre que lo manda, con el estado
   * que sea: el candado es su `_traba_el_dia` y desde acá no se ven todas sus razones. La
   * 'pagada' que dejó el Pagar de antes con el tercero debiendo (pagado $0), cuya deuda ya
   * se cobró la siguiente, no es plata entregada, y "ya se pagó" mandaba a buscar un pago
   * que no existe; el servidor dice "ya se le cobró". Los textos cortos quedan para una
   * respuesta vieja, sin el aviso. No usa `this`, igual que `tooltipEditar`.
   */
  tooltipEliminar(fila: Recepcion): string {
    if (!(fila.leche_pagada || fila.flete_pagado)) return 'Eliminar';
    if (fila.candado_aviso) return `No se puede eliminar. ${fila.candado_aviso}`;
    if (trabadoSinPlataEntregada(fila)) {
      return 'Las cifras de este día quedaron en firme: no se puede eliminar';
    }
    if (fila.leche_pagada && fila.flete_pagado) {
      return 'La leche y el flete de este día ya se pagaron: no se puede eliminar';
    }
    if (fila.leche_pagada) return 'La leche de este día ya se pagó: no se puede eliminar';
    if (fila.flete_pagado) return 'El flete de este día ya se pagó: no se puede eliminar';
    return 'Eliminar';
  }

  /**
   * EL TOOLTIP DEL CHIP 'Aprobada' / 'En borrador', que prometía corregir el día.
   *
   * La quincena cuya deuda ya se cobró en otra sigue 'aprobada' (o en borrador) y aun
   * así sus días quedan trabados: el backend lo dice con `leche_pagada` / `flete_pagado`
   * (su `_traba_el_dia`), los mismos que cierran Eliminar. Ahí "si corrige el día, vuelve
   * a borrador" ofrecía algo que el servidor rebota; se muestra el aviso que él escribe.
   */
  tooltipChipSinPagar(fila: Recepcion): string {
    if (fila.leche_pagada || fila.flete_pagado) {
      return (
        fila.candado_aviso ??
        'Las cifras de este día quedaron en firme: ábralo para ver qué se puede corregir'
      );
    }
    return fila.liquidacion_estado === 'aprobada'
      ? 'Aprobada: si corrige el día, vuelve a borrador y se recalcula'
      : 'En borrador: si corrige el día, la liquidación se recalcula';
  }

  /**
   * EL RÓTULO DEL CHIP DE UNA 'parcial', que decía "Con abono" sacado solo del estado.
   *
   * La quincena de $180.000 (100 L × $1.800) que el adelanto de $180.000 cubría exacto se
   * cerró con Pagar en pagado $0; al corregirla con un día olvidado de 20 L quedó
   * 'parcial' v2 con saldo $36.000 y sin un solo pago. Lo mismo la que se pagó con
   * $180.000, se corrigió y después se le borró ese pago mal registrado: saldo $216.000.
   * El chip decía "Con abono" y el dueño buscaba con la calculadora un abono que no
   * existe. Si hubo plata por pagos lo dice el servidor (`liquidacion_con_abono`, su
   * `con_abonos`): acá no se adivina con el estado ni con la versión.
   *
   * Sin abono el rótulo dice lo único que es cierto en todos los casos: el día tiene las
   * cifras en firme (una 'parcial' siempre lo traba). El porqué —"ya emitió un
   * comprobante corregido", o la deuda que borró la migración— lo dice el tooltip con el
   * `candado_aviso` del servidor. Una respuesta vieja, sin la señal, sigue con "Con abono".
   * No usa `this`, igual que `tooltipEditar`.
   */
  rotuloParcial(fila: Recepcion): string {
    return fila.liquidacion_con_abono === false ? 'En firme' : 'Con abono';
  }

  /**
   * El tooltip de editar decía "Ya pagada: no editable" en cuanto CUALQUIERA de
   * las dos liquidaciones tenía pagos, y eso quedó mintiendo con el candado por
   * campo. Ahora se dice cuál plata salió y qué queda por corregir; el aviso
   * completo lo escribe el backend y sale dentro del diálogo (`candado_aviso`).
   *
   * Y el aviso del backend va acá mismo siempre que lo manda: "la leche ya se pagó" sobre
   * el día de Beto —deuda cobrada, ni un peso pagado— contradecía al chip de al lado, que
   * ya daba la razón real. Y el estado no alcanza para saber si fue plata: una 'pagada'
   * del Pagar de antes puede no tener un peso entregado (ver `tooltipEliminar`).
   */
  tooltipEditar(fila: Recepcion): string {
    if ((fila.leche_pagada || fila.flete_pagado) && fila.candado_aviso) {
      return fila.candado_aviso;
    }
    // Sin el aviso (una respuesta vieja): "ya se pagó" solo si la que manda es una pagada
    // o una parcial.
    if (trabadoSinPlataEntregada(fila)) {
      return 'Las cifras de este día quedaron en firme: ábralo para ver qué se puede corregir';
    }
    if (fila.leche_pagada && fila.flete_pagado) {
      return 'Abrir: las cifras ya pagadas quedan en firme, se corrigen las observaciones';
    }
    if (fila.leche_pagada) {
      return 'Abrir: la leche ya se pagó, pero el transportador todavía se puede corregir';
    }
    if (fila.flete_pagado) {
      return 'Abrir: el flete ya se pagó, pero el precio de la leche todavía se puede corregir';
    }
    switch (fila.liquidacion_estado) {
      case 'aprobada':
        return 'Editar (la liquidación aprobada volverá a borrador y se recalculará)';
      case 'borrador':
        return 'Editar (la liquidación en borrador se recalculará)';
      default:
        return 'Editar';
    }
  }

  /**
   * El aviso de lo que le pasó a la liquidación del día: `antes` es la fila como estaba al
   * abrirla (después de guardar, una aprobada ya aparece en borrador y no se sabría que
   * hubo retroceso) y `despues`, la respuesta del PUT. Ver `avisoDelGuardado`.
   */
  private avisar(hecho: string, antes: Recepcion | undefined, despues: Recepcion | null): void {
    const aviso = avisoDelGuardado(antes, despues);
    this.snackbar.open(aviso ? `${hecho}. ${aviso}` : hecho, 'OK', {
      duration: aviso ? 9000 : 3000,
    });
  }

  abrirFormulario(item?: Recepcion): void {
    this.dialog
      .open(RecepcionFormDialog, { data: { item }, width: '640px' })
      .afterClosed()
      .subscribe((resultado?: CierreRecepcion) => {
        if (!resultado) return;
        this.avisar(
          resultado === 'eliminado' ? 'Recepción eliminada' : 'Recepción guardada',
          item,
          typeof resultado === 'object' ? resultado : null,
        );
        this.cargar();
        this.cargarResumen();
        this.grillaTab()?.cargar();
      });
  }

  eliminar(item: Recepcion): void {
    // Borrar un día que está en una liquidación le quita el renglón y la
    // recalcula: hay que decirlo ANTES de confirmar, no después.
    const consecuencia =
      item.liquidacion_estado === 'aprobada'
        ? ' La liquidación que lo incluye volverá a borrador y se recalculará sin este día.'
        : item.liquidacion_estado === 'borrador'
          ? ' La liquidación que lo incluye se recalculará sin este día.'
          : '';
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar recepción',
          mensaje:
            `¿Eliminar la recepción de "${item.proveedor_nombre ?? 'proveedor'}" del ` +
            `${item.fecha}?${consecuencia}`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(this.servicio.remove(item.id));
          this.avisar('Recepción eliminada', item, null);
          this.cargar();
          this.cargarResumen();
          this.grillaTab()?.cargar();
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible eliminar');
        }
      });
  }
}
