import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { Empresa } from '../../core/models';
import { dateToIso, isoToDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { EmpresasService } from './empresas.service';

/**
 * Suscripción de una empresa: tarifa propia, exención y "pagada hasta"
 * (regalar días de vigencia sin pasar por la pasarela). SOLO la ve el
 * superadmin (el botón de la lista va dentro de su @if) y el backend lo
 * revalida en el service, mismo patrón que reiniciar.
 *
 * Los campos vacíos APLICAN al guardar (el backend recibe null explícito):
 * tarifa vacía = volver a la tarifa global; fecha vacía = volver a la prueba.
 */
@Component({
  selector: 'app-suscripcion-empresa',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatCheckboxModule, MatDatepickerModule,
    MilesInputDirective, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>Suscripción de {{ data.empresa.nombre }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-suscripcion-empresa" (ngSubmit)="guardar()">
        <mat-form-field class="full">
          <mat-label>Tarifa mensual</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="tarifa_mensual" />
          <span matTextPrefix>$&nbsp;</span>
          <mat-hint>Vacía = usa la tarifa global del sistema</mat-hint>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Pagada hasta</mat-label>
          <input matInput [matDatepicker]="pPagada" (click)="pPagada.open()" formControlName="pagada_hasta" />
          <mat-datepicker-toggle matSuffix [for]="pPagada" />
          <mat-datepicker #pPagada />
          <mat-hint>Regalar días: fecha futura. Vacía = período de prueba desde su creación</mat-hint>
        </mat-form-field>
        <mat-checkbox class="full" formControlName="exenta">
          Empresa exenta de pago (no se le cobra ni se bloquea)
        </mat-checkbox>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-suscripcion-empresa"
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
export class SuscripcionEmpresaDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(EmpresasService);
  private readonly dialogRef = inject(MatDialogRef<SuscripcionEmpresaDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ empresa: Empresa }>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    // null = tarifa global (appMiles emite null cuando el campo queda vacío).
    tarifa_mensual: [
      (this.data.empresa.tarifa_mensual != null
        ? Number(this.data.empresa.tarifa_mensual)
        : null) as number | null,
      Validators.min(0),
    ],
    exenta: [this.data.empresa.exenta ?? false],
    // null = período de prueba de 30 días desde la creación de la empresa.
    pagada_hasta: [isoToDate(this.data.empresa.pagada_hasta) as Date | null],
  });

  constructor() {
    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const actualizada = await firstValueFrom(
        this.servicio.actualizarSuscripcion(this.data.empresa.id, {
          tarifa_mensual: valores.tarifa_mensual,
          exenta: valores.exenta,
          pagada_hasta: dateToIso(valores.pagada_hasta),
        }),
      );
      this.dialogRef.close(actualizada);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible actualizar la suscripción');
    } finally {
      this.guardando.set(false);
    }
  }
}
