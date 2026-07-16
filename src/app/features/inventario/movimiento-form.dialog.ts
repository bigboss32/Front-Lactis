import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Page, Producto } from '../../core/models';
import { dateToIso, hoyDate } from '../../shared/date-utils';
import { MovimientosInventarioService, TIPOS_MOVIMIENTO } from './inventario.service';

/** Diálogo para registrar un movimiento de inventario (los movimientos no se editan). */
@Component({
  selector: 'app-movimiento-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatDatepickerModule,
  ],
  template: `
    <h2 mat-dialog-title>Registrar movimiento</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-movimiento" (ngSubmit)="guardar()">
        <mat-form-field class="full">
          <mat-label>Producto</mat-label>
          <mat-select formControlName="producto_id" required>
            @for (producto of productos(); track producto.id) {
              <mat-option [value]="producto.id">{{ producto.nombre }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Tipo</mat-label>
          <mat-select formControlName="tipo" required>
            @for (tipo of tipos; track tipo.valor) {
              <mat-option [value]="tipo.valor">{{ tipo.etiqueta }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Cantidad</mat-label>
          <input matInput type="number" formControlName="cantidad" required />
          <mat-hint>En ajustes la cantidad puede ser negativa</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Costo unitario</mat-label>
          <input matInput type="number" min="0" formControlName="costo_unitario" />
          <span matTextPrefix>$&nbsp;</span>
          <mat-hint>Si se deja en 0 se usa el costo del producto</mat-hint>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Referencia</mat-label>
          <input matInput formControlName="referencia" placeholder="Factura, remisión, lote…" />
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
        form="form-movimiento"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
})
export class MovimientoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(MovimientosInventarioService);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<MovimientoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly tipos = TIPOS_MOVIMIENTO;
  readonly productos = signal<Producto[]>([]);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    producto_id: ['', Validators.required],
    fecha: [hoyDate(), Validators.required],
    tipo: ['entrada', Validators.required],
    cantidad: [0, Validators.required],
    costo_unitario: [0, Validators.min(0)],
    referencia: [''],
    observaciones: [''],
  });

  constructor() {
    firstValueFrom(
      this.api.get<Page<Producto>>('/inventario/productos', { page_size: 100, estado: 'activo' }),
    ).then((page) => this.productos.set(page.items));
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      await firstValueFrom(this.servicio.create({ ...valores, fecha: dateToIso(valores.fecha)! }));
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
