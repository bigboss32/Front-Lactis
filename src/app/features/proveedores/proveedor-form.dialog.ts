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

import { ApiService } from '../../core/api.service';
import { Page, Proveedor, Ruta } from '../../core/models';
import { ProveedoresService } from './proveedores.service';

@Component({
  selector: 'app-proveedor-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar proveedor' : 'Nuevo proveedor' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-proveedor" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Documento</mat-label>
          <input matInput formControlName="documento" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Vereda</mat-label>
          <input matInput formControlName="vereda" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Municipio</mat-label>
          <input matInput formControlName="municipio" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Teléfono</mat-label>
          <input matInput formControlName="telefono" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Precio por litro</mat-label>
          <input matInput type="number" min="0" formControlName="precio_litro" required />
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Ruta</mat-label>
          <mat-select formControlName="ruta_id">
            <mat-option [value]="null">Sin ruta</mat-option>
            @for (ruta of rutas(); track ruta.id) {
              <mat-option [value]="ruta.id">{{ ruta.nombre }}</mat-option>
            }
          </mat-select>
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
        form="form-proveedor"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
})
export class ProveedorFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ProveedoresService);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<ProveedorFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: Proveedor } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly rutas = signal<Ruta[]>([]);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    nombre: [this.data?.item?.nombre ?? '', [Validators.required, Validators.minLength(2)]],
    documento: [this.data?.item?.documento ?? ''],
    vereda: [this.data?.item?.vereda ?? ''],
    municipio: [this.data?.item?.municipio ?? ''],
    telefono: [this.data?.item?.telefono ?? ''],
    precio_litro: [Number(this.data?.item?.precio_litro ?? 0), [Validators.required, Validators.min(0)]],
    ruta_id: [this.data?.item?.ruta_id ?? null as string | null],
    observaciones: [this.data?.item?.observaciones ?? ''],
  });

  constructor() {
    firstValueFrom(
      this.api.get<Page<Ruta>>('/rutas', { page_size: 100, estado: 'activo' }),
    ).then((page) => this.rutas.set(page.items));
  }

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
