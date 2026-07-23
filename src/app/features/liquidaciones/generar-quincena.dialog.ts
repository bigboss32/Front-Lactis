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
import { protegerCambios } from '../../shared/proteger-cambios';
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
    return { inicio: toIso(new Date(anio, mes, 1)), fin: toIso(new Date(anio, mes, 15)) };
  }
  return {
    inicio: toIso(new Date(anio, mes, 16)),
    fin: toIso(new Date(anio, mes + 1, 0)), // día 0 del mes siguiente = último día del mes
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
        1) Elige el mes y la quincena. 2) Revisa las fechas. 3) Genera. Se agrupan las
        recepciones sin liquidar del período y se descuentan los anticipos pendientes.
      </p>

      <!-- Paso 1: mes -->
      <div class="paso">
        <span class="paso-num">1</span>
        <div class="selector-mes">
          <button mat-icon-button type="button" (click)="mesAnterior()" aria-label="Mes anterior">
            <mat-icon>chevron_left</mat-icon>
          </button>
          <span class="mes">{{ etiquetaMes() }}</span>
          <button mat-icon-button type="button" (click)="mesSiguiente()" aria-label="Mes siguiente">
            <mat-icon>chevron_right</mat-icon>
          </button>
        </div>
      </div>

      <!-- Paso 2: quincena -->
      <div class="quincena-botones">
        <button
          mat-stroked-button
          type="button"
          class="q-btn"
          [class.activa]="quincenaActiva() === 1"
          (click)="aplicarQuincena(1)"
        >
          <mat-icon>event</mat-icon>
          <span>1.ª quincena<small>días {{ diasQ1() }}</small></span>
        </button>
        <button
          mat-stroked-button
          type="button"
          class="q-btn"
          [class.activa]="quincenaActiva() === 2"
          (click)="aplicarQuincena(2)"
        >
          <mat-icon>event</mat-icon>
          <span>2.ª quincena<small>días {{ diasQ2() }}</small></span>
        </button>
      </div>

      <!-- Paso 3: revisar/ajustar fechas -->
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
            <mat-option value="ambos">Ambos (proveedores y transportadores)</mat-option>
            <mat-option value="proveedor">Solo proveedores</mat-option>
            <mat-option value="transportador">Solo transportadores</mat-option>
          </mat-select>
        </mat-form-field>
      </form>

      @if (resumenPeriodo()) {
        <p class="resumen-periodo">
          <mat-icon aria-hidden="true">date_range</mat-icon>
          <span>Se liquidará: <strong>{{ resumenPeriodo() }}</strong></span>
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
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.85rem;
    }

    .paso { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .paso-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      font-size: 0.75rem;
      font-weight: 700;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
    .selector-mes { display: flex; align-items: center; gap: 4px; }
    .selector-mes .mes {
      min-width: 130px;
      text-align: center;
      font-weight: 600;
      text-transform: capitalize;
    }

    .quincena-botones {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin: 4px 0 18px 32px;
    }
    .q-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      height: auto;
      padding: 10px 12px;
      text-align: left;

      span { display: flex; flex-direction: column; line-height: 1.2; }
      small { color: var(--mat-sys-on-surface-variant); font-size: 0.72rem; }
    }
    .q-btn.activa {
      border-color: var(--mat-sys-primary);
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
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
      strong { text-transform: capitalize; }
    }

    @media (max-width: 560px) {
      .quincena-botones { grid-template-columns: 1fr; margin-left: 0; }
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

  /** Mes sobre el que actúan los botones de quincena (por defecto, el del período). */
  readonly mesSel = signal<{ anio: number; mes: number }>({
    anio: Number(this.quincena.inicio.slice(0, 4)),
    mes: Number(this.quincena.inicio.slice(5, 7)) - 1,
  });

  readonly etiquetaMes = computed(() => `${MESES[this.mesSel().mes]} ${this.mesSel().anio}`);
  readonly diasQ1 = computed(() => this.rangoDias(1));
  readonly diasQ2 = computed(() => this.rangoDias(2));

  private readonly valores = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /** Qué quincena del mes seleccionado coincide con las fechas actuales (1, 2 o null). */
  readonly quincenaActiva = computed(() => {
    const v = this.valores();
    const ini = dateToIso(v.periodo_inicio);
    const fin = dateToIso(v.periodo_fin);
    const { anio, mes } = this.mesSel();
    for (const q of [1, 2] as const) {
      const r = rangoQuincena(anio, mes, q);
      if (r.inicio === ini && r.fin === fin) return q;
    }
    return null;
  });

  /** Resumen legible del período elegido, ej. "Del 16 al 31 de julio de 2026". */
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

  constructor() {
    protegerCambios(this.dialogRef, () => this.form);
  }

  mesAnterior(): void {
    const { anio, mes } = this.mesSel();
    this.mesSel.set(mes === 0 ? { anio: anio - 1, mes: 11 } : { anio, mes: mes - 1 });
  }

  mesSiguiente(): void {
    const { anio, mes } = this.mesSel();
    this.mesSel.set(mes === 11 ? { anio: anio + 1, mes: 0 } : { anio, mes: mes + 1 });
  }

  aplicarQuincena(quincena: 1 | 2): void {
    const { anio, mes } = this.mesSel();
    const rango = rangoQuincena(anio, mes, quincena);
    this.form.patchValue({
      periodo_inicio: isoToDate(rango.inicio)!,
      periodo_fin: isoToDate(rango.fin)!,
    });
  }

  /** Días de la quincena del mes seleccionado, ej. "16 al 31". */
  private rangoDias(quincena: 1 | 2): string {
    const { anio, mes } = this.mesSel();
    const r = rangoQuincena(anio, mes, quincena);
    return `${Number(r.inicio.slice(8, 10))} al ${Number(r.fin.slice(8, 10))}`;
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
