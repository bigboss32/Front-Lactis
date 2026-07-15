import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Producto } from '../../core/models';
import { CATEGORIAS_PRODUCTO, ProductosService } from './inventario.service';

/** Diálogo de creación/edición de productos del catálogo de inventario. */
@Component({
  selector: 'app-producto-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar producto' : 'Nuevo producto' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-producto" (ngSubmit)="guardar()">
        <mat-form-field class="full">
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Categoría</mat-label>
          <mat-select formControlName="categoria" required>
            @for (categoria of categorias; track categoria.valor) {
              <mat-option [value]="categoria.valor">{{ categoria.etiqueta }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Unidad</mat-label>
          <input matInput formControlName="unidad" placeholder="unidad, kg, litro…" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Stock mínimo</mat-label>
          <input matInput type="number" min="0" formControlName="stock_minimo" required />
          <mat-hint>Genera alerta cuando el stock cae por debajo</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Costo unitario</mat-label>
          <input matInput type="number" min="0" formControlName="costo_unitario" required />
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-producto"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
})
export class ProductoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ProductosService);
  private readonly dialogRef = inject(MatDialogRef<ProductoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: Producto } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly categorias = CATEGORIAS_PRODUCTO;
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    nombre: [this.data?.item?.nombre ?? '', [Validators.required, Validators.minLength(2)]],
    categoria: [this.data?.item?.categoria ?? 'insumo', Validators.required],
    unidad: [this.data?.item?.unidad ?? 'unidad', Validators.required],
    stock_minimo: [
      Number(this.data?.item?.stock_minimo ?? 0),
      [Validators.required, Validators.min(0)],
    ],
    costo_unitario: [
      Number(this.data?.item?.costo_unitario ?? 0),
      [Validators.required, Validators.min(0)],
    ],
  });

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const payload = this.form.getRawValue();
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
