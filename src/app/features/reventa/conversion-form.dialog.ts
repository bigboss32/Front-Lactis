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

import { Monto } from '../../core/models';
import { dateToIso, hoyDate } from '../../shared/date-utils';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { protegerCambios } from '../../shared/proteger-cambios';
import { DestinoConversion, ReventaService } from './reventa.service';

export interface ConversionDialogData {
  /** Kilos de queso disponibles (kilos_disponibles). */
  disponible: Monto;
  /** A dónde va el queso: borona (vendible) o merma (pérdida). Por defecto borona. */
  destino?: DestinoConversion;
}

/**
 * Reduce el queso disponible de reventa. Según el destino:
 * - borona: queso devuelto o ya no vendible como entero; suma a la borona y
 *   lleva un precio por kilo (su valor).
 * - merma: pérdida de peso (se pesó menos al vender); no suma ni tiene precio.
 * Para la merma el diálogo llega con los kilos disponibles precargados, para
 * cerrar la semana de un solo paso. El backend valida contra el disponible real.
 */
@Component({
  selector: 'app-conversion-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatButtonModule, MilesInputDirective, CantidadPipe, MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>{{ esMerma ? 'Registrar merma' : 'Pasar queso a borona' }}</h2>
    <mat-dialog-content>
      @if (esMerma) {
        <p class="ayuda">
          Descuenta del queso disponible los kilos que se perdieron (merma). No se
          venden ni suman a la borona; solo dejan el inventario al día.
        </p>
      }
      <form [formGroup]="form" class="form-grid" id="form-conversion" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Kilos</mat-label>
          <input matInput type="number" min="0" step="0.1" formControlName="kilos" required />
          <span matTextSuffix>kg</span>
          <mat-hint>Disponible: {{ data.disponible | cantidad: 'kg' }}</mat-hint>
        </mat-form-field>
        @if (!esMerma) {
          <mat-form-field>
            <mat-label>Precio por kilo</mat-label>
            <input matInput type="text" inputmode="numeric" appMiles formControlName="precio_kilo" />
            <span matTextPrefix>$&nbsp;</span>
            <mat-hint>Valor de la borona: {{ valor() | money }}</mat-hint>
          </mat-form-field>
        }
        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea
            matInput
            formControlName="observaciones"
            rows="2"
            [placeholder]="esMerma ? 'Ej. Merma de la semana' : 'Ej. Queso devuelto del viaje'"
          ></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-conversion"
        [disabled]="form.invalid || guardando()"
      >
        {{ esMerma ? 'Registrar merma' : 'Pasar a borona' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    // Espacio extra: las pistas de disponible/valor ocupan una línea adicional.
    .form-grid { row-gap: 22px; }
    .ayuda {
      margin: 0 0 12px;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class ConversionFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<ConversionFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<ConversionDialogData>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);
  readonly destino: DestinoConversion = this.data.destino ?? 'borona';
  readonly esMerma = this.destino === 'merma';

  readonly form = this.fb.group({
    fecha: [hoyDate(), Validators.required],
    // La merma llega con los kilos disponibles precargados (cerrar semana de un paso).
    kilos: [
      this.esMerma ? Number(this.data.disponible) : 0,
      [Validators.required, Validators.min(0.01)],
    ],
    precio_kilo: [0, [Validators.min(0)]],
    observaciones: [''],
  });

  private readonly cambios = toSignal(this.form.valueChanges);

  /** Valor de la borona en vivo: kilos × precio por kilo. */
  readonly valor = computed(() => {
    this.cambios();
    const v = this.form.getRawValue();
    return Number(v.kilos || 0) * Number(v.precio_kilo || 0);
  });

  constructor() {
    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      await firstValueFrom(
        this.servicio.crearConversion({
          fecha: dateToIso(valores.fecha),
          kilos: Number(valores.kilos),
          destino: this.destino,
          precio_kilo: this.esMerma ? 0 : Number(valores.precio_kilo || 0),
          observaciones: valores.observaciones || null,
        }),
      );
      this.dialogRef.close(true);
    } catch (err) {
      const generico = this.esMerma
        ? 'No fue posible registrar la merma'
        : 'No fue posible pasar el queso a borona';
      const detalle =
        err instanceof HttpErrorResponse ? (err.error?.error?.detail ?? generico) : generico;
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
