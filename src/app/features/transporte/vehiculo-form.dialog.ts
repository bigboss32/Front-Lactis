import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { Vehiculo } from '../../core/models';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { VehiculosService } from './vehiculos.service';

@Component({
  selector: 'app-vehiculo-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MilesInputDirective, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar vehículo' : 'Nuevo vehículo' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-vehiculo" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Placa</mat-label>
          <input matInput formControlName="placa" required maxlength="10" cdkFocusInitial />
          <mat-hint>Única por empresa</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" maxlength="100" />
          <mat-hint>Alias con que lo conocen ("la turbo")</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Marca</mat-label>
          <input matInput formControlName="marca" maxlength="60" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Línea</mat-label>
          <input matInput formControlName="linea" maxlength="60" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Año</mat-label>
          <input matInput type="number" min="1950" max="2100" step="1" formControlName="anio" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Capacidad</mat-label>
          <input matInput type="number" min="0" step="10" formControlName="capacidad_kg" />
          <span matTextSuffix>kg</span>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Tarifa por kilo</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="tarifa_kilo" />
          <span matTextPrefix>$&nbsp;</span>
          <span matTextSuffix>/kg</span>
          <mat-hint>Base de los fletes; editable por servicio</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Odómetro actual</mat-label>
          <input matInput type="number" min="0" step="1" formControlName="odometro_actual" />
          <span matTextSuffix>km</span>
          <mat-hint>Se actualiza solo al finalizar viajes</mat-hint>
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
        form="form-vehiculo"
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
    // Espacio extra entre filas: las pistas ocupan una línea más.
    .form-grid { row-gap: 22px; }
  `,
})
export class VehiculoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(VehiculosService);
  private readonly dialogRef = inject(MatDialogRef<VehiculoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: Vehiculo } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    placa: [this.data?.item?.placa ?? '', [Validators.required, Validators.minLength(3)]],
    nombre: [this.data?.item?.nombre ?? ''],
    marca: [this.data?.item?.marca ?? ''],
    linea: [this.data?.item?.linea ?? ''],
    anio: [(this.data?.item?.anio ?? null) as number | null, [Validators.min(1950)]],
    capacidad_kg: [
      (this.data?.item?.capacidad_kg !== null && this.data?.item?.capacidad_kg !== undefined
        ? Number(this.data.item.capacidad_kg)
        : null) as number | null,
      [Validators.min(0)],
    ],
    tarifa_kilo: [Number(this.data?.item?.tarifa_kilo ?? 0), [Validators.min(0)]],
    odometro_actual: [Number(this.data?.item?.odometro_actual ?? 0), [Validators.min(0)]],
    observaciones: [this.data?.item?.observaciones ?? ''],
  });

  constructor() {
    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const payload = {
        // El backend normaliza (mayúsculas, sin espacios) y valida el único por empresa.
        placa: valores.placa.trim(),
        nombre: valores.nombre.trim() || null,
        marca: valores.marca.trim() || null,
        linea: valores.linea.trim() || null,
        anio: valores.anio === null ? null : Number(valores.anio),
        capacidad_kg: valores.capacidad_kg === null ? null : Number(valores.capacidad_kg),
        tarifa_kilo: Number(valores.tarifa_kilo || 0),
        odometro_actual: Number(valores.odometro_actual || 0),
        observaciones: valores.observaciones || null,
      };
      if (this.data?.item) {
        await firstValueFrom(this.servicio.update(this.data.item.id, payload));
      } else {
        await firstValueFrom(this.servicio.create(payload));
      }
      this.dialogRef.close(true);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar el vehículo');
    } finally {
      this.guardando.set(false);
    }
  }
}
