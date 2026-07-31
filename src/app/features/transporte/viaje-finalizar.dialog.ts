import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { ViajeDetalle } from '../../core/models';
import { dateToIso, hoyDate, isoToDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { ViajesService } from './viajes.service';

/**
 * Finaliza el viaje capturando la fecha de regreso y el odómetro de llegada.
 * Con el odómetro el backend actualiza el del vehículo y el resumen puede
 * calcular los kilómetros; ambos campos son opcionales. Cierra devolviendo el
 * detalle actualizado del viaje.
 */
@Component({
  selector: 'app-viaje-finalizar',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatButtonModule, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>Finalizar viaje Nº {{ data.viaje.numero }}</h2>
    <mat-dialog-content>
      <p class="ayuda">
        Al finalizar se bloquean los servicios y los gastos (se puede reabrir
        para corregir); los abonos de cartera siguen permitidos.
      </p>
      <form [formGroup]="form" class="form-grid" id="form-finalizar" (ngSubmit)="finalizar()">
        <mat-form-field>
          <mat-label>Fecha de regreso</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha_regreso" />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Odómetro de regreso</mat-label>
          <input matInput type="number" min="0" step="1" formControlName="odometro_regreso" cdkFocusInitial />
          <span matTextSuffix>km</span>
          @if (data.viaje.odometro_salida !== null) {
            <mat-hint>Salió con {{ data.viaje.odometro_salida }} km</mat-hint>
          }
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-finalizar"
        [disabled]="form.invalid || guardando()"
      >
        @if (guardando()) {
          <app-spinner-boton /> Finalizando…
        } @else {
          Finalizar viaje
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .ayuda {
      margin: 0 0 10px;
      font-size: 0.84rem;
      line-height: 1.45;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class ViajeFinalizarDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ViajesService);
  private readonly dialogRef = inject(MatDialogRef<ViajeFinalizarDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ viaje: ViajeDetalle }>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    fecha_regreso: [
      isoToDate(this.data.viaje.fecha_regreso) ?? hoyDate(),
    ],
    odometro_regreso: [
      (this.data.viaje.odometro_regreso !== null
        ? Number(this.data.viaje.odometro_regreso)
        : null) as number | null,
      [Validators.min(0)],
    ],
  });

  constructor() {
    protegerCambios(this.dialogRef, () => this.form);
  }

  async finalizar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const actualizado = await firstValueFrom(
        this.servicio.finalizar(this.data.viaje.id, {
          fecha_regreso: dateToIso(valores.fecha_regreso),
          odometro_regreso:
            valores.odometro_regreso === null ? null : Number(valores.odometro_regreso),
        }),
      );
      this.dialogRef.close(actualizado);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible finalizar el viaje');
    } finally {
      this.guardando.set(false);
    }
  }
}
