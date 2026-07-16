import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Page, Proveedor, Recepcion, Transportador } from '../../core/models';
import { dateToIso, isoToDate, hoyDate } from '../../shared/date-utils';
import { RecepcionesService, RecepcionPayload } from './recepciones.service';

/** Datos de apertura del diálogo: edición (`item`) o celda de la grilla (`prefill`). */
export interface RecepcionDialogData {
  item?: Recepcion;
  /** Al crear desde la grilla: fecha y proveedor vienen fijos (no editables). */
  prefill?: { fecha: string; proveedor_id: string };
}

@Component({
  selector: 'app-recepcion-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatDatepickerModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar recepción' : 'Nueva recepción' }}</h2>
    <mat-dialog-content>
      @if (liquidada) {
        <p class="aviso-liquidada">
          Esta recepción ya fue liquidada y no se puede modificar.
        </p>
      }
      @if (prefijado) {
        <p class="aviso-prefijado">
          Fecha y proveedor vienen fijos desde la celda elegida en la grilla.
        </p>
      }
      <form [formGroup]="form" class="form-grid" id="form-recepcion" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Proveedor</mat-label>
          <mat-select formControlName="proveedor_id" required>
            @for (proveedor of proveedores(); track proveedor.id) {
              <mat-option [value]="proveedor.id">{{ proveedor.nombre }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Transportador</mat-label>
          <mat-select formControlName="transportador_id">
            <mat-option [value]="null">Sin transportador</mat-option>
            @for (transportador of transportadores(); track transportador.id) {
              <mat-option [value]="transportador.id">{{ transportador.nombre }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Cantidad de litros</mat-label>
          <input matInput type="number" min="0" formControlName="cantidad_litros" required />
          <span matTextSuffix>L</span>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Precio por litro</mat-label>
          <input matInput type="number" min="0" formControlName="precio_litro" />
          <span matTextPrefix>$&nbsp;</span>
          <mat-hint>Vacío = precio del proveedor</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Bonificaciones</mat-label>
          <input matInput type="number" min="0" formControlName="bonificaciones" />
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Descuentos</mat-label>
          <input matInput type="number" min="0" formControlName="descuentos" />
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
        form="form-recepcion"
        [disabled]="form.invalid || guardando() || liquidada"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .aviso-liquidada {
      margin: 0 0 12px;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 0.85rem;
      background: color-mix(in srgb, #b26a00 14%, transparent);
      color: #b26a00;
    }
    :host-context(html.dark) .aviso-liquidada { color: #ffb74d; }

    .aviso-prefijado {
      margin: 0 0 12px;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 0.85rem;
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      color: var(--mat-sys-primary);
    }
  `,
})
export class RecepcionFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(RecepcionesService);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<RecepcionFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<RecepcionDialogData | null>(MAT_DIALOG_DATA, { optional: true });
  readonly liquidada = !!this.data?.item?.liquidacion_id;
  /** Nueva recepción abierta desde una celda de la grilla: fecha y proveedor fijos. */
  readonly prefijado = !this.data?.item && !!this.data?.prefill;
  readonly proveedores = signal<Proveedor[]>([]);
  readonly transportadores = signal<Transportador[]>([]);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    fecha: [
      isoToDate(this.data?.item?.fecha ?? this.data?.prefill?.fecha ?? null) ?? hoyDate(),
      Validators.required,
    ],
    proveedor_id: [
      this.data?.item?.proveedor_id ?? this.data?.prefill?.proveedor_id ?? '',
      Validators.required,
    ],
    transportador_id: [this.data?.item?.transportador_id ?? (null as string | null)],
    cantidad_litros: [
      (this.data?.item ? Number(this.data.item.cantidad_litros) : null) as number | null,
      [Validators.required, Validators.min(0.01)],
    ],
    precio_litro: [
      (this.data?.item ? Number(this.data.item.precio_litro) : null) as number | null,
      [Validators.min(0)],
    ],
    bonificaciones: [Number(this.data?.item?.bonificaciones ?? 0), [Validators.min(0)]],
    descuentos: [Number(this.data?.item?.descuentos ?? 0), [Validators.min(0)]],
    observaciones: [this.data?.item?.observaciones ?? ''],
  });

  constructor() {
    // El backend no permite cambiar el proveedor de una recepción existente.
    // Desde la grilla, la celda ya define proveedor y fecha: quedan bloqueados.
    if (this.data?.item || this.prefijado) {
      this.form.controls.proveedor_id.disable();
    }
    if (this.prefijado) {
      this.form.controls.fecha.disable();
    }
    // Una recepción ya liquidada es de solo lectura (el backend también lo valida).
    if (this.liquidada) {
      this.form.disable();
    }
    firstValueFrom(
      this.api.get<Page<Proveedor>>('/proveedores', { page_size: 100, estado: 'activo' }),
    ).then((page) => this.proveedores.set(page.items));
    firstValueFrom(
      this.api.get<Page<Transportador>>('/transportadores', { page_size: 100, estado: 'activo' }),
    ).then((page) => this.transportadores.set(page.items));
  }

  async guardar(): Promise<void> {
    if (this.form.invalid || this.liquidada) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const payload: RecepcionPayload = {
        fecha: dateToIso(valores.fecha)!,
        transportador_id: valores.transportador_id,
        cantidad_litros: valores.cantidad_litros!,
        bonificaciones: valores.bonificaciones,
        descuentos: valores.descuentos,
        observaciones: valores.observaciones || null,
      };
      // Vacío = usa el precio acordado del proveedor (no se envía el campo).
      if (valores.precio_litro !== null && valores.precio_litro !== undefined) {
        payload.precio_litro = valores.precio_litro;
      }
      if (this.data?.item) {
        await firstValueFrom(this.servicio.update(this.data.item.id, payload));
      } else {
        payload.proveedor_id = valores.proveedor_id;
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
