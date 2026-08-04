import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Page, Ruta, Transportador } from '../../core/models';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SelectBuscable } from '../../shared/select-buscable';
import { TransportadoresService } from './transportadores.service';

@Component({
  selector: 'app-transportador-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MilesInputDirective, SelectBuscable,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar transportador' : 'Nuevo transportador' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-transportador" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Documento</mat-label>
          <input matInput formControlName="documento" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Teléfono</mat-label>
          <input matInput formControlName="telefono" />
        </mat-form-field>
        <app-select-buscable formControlName="ruta_id" [opciones]="rutas()" label="Ruta" />
        <!--
          Tarifa CON DECIMALES ([decimales]="2"): no es un total en pesos, es lo
          que se le paga por cada litro, y hay transportadores a $242,76. Se puede
          teclear con coma o con punto; inputmode="decimal" saca la coma en el
          teclado del celular.
        -->
        <mat-form-field>
          <mat-label>Valor de transporte por litro</mat-label>
          <input
            matInput
            type="text"
            inputmode="decimal"
            appMiles
            [decimales]="2"
            formControlName="valor_transporte"
            required
          />
          <span matTextPrefix>$&nbsp;</span>
          <span matTextSuffix>/L</span>
          <mat-hint>Se admite coma: 242,76</mat-hint>
          <!--
            El mensaje es obligatorio: con esta tarifa se le paga al transportador,
            así que si el campo queda vacío o con algo que no es un número hay que
            decirlo, no guardar un cero callado.
          -->
          @if (form.controls.valor_transporte.hasError('required')) {
            <mat-error>Escriba la tarifa por litro (ej: 242,76)</mat-error>
          } @else if (form.controls.valor_transporte.hasError('min')) {
            <mat-error>La tarifa no puede ser negativa</mat-error>
          }
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-transportador"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
})
export class TransportadorFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(TransportadoresService);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<TransportadorFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: Transportador } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly rutas = signal<Ruta[]>([]);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    nombre: [this.data?.item?.nombre ?? '', [Validators.required, Validators.minLength(2)]],
    documento: [this.data?.item?.documento ?? ''],
    telefono: [this.data?.item?.telefono ?? ''],
    ruta_id: [this.data?.item?.ruta_id ?? null as string | null],
    valor_transporte: [
      Number(this.data?.item?.valor_transporte ?? 0),
      [Validators.required, Validators.min(0)],
    ],
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
