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

import { ApiService } from '../../core/api.service';
import { Page, Produccion, TipoQueso } from '../../core/models';
import { dateToIso, hoyDate, isoToDate } from '../../shared/date-utils';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SelectBuscable } from '../../shared/select-buscable';
import { ProduccionService } from './produccion.service';

@Component({
  selector: 'app-produccion-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatDatepickerModule, SelectBuscable,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar producción' : 'Nueva producción' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-produccion" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <app-select-buscable
          formControlName="tipo_queso_id"
          [opciones]="tiposQueso()"
          label="Tipo de queso"
        />
        <mat-form-field>
          <mat-label>Cantidad (unidades)</mat-label>
          <input matInput type="number" min="0" formControlName="cantidad" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Peso</mat-label>
          <input matInput type="number" min="0" formControlName="peso_kg" required />
          <span matTextSuffix>&nbsp;kg</span>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Litros usados</mat-label>
          <input matInput type="number" min="0" formControlName="litros_usados" required />
          <span matTextSuffix>&nbsp;L</span>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea matInput formControlName="observaciones" rows="2"></textarea>
        </mat-form-field>
      </form>
      <p class="hint">El promedio de litros por kilo (L/kg) lo calcula el sistema automáticamente.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-produccion"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .hint {
      margin: 4px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8rem;
    }
  `,
})
export class ProduccionFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ProduccionService);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<ProduccionFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: Produccion } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly tiposQueso = signal<TipoQueso[]>([]);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    fecha: [
      this.data?.item ? (isoToDate(this.data.item.fecha) ?? hoyDate()) : hoyDate(),
      Validators.required,
    ],
    tipo_queso_id: [this.data?.item?.tipo_queso_id ?? '', Validators.required],
    cantidad: [Number(this.data?.item?.cantidad ?? 0), [Validators.required, Validators.min(0)]],
    peso_kg: [
      Number(this.data?.item?.peso_kg ?? 0),
      [Validators.required, Validators.min(0.001)],
    ],
    litros_usados: [
      Number(this.data?.item?.litros_usados ?? 0),
      [Validators.required, Validators.min(0)],
    ],
    observaciones: [this.data?.item?.observaciones ?? ''],
  });

  constructor() {
    firstValueFrom(
      this.api.get<Page<TipoQueso>>('/tipos-queso', { page_size: 100, estado: 'activo' }),
    ).then((page) => this.tiposQueso.set(page.items));

    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const payload = { ...valores, fecha: dateToIso(valores.fecha)! };
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
