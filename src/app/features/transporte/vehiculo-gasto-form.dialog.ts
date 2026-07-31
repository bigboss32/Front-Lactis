import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { VehiculoGasto, ViajeDetalle } from '../../core/models';
import { dateToIso, hoyDate, isoToDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import {
  CATEGORIAS_GASTO_VEHICULO,
  ETIQUETAS_CATEGORIA_GASTO,
  TransporteGastosService,
} from './transporte-gastos.service';
import { ViajesService } from './viajes.service';

export interface VehiculoGastoFormData {
  /** Viaje al que se ata el gasto (registro desde el detalle del viaje). */
  viaje?: ViajeDetalle;
  /** Gasto general del vehículo, sin viaje (desde la ficha del vehículo). */
  vehiculoId?: string;
  /** Gasto a editar; si falta, se crea uno nuevo. */
  item?: VehiculoGasto;
}

/**
 * Registra o edita un gasto del vehículo (combustible, peajes…). Los documentos
 * legales (SOAT, seguro, impuestos) NO se registran aquí: tienen su propio
 * módulo con alertas de vencimiento y su propio renglón en el resumen.
 * Tras guardar ofrece adjuntar el recibo (dos fases, patrón de gastos).
 */
@Component({
  selector: 'app-vehiculo-gasto-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatDatepickerModule,
    MilesInputDirective, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.item ? 'Editar gasto' : 'Nuevo gasto del vehículo' }}</h2>
    <mat-dialog-content>
      @if (!gastoGuardado()) {
        <form [formGroup]="form" class="form-grid" id="form-gasto-vehiculo" (ngSubmit)="guardar()">
          <mat-form-field>
            <mat-label>Fecha</mat-label>
            <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
            <mat-datepicker-toggle matSuffix [for]="pFecha" />
            <mat-datepicker #pFecha />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Categoría</mat-label>
            <mat-select formControlName="categoria" required>
              @for (categoria of categorias; track categoria) {
                <mat-option [value]="categoria">{{ etiquetas[categoria] }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field class="full">
            <mat-label>Concepto</mat-label>
            <input matInput formControlName="concepto" maxlength="200" cdkFocusInitial />
            <mat-hint>Opcional; detalle del gasto</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Valor</mat-label>
            <input matInput type="text" inputmode="numeric" appMiles formControlName="valor" required />
            <span matTextPrefix>$&nbsp;</span>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Odómetro</mat-label>
            <input matInput type="number" min="0" step="1" formControlName="odometro" />
            <span matTextSuffix>km</span>
            <mat-hint>Opcional; útil al tanquear</mat-hint>
          </mat-form-field>
        </form>
      } @else {
        <p>Gasto guardado. Si lo desea, adjunte el recibo o soporte:</p>
        <input type="file" accept="image/*,.pdf" (change)="seleccionarArchivo($event)" />
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (!gastoGuardado()) {
        <button mat-button mat-dialog-close type="button">Cancelar</button>
        <button
          mat-flat-button
          type="submit"
          form="form-gasto-vehiculo"
          [disabled]="form.invalid || guardando()"
        >
          @if (guardando()) {
            <app-spinner-boton /> Guardando…
          } @else {
            Guardar
          }
        </button>
      } @else {
        <button mat-button type="button" (click)="finalizar()">Omitir</button>
        <button
          mat-flat-button
          type="button"
          [disabled]="!archivo() || subiendo()"
          (click)="subirAdjunto()"
        >
          <!-- El icono/spinner va SOLO en su rama: si comparte raíz con el texto,
               MatButton no lo proyecta en su ranura de icono (NG8011). -->
          @if (subiendo()) {
            <app-spinner-boton />
          } @else {
            <mat-icon>attach_file</mat-icon>
          }
          {{ subiendo() ? 'Subiendo adjunto…' : 'Subir adjunto' }}
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    // Espacio extra entre filas: las pistas ocupan una línea más.
    .form-grid { row-gap: 22px; }
  `,
})
export class VehiculoGastoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly gastosService = inject(TransporteGastosService);
  private readonly viajesService = inject(ViajesService);
  private readonly dialogRef = inject(MatDialogRef<VehiculoGastoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<VehiculoGastoFormData>(MAT_DIALOG_DATA);
  readonly categorias = CATEGORIAS_GASTO_VEHICULO;
  readonly etiquetas = ETIQUETAS_CATEGORIA_GASTO;
  readonly guardando = signal(false);
  readonly gastoGuardado = signal<VehiculoGasto | null>(null);
  readonly archivo = signal<File | null>(null);
  readonly subiendo = signal(false);

  readonly form = this.fb.group({
    fecha: [
      this.data.item ? (isoToDate(this.data.item.fecha) ?? hoyDate()) : hoyDate(),
      Validators.required,
    ],
    categoria: [this.data.item?.categoria ?? '', Validators.required],
    concepto: [this.data.item?.concepto ?? ''],
    valor: [Number(this.data.item?.valor ?? 0), [Validators.required, Validators.min(1)]],
    odometro: [
      (this.data.item?.odometro !== null && this.data.item?.odometro !== undefined
        ? Number(this.data.item.odometro)
        : null) as number | null,
      [Validators.min(0)],
    ],
  });

  constructor() {
    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const base = {
        fecha: dateToIso(valores.fecha)!,
        categoria: valores.categoria,
        concepto: valores.concepto.trim() || null,
        valor: Number(valores.valor),
        odometro: valores.odometro === null ? null : Number(valores.odometro),
      };
      let guardado: VehiculoGasto;
      if (this.data.item) {
        guardado = await firstValueFrom(this.gastosService.update(this.data.item.id, base));
      } else if (this.data.viaje) {
        // Atajo del backend: fija el viaje y su vehículo, sin repetirlos aquí.
        guardado = await firstValueFrom(this.viajesService.agregarGasto(this.data.viaje.id, base));
      } else {
        guardado = await firstValueFrom(
          this.gastosService.create({ ...base, vehiculo_id: this.data.vehiculoId! }),
        );
      }
      this.gastoGuardado.set(guardado);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar el gasto');
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
      await firstValueFrom(this.gastosService.adjuntar(gasto.id, archivo));
      this.snackbar.open('Adjunto subido', 'OK', { duration: 3000 });
      this.dialogRef.close(true);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible subir el adjunto');
    } finally {
      this.subiendo.set(false);
    }
  }

  finalizar(): void {
    this.dialogRef.close(true);
  }
}
