import { Component, computed, inject, signal } from '@angular/core';
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

import { Vehiculo, VehiculoMantenimiento } from '../../core/models';
import { dateToIso, hoyDate, isoToDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SelectBuscable } from '../../shared/select-buscable';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { ETIQUETAS_TIPO_MANTENIMIENTO, MantenimientosService } from './mantenimientos.service';
import { VehiculosService } from './vehiculos.service';

export interface MantenimientoFormData {
  /** Mantenimiento a editar; si falta, se crea uno nuevo. */
  item?: VehiculoMantenimiento;
  /** Vehículo preseleccionado (arranque rápido desde otra pantalla). */
  vehiculoId?: string;
}

/**
 * Registra o edita un mantenimiento del vehículo. El "próximo" (por fecha y/o
 * por odómetro) alimenta las alertas de la pantalla de vehículos. Tras guardar
 * ofrece adjuntar la factura del taller (dos fases, patrón de gastos).
 */
@Component({
  selector: 'app-mantenimiento-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatDatepickerModule,
    MilesInputDirective, SelectBuscable, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.item ? 'Editar mantenimiento' : 'Nuevo mantenimiento' }}</h2>
    <mat-dialog-content>
      @if (!mantenimientoGuardado()) {
        <form [formGroup]="form" class="form-grid" id="form-mantenimiento" (ngSubmit)="guardar()">
          <app-select-buscable formControlName="vehiculo_id" [opciones]="opcionesVehiculos()" label="Vehículo" />
          <mat-form-field>
            <mat-label>Fecha</mat-label>
            <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
            <mat-datepicker-toggle matSuffix [for]="pFecha" />
            <mat-datepicker #pFecha />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Tipo</mat-label>
            <mat-select formControlName="tipo" required>
              <mat-option value="preventivo">{{ etiquetasTipo['preventivo'] }}</mat-option>
              <mat-option value="correctivo">{{ etiquetasTipo['correctivo'] }}</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Taller</mat-label>
            <input matInput formControlName="taller" maxlength="150" />
            <mat-hint>Opcional</mat-hint>
          </mat-form-field>
          <mat-form-field class="full">
            <mat-label>Descripción</mat-label>
            <input matInput formControlName="descripcion" required maxlength="200" cdkFocusInitial />
            <mat-hint>Qué se le hizo al vehículo (cambio de aceite, frenos…)</mat-hint>
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
            <mat-hint>Opcional; el del vehículo al hacerlo</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Próximo por odómetro</mat-label>
            <input matInput type="number" min="0" step="1" formControlName="proximo_odometro" />
            <span matTextSuffix>km</span>
            <mat-hint>Opcional; dispara la alerta al acercarse</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Próximo por fecha</mat-label>
            <input matInput [matDatepicker]="pProxima" (click)="pProxima.open()" formControlName="proxima_fecha" />
            <mat-datepicker-toggle matSuffix [for]="pProxima" />
            <mat-datepicker #pProxima />
            <mat-hint>Opcional; dispara la alerta al acercarse</mat-hint>
          </mat-form-field>
        </form>
      } @else {
        <p>Mantenimiento guardado. Si lo desea, adjunte la factura del taller:</p>
        <input type="file" accept="image/*,.pdf" (change)="seleccionarArchivo($event)" />
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (!mantenimientoGuardado()) {
        <button mat-button mat-dialog-close type="button">Cancelar</button>
        <button
          mat-flat-button
          type="submit"
          form="form-mantenimiento"
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
export class MantenimientoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(MantenimientosService);
  private readonly vehiculosService = inject(VehiculosService);
  private readonly dialogRef = inject(MatDialogRef<MantenimientoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<MantenimientoFormData>(MAT_DIALOG_DATA);
  readonly etiquetasTipo = ETIQUETAS_TIPO_MANTENIMIENTO;
  readonly vehiculos = signal<Vehiculo[]>([]);
  readonly guardando = signal(false);
  readonly mantenimientoGuardado = signal<VehiculoMantenimiento | null>(null);
  readonly archivo = signal<File | null>(null);
  readonly subiendo = signal(false);

  readonly opcionesVehiculos = computed(() =>
    this.vehiculos().map((v) => ({
      id: v.id,
      nombre: v.nombre ? `${v.placa} — ${v.nombre}` : v.placa,
    })),
  );

  readonly form = this.fb.group({
    vehiculo_id: [
      (this.data.item?.vehiculo_id ?? this.data.vehiculoId ?? null) as string | null,
      Validators.required,
    ],
    fecha: [
      this.data.item ? (isoToDate(this.data.item.fecha) ?? hoyDate()) : hoyDate(),
      Validators.required,
    ],
    tipo: [
      (this.data.item?.tipo ?? 'preventivo') as 'preventivo' | 'correctivo',
      Validators.required,
    ],
    descripcion: [this.data.item?.descripcion ?? '', [Validators.required, Validators.minLength(2)]],
    taller: [this.data.item?.taller ?? ''],
    odometro: [
      (this.data.item?.odometro !== null && this.data.item?.odometro !== undefined
        ? Number(this.data.item.odometro)
        : null) as number | null,
      [Validators.min(0)],
    ],
    valor: [Number(this.data.item?.valor ?? 0), [Validators.required, Validators.min(0)]],
    proximo_odometro: [
      (this.data.item?.proximo_odometro !== null && this.data.item?.proximo_odometro !== undefined
        ? Number(this.data.item.proximo_odometro)
        : null) as number | null,
      [Validators.min(0)],
    ],
    proxima_fecha: [isoToDate(this.data.item?.proxima_fecha) as Date | null],
  });

  constructor() {
    firstValueFrom(this.vehiculosService.list({ page_size: 100, estado: 'activo' })).then(
      (pagina) => {
        this.vehiculos.set(pagina.items);
        const actual = this.form.controls.vehiculo_id.value;
        if (actual) {
          // Repinta el select buscable, que al construirse aún no tenía opciones.
          this.form.controls.vehiculo_id.setValue(actual, { emitEvent: false });
        } else if (pagina.items.length === 1) {
          // Con un solo vehículo (el caso real: la turbo) se preselecciona.
          this.form.controls.vehiculo_id.setValue(pagina.items[0].id);
        }
      },
    );

    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const payload = {
        vehiculo_id: valores.vehiculo_id!,
        fecha: dateToIso(valores.fecha)!,
        tipo: valores.tipo,
        descripcion: valores.descripcion.trim(),
        taller: valores.taller.trim() || null,
        odometro: valores.odometro === null ? null : Number(valores.odometro),
        valor: Number(valores.valor),
        proximo_odometro:
          valores.proximo_odometro === null ? null : Number(valores.proximo_odometro),
        proxima_fecha: dateToIso(valores.proxima_fecha),
      };
      const guardado = this.data.item
        ? await firstValueFrom(this.servicio.update(this.data.item.id, payload))
        : await firstValueFrom(this.servicio.create(payload));
      this.mantenimientoGuardado.set(guardado);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar el mantenimiento');
    } finally {
      this.guardando.set(false);
    }
  }

  seleccionarArchivo(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    this.archivo.set(input.files?.[0] ?? null);
  }

  async subirAdjunto(): Promise<void> {
    const mantenimiento = this.mantenimientoGuardado();
    const archivo = this.archivo();
    if (!mantenimiento || !archivo) return;
    this.subiendo.set(true);
    try {
      await firstValueFrom(this.servicio.adjuntar(mantenimiento.id, archivo));
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
