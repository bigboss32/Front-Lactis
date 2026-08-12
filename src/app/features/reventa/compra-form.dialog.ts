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

import { dateToIso, isoToDate, hoyDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { MoneyPipe } from '../../shared/pipes';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import {
  CatalogoReventaService,
  CompraQueso,
  CompraQuesoPayload,
  ReventaService,
  seCuenta,
} from './reventa.service';

/** Lo que se le puede corregir a un renglón de compra: todo menos el `tipo`. */
type RenglonCompraUpdate = Partial<Omit<CompraQuesoPayload, 'tipo'>>;

/** Lo que recibe el diálogo: el renglón y de qué factura sale. */
export interface CompraFormData {
  item: CompraQueso;
  /**
   * Cuántos productos tiene la factura de la que sale este renglón. Con más de uno,
   * la fecha y el productor se cambian en la factura y no aquí (ver `conHermanos`).
   */
  cuantosRenglones?: number;
}

/**
 * Corrige UN PRODUCTO de una factura de compra, EN LA UNIDAD QUE ESE PRODUCTO TENGA:
 * kilos si se pesa, piezas si se cuenta. Al comprar se paga por todo lo recibido (no
 * hay merma: la merma real se ve al vender). Muestra en vivo el total a pagar
 * mientras se escribe.
 *
 * SOLO CORRIGE, NO REGISTRA. Las compras se registran en
 * `DocumentoReventaFormDialog`, que es la factura de varios productos. Este diálogo
 * quedó para corregir la cantidad o el precio de UN producto suelto, que es lo que
 * la factura no puede hacer cuando ya tiene abonos.
 *
 * CON HERMANOS, LA FECHA Y EL PRODUCTOR NO SE TOCAN AQUÍ: son de la factura y valen
 * para todos sus productos (ver `conHermanos`).
 *
 * LAS DOS UNIDADES NO COMPARTEN CAMPOS. Según el tipo se habilita el par de
 * controles de su unidad y se DESHABILITA el del otro, en vez de reutilizar un
 * campo "cantidad" con un rótulo que cambia. Es a propósito: un control
 * deshabilitado no viaja en `getRawValue()`… pero sí en `value`, así que además el
 * payload se arma nombrando los campos de la unidad y nada más. Así es imposible
 * que un intento previo en kilos se cuele en una compra de barras — el backend lo
 * rechazaría con el CHECK de la tabla, pero un 500 de la base no le dice nada al
 * dueño.
 *
 * EL TIPO NO SE EDITA: cambiárselo a una compra que ya tiene ventas encima movería
 * mercancía de una cola de inventario a la otra. Si se registró mal, se elimina o
 * se anula.
 *
 * LA BORONA QUE VINO GRATIS con el queso no tiene campo aquí y no se toca: el PUT
 * es parcial, así que no mandarla la deja como está. Es la misma razón por la que la
 * factura la lleva escondida (ver `DocumentoReventaFormDialog`).
 */
@Component({
  selector: 'app-compra-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatButtonModule, MatAutocompleteModule, MatIconModule,
    MoneyPipe, MilesInputDirective, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>Corregir {{ nombreProducto() }}</h2>
    <mat-dialog-content>
      @if (conHermanos) {
        <p class="aviso-factura">
          <mat-icon>receipt_long</mat-icon>
          <span>
            Este es uno de los {{ data.cuantosRenglones }} productos de una factura.
            Aquí se corrigen <strong>la cantidad y el precio</strong>; la fecha y el
            productor se cambian en la factura, porque valen para todos sus productos.
          </span>
        </p>
      }
      <form [formGroup]="form" class="form-grid" id="form-compra" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Producto</mat-label>
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
          <mat-label>Productor</mat-label>
          <input matInput formControlName="productor" required maxlength="150" [matAutocomplete]="autoProd" />
          <mat-autocomplete #autoProd="matAutocomplete">
            @for (nombre of productoresFiltrados(); track nombre) {
              <mat-option [value]="nombre">{{ nombre }}</mat-option>
            }
          </mat-autocomplete>
          @if (conHermanos) {
            <mat-hint>Se cambia en la factura</mat-hint>
          }
        </mat-form-field>

        @if (esMozzarella) {
          <!-- step="1" y sin decimales: una pieza es una pieza. El backend RECHAZA
               "8,5 barras" (no las redondea), así que el formulario no puede
               ofrecer algo que se va a devolver con error. -->
          <mat-form-field>
            <mat-label>{{ palabraUnidad() === 'barra' ? 'Barras' : 'Unidades' }}</mat-label>
            <input matInput type="number" min="1" step="1" formControlName="barras" required />
            <span matTextSuffix>{{ palabraUnidad() }}s</span>
            <mat-hint>
              {{ palabraUnidad() === 'barra' ? 'Barras completas' : 'Piezas completas' }}: no
              acepta media {{ palabraUnidad() }}
            </mat-hint>
          </mat-form-field>
          <!-- CON DECIMALES: es el precio de UNA pieza y es lo que se le paga al
               productor; el total a pagar sale de multiplicarlo. -->
          <mat-form-field>
            <mat-label>Precio por {{ palabraUnidad() }}</mat-label>
            <input matInput type="text" inputmode="decimal" appMiles [decimales]="2"
                   formControlName="precio_barra" required />
            <span matTextPrefix>$&nbsp;</span>
          </mat-form-field>
        } @else {
          <mat-form-field>
            <mat-label>Kilos</mat-label>
            <input matInput type="number" min="0" step="0.1" formControlName="kilos_brutos" required />
            <span matTextSuffix>kg</span>
            <mat-hint>Lo que compras y pagas al productor</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Precio por kilo</mat-label>
            <input matInput type="text" inputmode="decimal" appMiles [decimales]="2"
                   formControlName="precio_kilo" required />
            <span matTextPrefix>$&nbsp;</span>
          </mat-form-field>
        }

        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea matInput formControlName="observaciones" rows="2"></textarea>
        </mat-form-field>
      </form>

      <div class="calculo">
        <span>Total a pagar: <strong>{{ totalPagar() | money: true }}</strong></span>
        @if (esMozzarella) {
          <!-- Se repite la cuenta con la unidad puesta para que el dueño la pueda
               verificar de un vistazo contra su calculadora. -->
          <span class="detalle">{{ detalleCuenta() }}</span>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-compra"
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
    // Espacio extra entre filas: las pistas de kilos/borona ocupan una línea más.
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
      .detalle { font-size: 12px; font-variant-numeric: tabular-nums; }
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
export class CompraFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<CompraFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  private readonly catalogoServicio = inject(CatalogoReventaService);

  readonly data = inject<CompraFormData>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  /** La clave del producto de la fila. No cambia nunca: ver el comentario del componente. */
  readonly tipo = this.data.item.tipo;
  /**
   * ESTA COMPRA SE CUENTA POR PIEZAS, y se decide con la UNIDAD QUE MANDA EL BACKEND
   * y no preguntando si el producto se llama 'mozzarella'.
   *
   * Es el mismo defecto que el backend acabó de cerrar, de este lado: con la pregunta
   * por el nombre, corregir la compra de un producto por unidad que no fuera la
   * mozzarella abría el formulario en la rama de los kilos —o sea con la cantidad y
   * el precio en cero, porque en una compra por unidad los kilos son cero de verdad—
   * y al guardar mandaba `kilos_brutos` a una fila que se cuenta. El servidor la
   * rechaza, pero el dueño ya habría visto su compra de 100 panelas como si estuviera
   * en blanco.
   */
  readonly esMozzarella = seCuenta(this.data.item.unidad);
  /** El nombre del producto, para los rótulos. Llega con el catálogo. */
  readonly nombreDelProducto = signal<string>('');

  /**
   * Este renglón COMPARTE FACTURA con otros, así que la fecha y el productor se
   * cambian en la factura: el backend devuelve 422 si llegan por aquí.
   */
  readonly conHermanos = (this.data.cuantosRenglones ?? 1) > 1;

  readonly form = this.fb.group({
    fecha: [isoToDate(this.data.item.fecha) ?? hoyDate(), Validators.required],
    productor: [this.data.item.productor, [Validators.required, Validators.minLength(2)]],
    kilos_brutos: [
      Number(this.data.item.kilos_brutos),
      [Validators.required, Validators.min(0.01)],
    ],
    precio_kilo: [Number(this.data.item.precio_kilo), [Validators.required, Validators.min(0.01)]],
    // Las barras arrancan con los validadores puestos pero el control DESHABILITADO
    // (lo hace `_sincronizarUnidad` en el constructor): un control deshabilitado no
    // valida, así que una compra de queso no queda inválida por no tener barras.
    barras: [Number(this.data.item.barras), [Validators.required, Validators.min(1)]],
    precio_barra: [
      Number(this.data.item.precio_barra),
      [Validators.required, Validators.min(0.01)],
    ],
    observaciones: [this.data.item.observaciones ?? ''],
  });

  /** Re-emite en cada cambio del formulario para recalcular en vivo. */
  private readonly cambios = toSignal(this.form.valueChanges);

  readonly totalPagar = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    // Cada unidad multiplica lo suyo. No hay un camino común con un "precio
    // unitario": un precio por barra usado como precio por kilo daría un total que
    // no coincide con lo que el productor espera cobrar.
    return this.esMozzarella
      ? Number(valores.barras || 0) * Number(valores.precio_barra || 0)
      : Number(valores.kilos_brutos || 0) * Number(valores.precio_kilo || 0);
  });

  /** "12 barras × $9.000" — la cuenta escrita, para poder verificarla a mano. */
  readonly detalleCuenta = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    const cantidad = Math.round(Number(valores.barras || 0));
    const singular = this.palabraUnidad();
    const unidad = Math.abs(cantidad) === 1 ? singular : `${singular}s`;
    const precio = Number(valores.precio_barra || 0).toLocaleString('es-CO');
    return `${cantidad} ${unidad} × $${precio} por ${singular}`;
  });

  /**
   * La palabra de la pieza de ESTE producto: "barra" la de la mozzarella y "unidad"
   * la de cualquier otro que se cuente. La manda el backend en la unidad de la fila.
   */
  palabraUnidad(): string {
    return this.data.item.unidad === 'barra' ? 'barra' : 'unidad';
  }

  /** Productores ya registrados, para autocompletar el nombre. */
  readonly productores = signal<string[]>([]);
  readonly productoresFiltrados = computed(() => {
    this.cambios();
    const texto = (this.form.controls.productor.value ?? '').toLowerCase().trim();
    const todos = this.productores();
    const filtrados = texto ? todos.filter((n) => n.toLowerCase().includes(texto)) : todos;
    return filtrados.slice(0, 20);
  });

  /**
   * "Costeño (por kilo)" — el nombre del catálogo con su unidad al lado.
   *
   * Mientras el catálogo no llegue se muestra la CLAVE de la fila, que es lo único
   * que se sabe con certeza del producto: inventarle un nombre sería peor, y dejar el
   * campo en blanco haría dudar de qué se está corrigiendo.
   */
  tipoLabel(): string {
    const nombre = this.nombreDelProducto() || this.tipo;
    return `${nombre} (por ${this.esMozzarella ? this.palabraUnidad() : 'kilo'})`;
  }

  nombreProducto(): string {
    return this.nombreDelProducto() || this.tipo;
  }

  /**
   * Deja habilitado el par de controles de la unidad del tipo y deshabilitado el
   * del otro.
   *
   * Los controles deshabilitados NO validan, y eso es justo lo que se necesita:
   * los cuatro llevan `Validators.required` puesto de entrada, así que sin esto una
   * compra de queso quedaría inválida para siempre por no tener barras y el botón
   * Guardar nunca se activaría. La alternativa —añadir y quitar validadores a mano
   * en cada cambio— es la que se olvida el día que alguien toque una de las dos
   * ramas.
   */
  private _sincronizarUnidad(): void {
    const opciones = { emitEvent: false };
    for (const nombre of ['barras', 'precio_barra'] as const) {
      const control = this.form.controls[nombre];
      if (this.esMozzarella) control.enable(opciones);
      else control.disable(opciones);
    }
    for (const nombre of ['kilos_brutos', 'precio_kilo'] as const) {
      const control = this.form.controls[nombre];
      if (this.esMozzarella) control.disable(opciones);
      else control.enable(opciones);
    }
  }

  constructor() {
    firstValueFrom(this.servicio.sugerencias())
      .then((s) => this.productores.set(s.productores))
      .catch(() => undefined);
    firstValueFrom(this.catalogoServicio.catalogo())
      .then((catalogo) =>
        this.nombreDelProducto.set(
          catalogo.find((p) => p.clave === this.tipo)?.nombre ?? '',
        ),
      )
      .catch(() => undefined);
    this._sincronizarUnidad();
    if (this.conHermanos) {
      // Apagados, no escondidos: el dueño necesita seguir viendo de qué compra se
      // trata mientras corrige la cantidad o el precio.
      this.form.controls.fecha.disable();
      this.form.controls.productor.disable();
    }
    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      // La fecha y el productor NO VIAJAN cuando el renglón tiene hermanos: el
      // backend rechaza el PUT si llegan (mira si vienen, no si cambiaron).
      const comun: RenglonCompraUpdate = {
        ...(this.conHermanos
          ? {}
          : { fecha: dateToIso(valores.fecha), productor: valores.productor.trim() }),
        observaciones: valores.observaciones || null,
      };
      // El payload SE ARMA NOMBRANDO LOS CAMPOS DE LA UNIDAD, no mandando los seis
      // y dejando que el backend elija: los del otro par no pueden viajar ni en
      // cero.
      const payload: RenglonCompraUpdate = this.esMozzarella
        ? {
            ...comun,
            barras: Number(valores.barras),
            precio_barra: Number(valores.precio_barra),
          }
        : {
            ...comun,
            kilos_brutos: Number(valores.kilos_brutos),
            precio_kilo: Number(valores.precio_kilo),
          };
      const guardada = await firstValueFrom(
        this.servicio.editarCompra(this.data.item.id, payload),
      );
      this.dialogRef.close(guardada);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar la compra');
    } finally {
      this.guardando.set(false);
    }
  }
}
