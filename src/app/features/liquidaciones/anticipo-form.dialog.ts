import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Anticipo, Empleado, Page, Proveedor, Transportador } from '../../core/models';
import { dateToIso, hoyDate, isoToDate } from '../../shared/date-utils';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { AnticipoCreatePayload, AnticiposService } from './anticipos.service';

type TipoAnticipo = 'proveedor' | 'transportador' | 'empleado';
interface Beneficiario {
  id: string;
  nombre: string;
}

@Component({
  selector: 'app-anticipo-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatDatepickerModule, MilesInputDirective,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar anticipo' : 'Nuevo anticipo' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-anticipo" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Tipo</mat-label>
          <mat-select formControlName="tipo" (selectionChange)="cambiarTipo()" required>
            <mat-option value="proveedor">Proveedor</mat-option>
            <mat-option value="transportador">Transportador</mat-option>
            <mat-option value="empleado">Empleado</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ etiquetaBeneficiario() }}</mat-label>
          <mat-select formControlName="beneficiario_id" required>
            @for (beneficiario of beneficiarios(); track beneficiario.id) {
              <mat-option [value]="beneficiario.id">{{ beneficiario.nombre }}</mat-option>
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
          <mat-label>Valor</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="valor" required />
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
  readonly transportadores = signal<Transportador[]>([]);
  readonly empleados = signal<Empleado[]>([]);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    tipo: [(this.data?.item?.tipo as TipoAnticipo) ?? 'proveedor', Validators.required],
    beneficiario_id: [this.beneficiarioInicial(), Validators.required],
    fecha: [this.data?.item ? (isoToDate(this.data.item.fecha) ?? hoyDate()) : hoyDate(), Validators.required],
    valor: [Number(this.data?.item?.valor ?? 0), [Validators.required, Validators.min(0.01)]],
    observaciones: [this.data?.item?.observaciones ?? ''],
  });

  /** El valor de `tipo` se sigue por señal para recomputar el catálogo de beneficiarios. */
  private readonly tipoSeleccionado = toSignal(this.form.controls.tipo.valueChanges, {
    initialValue: this.form.controls.tipo.value,
  });

  readonly beneficiarios = computed<Beneficiario[]>(() => {
    switch (this.tipoSeleccionado()) {
      case 'transportador':
        return this.transportadores().map((t) => ({ id: t.id, nombre: t.nombre }));
      case 'empleado':
        return this.empleados().map((e) => ({ id: e.id, nombre: `${e.nombre} ${e.apellido}` }));
      default:
        return this.proveedores().map((p) => ({ id: p.id, nombre: p.nombre }));
    }
  });

  readonly etiquetaBeneficiario = computed(() => {
    switch (this.tipoSeleccionado()) {
      case 'transportador':
        return 'Transportador';
      case 'empleado':
        return 'Empleado';
      default:
        return 'Proveedor';
    }
  });

  constructor() {
    const params = { page_size: 100, estado: 'activo' };
    firstValueFrom(this.api.get<Page<Proveedor>>('/proveedores', params)).then((page) =>
      this.proveedores.set(page.items),
    );
    firstValueFrom(this.api.get<Page<Transportador>>('/transportadores', params)).then((page) =>
      this.transportadores.set(page.items),
    );
    firstValueFrom(this.api.get<Page<Empleado>>('/empleados', params)).then((page) =>
      this.empleados.set(page.items),
    );
    // El backend no permite cambiar el beneficiario ni el tipo de un anticipo existente.
    if (this.data?.item) {
      this.form.controls.tipo.disable();
      this.form.controls.beneficiario_id.disable();
    }
  }

  /** En modo edición precarga el beneficiario según el tipo del anticipo. */
  private beneficiarioInicial(): string {
    const item = this.data?.item;
    if (!item) return '';
    return item.proveedor_id ?? item.transportador_id ?? item.empleado_id ?? '';
  }

  /** Al cambiar el tipo se limpia el beneficiario para forzar una nueva elección. */
  cambiarTipo(): void {
    this.form.controls.beneficiario_id.setValue('');
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      if (this.data?.item) {
        await firstValueFrom(
          this.servicio.update(this.data.item.id, {
            fecha: dateToIso(valores.fecha),
            valor: valores.valor,
            observaciones: valores.observaciones || null,
          }),
        );
      } else {
        const payload: AnticipoCreatePayload = {
          tipo: valores.tipo,
          fecha: dateToIso(valores.fecha),
          valor: valores.valor,
          observaciones: valores.observaciones || null,
        };
        if (valores.tipo === 'transportador') payload.transportador_id = valores.beneficiario_id;
        else if (valores.tipo === 'empleado') payload.empleado_id = valores.beneficiario_id;
        else payload.proveedor_id = valores.beneficiario_id;
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
