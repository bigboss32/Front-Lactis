import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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

import { ApiService } from '../../core/api.service';
import { Cliente, Page, Producto, Venta, VentaTramoFlete } from '../../core/models';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { SelectBuscable } from '../../shared/select-buscable';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { protegerCambios } from '../../shared/proteger-cambios';
import { dateToIso, hoyDate, isoToDate } from '../../shared/date-utils';
import { TramoFletePayload, VentaPayload, VentasService } from './ventas.service';

/**
 * Redondea a centavos, igual que el backend redondea el total de CADA tramo
 * antes de sumarlos.
 *
 * Importa que se redondee tramo por tramo y no al final: si aquí se sumara
 * primero y se redondeara después, la pantalla podría mostrar un peso de
 * diferencia contra lo que guarda el servidor, y el desglose dejaría de sumar
 * exacto la cifra grande. El dueño cuadra esas cuentas a mano.
 */
function aCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

@Component({
  selector: 'app-venta-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatCheckboxModule,
    MatTooltipModule, MatDatepickerModule, MatAutocompleteModule, MoneyPipe,
    CantidadPipe, MilesInputDirective, SelectBuscable, SpinnerBoton,
  ],
  templateUrl: './venta-form.dialog.html',
  styles: `
    .seccion {
      margin: 12px 0 8px;
      font-size: 1rem;
      font-weight: 500;
    }
    .linea {
      display: grid;
      grid-template-columns: minmax(180px, 2fr) 100px 150px 110px 40px;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }
    .subtotal-linea {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    // En celular y tablet la fila de 5 columnas no cabe en el diálogo: se reacomoda
    // como tarjeta apilada (Producto a lo ancho, Cantidad+Precio en dos columnas,
    // Subtotal+eliminar abajo). 900px = mismo breakpoint que el resto del sistema.
    @media (max-width: 900px) {
      .linea {
        grid-template-columns: 1fr 1fr;
        grid-template-areas:
          'producto producto'
          'cantidad precio'
          'subtotal borrar';
        gap: 8px 12px;
        padding: 12px;
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 10px;
      }
      .linea > *:nth-child(1) { grid-area: producto; }
      .linea > *:nth-child(2) { grid-area: cantidad; }
      .linea > *:nth-child(3) { grid-area: precio; }
      .linea .subtotal-linea {
        grid-area: subtotal;
        text-align: left;
        align-self: center;
      }
      .linea .subtotal-linea::before {
        content: 'Subtotal: ';
        color: var(--mat-sys-on-surface-variant);
      }
      .linea > button { grid-area: borrar; justify-self: end; }
    }
    .agregar { margin: 4px 0 16px; }
    /* Un tramo del flete: de dónde, a dónde, quién lo lleva y cuánto por kilo.
       Misma rejilla que las líneas de producto para que las dos secciones se
       lean igual. */
    .tramo {
      display: grid;
      grid-template-columns: 1fr 1fr minmax(140px, 1.2fr) 120px 110px 40px;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }
    .tramo-total {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    @media (max-width: 900px) {
      .tramo {
        grid-template-columns: 1fr 1fr;
        grid-template-areas:
          'origen destino'
          'conductor conductor'
          'porkilo total'
          'borrar borrar';
        gap: 8px 12px;
        padding: 12px;
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 10px;
      }
      .tramo > *:nth-child(1) { grid-area: origen; }
      .tramo > *:nth-child(2) { grid-area: destino; }
      .tramo > *:nth-child(3) { grid-area: conductor; }
      .tramo > *:nth-child(4) { grid-area: porkilo; }
      .tramo .tramo-total {
        grid-area: total;
        align-self: center;
      }
      .tramo .tramo-total::before {
        content: 'Tramo: ';
        color: var(--mat-sys-on-surface-variant);
      }
      .tramo > button { grid-area: borrar; justify-self: end; }
    }
    /* Cuando hay varios tramos, la suma va debajo para que se vea que el flete
       del despacho es exactamente lo que suman. El dueño la cuadra a mano. */
    .suma-tramos {
      display: flex;
      justify-content: flex-end;
      gap: 24px;
      margin: -2px 0 12px;
      font-size: 0.9rem;
      span { color: var(--mat-sys-on-surface-variant); }
      strong { min-width: 110px; text-align: right; font-variant-numeric: tabular-nums; }
    }
    .sin-flete {
      margin: 0 0 12px;
      font-size: 0.86rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .totales {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      margin-bottom: 16px;

      div {
        display: flex;
        gap: 24px;
        span { color: var(--mat-sys-on-surface-variant); }
        strong { min-width: 110px; text-align: right; font-variant-numeric: tabular-nums; }
      }
      .total-final { font-size: 1.05rem; }
      /* El transporte va DESPUÉS del total y separado por una línea: si fuera
         antes, se leería como que está incluido en lo que paga el cliente. La
         línea la pone el bloque entero y no el primer renglón, porque cuál es el
         primero depende de cuántos tramos tenga el despacho. */
      .bloque-flete {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        margin-top: 4px;
        padding-top: 6px;
        border-top: 1px solid var(--mat-sys-outline-variant);
      }
      .aparte {
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.88rem;
      }
      /* La cuenta de cada tramo, un escalón por debajo de la cifra que se resta. */
      .cuenta-tramo { font-size: 0.82rem; }
    }
    .ayuda {
      margin: 0 0 10px;
      font-size: 0.84rem;
      line-height: 1.45;
      color: var(--mat-sys-on-surface-variant);
    }
    mat-checkbox { display: block; margin-bottom: 8px; }
    .obs { width: 100%; margin-top: 8px; }
    /* Aviso de venta ya cobrada: los campos quedan a la vista pero apagados, así
       que hay que decir por qué antes de que el usuario intente escribir en ellos. */
    .aviso-pagos {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 0 0 16px;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font-size: 0.86rem;
      line-height: 1.45;

      mat-icon { flex: none; font-size: 20px; width: 20px; height: 20px; }
    }
  `,
})
export class VentaFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(VentasService);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<VentaFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ venta?: Venta } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly esEdicion = !!this.data?.venta;
  /**
   * La venta ya tiene plata cobrada (abono o pago completo). En ese caso solo se
   * deja corregir el flete y las observaciones: el transporte es un costo de la
   * quesera, NO se le suma al total que paga el cliente ni le mueve la cartera,
   * así que ponerlo después de cobrar no descuadra nada. Cambiar productos o
   * descuento sí movería lo ya cobrado, y para eso hay que anular y rehacer.
   */
  readonly ventaConPagos = Number(this.data?.venta?.pagado ?? 0) > 0;

  readonly clientes = signal<Cliente[]>([]);
  readonly productos = signal<Producto[]>([]);
  /** Conductores que ya han llevado despachos, para autocompletar el nombre. */
  readonly conductores = signal<string[]>([]);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    tipo: ['factura' as 'factura' | 'remision', Validators.required],
    cliente_id: ['', Validators.required],
    fecha: [hoyDate(), Validators.required],
    descuento: [0, [Validators.min(0)]],
    observaciones: [''],
    descontar_inventario: [true],
    lineas: this.fb.array([this.nuevaLinea()]),
    // Los tramos del flete. Arranca VACÍO (a diferencia de las líneas de
    // producto, que siempre tienen una): un despacho que recogen en la planta no
    // tiene flete, y obligar a borrar una fila vacía sería un estorbo.
    tramos: this.fb.array([] as ReturnType<VentaFormDialog['nuevoTramo']>[]),
  });

  /** Re-emite en cada cambio del formulario para recalcular totales en vivo. */
  private readonly cambios = toSignal(this.form.valueChanges);

  readonly subtotales = computed(() => {
    this.cambios();
    return this.lineas.controls.map((linea) => {
      const valor = linea.getRawValue();
      return Number(valor.cantidad || 0) * Number(valor.precio_unitario || 0);
    });
  });
  readonly subtotal = computed(() => this.subtotales().reduce((acum, s) => acum + s, 0));
  readonly descuentoValor = computed(() => {
    this.cambios();
    return Number(this.form.controls.descuento.value || 0);
  });
  readonly total = computed(() => this.subtotal() - this.descuentoValor());

  /** Kilos que suben al camión: el flete se paga por peso, no por plata. */
  readonly kilosDespachados = computed(() => {
    this.cambios();
    return this.lineas.controls.reduce(
      (acum, linea) => acum + Number(linea.getRawValue().cantidad || 0),
      0,
    );
  });
  /**
   * Lo que vale CADA tramo: los kilos del despacho por lo que ese tramo cobra el
   * kilo. Los kilos son los mismos para todos los tramos —el flete se paga por el
   * peso que sube al camión, y el mismo queso recorre toda la ruta—, que es
   * exactamente como lo calcula el backend.
   */
  readonly totalesTramos = computed(() => {
    this.cambios();
    const kilos = this.kilosDespachados();
    return this.tramos.controls.map((tramo) =>
      aCentavos(kilos * Number(tramo.getRawValue().valor_por_kilo || 0)),
    );
  });
  /**
   * El flete del despacho: la SUMA de los tramos ya redondeados, uno por uno. No
   * se recalcula como "suma de los por-kilo × kilos" a propósito: con centavos de
   * por medio las dos cuentas pueden diferir en un peso y el desglose no cuadraría
   * con la cifra grande.
   */
  readonly fleteTotal = computed(() =>
    this.totalesTramos().reduce((acum, valor) => acum + valor, 0),
  );
  /** Lo que cuesta el kilo puesto en el último destino: 400 + 600 = 1.000/kg. */
  readonly fletePorKilo = computed(() => {
    this.cambios();
    return this.tramos.controls.reduce(
      (acum, tramo) => acum + Number(tramo.getRawValue().valor_por_kilo || 0),
      0,
    );
  });

  /**
   * El desglose que se muestra en el resumen de abajo: un renglón por tramo con
   * su cuenta (kilos × $/kg). Se arma acá y no en la plantilla para que la cifra
   * de "Transporte" sea literalmente la suma de estos renglones.
   *
   * Se dejan por fuera los tramos que todavía valen cero (el usuario acaba de
   * agregar el renglón y no ha escrito el precio): sumarían cero y solo harían
   * ruido en la cuenta.
   */
  readonly desgloseFlete = computed(() => {
    const kilos = this.kilosDespachados();
    const totales = this.totalesTramos();
    return this.tramos.controls
      .map((tramo, indice) => {
        const valor = tramo.getRawValue();
        const destino = (valor.destino || '').trim();
        const origen = (valor.origen || '').trim();
        return {
          ruta: origen ? `${origen} → ${destino || '—'}` : destino || 'Transporte',
          porKilo: Number(valor.valor_por_kilo || 0),
          kilos,
          total: totales[indice],
        };
      })
      .filter((tramo) => tramo.total > 0);
  });

  /**
   * Nombres de conductor sugeridos para cada renglón, filtrados por lo que se
   * lleva escrito. El nombre es texto libre —el dueño no registra conductores
   * antes de despachar— pero sugerir los que ya usó evita que el mismo señor
   * quede escrito de tres formas y su deuda salga partida.
   */
  readonly conductoresFiltrados = computed(() => {
    this.cambios();
    const todos = this.conductores();
    return this.tramos.controls.map((tramo) => {
      const texto = (tramo.getRawValue().conductor ?? '').toLowerCase().trim();
      const filtrados = texto ? todos.filter((n) => n.toLowerCase().includes(texto)) : todos;
      return filtrados.slice(0, 20);
    });
  });

  constructor() {
    firstValueFrom(
      this.api.get<Page<Cliente>>('/clientes', { page_size: 100, estado: 'activo' }),
    ).then((pagina) => this.clientes.set(pagina.items));

    // Solo se venden productos terminados (queso), no materias primas ni insumos.
    // Si la empresa no tiene ninguno, el selector queda vacío a propósito.
    firstValueFrom(
      this.api.get<Page<Producto>>('/inventario/productos', { page_size: 200, estado: 'activo' }),
    ).then((pagina) => {
      this.productos.set(pagina.items.filter((p) => p.categoria === 'producto_terminado'));
    });

    // Los conductores que ya han llevado despachos, para autocompletar. Si la
    // consulta falla no pasa nada: el campo es texto libre y se puede escribir.
    firstValueFrom(this.servicio.sugerenciasConductores())
      .then((s) => this.conductores.set(s.conductores))
      .catch(() => undefined);

    // Modo edición: precarga los datos y las líneas de la venta existente.
    if (this.data?.venta) {
      const v = this.data.venta;
      this.form.patchValue({
        tipo: v.tipo as 'factura' | 'remision',
        cliente_id: v.cliente_id,
        fecha: isoToDate(v.fecha) ?? hoyDate(),
        descuento: Number(v.descuento),
        observaciones: v.observaciones ?? '',
      });
      this.lineas.clear();
      for (const d of v.detalles) {
        this.lineas.push(
          this.fb.group({
            producto_id: [d.producto_id, Validators.required],
            cantidad: [Number(d.cantidad), [Validators.required, Validators.min(0.01)]],
            precio_unitario: [Number(d.precio_unitario), [Validators.required, Validators.min(0)]],
          }),
        );
      }

      // El flete de la venta, tramo por tramo. Las ventas VIEJAS también entran
      // acá: el backend ya migró su flete de siempre a un solo tramo, así que al
      // abrirlas se ve ese tramo con su destino y su valor por kilo, y no un
      // formulario vacío que borraría el flete al guardar.
      this.tramos.clear();
      for (const t of v.tramos_flete ?? []) {
        this.tramos.push(this.nuevoTramo(t));
      }
      // Red de seguridad para una venta que traiga el flete resumido pero sin
      // tramos (un caché viejo, o un despacho anterior a la migración): se arma el
      // tramo con lo que hay antes que mostrar la sección vacía y perder el flete.
      if (this.tramos.length === 0 && Number(v.gasto_por_kilo ?? 0) > 0) {
        this.tramos.push(
          this.nuevoTramo({
            destino: v.gasto_concepto,
            valor_por_kilo: Number(v.gasto_por_kilo),
          }),
        );
      }

      // Con pagos encima se bloquea todo lo que cambiaría lo ya cobrado: cliente,
      // fecha, tipo, descuento y renglones. Se dejan VISIBLES (deshabilitados, no
      // escondidos) para que el usuario siga viendo qué vendió mientras corrige el
      // flete. Queda editable solo lo que no toca la plata del cliente.
      if (this.ventaConPagos) {
        this.form.controls.tipo.disable();
        this.form.controls.cliente_id.disable();
        this.form.controls.fecha.disable();
        this.form.controls.descuento.disable();
        this.lineas.disable();
      }
    }

    protegerCambios(this.dialogRef, () => this.form);
  }

  get lineas() {
    return this.form.controls.lineas;
  }

  get tramos() {
    return this.form.controls.tramos;
  }

  private nuevaLinea() {
    return this.fb.group({
      producto_id: ['', Validators.required],
      cantidad: [1, [Validators.required, Validators.min(0.01)]],
      precio_unitario: [0, [Validators.required, Validators.min(0)]],
    });
  }

  /**
   * Un renglón del recorrido. El destino es obligatorio porque el backend lo
   * exige y porque un tramo sin destino no se puede leer ni cobrar; el origen no,
   * que el primero casi siempre sale de la planta y escribirlo sería trabajo de
   * más.
   */
  private nuevoTramo(datos?: Partial<Pick<VentaTramoFlete, 'origen' | 'destino' | 'conductor'>> & {
    valor_por_kilo?: number | string;
  }) {
    return this.fb.group({
      origen: [datos?.origen ?? ''],
      destino: [datos?.destino ?? '', Validators.required],
      conductor: [datos?.conductor ?? ''],
      valor_por_kilo: [Number(datos?.valor_por_kilo ?? 0), [Validators.min(0)]],
    });
  }

  agregarLinea(): void {
    this.lineas.push(this.nuevaLinea());
  }

  eliminarLinea(indice: number): void {
    if (this.lineas.length > 1) this.lineas.removeAt(indice);
  }

  /**
   * El segundo tramo arranca donde terminó el anterior ("de la quesera a San
   * Vicente, y de San Vicente a Bogotá"): se propone ese origen ya escrito porque
   * es lo que pasa casi siempre y así la ruta queda encadenada sola.
   */
  agregarTramo(): void {
    const anterior = this.tramos.at(this.tramos.length - 1);
    this.tramos.push(
      this.nuevoTramo({ origen: anterior ? anterior.getRawValue().destino : null }),
    );
  }

  /** Quitar todos los tramos es válido: significa que lo recogen en la planta. */
  eliminarTramo(indice: number): void {
    this.tramos.removeAt(indice);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid || this.total() < 0) return;
    this.guardando.set(true);
    try {
      const valor = this.form.getRawValue();
      const detalles = valor.lineas.map((linea) => ({
        producto_id: linea.producto_id,
        cantidad: Number(linea.cantidad),
        precio_unitario: Number(linea.precio_unitario),
      }));
      // El flete SIEMPRE se manda como tramos, incluso vacío: mandar la lista
      // reemplaza el recorrido completo, y una lista vacía deja el despacho sin
      // flete (se lo recogieron en la planta). Ya no se manda el `gasto_por_kilo`
      // suelto de antes: sobre un despacho con varios tramos el backend lo rechaza
      // —aplastarlos borraría a los conductores y lo que se les debe—.
      const tramos: TramoFletePayload[] = valor.tramos.map((tramo) => ({
        origen: tramo.origen?.trim() || null,
        destino: tramo.destino.trim(),
        conductor: tramo.conductor?.trim() || null,
        valor_por_kilo: Number(tramo.valor_por_kilo || 0),
      }));
      if (this.data?.venta && this.ventaConPagos) {
        // Venta ya cobrada: se manda SOLO el flete y las observaciones. Ni siquiera
        // se reenvían `detalles` ni `descuento` con los mismos valores, porque el
        // backend rechaza cualquier edición que traiga esos campos cuando hay pagos
        // (mira si vienen, no si cambiaron). Lo que va aquí no mueve la cartera.
        await firstValueFrom(
          this.servicio.update(this.data.venta.id, {
            tramos,
            observaciones: valor.observaciones || null,
          }),
        );
      } else if (this.data?.venta) {
        // Editar: no se reenvía descontar_inventario (el backend reajusta el stock).
        await firstValueFrom(
          this.servicio.update(this.data.venta.id, {
            tipo: valor.tipo,
            cliente_id: valor.cliente_id,
            fecha: dateToIso(valor.fecha)!,
            descuento: Number(valor.descuento || 0),
            tramos,
            observaciones: valor.observaciones || null,
            detalles,
          }),
        );
      } else {
        const payload: VentaPayload = {
          tipo: valor.tipo,
          cliente_id: valor.cliente_id,
          fecha: dateToIso(valor.fecha)!,
          descuento: Number(valor.descuento || 0),
          tramos,
          observaciones: valor.observaciones || null,
          descontar_inventario: valor.descontar_inventario,
          detalles,
        };
        await firstValueFrom(this.servicio.create(payload));
      }
      this.dialogRef.close(true);
    } catch (err) {
      const generico = this.esEdicion
        ? 'No fue posible guardar los cambios'
        : 'No fue posible registrar la venta';
      avisarErrorAlGuardar(this.snackbar, err, generico);
    } finally {
      this.guardando.set(false);
    }
  }
}
