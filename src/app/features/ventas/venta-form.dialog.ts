import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Cliente, Page, Producto } from '../../core/models';
import { MoneyPipe } from '../../shared/pipes';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { dateToIso, hoyDate } from '../../shared/date-utils';
import { VentaPayload, VentasService } from './ventas.service';

@Component({
  selector: 'app-venta-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatCheckboxModule,
    MatTooltipModule, MatDatepickerModule, MoneyPipe, MilesInputDirective,
  ],
  templateUrl: './venta-form.dialog.html',
  styles: `
    .seccion {
      margin: 12px 0 8px;
      font-size: 1rem;
      font-weight: 500;
    }
    .linea {
      display: grid;
      grid-template-columns: minmax(180px, 2fr) 100px 150px 110px 40px;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }
    .subtotal-linea {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .agregar { margin: 4px 0 16px; }
    .totales {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      margin-bottom: 16px;

      div {
        display: flex;
        gap: 24px;
        span { color: var(--mat-sys-on-surface-variant); }
        strong { min-width: 110px; text-align: right; font-variant-numeric: tabular-nums; }
      }
      .total-final { font-size: 1.05rem; }
    }
    mat-checkbox { display: block; margin-bottom: 8px; }
    .obs { width: 100%; margin-top: 8px; }
  `,
})
export class VentaFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(VentasService);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<VentaFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly clientes = signal<Cliente[]>([]);
  readonly productos = signal<Producto[]>([]);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    tipo: ['factura' as 'factura' | 'remision', Validators.required],
    cliente_id: ['', Validators.required],
    fecha: [hoyDate(), Validators.required],
    descuento: [0, [Validators.min(0)]],
    observaciones: [''],
    descontar_inventario: [true],
    lineas: this.fb.array([this.nuevaLinea()]),
  });

  /** Re-emite en cada cambio del formulario para recalcular totales en vivo. */
  private readonly cambios = toSignal(this.form.valueChanges);

  readonly subtotales = computed(() => {
    this.cambios();
    return this.lineas.controls.map((linea) => {
      const valor = linea.getRawValue();
      return Number(valor.cantidad || 0) * Number(valor.precio_unitario || 0);
    });
  });
  readonly subtotal = computed(() => this.subtotales().reduce((acum, s) => acum + s, 0));
  readonly descuentoValor = computed(() => {
    this.cambios();
    return Number(this.form.controls.descuento.value || 0);
  });
  readonly total = computed(() => this.subtotal() - this.descuentoValor());

  constructor() {
    firstValueFrom(
      this.api.get<Page<Cliente>>('/clientes', { page_size: 100, estado: 'activo' }),
    ).then((pagina) => this.clientes.set(pagina.items));

    // Solo se venden productos terminados (queso), no materias primas ni insumos.
    // Si la empresa no tiene ninguno, el selector queda vacío a propósito.
    firstValueFrom(
      this.api.get<Page<Producto>>('/inventario/productos', { page_size: 200, estado: 'activo' }),
    ).then((pagina) => {
      this.productos.set(pagina.items.filter((p) => p.categoria === 'producto_terminado'));
    });
  }

  get lineas() {
    return this.form.controls.lineas;
  }

  private nuevaLinea() {
    return this.fb.group({
      producto_id: ['', Validators.required],
      cantidad: [1, [Validators.required, Validators.min(0.01)]],
      precio_unitario: [0, [Validators.required, Validators.min(0)]],
    });
  }

  agregarLinea(): void {
    this.lineas.push(this.nuevaLinea());
  }

  eliminarLinea(indice: number): void {
    if (this.lineas.length > 1) this.lineas.removeAt(indice);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid || this.total() < 0) return;
    this.guardando.set(true);
    try {
      const valor = this.form.getRawValue();
      const payload: VentaPayload = {
        tipo: valor.tipo,
        cliente_id: valor.cliente_id,
        fecha: dateToIso(valor.fecha)!,
        descuento: Number(valor.descuento || 0),
        observaciones: valor.observaciones || null,
        descontar_inventario: valor.descontar_inventario,
        detalles: valor.lineas.map((linea) => ({
          producto_id: linea.producto_id,
          cantidad: Number(linea.cantidad),
          precio_unitario: Number(linea.precio_unitario),
        })),
      };
      await firstValueFrom(this.servicio.create(payload));
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible registrar la venta')
          : 'No fue posible registrar la venta';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
