import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { MoneyPipe } from '../../shared/pipes';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { dateToIso, isoToDate, hoyDate } from '../../shared/date-utils';
import { protegerCambios } from '../../shared/proteger-cambios';
import { ReventaService, TipoVenta, VentaQueso } from './reventa.service';

/** Precio de venta de queso sugerido por kilo (del cuaderno del dueño). */
const PRECIO_VENTA_SUGERIDO = 19500;

/**
 * Registra o edita una venta de queso de reventa. Calcula el total en vivo,
 * permite anotar los gastos de vender (ej. transporte) y, al crear, marcarla
 * como pagada de contado.
 */
@Component({
  selector: 'app-venta-queso-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatCheckboxModule, MatDatepickerModule, MoneyPipe,
    MilesInputDirective,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar venta' : 'Nueva venta de queso' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-venta-queso" (ngSubmit)="guardar()">
        @if (data?.item) {
          <mat-form-field>
            <mat-label>¿Qué se vende?</mat-label>
            <input matInput [value]="tipoLabel(data!.item!.tipo)" readonly />
          </mat-form-field>
        } @else {
          <mat-form-field>
            <mat-label>¿Qué vende?</mat-label>
            <mat-select formControlName="tipo">
              <mat-option value="queso">Queso</mat-option>
              <mat-option value="borona">Borona</mat-option>
            </mat-select>
          </mat-form-field>
        }
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Cliente</mat-label>
          <input matInput formControlName="cliente" required maxlength="150" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Kilos</mat-label>
          <input matInput type="number" min="0" step="0.1" formControlName="kilos" required />
          <span matTextSuffix>kg</span>
          <mat-hint>El peso real al vender (aquí se ve la merma)</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Precio por kilo</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="precio_kilo" required />
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Concepto del gasto</mat-label>
          <input matInput formControlName="gasto_concepto" maxlength="150" placeholder="Ej. Transporte" />
          <mat-hint>Opcional</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Gasto por kilo</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="gasto_por_kilo" />
          <span matTextPrefix>$&nbsp;</span>
          <span matTextSuffix>/kg</span>
          <mat-hint>Ej. transporte; no lo paga el cliente</mat-hint>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea matInput formControlName="observaciones" rows="2"></textarea>
        </mat-form-field>
        @if (!data?.item) {
          <mat-checkbox class="full" formControlName="pagada_de_contado">
            Pagada de contado
          </mat-checkbox>
        }
      </form>

      <div class="calculo">
        <span>Total de la venta: <strong>{{ total() | money }}</strong></span>
        @if (gastoTotal() > 0) {
          <span>Gastos: <strong>{{ gastoTotal() | money }}</strong> ({{ gastoPorKilo() | money }}/kg)</span>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-venta-queso"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    // Espacio extra entre filas: las pistas de kilos/gasto ocupan una línea más.
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
export class VentaQuesoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<VentaQuesoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: VentaQueso } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    tipo: [this.data?.item?.tipo ?? ('queso' as TipoVenta), Validators.required],
    fecha: [this.data?.item ? (isoToDate(this.data.item.fecha) ?? hoyDate()) : hoyDate(), Validators.required],
    cliente: [this.data?.item?.cliente ?? '', [Validators.required, Validators.minLength(2)]],
    kilos: [Number(this.data?.item?.kilos ?? 0), [Validators.required, Validators.min(0.01)]],
    precio_kilo: [
      Number(this.data?.item?.precio_kilo ?? PRECIO_VENTA_SUGERIDO),
      [Validators.required, Validators.min(0.01)],
    ],
    gasto_concepto: [this.data?.item?.gasto_concepto ?? ''],
    gasto_por_kilo: [Number(this.data?.item?.gasto_por_kilo ?? 0), [Validators.min(0)]],
    observaciones: [this.data?.item?.observaciones ?? ''],
    pagada_de_contado: [false],
  });

  constructor() {
    // Al crear: el queso sugiere 19.500/kg; la borona no sugiere precio.
    if (!this.data?.item) {
      this.form.controls.tipo.valueChanges
        .pipe(takeUntilDestroyed())
        .subscribe((tipo) => {
          this.form.controls.precio_kilo.setValue(tipo === 'queso' ? PRECIO_VENTA_SUGERIDO : 0);
        });
    }
    protegerCambios(this.dialogRef, () => this.form);
  }

  tipoLabel(tipo: TipoVenta): string {
    return tipo === 'borona' ? 'Borona' : 'Queso';
  }

  /** Re-emite en cada cambio del formulario para recalcular el total en vivo. */
  private readonly cambios = toSignal(this.form.valueChanges);

  readonly total = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    return Number(valores.kilos || 0) * Number(valores.precio_kilo || 0);
  });

  readonly gastoPorKilo = computed(() => {
    this.cambios();
    return Number(this.form.getRawValue().gasto_por_kilo || 0);
  });

  readonly gastoTotal = computed(() => {
    this.cambios();
    const valores = this.form.getRawValue();
    return Number(valores.gasto_por_kilo || 0) * Number(valores.kilos || 0);
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const payload = {
        fecha: dateToIso(valores.fecha),
        cliente: valores.cliente.trim(),
        kilos: Number(valores.kilos),
        precio_kilo: Number(valores.precio_kilo),
        gasto_concepto: valores.gasto_concepto?.trim() || null,
        gasto_por_kilo: Number(valores.gasto_por_kilo || 0),
        observaciones: valores.observaciones || null,
      };
      await firstValueFrom(
        this.data?.item
          ? this.servicio.editarVenta(this.data.item.id, payload)
          : this.servicio.crearVenta({
              ...payload,
              tipo: valores.tipo,
              pagada_de_contado: valores.pagada_de_contado,
            }),
      );
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible guardar la venta')
          : 'No fue posible guardar la venta';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
