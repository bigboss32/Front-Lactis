import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { MoneyPipe } from '../../shared/pipes';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { dateToIso, isoToDate, hoyDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import {
  CatalogoReventaService,
  ReventaService,
  VentaQueso,
  VentaQuesoPayload,
  seCuenta,
} from './reventa.service';

/**
 * Lo que se le puede corregir a un renglón de venta: todo menos el `tipo` (que no
 * se edita) y `pagada_de_contado` (que solo existe al registrar). La fecha y el
 * cliente además solo viajan si el renglón es hijo único; ver `conHermanos`.
 */
type RenglonVentaUpdate = Partial<Omit<VentaQuesoPayload, 'tipo' | 'pagada_de_contado'>>;

/** Lo que recibe el diálogo: el renglón y de qué factura sale. */
export interface VentaQuesoFormData {
  item: VentaQueso;
  /**
   * Cuántos productos tiene la factura de la que sale este renglón. Con más de uno,
   * la fecha y el cliente se cambian en la factura y no aquí (ver `conHermanos`).
   */
  cuantosRenglones?: number;
}

/**
 * Corrige UN PRODUCTO de una factura de venta, EN LA UNIDAD QUE ESE PRODUCTO TENGA:
 * kilos si se pesa, piezas si se cuenta. Calcula el total en vivo y deja anotar el
 * gasto de vender (ej. transporte).
 *
 * SOLO CORRIGE, NO REGISTRA. Las ventas se registran en
 * `DocumentoReventaFormDialog`, que es la factura de varios productos y la única
 * puerta de esta pantalla para crear. Este diálogo quedó para lo que la factura no
 * puede hacer: corregir la cantidad, el precio o el gasto de UN producto suelto,
 * incluso si la factura ya tiene abonos —cambiarle el precio a un renglón no mueve
 * los pagos, solo recalcula su saldo, mientras que REHACER los productos sí los
 * movería y por eso la factura lo prohíbe con abonos encima—.
 *
 * CON HERMANOS, LA FECHA Y EL CLIENTE NO SE TOCAN AQUÍ (ver `conHermanos`): son de
 * la factura y valen para todos sus productos. El backend lo rechaza con un 422; de
 * este lado los campos se ven apagados y se dice por qué, que es mejor que dejarlo
 * escribir para devolverle un error después.
 *
 * LAS DOS UNIDADES NO COMPARTEN CAMPOS y el par de la unidad que no toca queda
 * DESHABILITADO: está explicado a fondo en `_sincronizarUnidad`. Aquí el tipo del
 * renglón ya está decidido y no cambia, así que eso corre una sola vez.
 *
 * El `tipo` nunca se ha podido editar y sigue sin poderse: define de qué inventario
 * sale la mercancía, y cambiarlo movería cantidades de una cola del reparto a otra.
 */
@Component({
  selector: 'app-venta-queso-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatDatepickerModule, MoneyPipe, MilesInputDirective,
    MatAutocompleteModule, MatIconModule, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>Corregir {{ nombreProducto() }}</h2>
    <mat-dialog-content>
      @if (conHermanos) {
        <p class="aviso-factura">
          <mat-icon>receipt_long</mat-icon>
          <span>
            Este es uno de los {{ data.cuantosRenglones }} productos de una factura.
            Aquí se corrigen <strong>la cantidad, el precio y el gasto</strong>; la
            fecha y el cliente se cambian en la factura, porque valen para todos sus
            productos.
          </span>
        </p>
      }
      <form [formGroup]="form" class="form-grid" id="form-venta-queso" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>¿Qué se vende?</mat-label>
          <input matInput [value]="tipoLabel()" readonly />
          <mat-hint>El producto no se cambia: anule y registre de nuevo</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" [disabled]="conHermanos" />
          <mat-datepicker #pFecha />
          @if (conHermanos) {
            <mat-hint>Se cambia en la factura</mat-hint>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>Cliente</mat-label>
          <input matInput formControlName="cliente" required maxlength="150" [matAutocomplete]="autoCli" />
          <mat-autocomplete #autoCli="matAutocomplete">
            @for (nombre of clientesFiltrados(); track nombre) {
              <mat-option [value]="nombre">{{ nombre }}</mat-option>
            }
          </mat-autocomplete>
          @if (conHermanos) {
            <mat-hint>Se cambia en la factura</mat-hint>
          }
        </mat-form-field>
        @if (esMozzarella) {
          <!-- Lo que se cuenta va en piezas: step="1" y sin decimales. El backend
               RECHAZA "2,5 barras" en vez de redondearlas, así que el formulario no
               puede ofrecer algo que se va a devolver con error. Y no se menciona
               la merma: la pieza no pierde peso porque no se está pesando. -->
          <mat-form-field>
            <mat-label>{{ palabraUnidad() === 'barra' ? 'Barras' : 'Unidades' }}</mat-label>
            <input matInput type="number" min="1" step="1" formControlName="barras" required />
            <span matTextSuffix>{{ palabraUnidad() }}s</span>
            <mat-hint>
              {{ palabraUnidad() === 'barra' ? 'Barras completas' : 'Piezas completas' }}: no
              acepta media {{ palabraUnidad() }}
            </mat-hint>
          </mat-form-field>
          <!-- CON DECIMALES los cuatro campos de este diálogo (precio y gasto, por
               pieza y por kilo): ninguno es un total, todos son POR UNIDAD y de
               ellos salen la venta, el gasto y la ganancia. -->
          <mat-form-field>
            <mat-label>Precio por {{ palabraUnidad() }}</mat-label>
            <input matInput type="text" inputmode="decimal" appMiles [decimales]="2"
                   formControlName="precio_barra" required />
            <span matTextPrefix>$&nbsp;</span>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Concepto del gasto</mat-label>
            <input matInput formControlName="gasto_concepto" maxlength="150" placeholder="Ej. Transporte" />
            <mat-hint>Opcional</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Gasto por {{ palabraUnidad() }}</mat-label>
            <input matInput type="text" inputmode="decimal" appMiles [decimales]="2"
                   formControlName="gasto_por_barra" />
            <span matTextPrefix>$&nbsp;</span>
            <span matTextSuffix>/{{ palabraUnidad() }}</span>
            <mat-hint>Ej. transporte; no lo paga el cliente</mat-hint>
          </mat-form-field>
        } @else {
          <mat-form-field>
            <mat-label>Kilos</mat-label>
            <input matInput type="number" min="0" step="0.1" formControlName="kilos" required />
            <span matTextSuffix>kg</span>
            <mat-hint>El peso real al vender (aquí se ve la merma)</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Precio por kilo</mat-label>
            <input matInput type="text" inputmode="decimal" appMiles [decimales]="2"
                   formControlName="precio_kilo" required />
            <span matTextPrefix>$&nbsp;</span>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Concepto del gasto</mat-label>
            <input matInput formControlName="gasto_concepto" maxlength="150" placeholder="Ej. Transporte" />
            <mat-hint>Opcional</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Gasto por kilo</mat-label>
            <input matInput type="text" inputmode="decimal" appMiles [decimales]="2"
                   formControlName="gasto_por_kilo" />
            <span matTextPrefix>$&nbsp;</span>
            <span matTextSuffix>/kg</span>
            <mat-hint>Ej. transporte; no lo paga el cliente</mat-hint>
          </mat-form-field>
        }
        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea matInput formControlName="observaciones" rows="2"></textarea>
        </mat-form-field>
      </form>

      <div class="calculo">
        <span>Total de la venta: <strong>{{ total() | money: true }}</strong></span>
        @if (gastoTotal() > 0) {
          <!-- El rótulo del gasto lleva la unidad de ESTA venta: "/kg" en una de
               kilos y "/barra" en una de piezas. Un "$700/kg" debajo de una venta
               de barras sería una cifra que no significa nada. -->
          <span>
            Gastos: <strong>{{ gastoTotal() | money: true }}</strong>
            ({{ gastoUnitario() | money: true }}/{{ esMozzarella ? palabraUnidad() : 'kg' }})
          </span>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-venta-queso"
        [disabled]="form.invalid || guardando()"
      >
        @if (guardando()) {
          <app-spinner-boton /> Guardando…
        } @else {
          Guardar cambios
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    // Espacio extra entre filas: las pistas de kilos/gasto ocupan una línea más.
    .form-grid { row-gap: 22px; }

    .calculo {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 32px;
      margin-top: 16px;
      padding: 10px 14px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface-variant);

      strong { color: var(--mat-sys-on-surface); font-variant-numeric: tabular-nums; }
    }

    // Aviso de "esto es un renglón de una factura": los dos campos de la cabecera
    // quedan a la vista pero apagados, así que hay que decir por qué.
    .aviso-factura {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 0 0 8px;
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
export class VentaQuesoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<VentaQuesoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  private readonly catalogoServicio = inject(CatalogoReventaService);

  readonly data = inject<VentaQuesoFormData>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  /** La clave del producto de la fila. No cambia nunca: ver el comentario del componente. */
  readonly tipo = this.data.item.tipo;
  /**
   * ESTA VENTA SE CUENTA POR PIEZAS, decidido por la UNIDAD QUE MANDA EL BACKEND y no
   * preguntando si el producto se llama 'mozzarella'.
   *
   * Con la pregunta por el nombre, corregir la venta de un producto por unidad que no
   * fuera la mozzarella abría el formulario en la rama de los kilos —en cero, porque
   * en una venta por unidad los kilos son cero de verdad— y al guardar mandaba
   * `kilos` a una fila que se cuenta.
   */
  readonly esMozzarella = seCuenta(this.data.item.unidad);
  /** El nombre del producto, para los rótulos. Llega con el catálogo. */
  readonly nombreDelProducto = signal<string>('');

  /**
   * Este renglón COMPARTE FACTURA con otros. La fecha y el cliente son de la
   * factura, así que aquí no se tocan: el backend devuelve 422 si llegan, porque
   * cambiarlos en un renglón dejaría la factura diciendo una fecha y sus productos
   * otra. Con un solo producto sí se corrigen aquí y la cabecera se mueve con él.
   */
  readonly conHermanos = (this.data.cuantosRenglones ?? 1) > 1;

  readonly form = this.fb.group({
    fecha: [isoToDate(this.data.item.fecha) ?? hoyDate(), Validators.required],
    cliente: [this.data.item.cliente, [Validators.required, Validators.minLength(2)]],
    kilos: [Number(this.data.item.kilos), [Validators.required, Validators.min(0.01)]],
    precio_kilo: [Number(this.data.item.precio_kilo), [Validators.required, Validators.min(0.01)]],
    // Las barras arrancan con validadores puestos pero el control DESHABILITADO
    // (lo hace `_sincronizarUnidad`): un control deshabilitado no valida, así que
    // una venta de queso no queda inválida por no tener barras.
    barras: [Number(this.data.item.barras), [Validators.required, Validators.min(1)]],
    precio_barra: [
      Number(this.data.item.precio_barra),
      [Validators.required, Validators.min(0.01)],
    ],
    gasto_concepto: [this.data.item.gasto_concepto ?? ''],
    gasto_por_kilo: [Number(this.data.item.gasto_por_kilo), [Validators.min(0)]],
    gasto_por_barra: [Number(this.data.item.gasto_por_barra), [Validators.min(0)]],
    observaciones: [this.data.item.observaciones ?? ''],
  });

  /** Clientes ya registrados, para autocompletar el nombre. */
  readonly clientes = signal<string[]>([]);

  /**
   * Deja habilitado el par de controles de la unidad del tipo y deshabilitado el
   * del otro.
   *
   * Los controles deshabilitados NO validan, y eso es justo lo que se necesita: los
   * cuatro llevan `Validators.required` puesto de entrada, así que sin esto una
   * venta de queso quedaría inválida para siempre por no tener barras y el botón
   * Guardar nunca se activaría. La alternativa —añadir y quitar validadores a mano—
   * es la que se olvida el día que alguien toque una de las dos ramas.
   */
  private _sincronizarUnidad(): void {
    const opciones = { emitEvent: false };
    for (const nombre of ['barras', 'precio_barra', 'gasto_por_barra'] as const) {
      const control = this.form.controls[nombre];
      if (this.esMozzarella) control.enable(opciones);
      else control.disable(opciones);
    }
    for (const nombre of ['kilos', 'precio_kilo', 'gasto_por_kilo'] as const) {
      const control = this.form.controls[nombre];
      if (this.esMozzarella) control.disable(opciones);
      else control.enable(opciones);
    }
  }

  constructor() {
    this._sincronizarUnidad();
    firstValueFrom(this.servicio.sugerencias())
      .then((s) => this.clientes.set(s.clientes))
      .catch(() => undefined);
    firstValueFrom(this.catalogoServicio.catalogo())
      .then((catalogo) =>
        this.nombreDelProducto.set(
          catalogo.find((p) => p.clave === this.tipo)?.nombre ?? '',
        ),
      )
      .catch(() => undefined);
    if (this.conHermanos) {
      // Apagados, no escondidos: el dueño necesita seguir viendo de qué venta se
      // trata mientras corrige la cantidad o el precio.
      this.form.controls.fecha.disable();
      this.form.controls.cliente.disable();
    }
    protegerCambios(this.dialogRef, () => this.form);
  }

  /**
   * La palabra de la pieza de ESTE producto: "barra" la de la mozzarella y "unidad"
   * la de cualquier otro que se cuente. La manda el backend en la unidad de la fila.
   */
  palabraUnidad(): string {
    return this.data.item.unidad === 'barra' ? 'barra' : 'unidad';
  }

  /** "Costeño (por kilo)": el nombre del catálogo con su unidad al lado. */
  tipoLabel(): string {
    const nombre = this.nombreDelProducto() || this.tipo;
    return `${nombre} (por ${this.esMozzarella ? this.palabraUnidad() : 'kilo'})`;
  }

  nombreProducto(): string {
    return this.nombreDelProducto() || this.tipo;
  }

  /** Re-emite en cada cambio del formulario para recalcular el total en vivo. */
  private readonly cambios = toSignal(this.form.valueChanges);

  readonly total = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    // Cada unidad multiplica lo suyo: barras × precio por barra, o kilos × precio
    // por kilo. Nunca se cruzan.
    return this.esMozzarella
      ? Number(valores.barras || 0) * Number(valores.precio_barra || 0)
      : Number(valores.kilos || 0) * Number(valores.precio_kilo || 0);
  });

  /** El gasto UNITARIO de esta venta: por kilo o por barra, según el tipo. */
  readonly gastoUnitario = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    return Number(
      (this.esMozzarella ? valores.gasto_por_barra : valores.gasto_por_kilo) || 0,
    );
  });

  readonly gastoTotal = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    // El total en PESOS: unitario × cantidad, cada uno en su unidad.
    return (
      this.gastoUnitario() *
      Number((this.esMozzarella ? valores.barras : valores.kilos) || 0)
    );
  });

  readonly clientesFiltrados = computed(() => {
    this.cambios();
    const texto = (this.form.controls.cliente.value ?? '').toLowerCase().trim();
    const todos = this.clientes();
    const filtrados = texto ? todos.filter((n) => n.toLowerCase().includes(texto)) : todos;
    return filtrados.slice(0, 20);
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      // La fecha y el cliente NO VIAJAN cuando el renglón tiene hermanos: el
      // backend rechaza el PUT si llegan (aunque lleguen iguales, porque mira si
      // vienen, no si cambiaron). Se cambian en la factura, que es de donde los
      // renglones los copian.
      const comun: RenglonVentaUpdate = {
        ...(this.conHermanos
          ? {}
          : { fecha: dateToIso(valores.fecha), cliente: valores.cliente.trim() }),
        gasto_concepto: valores.gasto_concepto?.trim() || null,
        observaciones: valores.observaciones || null,
      };
      // El payload SE ARMA NOMBRANDO LOS CAMPOS DE LA UNIDAD y los del otro par no
      // viajan ni en cero: así es imposible que un intento previo en kilos se cuele
      // en una venta de barras.
      const payload: RenglonVentaUpdate = this.esMozzarella
        ? {
            ...comun,
            barras: Number(valores.barras),
            precio_barra: Number(valores.precio_barra),
            gasto_por_barra: Number(valores.gasto_por_barra || 0),
          }
        : {
            ...comun,
            kilos: Number(valores.kilos),
            precio_kilo: Number(valores.precio_kilo),
            gasto_por_kilo: Number(valores.gasto_por_kilo || 0),
          };
      const guardada = await firstValueFrom(
        this.servicio.editarVenta(this.data.item.id, payload),
      );
      this.dialogRef.close(guardada);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar la venta');
    } finally {
      this.guardando.set(false);
    }
  }
}
