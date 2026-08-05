import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Page, Proveedor, Ruta } from '../../core/models';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SelectBuscable } from '../../shared/select-buscable';
import { ProveedoresService } from './proveedores.service';

@Component({
  selector: 'app-proveedor-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MilesInputDirective, SelectBuscable,
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
        <!--
          CON DECIMALES ([decimales]="2"): este es el precio con el que se le PAGA la
          leche al productor, y se paga por litro, así que el centavo se multiplica
          por los miles de litros del mes; hay precios de $1.800,50. Es el gemelo de
          la tarifa del transportador. inputmode="decimal" saca la coma en el
          teclado del celular. El backend guarda dos decimales y rechaza un tercero.
        -->
        <mat-form-field>
          <mat-label>Precio por litro</mat-label>
          <input matInput type="text" inputmode="decimal" appMiles [decimales]="2"
                 formControlName="precio_litro" required />
          <span matTextPrefix>$&nbsp;</span>
          <mat-hint>Se admite coma: 1.800,50</mat-hint>
        </mat-form-field>
        <app-select-buscable formControlName="ruta_id" [opciones]="rutas()" label="Ruta" />
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

    protegerCambios(this.dialogRef, () => this.form);
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
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar');
    } finally {
      this.guardando.set(false);
    }
  }
}
