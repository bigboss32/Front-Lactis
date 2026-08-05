import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { MoneyPipe } from '../../shared/pipes';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { dateToIso, isoToDate, hoyDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { ReventaService, TipoVenta, VentaQueso, VentaQuesoPayload } from './reventa.service';

/** Precio de venta de queso sugerido por kilo (del cuaderno del dueño). */
const PRECIO_VENTA_SUGERIDO = 19500;

/**
 * Registra o edita una venta de reventa: QUESO o BORONA en kilos, o MOZZARELLA en
 * barras. Calcula el total en vivo, permite anotar los gastos de vender (ej.
 * transporte) y, al crear, marcarla como pagada de contado.
 *
 * LAS DOS UNIDADES NO COMPARTEN CAMPOS y el par de la unidad que no toca queda
 * DESHABILITADO: es el mismo criterio (y por las mismas razones) que en la compra;
 * está explicado a fondo en `CompraFormDialog` y en `_sincronizarUnidad`.
 *
 * El `tipo` nunca se ha podido editar y sigue sin poderse: define de qué
 * inventario sale la mercancía, y cambiarlo movería cantidades de una cola del
 * reparto a otra.
 */
@Component({
  selector: 'app-venta-queso-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatCheckboxModule, MatDatepickerModule, MoneyPipe,
    MilesInputDirective, MatAutocompleteModule, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ tituloDialogo() }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-venta-queso" (ngSubmit)="guardar()">
        @if (data?.item) {
          <mat-form-field>
            <mat-label>¿Qué se vende?</mat-label>
            <input matInput [value]="tipoLabel(data!.item!.tipo)" readonly />
          </mat-form-field>
        } @else {
          <mat-form-field>
            <mat-label>¿Qué vende?</mat-label>
            <mat-select formControlName="tipo">
              <mat-option value="queso">Queso (por kilo)</mat-option>
              <mat-option value="borona">Borona (por kilo)</mat-option>
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
          <mat-label>Cliente</mat-label>
          <input matInput formControlName="cliente" required maxlength="150" [matAutocomplete]="autoCli" />
          <mat-autocomplete #autoCli="matAutocomplete">
            @for (nombre of clientesFiltrados(); track nombre) {
              <mat-option [value]="nombre">{{ nombre }}</mat-option>
            }
          </mat-autocomplete>
        </mat-form-field>
        @if (esMozzarella()) {
          <!-- La mozzarella se cuenta: step="1" y sin decimales. El backend
               RECHAZA "2,5 barras" en vez de redondearlas, así que el formulario no
               puede ofrecer algo que se va a devolver con error. Y no se menciona
               la merma: la barra no pierde peso porque no se está pesando. -->
          <mat-form-field>
            <mat-label>Barras</mat-label>
            <input matInput type="number" min="1" step="1" formControlName="barras" required />
            <span matTextSuffix>barras</span>
            <mat-hint>Barras completas: no acepta medias barras</mat-hint>
          </mat-form-field>
          <!-- CON DECIMALES los cuatro campos de este diálogo (precio y gasto, por
               barra y por kilo): ninguno es un total, todos son POR UNIDAD y de
               ellos salen la venta, el gasto y la ganancia. -->
          <mat-form-field>
            <mat-label>Precio por barra</mat-label>
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
            <mat-label>Gasto por barra</mat-label>
            <input matInput type="text" inputmode="decimal" appMiles [decimales]="2"
                   formControlName="gasto_por_barra" />
            <span matTextPrefix>$&nbsp;</span>
            <span matTextSuffix>/barra</span>
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
        @if (!data?.item) {
          <mat-checkbox class="full" formControlName="pagada_de_contado">
            Pagada de contado
          </mat-checkbox>
        }
      </form>

      <div class="calculo">
        <span>Total de la venta: <strong>{{ total() | money }}</strong></span>
        @if (gastoTotal() > 0) {
          <!-- El rótulo del gasto lleva la unidad de ESTA venta: "/kg" en una de
               kilos y "/barra" en una de barras. Un "$700/kg" debajo de una venta
               de barras sería una cifra que no significa nada. -->
          <span>
            Gastos: <strong>{{ gastoTotal() | money }}</strong>
            ({{ gastoUnitario() | money }}/{{ esMozzarella() ? 'barra' : 'kg' }})
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
          Guardar
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
  `,
})
export class VentaQuesoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<VentaQuesoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: VentaQueso } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    tipo: [this.data?.item?.tipo ?? ('queso' as TipoVenta), Validators.required],
    fecha: [this.data?.item ? (isoToDate(this.data.item.fecha) ?? hoyDate()) : hoyDate(), Validators.required],
    cliente: [this.data?.item?.cliente ?? '', [Validators.required, Validators.minLength(2)]],
    kilos: [Number(this.data?.item?.kilos ?? 0), [Validators.required, Validators.min(0.01)]],
    precio_kilo: [
      Number(this.data?.item?.precio_kilo ?? PRECIO_VENTA_SUGERIDO),
      [Validators.required, Validators.min(0.01)],
    ],
    // Las barras arrancan con validadores puestos pero el control DESHABILITADO
    // (lo hace `_sincronizarUnidad`): un control deshabilitado no valida, así que
    // una venta de queso no queda inválida por no tener barras.
    barras: [Number(this.data?.item?.barras ?? 0), [Validators.required, Validators.min(1)]],
    precio_barra: [
      Number(this.data?.item?.precio_barra ?? 0),
      [Validators.required, Validators.min(0.01)],
    ],
    gasto_concepto: [this.data?.item?.gasto_concepto ?? ''],
    gasto_por_kilo: [Number(this.data?.item?.gasto_por_kilo ?? 0), [Validators.min(0)]],
    gasto_por_barra: [Number(this.data?.item?.gasto_por_barra ?? 0), [Validators.min(0)]],
    observaciones: [this.data?.item?.observaciones ?? ''],
    pagada_de_contado: [false],
  });

  /** Clientes ya registrados, para autocompletar el nombre. */
  readonly clientes = signal<string[]>([]);

  /**
   * Deja habilitado el par de controles de la unidad del tipo y deshabilitado el
   * del otro. Ver la explicación larga en `CompraFormDialog._sincronizarUnidad`:
   * es lo que permite que los cuatro campos lleven `required` sin que el botón
   * Guardar quede bloqueado para siempre en la unidad que no se está usando.
   */
  private _sincronizarUnidad(tipo: TipoVenta): void {
    const opciones = { emitEvent: false };
    const deBarras = tipo === 'mozzarella';
    for (const nombre of ['barras', 'precio_barra', 'gasto_por_barra'] as const) {
      const control = this.form.controls[nombre];
      if (deBarras) control.enable(opciones);
      else control.disable(opciones);
    }
    for (const nombre of ['kilos', 'precio_kilo', 'gasto_por_kilo'] as const) {
      const control = this.form.controls[nombre];
      if (deBarras) control.disable(opciones);
      else control.enable(opciones);
    }
  }

  constructor() {
    this._sincronizarUnidad(this.data?.item?.tipo ?? this.form.getRawValue().tipo);
    // Al crear: el queso sugiere 19.500/kg; la borona no sugiere precio. La
    // mozzarella tampoco sugiere: su precio por barra no tiene nada que ver con el
    // del queso por kilo, y dejar 19.500 puesto en un campo "por barra" invitaría
    // a guardarlo sin pensar.
    if (!this.data?.item) {
      this.form.controls.tipo.valueChanges
        .pipe(takeUntilDestroyed())
        .subscribe((tipo) => {
          this._sincronizarUnidad(tipo);
          this.form.controls.precio_kilo.setValue(tipo === 'queso' ? PRECIO_VENTA_SUGERIDO : 0);
        });
    }
    firstValueFrom(this.servicio.sugerencias())
      .then((s) => this.clientes.set(s.clientes))
      .catch(() => undefined);
    protegerCambios(this.dialogRef, () => this.form);
  }

  tipoLabel(tipo: TipoVenta): string {
    if (tipo === 'mozzarella') return 'Mozzarella (por barra)';
    return tipo === 'borona' ? 'Borona (por kilo)' : 'Queso (por kilo)';
  }

  /** Re-emite en cada cambio del formulario para recalcular el total en vivo. */
  private readonly cambios = toSignal(this.form.valueChanges);

  /** El tipo que manda AHORA: el de la fila si se edita, el del selector si es nueva. */
  readonly tipo = computed<TipoVenta>(() => {
    this.cambios();
    return this.data?.item?.tipo ?? this.form.getRawValue().tipo;
  });

  readonly esMozzarella = computed(() => this.tipo() === 'mozzarella');

  readonly tituloDialogo = computed(() => {
    if (this.data?.item) return 'Editar venta';
    return this.esMozzarella() ? 'Nueva venta de mozzarella' : 'Nueva venta de queso';
  });

  readonly total = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    // Cada unidad multiplica lo suyo: barras × precio por barra, o kilos × precio
    // por kilo. Nunca se cruzan.
    return this.esMozzarella()
      ? Number(valores.barras || 0) * Number(valores.precio_barra || 0)
      : Number(valores.kilos || 0) * Number(valores.precio_kilo || 0);
  });

  /** El gasto UNITARIO de esta venta: por kilo o por barra, según el tipo. */
  readonly gastoUnitario = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    return Number(
      (this.esMozzarella() ? valores.gasto_por_barra : valores.gasto_por_kilo) || 0,
    );
  });

  readonly gastoTotal = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    // El total en PESOS: unitario × cantidad, cada uno en su unidad.
    return (
      this.gastoUnitario() *
      Number((this.esMozzarella() ? valores.barras : valores.kilos) || 0)
    );
  });

  readonly clientesFiltrados = computed(() => {
    this.cambios();
    const texto = (this.form.getRawValue().cliente ?? '').toLowerCase().trim();
    const todos = this.clientes();
    const filtrados = texto ? todos.filter((n) => n.toLowerCase().includes(texto)) : todos;
    return filtrados.slice(0, 20);
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const comun = {
        fecha: dateToIso(valores.fecha),
        cliente: valores.cliente.trim(),
        gasto_concepto: valores.gasto_concepto?.trim() || null,
        observaciones: valores.observaciones || null,
      };
      // El payload SE ARMA NOMBRANDO LOS CAMPOS DE LA UNIDAD y los del otro par no
      // viajan ni en cero (mismo criterio que en la compra: ver CompraFormDialog).
      const payload: Omit<VentaQuesoPayload, 'tipo' | 'pagada_de_contado'> = this.esMozzarella()
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
        this.data?.item
          ? this.servicio.editarVenta(this.data.item.id, payload)
          : this.servicio.crearVenta({
              ...payload,
              tipo: valores.tipo,
              pagada_de_contado: valores.pagada_de_contado,
            }),
      );
      // Se devuelve la venta guardada, no un simple `true`: quien abrió el
      // diálogo la necesita para ofrecer «Anexar soporte» justo después, que es
      // cuando el dueño tiene a mano la foto de la transferencia del cliente.
      // Sigue siendo un valor "verdadero" para quien solo mira si se guardó.
      this.dialogRef.close(guardada);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar la venta');
    } finally {
      this.guardando.set(false);
    }
  }
}
