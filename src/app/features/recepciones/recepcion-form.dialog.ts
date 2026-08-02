import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Page, Proveedor, Recepcion, Transportador } from '../../core/models';
import { dateToIso, isoToDate, hoyDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { RecepcionesService, RecepcionPayload } from './recepciones.service';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SelectBuscable } from '../../shared/select-buscable';
import { SpinnerBoton } from '../../shared/spinner-boton';

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
    MatButtonModule, MatIconModule, MatDatepickerModule, MilesInputDirective, SelectBuscable,
    SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar recepción' : 'Nueva recepción' }}</h2>
    <mat-dialog-content>
      @if (pagada) {
        <p class="aviso-liquidacion">
          Este día ya se pagó en una liquidación y no se puede modificar.
        </p>
      } @else if (enLiquidacion) {
        <!-- No es un bloqueo: es una advertencia. Se puede guardar, pero conviene
             saber que por detrás se mueve un comprobante ya emitido. -->
        <p class="aviso-liquidacion">
          @if (estadoLiquidacion === 'aprobada') {
            Este día ya está en una liquidación <strong>aprobada</strong>. Si lo cambia (o lo
            elimina), esa liquidación vuelve a borrador y se recalcula: tendrá que revisarla y
            aprobarla otra vez.
          } @else {
            Este día ya está en una liquidación en <strong>borrador</strong>. Si lo cambia (o lo
            elimina), esa liquidación se recalcula sola.
          }
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
        <app-select-buscable formControlName="proveedor_id" [opciones]="proveedores()" label="Proveedor" />
        <app-select-buscable formControlName="transportador_id" [opciones]="transportadores()" label="Transportador" />
        <mat-form-field>
          <mat-label>Cantidad de litros</mat-label>
          <!-- cdkFocusInitial: el foco arranca en los litros, no en la fecha (que se llena con el calendario). -->
          <input matInput type="number" min="0" formControlName="cantidad_litros" required cdkFocusInitial />
          <span matTextSuffix>L</span>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Precio por litro</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="precio_litro" />
          <span matTextPrefix>$&nbsp;</span>
          <mat-hint>Vacío = precio del proveedor</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Bonificaciones</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="bonificaciones" />
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Descuentos</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="descuentos" />
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea matInput formControlName="observaciones" rows="2"></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (data?.item && !pagada) {
        <button
          mat-button
          type="button"
          class="btn-eliminar"
          [disabled]="eliminando()"
          (click)="eliminar()"
        >
          <mat-icon>delete</mat-icon> Eliminar
        </button>
      }
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-recepcion"
        [disabled]="form.invalid || guardando() || pagada"
      >
        @if (guardando()) {
          <app-spinner-boton /> Guardando…
        } @else {
          Guardar
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .aviso-liquidacion {
      margin: 0 0 12px;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 0.85rem;
      background: color-mix(in srgb, #b26a00 14%, transparent);
      color: #b26a00;
    }
    :host-context(html.dark) .aviso-liquidacion { color: #ffb74d; }

    .aviso-prefijado {
      margin: 0 0 12px;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 0.85rem;
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      color: var(--mat-sys-primary);
    }

    /* El botón Eliminar se ancla a la izquierda de las acciones */
    .btn-eliminar { margin-right: auto; color: var(--mat-sys-error); }
  `,
})
export class RecepcionFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(RecepcionesService);
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef<RecepcionFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<RecepcionDialogData | null>(MAT_DIALOG_DATA, { optional: true });
  /**
   * Estado de la liquidación que manda sobre este día. El candado es SOLO
   * 'pagada': en borrador y en aprobada el día se corrige y el backend recuadra
   * la liquidación (ver RecepcionService._exigir_no_pagada). Antes se bloqueaba
   * con solo tener liquidación, y el dueño se quedaba sin poder corregir un día
   * desde que la generaba, aunque no le hubiera pagado a nadie.
   */
  readonly estadoLiquidacion = this.data?.item?.liquidacion_estado ?? null;
  readonly pagada = this.estadoLiquidacion === 'pagada';
  /** Ya está en una liquidación, pero sin pagar: se edita avisando. */
  readonly enLiquidacion =
    this.estadoLiquidacion === 'borrador' || this.estadoLiquidacion === 'aprobada';
  /** Nueva recepción abierta desde una celda de la grilla: fecha y proveedor fijos. */
  readonly prefijado = !this.data?.item && !!this.data?.prefill;
  readonly proveedores = signal<Proveedor[]>([]);
  readonly transportadores = signal<Transportador[]>([]);
  readonly guardando = signal(false);
  readonly eliminando = signal(false);

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
    // Un día ya PAGADO es de solo lectura (el backend también lo valida).
    if (this.pagada) {
      this.form.disable();
    }
    firstValueFrom(
      this.api.get<Page<Proveedor>>('/proveedores', { page_size: 100, estado: 'activo' }),
    ).then((page) => this.proveedores.set(page.items));
    firstValueFrom(
      this.api.get<Page<Transportador>>('/transportadores', { page_size: 100, estado: 'activo' }),
    ).then((page) => this.transportadores.set(page.items));

    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid || this.pagada) return;
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
      this.dialogRef.close('guardado');
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar');
    } finally {
      this.guardando.set(false);
    }
  }

  /** Elimina la recepción (p. ej. un registro equivocado). Bloqueada si ya se pagó. */
  eliminar(): void {
    const item = this.data?.item;
    if (!item || this.pagada) return;
    // Si el día está en una liquidación, borrarlo también le quita el renglón:
    // hay que decirlo ANTES de confirmar, no después.
    const consecuencia =
      this.estadoLiquidacion === 'aprobada'
        ? ' La liquidación que lo incluye volverá a borrador y se recalculará sin este día:' +
          ' tendrá que aprobarla otra vez.'
        : this.estadoLiquidacion === 'borrador'
          ? ' La liquidación que lo incluye se recalculará sin este día.'
          : '';
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar recepción',
          mensaje:
            '¿Eliminar esta recepción? Desaparecerá de la grilla y del listado. ' +
            'No se puede deshacer.' + consecuencia,
          accion: 'Eliminar',
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        this.eliminando.set(true);
        try {
          await firstValueFrom(this.servicio.remove(item.id));
          this.dialogRef.close('eliminado');
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible eliminar');
        } finally {
          this.eliminando.set(false);
        }
      });
  }
}
