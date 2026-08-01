import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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
import { Cliente, Page, Producto, Venta } from '../../core/models';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { SelectBuscable } from '../../shared/select-buscable';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { protegerCambios } from '../../shared/proteger-cambios';
import { dateToIso, hoyDate, isoToDate } from '../../shared/date-utils';
import { VentaPayload, VentasService } from './ventas.service';

@Component({
  selector: 'app-venta-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatCheckboxModule,
    MatTooltipModule, MatDatepickerModule, MoneyPipe, CantidadPipe, MilesInputDirective,
    SelectBuscable, SpinnerBoton,
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
         antes, se leería como que está incluido en lo que paga el cliente. */
      .aparte {
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.88rem;
      }
      .aparte:first-of-type {
        margin-top: 4px;
        padding-top: 6px;
        border-top: 1px solid var(--mat-sys-outline-variant);
      }
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
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    tipo: ['factura' as 'factura' | 'remision', Validators.required],
    cliente_id: ['', Validators.required],
    fecha: [hoyDate(), Validators.required],
    descuento: [0, [Validators.min(0)]],
    // Flete del despacho. NO se le suma al total que paga el cliente.
    gasto_concepto: [''],
    gasto_por_kilo: [0, [Validators.min(0)]],
    observaciones: [''],
    descontar_inventario: [true],
    lineas: this.fb.array([this.nuevaLinea()]),
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
  readonly fletePorKilo = computed(() => {
    this.cambios();
    return Number(this.form.controls.gasto_por_kilo.value || 0);
  });
  readonly fleteTotal = computed(() => this.kilosDespachados() * this.fletePorKilo());

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

    // Modo edición: precarga los datos y las líneas de la venta existente.
    if (this.data?.venta) {
      const v = this.data.venta;
      this.form.patchValue({
        tipo: v.tipo as 'factura' | 'remision',
        cliente_id: v.cliente_id,
        fecha: isoToDate(v.fecha) ?? hoyDate(),
        descuento: Number(v.descuento),
        gasto_concepto: v.gasto_concepto ?? '',
        gasto_por_kilo: Number(v.gasto_por_kilo ?? 0),
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

  private nuevaLinea() {
    return this.fb.group({
      producto_id: ['', Validators.required],
      cantidad: [1, [Validators.required, Validators.min(0.01)]],
      precio_unitario: [0, [Validators.required, Validators.min(0)]],
    });
  }

  agregarLinea(): void {
    this.lineas.push(this.nuevaLinea());
  }

  eliminarLinea(indice: number): void {
    if (this.lineas.length > 1) this.lineas.removeAt(indice);
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
      if (this.data?.venta && this.ventaConPagos) {
        // Venta ya cobrada: se manda SOLO el flete y las observaciones. Ni siquiera
        // se reenvían `detalles` ni `descuento` con los mismos valores, porque el
        // backend rechaza cualquier edición que traiga esos campos cuando hay pagos
        // (mira si vienen, no si cambiaron). Lo que va aquí no mueve la cartera.
        await firstValueFrom(
          this.servicio.update(this.data.venta.id, {
            gasto_concepto: valor.gasto_concepto?.trim() || null,
            gasto_por_kilo: Number(valor.gasto_por_kilo || 0),
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
            gasto_concepto: valor.gasto_concepto?.trim() || null,
            gasto_por_kilo: Number(valor.gasto_por_kilo || 0),
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
          gasto_concepto: valor.gasto_concepto?.trim() || null,
          gasto_por_kilo: Number(valor.gasto_por_kilo || 0),
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
