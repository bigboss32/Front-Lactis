import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { CuentaBancaria } from '../../core/models';
import { CuentaPayload, CuentasBancariasService } from './bancos.service';

@Component({
  selector: 'app-cuenta-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar cuenta bancaria' : 'Nueva cuenta bancaria' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-cuenta" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Banco</mat-label>
          <input matInput formControlName="banco" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Número de cuenta</mat-label>
          <input matInput formControlName="numero_cuenta" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Tipo</mat-label>
          <mat-select formControlName="tipo" required>
            <mat-option value="ahorros">Ahorros</mat-option>
            <mat-option value="corriente">Corriente</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Titular</mat-label>
          <input matInput formControlName="titular" />
        </mat-form-field>
        @if (!data?.item) {
          <mat-form-field>
            <mat-label>Saldo inicial</mat-label>
            <input matInput type="number" formControlName="saldo_inicial" />
            <span matTextPrefix>$&nbsp;</span>
          </mat-form-field>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-cuenta"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
})
export class CuentaFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(CuentasBancariasService);
  private readonly dialogRef = inject(MatDialogRef<CuentaFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: CuentaBancaria } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    banco: [this.data?.item?.banco ?? '', [Validators.required, Validators.minLength(2)]],
    numero_cuenta: [
      this.data?.item?.numero_cuenta ?? '',
      [Validators.required, Validators.minLength(3)],
    ],
    tipo: [(this.data?.item?.tipo ?? 'ahorros') as 'ahorros' | 'corriente', Validators.required],
    titular: [this.data?.item?.titular ?? ''],
    saldo_inicial: [Number(this.data?.item?.saldo_inicial ?? 0)],
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const payload: CuentaPayload = {
        banco: valores.banco,
        numero_cuenta: valores.numero_cuenta,
        tipo: valores.tipo,
        titular: valores.titular || null,
      };
      if (this.data?.item) {
        // El saldo inicial no es editable una vez creada la cuenta.
        await firstValueFrom(this.servicio.update(this.data.item.id, payload));
      } else {
        await firstValueFrom(
          this.servicio.create({ ...payload, saldo_inicial: valores.saldo_inicial }),
        );
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
