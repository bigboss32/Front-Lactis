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
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { CompraQueso, ReventaService } from './reventa.service';

/**
 * Registra o edita una compra de queso a un productor. Muestra en vivo los
 * kilos netos (brutos − merma) y el total a pagar mientras se escribe.
 */
@Component({
  selector: 'app-compra-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatButtonModule, MoneyPipe, CantidadPipe, MilesInputDirective,
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
          <mat-label>Kilos brutos</mat-label>
          <input matInput type="number" min="0" step="0.1" formControlName="kilos_brutos" required />
          <span matTextSuffix>kg</span>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Merma</mat-label>
          <input matInput type="number" min="0" step="0.1" formControlName="merma_kilos" />
          <span matTextSuffix>kg</span>
          <mat-hint>Kilos que se pierden; se pagan solo los netos</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Borona</mat-label>
          <input matInput type="number" min="0" step="0.1" formControlName="borona_kilos" />
          <span matTextSuffix>kg</span>
          <mat-hint>Pedacería, solo informativa</mat-hint>
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

      <div class="calculo" [class.invalido]="mermaInvalida()">
        @if (mermaInvalida()) {
          <span>La merma no puede ser mayor o igual a los kilos brutos</span>
        } @else {
          <span>Kilos netos a pagar: <strong>{{ kilosNetos() | cantidad: 'kg' }}</strong></span>
          <span>Total a pagar: <strong>{{ totalPagar() | money }}</strong></span>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-compra"
        [disabled]="form.invalid || mermaInvalida() || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    // Espacio extra entre filas: las pistas de merma/borona ocupan dos líneas.
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

      &.invalido { color: var(--mat-sys-error); font-weight: 500; }
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
    merma_kilos: [Number(this.data?.item?.merma_kilos ?? 0), [Validators.min(0)]],
    borona_kilos: [Number(this.data?.item?.borona_kilos ?? 0), [Validators.min(0)]],
    precio_kilo: [Number(this.data?.item?.precio_kilo ?? 0), [Validators.required, Validators.min(0.01)]],
    observaciones: [this.data?.item?.observaciones ?? ''],
  });

  /** Re-emite en cada cambio del formulario para recalcular en vivo. */
  private readonly cambios = toSignal(this.form.valueChanges);

  readonly kilosNetos = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    return Math.max(Number(valores.kilos_brutos || 0) - Number(valores.merma_kilos || 0), 0);
  });

  readonly totalPagar = computed(() => {
    this.cambios();
    return this.kilosNetos() * Number(this.form.getRawValue().precio_kilo || 0);
  });

  readonly mermaInvalida = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    const brutos = Number(valores.kilos_brutos || 0);
    return brutos > 0 && Number(valores.merma_kilos || 0) >= brutos;
  });

  async guardar(): Promise<void> {
    if (this.form.invalid || this.mermaInvalida()) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const payload = {
        fecha: dateToIso(valores.fecha),
        productor: valores.productor.trim(),
        kilos_brutos: Number(valores.kilos_brutos),
        merma_kilos: Number(valores.merma_kilos || 0),
        borona_kilos: Number(valores.borona_kilos || 0),
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
