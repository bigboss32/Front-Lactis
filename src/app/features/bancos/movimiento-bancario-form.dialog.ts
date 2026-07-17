import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { CuentaBancaria } from '../../core/models';
import { dateToIso, hoyDate } from '../../shared/date-utils';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SelectBuscable } from '../../shared/select-buscable';
import { CuentasBancariasService, MovimientosBancariosService } from './bancos.service';

@Component({
  selector: 'app-movimiento-bancario-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatDatepickerModule, MilesInputDirective,
    SelectBuscable,
  ],
  template: `
    <h2 mat-dialog-title>Registrar movimiento bancario</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-mov-bancario" (ngSubmit)="guardar()">
        <app-select-buscable formControlName="cuenta_id" [opciones]="cuentasOpciones()" label="Cuenta" />
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
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
          <input matInput type="text" inputmode="numeric" appMiles formControlName="valor" required />
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
  readonly cuentasOpciones = computed(() =>
    this.cuentas().map((c) => ({ id: c.id, nombre: `${c.banco} — ${c.numero_cuenta}` })),
  );
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    cuenta_id: ['', Validators.required],
    fecha: [hoyDate(), Validators.required],
    tipo: ['ingreso' as 'ingreso' | 'egreso', Validators.required],
    valor: [0, [Validators.required, Validators.min(0.01)]],
    concepto: ['', [Validators.required, Validators.minLength(2)]],
    referencia: [''],
  });

  constructor() {
    firstValueFrom(
      this.cuentasServicio.list({ page_size: 100, estado: 'activo' }),
    ).then((page) => this.cuentas.set(page.items));
    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      await firstValueFrom(
        this.servicio.crear({
          cuenta_id: valores.cuenta_id,
          fecha: dateToIso(valores.fecha)!,
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
