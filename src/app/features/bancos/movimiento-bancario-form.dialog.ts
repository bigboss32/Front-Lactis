import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { CuentaBancaria } from '../../core/models';
import { CuentasBancariasService, MovimientosBancariosService } from './bancos.service';

function hoyISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

@Component({
  selector: 'app-movimiento-bancario-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>Registrar movimiento bancario</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-mov-bancario" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Cuenta</mat-label>
          <mat-select formControlName="cuenta_id" required>
            @for (cuenta of cuentas(); track cuenta.id) {
              <mat-option [value]="cuenta.id">
                {{ cuenta.banco }} — {{ cuenta.numero_cuenta }}
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput type="date" formControlName="fecha" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Tipo</mat-label>
          <mat-select formControlName="tipo" required>
            <mat-option value="ingreso">Ingreso</mat-option>
            <mat-option value="egreso">Egreso</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Valor</mat-label>
          <input matInput type="number" min="0" formControlName="valor" required />
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Concepto</mat-label>
          <input matInput formControlName="concepto" required />
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Referencia</mat-label>
          <input matInput formControlName="referencia" />
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-mov-bancario"
        [disabled]="form.invalid || guardando()"
      >
        Registrar
      </button>
    </mat-dialog-actions>
  `,
})
export class MovimientoBancarioFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly cuentasServicio = inject(CuentasBancariasService);
  private readonly servicio = inject(MovimientosBancariosService);
  private readonly dialogRef = inject(MatDialogRef<MovimientoBancarioFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly cuentas = signal<CuentaBancaria[]>([]);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    cuenta_id: ['', Validators.required],
    fecha: [hoyISO(), Validators.required],
    tipo: ['ingreso' as 'ingreso' | 'egreso', Validators.required],
    valor: [0, [Validators.required, Validators.min(0.01)]],
    concepto: ['', [Validators.required, Validators.minLength(2)]],
    referencia: [''],
  });

  constructor() {
    firstValueFrom(
      this.cuentasServicio.list({ page_size: 100, estado: 'activo' }),
    ).then((page) => this.cuentas.set(page.items));
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      await firstValueFrom(
        this.servicio.crear({
          cuenta_id: valores.cuenta_id,
          fecha: valores.fecha,
          tipo: valores.tipo,
          valor: valores.valor,
          concepto: valores.concepto,
          referencia: valores.referencia || null,
        }),
      );
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible registrar el movimiento')
          : 'No fue posible registrar el movimiento';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
