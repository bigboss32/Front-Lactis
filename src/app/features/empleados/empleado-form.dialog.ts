import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Empleado } from '../../core/models';
import { dateToIso, isoToDate } from '../../shared/date-utils';
import { EmpleadosService } from './empleados.service';

@Component({
  selector: 'app-empleado-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatDatepickerModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar empleado' : 'Nuevo empleado' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-empleado" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Apellido</mat-label>
          <input matInput formControlName="apellido" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Documento</mat-label>
          <input matInput formControlName="documento" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Cargo</mat-label>
          <input matInput formControlName="cargo" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Teléfono</mat-label>
          <input matInput formControlName="telefono" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Fecha de ingreso</mat-label>
          <input matInput [matDatepicker]="pIngreso" (click)="pIngreso.open()" formControlName="fecha_ingreso" />
          <mat-datepicker-toggle matSuffix [for]="pIngreso" />
          <mat-datepicker #pIngreso />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Salario</mat-label>
          <input matInput type="number" min="0" formControlName="salario" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Valor por día (jornal)</mat-label>
          <input matInput type="number" min="0" formControlName="valor_dia" />
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Dirección</mat-label>
          <input matInput formControlName="direccion" />
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-empleado"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
})
export class EmpleadoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(EmpleadosService);
  private readonly dialogRef = inject(MatDialogRef<EmpleadoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: Empleado } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    nombre: [this.data?.item?.nombre ?? '', [Validators.required, Validators.minLength(2)]],
    apellido: [this.data?.item?.apellido ?? '', [Validators.required, Validators.minLength(2)]],
    documento: [this.data?.item?.documento ?? ''],
    cargo: [this.data?.item?.cargo ?? ''],
    telefono: [this.data?.item?.telefono ?? ''],
    direccion: [this.data?.item?.direccion ?? ''],
    fecha_ingreso: [this.data?.item ? isoToDate(this.data.item.fecha_ingreso) : null],
    salario: [
      this.data?.item?.salario != null ? Number(this.data.item.salario) : null,
      [Validators.min(0)],
    ],
    valor_dia: [
      this.data?.item?.valor_dia != null ? Number(this.data.item.valor_dia) : null,
      [Validators.min(0)],
    ],
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const payload = {
        ...valores,
        fecha_ingreso: dateToIso(valores.fecha_ingreso),
      };
      if (this.data?.item) {
        await firstValueFrom(this.servicio.update(this.data.item.id, payload));
      } else {
        await firstValueFrom(this.servicio.create(payload));
      }
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible guardar')
          : 'No fue posible guardar';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
