import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { Venta } from '../../core/models';
import { dateToIso, hoyDate } from '../../shared/date-utils';
import { MoneyPipe } from '../../shared/pipes';
import { VentasService } from './ventas.service';

@Component({
  selector: 'app-pago-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatDatepickerModule, MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>Registrar pago — venta Nº {{ data.venta.numero }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-pago" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Valor</mat-label>
          <input matInput type="number" min="0" [max]="saldo" formControlName="valor" required />
          <span matTextPrefix>$&nbsp;</span>
          <mat-hint>Saldo pendiente: {{ saldo | money }}</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Método</mat-label>
          <mat-select formControlName="metodo" required>
            <mat-option value="efectivo">Efectivo</mat-option>
            <mat-option value="transferencia">Transferencia</mat-option>
            <mat-option value="otro">Otro</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Referencia</mat-label>
          <input matInput formControlName="referencia" placeholder="Nº de consignación, cheque…" />
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
        form="form-pago"
        [disabled]="form.invalid || guardando()"
      >
        Registrar pago
      </button>
    </mat-dialog-actions>
  `,
})
export class PagoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(VentasService);
  private readonly dialogRef = inject(MatDialogRef<PagoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ venta: Venta }>(MAT_DIALOG_DATA);
  readonly saldo = Number(this.data.venta.saldo);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    fecha: [hoyDate(), Validators.required],
    valor: [this.saldo, [Validators.required, Validators.min(0.01), Validators.max(this.saldo)]],
    metodo: ['efectivo' as 'efectivo' | 'transferencia' | 'otro', Validators.required],
    referencia: [''],
    observaciones: [''],
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valor = this.form.getRawValue();
      await firstValueFrom(
        this.servicio.registrarPago({
          venta_id: this.data.venta.id,
          fecha: dateToIso(valor.fecha)!,
          valor: Number(valor.valor),
          metodo: valor.metodo,
          referencia: valor.referencia || null,
          observaciones: valor.observaciones || null,
        }),
      );
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible registrar el pago')
          : 'No fue posible registrar el pago';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
