import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { Vehiculo, Viaje } from '../../core/models';
import { dateToIso, hoyDate, isoToDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SelectBuscable } from '../../shared/select-buscable';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { VehiculosService } from './vehiculos.service';
import { ViajesService } from './viajes.service';

export interface ViajeFormData {
  /** Viaje a editar; si falta, se crea uno nuevo. */
  item?: Viaje;
  /** Vehículo preseleccionado (arranque rápido desde la ficha del vehículo). */
  vehiculoId?: string;
}

/**
 * Crea o edita un viaje. Al crear, cierra devolviendo el viaje guardado para
 * que quien lo abrió navegue directo al detalle a cargar los fletes.
 */
@Component({
  selector: 'app-viaje-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatDatepickerModule, MilesInputDirective, SelectBuscable,
    SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar viaje' : 'Nuevo viaje' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-viaje" (ngSubmit)="guardar()">
        <app-select-buscable formControlName="vehiculo_id" [opciones]="opcionesVehiculos()" label="Vehículo" />
        <mat-form-field>
          <mat-label>Fecha de salida</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha_salida" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Origen</mat-label>
          <!-- cdkFocusInitial: el foco arranca aquí, no en el vehículo (que suele venir preseleccionado). -->
          <input matInput formControlName="origen" required maxlength="120" cdkFocusInitial />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Destino</mat-label>
          <input matInput formControlName="destino" required maxlength="120" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Conductor</mat-label>
          <input matInput formControlName="conductor_nombre" maxlength="150" />
          <mat-hint>Opcional</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Pago del conductor</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="pago_conductor" />
          <span matTextPrefix>$&nbsp;</span>
          <mat-hint>Por el viaje; cuenta como gasto</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Odómetro de salida</mat-label>
          <input matInput type="number" min="0" step="1" formControlName="odometro_salida" />
          <span matTextSuffix>km</span>
          <mat-hint>Se sugiere el actual del vehículo</mat-hint>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea matInput formControlName="observaciones" rows="2"></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-viaje"
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
    // Espacio extra entre filas: las pistas del pago y el odómetro ocupan una línea más.
    .form-grid { row-gap: 22px; }
  `,
})
export class ViajeFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ViajesService);
  private readonly vehiculosService = inject(VehiculosService);
  private readonly dialogRef = inject(MatDialogRef<ViajeFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<ViajeFormData | null>(MAT_DIALOG_DATA, { optional: true });
  readonly vehiculos = signal<Vehiculo[]>([]);
  readonly guardando = signal(false);

  readonly opcionesVehiculos = computed(() =>
    this.vehiculos().map((v) => ({
      id: v.id,
      nombre: v.nombre ? `${v.placa} — ${v.nombre}` : v.placa,
    })),
  );

  readonly form = this.fb.group({
    vehiculo_id: [
      (this.data?.item?.vehiculo_id ?? this.data?.vehiculoId ?? null) as string | null,
      Validators.required,
    ],
    fecha_salida: [
      this.data?.item ? (isoToDate(this.data.item.fecha_salida) ?? hoyDate()) : hoyDate(),
      Validators.required,
    ],
    origen: [this.data?.item?.origen ?? '', [Validators.required, Validators.minLength(2)]],
    destino: [this.data?.item?.destino ?? '', [Validators.required, Validators.minLength(2)]],
    conductor_nombre: [this.data?.item?.conductor_nombre ?? ''],
    pago_conductor: [Number(this.data?.item?.pago_conductor ?? 0), [Validators.min(0)]],
    odometro_salida: [
      (this.data?.item?.odometro_salida !== null && this.data?.item?.odometro_salida !== undefined
        ? Number(this.data.item.odometro_salida)
        : null) as number | null,
      [Validators.min(0)],
    ],
    observaciones: [this.data?.item?.observaciones ?? ''],
  });

  constructor() {
    // Al cambiar de vehículo (creando) se sugiere su odómetro actual, salvo que
    // el usuario ya haya digitado uno a mano.
    this.form.controls.vehiculo_id.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((id) => this.sugerirOdometro(id));

    firstValueFrom(this.vehiculosService.list({ page_size: 100, estado: 'activo' })).then(
      (pagina) => {
        this.vehiculos.set(pagina.items);
        const actual = this.form.controls.vehiculo_id.value;
        if (actual) {
          // Repinta el select buscable, que al construirse aún no tenía opciones.
          this.form.controls.vehiculo_id.setValue(actual, { emitEvent: false });
          if (!this.data?.item) this.sugerirOdometro(actual);
        } else if (!this.data?.item && pagina.items.length === 1) {
          // Con un solo vehículo (el caso real: la turbo) se preselecciona.
          this.form.controls.vehiculo_id.setValue(pagina.items[0].id);
        }
      },
    );

    protegerCambios(this.dialogRef, () => this.form);
  }

  private sugerirOdometro(vehiculoId: string | null): void {
    if (this.data?.item) return; // editando no se pisa lo registrado
    const control = this.form.controls.odometro_salida;
    if (control.dirty) return;
    const vehiculo = this.vehiculos().find((v) => v.id === vehiculoId);
    if (vehiculo) {
      control.setValue(Number(vehiculo.odometro_actual), { emitEvent: false });
    }
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const payload = {
        vehiculo_id: valores.vehiculo_id!,
        fecha_salida: dateToIso(valores.fecha_salida)!,
        origen: valores.origen.trim(),
        destino: valores.destino.trim(),
        conductor_nombre: valores.conductor_nombre.trim() || null,
        pago_conductor: Number(valores.pago_conductor || 0),
        odometro_salida: valores.odometro_salida === null ? null : Number(valores.odometro_salida),
        observaciones: valores.observaciones || null,
      };
      const guardado = this.data?.item
        ? await firstValueFrom(this.servicio.update(this.data.item.id, payload))
        : await firstValueFrom(this.servicio.create(payload));
      // Devuelve el viaje guardado: el listado navega al detalle con su id.
      this.dialogRef.close(guardado);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar el viaje');
    } finally {
      this.guardando.set(false);
    }
  }
}
