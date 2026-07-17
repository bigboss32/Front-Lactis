import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { Monto } from '../../core/models';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { MoneyPipe } from '../../shared/pipes';
import { dateToIso, hoyDate } from '../../shared/date-utils';
import { ReventaService } from './reventa.service';

export interface AbonoDialogData {
  /** A qué registro se abona: compra a productor o venta a cliente. */
  tipo: 'compra' | 'venta';
  id: string;
  titulo: string;
  saldo: Monto;
}

/** Registra un abono (pago parcial) a una compra o a una venta de queso. */
@Component({
  selector: 'app-abono-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatButtonModule, MoneyPipe, MilesInputDirective,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.titulo }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-abono" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Valor</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="valor" required />
          <span matTextPrefix>$&nbsp;</span>
          <mat-hint>Saldo pendiente: {{ data.saldo | money }}</mat-hint>
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
        form="form-abono"
        [disabled]="form.invalid || guardando()"
      >
        Registrar abono
      </button>
    </mat-dialog-actions>
  `,
})
export class AbonoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<AbonoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<AbonoDialogData>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    fecha: [hoyDate(), Validators.required],
    valor: [
      Number(this.data.saldo),
      [Validators.required, Validators.min(0.01), Validators.max(Number(this.data.saldo))],
    ],
    observaciones: [''],
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const payload = {
        fecha: dateToIso(valores.fecha),
        valor: Number(valores.valor),
        observaciones: valores.observaciones || null,
      };
      if (this.data.tipo === 'compra') {
        await firstValueFrom(this.servicio.abonarCompra(this.data.id, payload));
      } else {
        await firstValueFrom(this.servicio.abonarVenta(this.data.id, payload));
      }
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible registrar el abono')
          : 'No fue posible registrar el abono';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
