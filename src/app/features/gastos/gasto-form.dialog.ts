import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { CategoriaGasto, Gasto, Page } from '../../core/models';
import { dateToIso, isoToDate, hoyDate } from '../../shared/date-utils';
import { GastosService } from './gastos.service';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SelectBuscable } from '../../shared/select-buscable';

@Component({
  selector: 'app-gasto-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatDatepickerModule,
    MilesInputDirective, SelectBuscable,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar gasto' : 'Nuevo gasto' }}</h2>
    <mat-dialog-content>
      @if (!gastoGuardado()) {
        <form [formGroup]="form" class="form-grid" id="form-gasto" (ngSubmit)="guardar()">
          <mat-form-field>
            <mat-label>Fecha</mat-label>
            <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
            <mat-datepicker-toggle matSuffix [for]="pFecha" />
            <mat-datepicker #pFecha />
          </mat-form-field>
          <app-select-buscable formControlName="categoria_id" [opciones]="categorias()" label="Categoría" />
          <mat-form-field class="full">
            <mat-label>Concepto</mat-label>
            <input matInput formControlName="concepto" required />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Proveedor</mat-label>
            <input matInput formControlName="proveedor" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Valor</mat-label>
            <input matInput type="text" inputmode="numeric" appMiles formControlName="valor" required />
            <span matTextPrefix>$&nbsp;</span>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Nº factura</mat-label>
            <input matInput formControlName="numero_factura" />
          </mat-form-field>
          <mat-form-field class="full">
            <mat-label>Observaciones</mat-label>
            <textarea matInput formControlName="observaciones" rows="2"></textarea>
          </mat-form-field>
        </form>
      } @else {
        <p>Gasto guardado. Si lo desea, adjunte la factura o soporte:</p>
        <input
          type="file"
          accept="image/*,.pdf"
          (change)="seleccionarArchivo($event)"
        />
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (!gastoGuardado()) {
        <button mat-button mat-dialog-close type="button">Cancelar</button>
        <button
          mat-flat-button
          type="submit"
          form="form-gasto"
          [disabled]="form.invalid || guardando()"
        >
          Guardar
        </button>
      } @else {
        <button mat-button type="button" (click)="finalizar()">Omitir</button>
        <button
          mat-flat-button
          type="button"
          [disabled]="!archivo() || subiendo()"
          (click)="subirAdjunto()"
        >
          <mat-icon>attach_file</mat-icon> Subir adjunto
        </button>
      }
    </mat-dialog-actions>
  `,
})
export class GastoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(GastosService);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<GastoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: Gasto } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly categorias = signal<CategoriaGasto[]>([]);
  readonly guardando = signal(false);
  readonly gastoGuardado = signal<Gasto | null>(null);
  readonly archivo = signal<File | null>(null);
  readonly subiendo = signal(false);

  readonly form = this.fb.group({
    fecha: [
      this.data?.item ? (isoToDate(this.data.item.fecha) ?? hoyDate()) : hoyDate(),
      Validators.required,
    ],
    categoria_id: [this.data?.item?.categoria_id ?? '', Validators.required],
    concepto: [this.data?.item?.concepto ?? '', [Validators.required, Validators.minLength(2)]],
    proveedor: [this.data?.item?.proveedor ?? ''],
    valor: [Number(this.data?.item?.valor ?? 0), [Validators.required, Validators.min(1)]],
    numero_factura: [this.data?.item?.numero_factura ?? ''],
    observaciones: [this.data?.item?.observaciones ?? ''],
  });

  constructor() {
    firstValueFrom(
      this.api.get<Page<CategoriaGasto>>('/categorias-gasto', { page_size: 100, estado: 'activo' }),
    ).then((pagina) => this.categorias.set(pagina.items));
    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const payload = { ...valores, fecha: dateToIso(valores.fecha)! };
      let guardado: Gasto;
      if (this.data?.item) {
        guardado = await firstValueFrom(this.servicio.update(this.data.item.id, payload));
      } else {
        guardado = await firstValueFrom(this.servicio.create(payload));
      }
      this.gastoGuardado.set(guardado);
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

  seleccionarArchivo(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    this.archivo.set(input.files?.[0] ?? null);
  }

  async subirAdjunto(): Promise<void> {
    const gasto = this.gastoGuardado();
    const archivo = this.archivo();
    if (!gasto || !archivo) return;
    this.subiendo.set(true);
    try {
      await firstValueFrom(this.servicio.adjuntar(gasto.id, archivo));
      this.snackbar.open('Adjunto subido', 'OK', { duration: 3000 });
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible subir el adjunto')
          : 'No fue posible subir el adjunto';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.subiendo.set(false);
    }
  }

  finalizar(): void {
    this.dialogRef.close(true);
  }
}
