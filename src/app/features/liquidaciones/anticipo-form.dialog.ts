import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Anticipo, Page, Proveedor } from '../../core/models';
import { AnticiposService } from './anticipos.service';

function hoyIso(): string {
  const hoy = new Date();
  const mes = `${hoy.getMonth() + 1}`.padStart(2, '0');
  const dia = `${hoy.getDate()}`.padStart(2, '0');
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

@Component({
  selector: 'app-anticipo-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar anticipo' : 'Nuevo anticipo' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-anticipo" (ngSubmit)="guardar()">
        <mat-form-field class="full">
          <mat-label>Proveedor</mat-label>
          <mat-select formControlName="proveedor_id" required>
            @for (proveedor of proveedores(); track proveedor.id) {
              <mat-option [value]="proveedor.id">{{ proveedor.nombre }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput type="date" formControlName="fecha" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Valor</mat-label>
          <input matInput type="number" min="0" formControlName="valor" required />
          <span matTextPrefix>$&nbsp;</span>
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
        form="form-anticipo"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
})
export class AnticipoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(AnticiposService);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<AnticipoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: Anticipo } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly proveedores = signal<Proveedor[]>([]);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    proveedor_id: [this.data?.item?.proveedor_id ?? '', Validators.required],
    fecha: [this.data?.item?.fecha ?? hoyIso(), Validators.required],
    valor: [Number(this.data?.item?.valor ?? 0), [Validators.required, Validators.min(0.01)]],
    observaciones: [this.data?.item?.observaciones ?? ''],
  });

  constructor() {
    firstValueFrom(
      this.api.get<Page<Proveedor>>('/proveedores', { page_size: 100, estado: 'activo' }),
    ).then((page) => this.proveedores.set(page.items));
    // El backend no permite cambiar el proveedor de un anticipo existente.
    if (this.data?.item) this.form.controls.proveedor_id.disable();
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      if (this.data?.item) {
        await firstValueFrom(
          this.servicio.update(this.data.item.id, {
            fecha: valores.fecha,
            valor: valores.valor,
            observaciones: valores.observaciones || null,
          }),
        );
      } else {
        await firstValueFrom(
          this.servicio.create({
            proveedor_id: valores.proveedor_id,
            fecha: valores.fecha,
            valor: valores.valor,
            observaciones: valores.observaciones || null,
          }),
        );
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
