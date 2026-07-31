import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom, merge } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Cliente, Page, ViajeDetalle, ViajeServicio } from '../../core/models';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SelectBuscable } from '../../shared/select-buscable';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { VehiculosService } from './vehiculos.service';
import { ViajeServicioPayload, ViajesService } from './viajes.service';

export interface ViajeServicioFormData {
  viaje: ViajeDetalle;
  /** Servicio a editar; si falta, se crea uno nuevo. */
  servicio?: ViajeServicio;
}

/**
 * Crea o edita un servicio de flete dentro de un viaje.
 *
 * - "Queso propio (interno)": se valora a tarifa por kilo para medir la
 *   rentabilidad real del viaje, sin cliente ni cartera.
 * - Cliente híbrido: del directorio (crédito permitido) o texto libre para
 *   ocasionales; el crédito EXIGE cliente del directorio, así que un ocasional
 *   solo puede quedar pagado de contado.
 * - Por kilo el valor se calcula (kilos × tarifa) y queda bloqueado; a precio
 *   fijo se digita directo.
 */
@Component({
  selector: 'app-viaje-servicio-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatButtonToggleModule, MatCheckboxModule,
    MilesInputDirective, SelectBuscable, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.servicio ? 'Editar servicio' : 'Nuevo servicio de flete' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-servicio" (ngSubmit)="guardar()">
        <div class="full toggles">
          <mat-button-toggle-group formControlName="sentido" aria-label="Sentido del flete">
            <mat-button-toggle value="ida">Ida</mat-button-toggle>
            <mat-button-toggle value="regreso">Regreso</mat-button-toggle>
          </mat-button-toggle-group>
          <mat-checkbox formControlName="es_interno">Queso propio (interno)</mat-checkbox>
        </div>

        @if (!esInterno()) {
          <div class="full toggles">
            <span class="etq">Cliente:</span>
            <mat-button-toggle-group formControlName="modo_cliente" aria-label="Tipo de cliente">
              <mat-button-toggle value="directorio">Del directorio</mat-button-toggle>
              <mat-button-toggle value="ocasional">Ocasional</mat-button-toggle>
            </mat-button-toggle-group>
          </div>
          @if (modoCliente() === 'directorio') {
            <app-select-buscable
              class="full"
              formControlName="cliente_id"
              [opciones]="opcionesClientes()"
              label="Cliente"
            />
          } @else {
            <mat-form-field class="full">
              <mat-label>Nombre del cliente ocasional</mat-label>
              <input matInput formControlName="cliente_nombre" maxlength="150" />
              <mat-hint>Los fletes a crédito van al directorio; el ocasional paga de contado</mat-hint>
            </mat-form-field>
          }
        }

        <mat-form-field class="full">
          <mat-label>Descripción de la carga</mat-label>
          <input matInput formControlName="descripcion" required maxlength="200" cdkFocusInitial />
        </mat-form-field>

        @if (!esInterno()) {
          <div class="full toggles">
            <span class="etq">Cobro:</span>
            <mat-button-toggle-group formControlName="tipo_cobro" aria-label="Tipo de cobro">
              <mat-button-toggle value="por_kilo">Por kilo</mat-button-toggle>
              <mat-button-toggle value="precio_fijo">Precio fijo</mat-button-toggle>
            </mat-button-toggle-group>
          </div>
        }

        <mat-form-field>
          <mat-label>Kilos</mat-label>
          <input matInput type="number" min="0" step="0.1" formControlName="kilos" />
          <span matTextSuffix>kg</span>
          @if (!porKilo()) {
            <mat-hint>Opcional a precio fijo</mat-hint>
          }
        </mat-form-field>
        @if (porKilo()) {
          <mat-form-field>
            <mat-label>Tarifa por kilo</mat-label>
            <input matInput type="text" inputmode="numeric" appMiles formControlName="tarifa_kilo" />
            <span matTextPrefix>$&nbsp;</span>
            <span matTextSuffix>/kg</span>
            <mat-hint>Se sugiere la tarifa del vehículo</mat-hint>
          </mat-form-field>
        }
        <mat-form-field>
          <mat-label>Valor total</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="valor_total" />
          <span matTextPrefix>$&nbsp;</span>
          @if (form.controls.valor_total.disabled) {
            <mat-hint>Calculado: kilos × tarifa</mat-hint>
          }
        </mat-form-field>

        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea matInput formControlName="observaciones" rows="2"></textarea>
        </mat-form-field>

        @if (!data.servicio && !esInterno()) {
          <mat-checkbox class="full" formControlName="pagado_de_contado">
            Pagado de contado
          </mat-checkbox>
          @if (avisoCredito()) {
            <p class="aviso full">
              Un cliente ocasional no puede quedar a crédito: marque "Pagado de
              contado" o regístrelo en el directorio de clientes.
            </p>
          }
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-servicio"
        [disabled]="!puedeGuardar() || guardando()"
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
    // Espacio extra entre filas: las pistas ocupan una línea más.
    .form-grid { row-gap: 22px; }

    .toggles {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
    }
    .etq {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.85rem;
    }
    .aviso {
      margin: 0;
      font-size: 0.84rem;
      line-height: 1.45;
      color: var(--mat-sys-error);
    }
  `,
})
export class ViajeServicioFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ViajesService);
  private readonly vehiculosService = inject(VehiculosService);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<ViajeServicioFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<ViajeServicioFormData>(MAT_DIALOG_DATA);
  readonly clientes = signal<Cliente[]>([]);
  readonly guardando = signal(false);

  readonly opcionesClientes = computed(() =>
    this.clientes().map((c) => ({ id: c.id, nombre: c.nombre })),
  );

  readonly form = this.fb.group({
    sentido: [
      (this.data.servicio?.sentido ?? 'ida') as 'ida' | 'regreso',
      Validators.required,
    ],
    es_interno: [this.data.servicio?.es_interno ?? false],
    modo_cliente: [
      (this.data.servicio && !this.data.servicio.cliente_id
        ? 'ocasional'
        : 'directorio') as 'directorio' | 'ocasional',
    ],
    cliente_id: [(this.data.servicio?.cliente_id ?? null) as string | null],
    cliente_nombre: [this.data.servicio?.cliente_nombre ?? ''],
    descripcion: [
      this.data.servicio?.descripcion ?? '',
      [Validators.required, Validators.minLength(2)],
    ],
    tipo_cobro: [
      (this.data.servicio?.tipo_cobro ?? 'por_kilo') as 'por_kilo' | 'precio_fijo',
      Validators.required,
    ],
    kilos: [
      (this.data.servicio?.kilos !== null && this.data.servicio?.kilos !== undefined
        ? Number(this.data.servicio.kilos)
        : null) as number | null,
      [Validators.min(0)],
    ],
    tarifa_kilo: [Number(this.data.servicio?.tarifa_kilo ?? 0), [Validators.min(0)]],
    valor_total: [Number(this.data.servicio?.valor_total ?? 0), [Validators.min(0)]],
    observaciones: [this.data.servicio?.observaciones ?? ''],
    pagado_de_contado: [false],
  });

  /** Re-emite en cada cambio del formulario para recalcular en vivo. */
  private readonly cambios = toSignal(this.form.valueChanges);

  readonly esInterno = computed(() => {
    this.cambios();
    return this.form.getRawValue().es_interno;
  });
  readonly modoCliente = computed(() => {
    this.cambios();
    return this.form.getRawValue().modo_cliente;
  });
  readonly porKilo = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    return valores.es_interno || valores.tipo_cobro === 'por_kilo';
  });
  /** Crédito sin directorio: bloquea el guardado con el aviso, no con un 422. */
  readonly avisoCredito = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    return (
      !this.data.servicio &&
      !valores.es_interno &&
      valores.modo_cliente === 'ocasional' &&
      !valores.pagado_de_contado
    );
  });

  readonly puedeGuardar = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    if (!valores.descripcion || valores.descripcion.trim().length < 2) return false;
    const porKilo = valores.es_interno || valores.tipo_cobro === 'por_kilo';
    if (porKilo) {
      if (!(Number(valores.kilos) > 0) || !(Number(valores.tarifa_kilo) > 0)) return false;
    } else if (!(Number(valores.valor_total) > 0)) {
      return false;
    }
    if (!valores.es_interno) {
      if (valores.modo_cliente === 'directorio') {
        if (!valores.cliente_id) return false;
      } else {
        if (!valores.cliente_nombre || valores.cliente_nombre.trim().length < 2) return false;
        if (this.avisoCredito()) return false;
      }
    }
    return true;
  });

  constructor() {
    firstValueFrom(
      this.api.get<Page<Cliente>>('/clientes', { page_size: 100, estado: 'activo' }),
    ).then((pagina) => {
      this.clientes.set(pagina.items);
      const actual = this.form.controls.cliente_id.value;
      if (actual) {
        // Repinta el select buscable, que al construirse aún no tenía opciones.
        this.form.controls.cliente_id.setValue(actual, { emitEvent: false });
      }
    });

    // Tarifa sugerida = la base del vehículo del viaje (editable por servicio).
    firstValueFrom(this.vehiculosService.getById(this.data.viaje.vehiculo_id))
      .then((vehiculo) => {
        if (!this.data.servicio && !(Number(this.form.controls.tarifa_kilo.value) > 0)) {
          this.form.controls.tarifa_kilo.setValue(Number(vehiculo.tarifa_kilo), {
            emitEvent: false,
          });
          this.recalcularValor();
        }
      })
      .catch(() => undefined);

    // Interno: sin cliente, sin contado y siempre por kilo (así lo valora el negocio).
    this.form.controls.es_interno.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((interno) => {
        if (interno) {
          this.form.patchValue({ tipo_cobro: 'por_kilo', pagado_de_contado: false }, { emitEvent: false });
          if (!this.form.controls.descripcion.value.trim()) {
            this.form.controls.descripcion.setValue('Queso propio', { emitEvent: false });
          }
        }
        this.recalcularValor();
      });

    // Por kilo el valor se calcula y se bloquea; a precio fijo se digita.
    merge(
      this.form.controls.kilos.valueChanges,
      this.form.controls.tarifa_kilo.valueChanges,
      this.form.controls.tipo_cobro.valueChanges,
    )
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.recalcularValor());

    // No se puede volver interno (ni dejar de serlo) un servicio con abonos.
    if ((this.data.servicio?.abonos.length ?? 0) > 0) {
      this.form.controls.es_interno.disable();
    }

    this.recalcularValor();
    protegerCambios(this.dialogRef, () => this.form);
  }

  private recalcularValor(): void {
    const valores = this.form.getRawValue();
    const porKilo = valores.es_interno || valores.tipo_cobro === 'por_kilo';
    const control = this.form.controls.valor_total;
    if (porKilo) {
      const kilos = Number(valores.kilos || 0);
      const tarifa = Number(valores.tarifa_kilo || 0);
      control.setValue(Math.round(kilos * tarifa * 100) / 100, { emitEvent: false });
      if (control.enabled) control.disable({ emitEvent: false });
    } else if (control.disabled) {
      control.enable({ emitEvent: false });
    }
  }

  async guardar(): Promise<void> {
    if (!this.puedeGuardar()) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const interno = valores.es_interno;
      const porKilo = interno || valores.tipo_cobro === 'por_kilo';
      const payload: ViajeServicioPayload = {
        sentido: valores.sentido,
        tipo_cobro: porKilo ? 'por_kilo' : 'precio_fijo',
        es_interno: interno,
        cliente_id: !interno && valores.modo_cliente === 'directorio' ? valores.cliente_id : null,
        cliente_nombre:
          !interno && valores.modo_cliente === 'ocasional'
            ? valores.cliente_nombre.trim()
            : null,
        descripcion: valores.descripcion.trim(),
        kilos: Number(valores.kilos) > 0 ? Number(valores.kilos) : null,
        tarifa_kilo: porKilo ? Number(valores.tarifa_kilo) : null,
        // Por kilo el backend calcula el valor (kilos × tarifa); no se envía.
        valor_total: porKilo ? null : Number(valores.valor_total),
        observaciones: valores.observaciones || null,
      };
      if (this.data.servicio) {
        await firstValueFrom(
          this.servicio.actualizarServicio(this.data.viaje.id, this.data.servicio.id, payload),
        );
      } else {
        await firstValueFrom(
          this.servicio.agregarServicio(this.data.viaje.id, {
            ...payload,
            pagado_de_contado: interno ? false : valores.pagado_de_contado,
          }),
        );
      }
      this.dialogRef.close(true);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar el servicio');
    } finally {
      this.guardando.set(false);
    }
  }
}
