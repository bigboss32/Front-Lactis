import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { dateToIso, isoToDate, hoyDate } from '../../shared/date-utils';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { MoneyPipe } from '../../shared/pipes';
import { protegerCambios } from '../../shared/proteger-cambios';
import { CompraQueso, ReventaService } from './reventa.service';

/**
 * Registra o edita una compra de queso a un productor. Al comprar se paga por
 * todo lo recibido (no hay merma: la merma real se ve al vender). Muestra en
 * vivo el total a pagar mientras se escribe.
 */
@Component({
  selector: 'app-compra-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatButtonModule, MoneyPipe, MilesInputDirective,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar compra' : 'Nueva compra de queso' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-compra" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Productor</mat-label>
          <input matInput formControlName="productor" required maxlength="150" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Kilos</mat-label>
          <input matInput type="number" min="0" step="0.1" formControlName="kilos_brutos" required />
          <span matTextSuffix>kg</span>
          <mat-hint>Lo que compras y pagas al productor</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Precio por kilo</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="precio_kilo" required />
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea matInput formControlName="observaciones" rows="2"></textarea>
        </mat-form-field>
      </form>

      <div class="calculo">
        <span>Total a pagar: <strong>{{ totalPagar() | money }}</strong></span>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-compra"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    // Espacio extra entre filas: las pistas de kilos/borona ocupan una línea más.
    .form-grid { row-gap: 22px; }

    .calculo {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 32px;
      margin-top: 16px;
      padding: 10px 14px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface-variant);

      strong { color: var(--mat-sys-on-surface); font-variant-numeric: tabular-nums; }
    }
  `,
})
export class CompraFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<CompraFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: CompraQueso } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    fecha: [this.data?.item ? (isoToDate(this.data.item.fecha) ?? hoyDate()) : hoyDate(), Validators.required],
    productor: [this.data?.item?.productor ?? '', [Validators.required, Validators.minLength(2)]],
    kilos_brutos: [Number(this.data?.item?.kilos_brutos ?? 0), [Validators.required, Validators.min(0.01)]],
    precio_kilo: [Number(this.data?.item?.precio_kilo ?? 0), [Validators.required, Validators.min(0.01)]],
    observaciones: [this.data?.item?.observaciones ?? ''],
  });

  /** Re-emite en cada cambio del formulario para recalcular en vivo. */
  private readonly cambios = toSignal(this.form.valueChanges);

  readonly totalPagar = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    return Number(valores.kilos_brutos || 0) * Number(valores.precio_kilo || 0);
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
        fecha: dateToIso(valores.fecha),
        productor: valores.productor.trim(),
        kilos_brutos: Number(valores.kilos_brutos),
        precio_kilo: Number(valores.precio_kilo),
        observaciones: valores.observaciones || null,
      };
      await firstValueFrom(
        this.data?.item
          ? this.servicio.editarCompra(this.data.item.id, payload)
          : this.servicio.crearCompra(payload),
      );
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible guardar la compra')
          : 'No fue posible guardar la compra';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
