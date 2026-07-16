import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { dateToIso, hoyDate, isoToDate } from '../../shared/date-utils';
import { LiquidacionesService } from './liquidaciones.service';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function toIso(fecha: Date): string {
  const mes = `${fecha.getMonth() + 1}`.padStart(2, '0');
  const dia = `${fecha.getDate()}`.padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/** Rango ISO de una quincena: 1.ª = día 1 al 15; 2.ª = día 16 a fin de mes. */
function rangoQuincena(anio: number, mes: number, quincena: 1 | 2): { inicio: string; fin: string } {
  if (quincena === 1) {
    return {
      inicio: toIso(new Date(anio, mes, 1)),
      fin: toIso(new Date(anio, mes, 15)),
    };
  }
  return {
    inicio: toIso(new Date(anio, mes, 16)),
    fin: toIso(new Date(anio, mes + 1, 0)), // día 0 del mes siguiente = fin de mes
  };
}

/** Quincena anterior completa: 1–15 o 16–fin de mes, según la fecha actual. */
function quincenaAnterior(): { inicio: string; fin: string } {
  const hoy = new Date();
  if (hoy.getDate() <= 15) {
    return rangoQuincena(hoy.getFullYear(), hoy.getMonth() - 1, 2);
  }
  return rangoQuincena(hoy.getFullYear(), hoy.getMonth(), 1);
}

/** Descompone una fecha ISO 'YYYY-MM-DD' sin pasar por Date (evita zonas horarias). */
function partesFecha(iso: string | null | undefined): { dia: number; mes: string; anio: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return null;
  const indiceMes = Number(m[2]) - 1;
  if (indiceMes < 0 || indiceMes > 11) return null;
  return { anio: Number(m[1]), mes: MESES[indiceMes], dia: Number(m[3]) };
}

interface PresetQuincena {
  etiqueta: string;
  rango: { inicio: string; fin: string };
}

@Component({
  selector: 'app-generar-quincena',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatTooltipModule,
    MatDatepickerModule,
  ],
  template: `
    <h2 mat-dialog-title>Generar liquidaciones de la quincena</h2>
    <mat-dialog-content>
      <p class="ayuda">
        Agrupa las recepciones sin liquidar del período y descuenta los anticipos pendientes.
      </p>

      <div class="presets">
        @for (preset of presets; track preset.etiqueta) {
          <button
            mat-stroked-button
            type="button"
            class="preset"
            matTooltip="Rellena las fechas de inicio y fin automáticamente"
            (click)="aplicarPreset(preset)"
          >
            <mat-icon>event</mat-icon> {{ preset.etiqueta }}
          </button>
        }
      </div>

      <form [formGroup]="form" class="form-grid" id="form-generar" (ngSubmit)="generar()">
        <mat-form-field>
          <mat-label>Inicio del período</mat-label>
          <input matInput [matDatepicker]="pInicio" (click)="pInicio.open()" formControlName="periodo_inicio" required />
          <mat-datepicker-toggle matSuffix [for]="pInicio" />
          <mat-datepicker #pInicio />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Fin del período</mat-label>
          <input matInput [matDatepicker]="pFin" (click)="pFin.open()" formControlName="periodo_fin" required />
          <mat-datepicker-toggle matSuffix [for]="pFin" />
          <mat-datepicker #pFin />
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Tipo</mat-label>
          <mat-select formControlName="tipo">
            <mat-option value="ambos">Ambos</mat-option>
            <mat-option value="proveedor">Solo proveedores</mat-option>
            <mat-option value="transportador">Solo transportadores</mat-option>
          </mat-select>
        </mat-form-field>
      </form>

      @if (resumenPeriodo()) {
        <p class="resumen-periodo">
          <mat-icon aria-hidden="true">date_range</mat-icon>
          <span>{{ resumenPeriodo() }}</span>
        </p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-generar"
        [disabled]="form.invalid || generando()"
      >
        Generar
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .ayuda {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.85rem;
    }

    .presets {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }

    .resumen-periodo {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 4px 0 0;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.9rem;
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent);
      color: var(--mat-sys-on-surface);

      mat-icon { color: var(--mat-sys-primary); flex-shrink: 0; }
    }
  `,
})
export class GenerarQuincenaDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(LiquidacionesService);
  private readonly dialogRef = inject(MatDialogRef<GenerarQuincenaDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly generando = signal(false);

  private readonly quincena = quincenaAnterior();

  readonly form = this.fb.group({
    periodo_inicio: [isoToDate(this.quincena.inicio) ?? hoyDate(), Validators.required],
    periodo_fin: [isoToDate(this.quincena.fin) ?? hoyDate(), Validators.required],
    tipo: ['ambos' as 'ambos' | 'proveedor' | 'transportador', Validators.required],
  });

  /** Presets de quincenas más usadas, calculados a partir de la fecha de hoy. */
  readonly presets: PresetQuincena[] = this.crearPresets();

  private readonly valores = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /** Resumen legible del período elegido, ej. "Del 1 al 15 de julio de 2026". */
  readonly resumenPeriodo = computed(() => {
    const valores = this.valores();
    const inicio = partesFecha(dateToIso(valores.periodo_inicio));
    const fin = partesFecha(dateToIso(valores.periodo_fin));
    if (!inicio || !fin) return '';
    if (inicio.anio === fin.anio && inicio.mes === fin.mes) {
      return `Del ${inicio.dia} al ${fin.dia} de ${inicio.mes} de ${inicio.anio}`;
    }
    if (inicio.anio === fin.anio) {
      return `Del ${inicio.dia} de ${inicio.mes} al ${fin.dia} de ${fin.mes} de ${inicio.anio}`;
    }
    return `Del ${inicio.dia} de ${inicio.mes} de ${inicio.anio} al ${fin.dia} de ${fin.mes} de ${fin.anio}`;
  });

  aplicarPreset(preset: PresetQuincena): void {
    this.form.patchValue({
      periodo_inicio: isoToDate(preset.rango.inicio)!,
      periodo_fin: isoToDate(preset.rango.fin)!,
    });
  }

  private crearPresets(): PresetQuincena[] {
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = hoy.getMonth();
    return [
      { etiqueta: '1.ª quincena de este mes', rango: rangoQuincena(anio, mes, 1) },
      { etiqueta: '2.ª quincena del mes pasado', rango: rangoQuincena(anio, mes - 1, 2) },
      { etiqueta: '1.ª quincena del mes pasado', rango: rangoQuincena(anio, mes - 1, 1) },
    ];
  }

  async generar(): Promise<void> {
    if (this.form.invalid) return;
    this.generando.set(true);
    try {
      const { periodo_inicio, periodo_fin, tipo } = this.form.getRawValue();
      const generadas = await firstValueFrom(
        this.servicio.generar({
          periodo_inicio: dateToIso(periodo_inicio)!,
          periodo_fin: dateToIso(periodo_fin)!,
          tipo,
        }),
      );
      this.dialogRef.close(generadas.length);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible generar las liquidaciones')
          : 'No fue posible generar las liquidaciones';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.generando.set(false);
    }
  }
}
