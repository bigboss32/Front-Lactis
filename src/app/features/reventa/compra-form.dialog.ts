import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { dateToIso, isoToDate, hoyDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { MoneyPipe } from '../../shared/pipes';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { CompraQueso, CompraQuesoPayload, ReventaService, TipoCompra } from './reventa.service';

/**
 * Registra o edita una compra a un productor: QUESO en kilos o MOZZARELLA en
 * barras. Al comprar se paga por todo lo recibido (no hay merma: la merma real se
 * ve al vender). Muestra en vivo el total a pagar mientras se escribe.
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
 * EL TIPO NO SE EDITA. Al editar se muestra de solo lectura, igual que en la
 * venta: cambiárselo a una compra que ya tiene ventas encima movería mercancía de
 * una cola de inventario a la otra. Si se registró mal, se elimina o se anula.
 */
@Component({
  selector: 'app-compra-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatButtonModule, MatAutocompleteModule, MatSelectModule,
    MoneyPipe, MilesInputDirective, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ tituloDialogo() }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-compra" (ngSubmit)="guardar()">
        @if (data?.item) {
          <!-- Al editar el tipo se ve pero no se toca (ver el comentario del componente). -->
          <mat-form-field>
            <mat-label>Producto</mat-label>
            <input matInput [value]="tipoLabel(tipo())" readonly />
            <mat-hint>El producto no se cambia: anule y registre de nuevo</mat-hint>
          </mat-form-field>
        } @else {
          <mat-form-field>
            <mat-label>Producto</mat-label>
            <mat-select formControlName="tipo">
              <mat-option value="queso">Queso (por kilo)</mat-option>
              <mat-option value="mozzarella">Mozzarella (por barra)</mat-option>
            </mat-select>
          </mat-form-field>
        }
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Productor</mat-label>
          <input matInput formControlName="productor" required maxlength="150" [matAutocomplete]="autoProd" />
          <mat-autocomplete #autoProd="matAutocomplete">
            @for (nombre of productoresFiltrados(); track nombre) {
              <mat-option [value]="nombre">{{ nombre }}</mat-option>
            }
          </mat-autocomplete>
        </mat-form-field>

        @if (esMozzarella()) {
          <!-- step="1" y sin decimales: una barra es una barra. El backend RECHAZA
               "8,5 barras" (no las redondea), así que el formulario no puede
               ofrecer algo que se va a devolver con error. -->
          <mat-form-field>
            <mat-label>Barras</mat-label>
            <input matInput type="number" min="1" step="1" formControlName="barras" required />
            <span matTextSuffix>barras</span>
            <mat-hint>Barras completas: no acepta medias barras</mat-hint>
          </mat-form-field>
          <!-- CON DECIMALES: es el precio de UNA barra y es lo que se le paga al
               productor; el total a pagar sale de multiplicarlo. -->
          <mat-form-field>
            <mat-label>Precio por barra</mat-label>
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
          <!-- CON DECIMALES: mismo caso, el precio de UN kilo de lo que se le compra
               al productor. -->
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
        <span>Total a pagar: <strong>{{ totalPagar() | money }}</strong></span>
        @if (esMozzarella()) {
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
          Guardar
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
  `,
})
export class CompraFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<CompraFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: CompraQueso } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    // Al editar manda el tipo de la fila guardada; el control existe igual para no
    // tener dos formularios, pero la plantilla no lo deja tocar.
    tipo: [(this.data?.item?.tipo ?? 'queso') as TipoCompra, Validators.required],
    fecha: [this.data?.item ? (isoToDate(this.data.item.fecha) ?? hoyDate()) : hoyDate(), Validators.required],
    productor: [this.data?.item?.productor ?? '', [Validators.required, Validators.minLength(2)]],
    kilos_brutos: [Number(this.data?.item?.kilos_brutos ?? 0), [Validators.required, Validators.min(0.01)]],
    precio_kilo: [Number(this.data?.item?.precio_kilo ?? 0), [Validators.required, Validators.min(0.01)]],
    // Las barras arrancan con los validadores puestos pero el control DESHABILITADO
    // (lo hace `_sincronizarUnidad` en el constructor): un control deshabilitado no
    // valida, así que una compra de queso no queda inválida por no tener barras.
    barras: [Number(this.data?.item?.barras ?? 0), [Validators.required, Validators.min(1)]],
    precio_barra: [Number(this.data?.item?.precio_barra ?? 0), [Validators.required, Validators.min(0.01)]],
    observaciones: [this.data?.item?.observaciones ?? ''],
  });

  /** Re-emite en cada cambio del formulario para recalcular en vivo. */
  private readonly cambios = toSignal(this.form.valueChanges);

  /** El tipo que manda AHORA: el de la fila si se edita, el del selector si es nueva. */
  readonly tipo = computed<TipoCompra>(() => {
    this.cambios();
    return this.data?.item?.tipo ?? this.form.getRawValue().tipo;
  });

  readonly esMozzarella = computed(() => this.tipo() === 'mozzarella');

  readonly tituloDialogo = computed(() => {
    if (this.data?.item) return 'Editar compra';
    return this.esMozzarella() ? 'Nueva compra de mozzarella' : 'Nueva compra de queso';
  });

  readonly totalPagar = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    // Cada unidad multiplica lo suyo. No hay un camino común con un "precio
    // unitario": un precio por barra usado como precio por kilo daría un total que
    // no coincide con lo que el productor espera cobrar.
    return this.esMozzarella()
      ? Number(valores.barras || 0) * Number(valores.precio_barra || 0)
      : Number(valores.kilos_brutos || 0) * Number(valores.precio_kilo || 0);
  });

  /** "12 barras × $9.000" — la cuenta escrita, para poder verificarla a mano. */
  readonly detalleCuenta = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    const cantidad = Math.round(Number(valores.barras || 0));
    const unidad = Math.abs(cantidad) === 1 ? 'barra' : 'barras';
    const precio = Number(valores.precio_barra || 0).toLocaleString('es-CO');
    return `${cantidad} ${unidad} × $${precio} por barra`;
  });

  /** Productores ya registrados, para autocompletar el nombre. */
  readonly productores = signal<string[]>([]);
  readonly productoresFiltrados = computed(() => {
    this.cambios();
    const texto = (this.form.getRawValue().productor ?? '').toLowerCase().trim();
    const todos = this.productores();
    const filtrados = texto ? todos.filter((n) => n.toLowerCase().includes(texto)) : todos;
    return filtrados.slice(0, 20);
  });

  tipoLabel(tipo: TipoCompra): string {
    return tipo === 'mozzarella' ? 'Mozzarella (por barra)' : 'Queso (por kilo)';
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
  private _sincronizarUnidad(tipo: TipoCompra): void {
    const opciones = { emitEvent: false };
    const deBarras = tipo === 'mozzarella';
    for (const nombre of ['barras', 'precio_barra'] as const) {
      const control = this.form.controls[nombre];
      if (deBarras) control.enable(opciones);
      else control.disable(opciones);
    }
    for (const nombre of ['kilos_brutos', 'precio_kilo'] as const) {
      const control = this.form.controls[nombre];
      if (deBarras) control.disable(opciones);
      else control.enable(opciones);
    }
  }

  constructor() {
    firstValueFrom(this.servicio.sugerencias())
      .then((s) => this.productores.set(s.productores))
      .catch(() => undefined);
    // El estado inicial y cada cambio del selector. Al editar, el tipo no cambia
    // nunca, así que esto corre una sola vez con el tipo de la fila guardada.
    this._sincronizarUnidad(this.data?.item?.tipo ?? this.form.getRawValue().tipo);
    this.form.controls.tipo.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((tipo) => this._sincronizarUnidad(tipo));
    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const comun = {
        fecha: dateToIso(valores.fecha),
        productor: valores.productor.trim(),
        observaciones: valores.observaciones || null,
      };
      // El payload SE ARMA NOMBRANDO LOS CAMPOS DE LA UNIDAD, no mandando los seis
      // y dejando que el backend elija: los del otro par no pueden viajar ni en
      // cero. Y el `tipo` solo va al crear, porque no se edita.
      const payload: CompraQuesoPayload = this.esMozzarella()
        ? {
            ...comun,
            ...(this.data?.item ? {} : { tipo: 'mozzarella' as const }),
            barras: Number(valores.barras),
            precio_barra: Number(valores.precio_barra),
          }
        : {
            ...comun,
            ...(this.data?.item ? {} : { tipo: 'queso' as const }),
            kilos_brutos: Number(valores.kilos_brutos),
            precio_kilo: Number(valores.precio_kilo),
          };
      const guardada = await firstValueFrom(
        this.data?.item
          ? this.servicio.editarCompra(this.data.item.id, payload)
          : this.servicio.crearCompra(payload),
      );
      // Se devuelve la compra guardada y no un simple `true`: quien abrió el
      // diálogo la necesita para ofrecer «Anexar soporte» justo después de
      // registrarla, que es cuando el dueño tiene la foto de la transferencia a
      // mano. Sigue siendo un valor "verdadero", así que quien solo pregunta si
      // se guardó no se entera del cambio.
      this.dialogRef.close(guardada);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar la compra');
    } finally {
      this.guardando.set(false);
    }
  }
}
