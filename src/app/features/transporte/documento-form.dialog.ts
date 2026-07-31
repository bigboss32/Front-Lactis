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

import { Vehiculo, VehiculoDocumento } from '../../core/models';
import { dateToIso, isoToDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SelectBuscable } from '../../shared/select-buscable';
import { SpinnerBoton } from '../../shared/spinner-boton';
import {
  ETIQUETAS_TIPO_DOCUMENTO,
  TIPOS_DOCUMENTO_VEHICULO,
  VehiculoDocumentosService,
} from './vehiculo-documentos.service';
import { VehiculosService } from './vehiculos.service';

export interface DocumentoFormData {
  /** Documento a editar; si falta, se crea uno nuevo. */
  item?: VehiculoDocumento;
  /** Vehículo preseleccionado (arranque rápido desde otra pantalla). */
  vehiculoId?: string;
}

/**
 * Registra o edita un documento legal del vehículo (SOAT, tecnomecánica…).
 * Renovar = registrar un documento NUEVO: el vencido se conserva como histórico
 * y las alertas solo miran el de vencimiento más reciente por tipo. El valor va
 * al resumen en su propio renglón de documentos, NO como gasto del vehículo
 * (así no se cuenta dos veces). Tras guardar ofrece adjuntar la copia.
 */
@Component({
  selector: 'app-documento-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatDatepickerModule,
    MilesInputDirective, SelectBuscable, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.item ? 'Editar documento' : 'Nuevo documento' }}</h2>
    <mat-dialog-content>
      @if (!documentoGuardado()) {
        <form [formGroup]="form" class="form-grid" id="form-documento" (ngSubmit)="guardar()">
          <app-select-buscable formControlName="vehiculo_id" [opciones]="opcionesVehiculos()" label="Vehículo" />
          <mat-form-field>
            <mat-label>Tipo</mat-label>
            <mat-select formControlName="tipo" required>
              @for (tipo of tipos; track tipo) {
                <mat-option [value]="tipo">{{ etiquetasTipo[tipo] }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Número</mat-label>
            <input matInput formControlName="numero" maxlength="100" />
            <mat-hint>Opcional; nº de la póliza o del recibo</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Descripción</mat-label>
            <input matInput formControlName="descripcion" maxlength="200" />
            <mat-hint>Opcional</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Fecha de expedición</mat-label>
            <input matInput [matDatepicker]="pExpedicion" (click)="pExpedicion.open()" formControlName="fecha_expedicion" />
            <mat-datepicker-toggle matSuffix [for]="pExpedicion" />
            <mat-datepicker #pExpedicion />
            <mat-hint>Opcional; con ella el valor entra al resumen del período</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Fecha de vencimiento</mat-label>
            <input matInput [matDatepicker]="pVencimiento" (click)="pVencimiento.open()" formControlName="fecha_vencimiento" required />
            <mat-datepicker-toggle matSuffix [for]="pVencimiento" />
            <mat-datepicker #pVencimiento />
            <mat-hint>Para renovar, registre un documento nuevo</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Valor</mat-label>
            <input matInput type="text" inputmode="numeric" appMiles formControlName="valor" required />
            <span matTextPrefix>$&nbsp;</span>
            <mat-hint>Cuenta como documento, no como gasto del vehículo</mat-hint>
          </mat-form-field>
        </form>
      } @else {
        <p>Documento guardado. Si lo desea, adjunte la copia (foto o PDF):</p>
        <input type="file" accept="image/*,.pdf" (change)="seleccionarArchivo($event)" />
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (!documentoGuardado()) {
        <button mat-button mat-dialog-close type="button">Cancelar</button>
        <button
          mat-flat-button
          type="submit"
          form="form-documento"
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
export class DocumentoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(VehiculoDocumentosService);
  private readonly vehiculosService = inject(VehiculosService);
  private readonly dialogRef = inject(MatDialogRef<DocumentoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<DocumentoFormData>(MAT_DIALOG_DATA);
  readonly tipos = TIPOS_DOCUMENTO_VEHICULO;
  readonly etiquetasTipo = ETIQUETAS_TIPO_DOCUMENTO;
  readonly vehiculos = signal<Vehiculo[]>([]);
  readonly guardando = signal(false);
  readonly documentoGuardado = signal<VehiculoDocumento | null>(null);
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
    tipo: [this.data.item?.tipo ?? '', Validators.required],
    numero: [this.data.item?.numero ?? ''],
    descripcion: [this.data.item?.descripcion ?? ''],
    fecha_expedicion: [isoToDate(this.data.item?.fecha_expedicion) as Date | null],
    fecha_vencimiento: [
      isoToDate(this.data.item?.fecha_vencimiento) as Date | null,
      Validators.required,
    ],
    valor: [Number(this.data.item?.valor ?? 0), [Validators.required, Validators.min(0)]],
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
        tipo: valores.tipo,
        numero: valores.numero.trim() || null,
        descripcion: valores.descripcion.trim() || null,
        fecha_expedicion: dateToIso(valores.fecha_expedicion),
        fecha_vencimiento: dateToIso(valores.fecha_vencimiento)!,
        valor: Number(valores.valor),
      };
      const guardado = this.data.item
        ? await firstValueFrom(this.servicio.update(this.data.item.id, payload))
        : await firstValueFrom(this.servicio.create(payload));
      this.documentoGuardado.set(guardado);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar el documento');
    } finally {
      this.guardando.set(false);
    }
  }

  seleccionarArchivo(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    this.archivo.set(input.files?.[0] ?? null);
  }

  async subirAdjunto(): Promise<void> {
    const documento = this.documentoGuardado();
    const archivo = this.archivo();
    if (!documento || !archivo) return;
    this.subiendo.set(true);
    try {
      await firstValueFrom(this.servicio.adjuntar(documento.id, archivo));
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
