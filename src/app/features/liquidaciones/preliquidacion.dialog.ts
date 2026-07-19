import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { ProveedoresService } from '../proveedores/proveedores.service';
import { TransportadoresService } from '../transportadores/transportadores.service';
import { compartirArchivo, compartirWhatsApp } from '../../shared/compartir';
import { dateToIso } from '../../shared/date-utils';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { OpcionSelect, SelectBuscable } from '../../shared/select-buscable';
import { LiquidacionesService, PreLiquidacion } from './liquidaciones.service';

type TipoTercero = 'proveedor' | 'transportador';

/** Presets de período: [inicio, fin] como Date locales. */
function quincenaActual(): [Date, Date] {
  const h = new Date();
  const y = h.getFullYear();
  const m = h.getMonth();
  return h.getDate() <= 15
    ? [new Date(y, m, 1), new Date(y, m, 15)]
    : [new Date(y, m, 16), new Date(y, m + 1, 0)];
}

function quincenaPasada(): [Date, Date] {
  const h = new Date();
  const y = h.getFullYear();
  const m = h.getMonth();
  return h.getDate() <= 15
    ? [new Date(y, m - 1, 16), new Date(y, m, 0)]
    : [new Date(y, m, 1), new Date(y, m, 15)];
}

function esteMes(): [Date, Date] {
  const h = new Date();
  const y = h.getFullYear();
  const m = h.getMonth();
  return [new Date(y, m, 1), new Date(y, m + 1, 0)];
}

/**
 * Pre-liquidación: le muestra a un proveedor o transportador cómo va en el
 * período con las recepciones aún sin liquidar, sin generar ni guardar nada.
 * Permite compartir un PDF preliminar (no oficial) por WhatsApp, etc.
 */
@Component({
  selector: 'app-preliquidacion-dialog',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatDatepickerModule,
    MatProgressBarModule, MatTableModule, MatTooltipModule, DatePipe, MoneyPipe, CantidadPipe, SelectBuscable,
  ],
  template: `
    <h2 mat-dialog-title>Pre-liquidación · ¿cómo va?</h2>
    <mat-dialog-content>
      <p class="ayuda">
        Calcula el avance de un proveedor o transportador con las recepciones aún
        sin liquidar. No genera ni guarda nada; es solo para consultar.
      </p>

      <div class="presets">
        <button mat-stroked-button type="button" (click)="aplicarPreset('actual')">
          <mat-icon>event</mat-icon> Esta quincena
        </button>
        <button mat-stroked-button type="button" (click)="aplicarPreset('pasada')">
          <mat-icon>event</mat-icon> Quincena pasada
        </button>
        <button mat-stroked-button type="button" (click)="aplicarPreset('mes')">
          <mat-icon>event</mat-icon> Este mes
        </button>
      </div>

      <form [formGroup]="form" class="form-grid" id="form-preliq" (ngSubmit)="calcular()">
        <mat-form-field>
          <mat-label>Tipo</mat-label>
          <mat-select formControlName="tipo">
            <mat-option value="proveedor">Proveedor</mat-option>
            <mat-option value="transportador">Transportador</mat-option>
          </mat-select>
        </mat-form-field>
        <app-select-buscable
          formControlName="tercero_id"
          [opciones]="terceros()"
          [label]="tipoLabel()"
        />
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
      </form>

      @if (calculando()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (sinDatos()) {
        <p class="sin-datos">
          No hay recepciones sin liquidar para ese tercero en el período.
        </p>
      }

      @if (resultado(); as r) {
        <div class="resultado">
          <h3>{{ r.tercero_nombre }}@if (r.tercero_detalle) { <small> · {{ r.tercero_detalle }}</small> }</h3>

          <div class="resumen">
            <span>Total litros</span>
            <span class="num">{{ r.total_litros | cantidad: 'L' }}</span>

            @if (esProveedor()) {
              <span>Precio promedio</span>
              <span class="num">{{ r.precio_promedio | money }}</span>
              <span>Valor bruto</span>
              <span class="num">{{ r.valor_bruto | money }}</span>
              <span>Bonificaciones</span>
              <span class="num">{{ r.bonificaciones | money }}</span>
              <span>Descuentos</span>
              <span class="num">{{ r.descuentos | money }}</span>
            } @else {
              <span>Valor transporte</span>
              <span class="num">{{ r.valor_transporte | money }}</span>
            }

            <span>Anticipos aplicados</span>
            <span class="num">{{ r.anticipos | money }}</span>

            <span class="destacado">Valor total</span>
            <span class="num destacado">{{ r.valor_total | money }}</span>

            <span class="destacado">Saldo estimado</span>
            <span class="num destacado">{{ r.saldo | money }}</span>
          </div>

          @if (r.detalles.length) {
            <h4>Detalle diario</h4>
            <table mat-table [dataSource]="r.detalles" class="detalle">
              <ng-container matColumnDef="fecha">
                <th mat-header-cell *matHeaderCellDef>Fecha</th>
                <td mat-cell *matCellDef="let d">{{ d.fecha | date: 'dd/MM/yyyy' }}</td>
              </ng-container>
              <ng-container matColumnDef="litros">
                <th mat-header-cell *matHeaderCellDef class="num">Litros</th>
                <td mat-cell *matCellDef="let d" class="num">{{ d.litros | cantidad: 'L' }}</td>
              </ng-container>
              <ng-container matColumnDef="valor">
                <th mat-header-cell *matHeaderCellDef class="num">Valor</th>
                <td mat-cell *matCellDef="let d" class="num">{{ d.valor | money }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columnasDetalle"></tr>
              <tr mat-row *matRowDef="let d; columns: columnasDetalle"></tr>
            </table>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cerrar</button>
      @if (resultado()) {
        <button
          mat-stroked-button
          type="button"
          matTooltip="Abre WhatsApp con el resumen en texto"
          (click)="enviarWhatsApp()"
        >
          <mat-icon>chat</mat-icon> WhatsApp
        </button>
        <button
          mat-stroked-button
          type="button"
          [disabled]="compartiendo()"
          (click)="compartir()"
        >
          <mat-icon>share</mat-icon> Compartir PDF
        </button>
      }
      <button
        mat-flat-button
        type="submit"
        form="form-preliq"
        [disabled]="form.invalid || calculando()"
      >
        <mat-icon>calculate</mat-icon> Calcular
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .ayuda { margin: 0 0 12px; color: var(--mat-sys-on-surface-variant); font-size: 0.85rem; }
    .presets { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
    .sin-datos { margin: 12px 0 0; color: var(--mat-sys-on-surface-variant); font-style: italic; }

    .resultado { margin-top: 16px; }
    .resultado h3 { margin: 0 0 8px; font-size: 1rem; font-weight: 600; }
    .resultado h3 small { color: var(--mat-sys-on-surface-variant); font-weight: 400; }
    .resultado h4 { margin: 16px 0 8px; font-size: 0.9rem; font-weight: 500; }

    .resumen {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 32px;
      max-width: 420px;
    }
    .resumen .num { text-align: right; font-variant-numeric: tabular-nums; }
    .resumen .destacado { font-weight: 600; }

    table.detalle { width: 100%; }
    table.detalle .num { text-align: right; font-variant-numeric: tabular-nums; }

    @media (max-width: 560px) { .form-grid { grid-template-columns: 1fr; } }
  `,
})
export class PreLiquidacionDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(LiquidacionesService);
  private readonly proveedoresSrv = inject(ProveedoresService);
  private readonly transportadoresSrv = inject(TransportadoresService);
  private readonly dialogRef = inject(MatDialogRef<PreLiquidacionDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly terceros = signal<OpcionSelect[]>([]);
  readonly resultado = signal<PreLiquidacion | null>(null);
  readonly calculando = signal(false);
  readonly compartiendo = signal(false);
  readonly sinDatos = signal(false);

  readonly columnasDetalle = ['fecha', 'litros', 'valor'];

  private readonly quincena = quincenaActual();

  readonly form = this.fb.group({
    tipo: ['proveedor' as TipoTercero, Validators.required],
    tercero_id: ['', Validators.required],
    periodo_inicio: [this.quincena[0], Validators.required],
    periodo_fin: [this.quincena[1], Validators.required],
  });

  readonly esProveedor = computed(() => this.resultado()?.tipo === 'proveedor');

  tipoLabel(): string {
    return this.form.controls.tipo.value === 'transportador' ? 'Transportador' : 'Proveedor';
  }

  constructor() {
    this.form.controls.tipo.valueChanges.pipe(takeUntilDestroyed()).subscribe((tipo) => {
      this.form.controls.tercero_id.setValue('');
      this.resultado.set(null);
      this.sinDatos.set(false);
      void this.cargarTerceros(tipo);
    });
    void this.cargarTerceros(this.form.controls.tipo.value);
  }

  private async cargarTerceros(tipo: TipoTercero): Promise<void> {
    try {
      let opciones: OpcionSelect[];
      if (tipo === 'proveedor') {
        const pagina = await firstValueFrom(
          this.proveedoresSrv.list({ page_size: 500, estado: 'activo' }),
        );
        opciones = pagina.items.map((t) => ({ id: t.id, nombre: t.nombre }));
      } else {
        const pagina = await firstValueFrom(
          this.transportadoresSrv.list({ page_size: 500, estado: 'activo' }),
        );
        opciones = pagina.items.map((t) => ({ id: t.id, nombre: t.nombre }));
      }
      this.terceros.set(opciones);
    } catch {
      this.terceros.set([]);
    }
  }

  aplicarPreset(cual: 'actual' | 'pasada' | 'mes'): void {
    const [inicio, fin] =
      cual === 'actual' ? quincenaActual() : cual === 'pasada' ? quincenaPasada() : esteMes();
    this.form.patchValue({ periodo_inicio: inicio, periodo_fin: fin });
  }

  async calcular(): Promise<void> {
    if (this.form.invalid) return;
    this.calculando.set(true);
    this.resultado.set(null);
    this.sinDatos.set(false);
    try {
      const filas = await firstValueFrom(this.servicio.previsualizar(this.payload()));
      if (filas.length) this.resultado.set(filas[0]);
      else this.sinDatos.set(true);
    } catch (err) {
      this.snackbar.open(this.mensajeError(err, 'No fue posible calcular la pre-liquidación'), 'OK', {
        duration: 5000,
      });
    } finally {
      this.calculando.set(false);
    }
  }

  async compartir(): Promise<void> {
    this.compartiendo.set(true);
    try {
      const blob = await firstValueFrom(this.servicio.previsualizarPdfBlob(this.payload()));
      const nombre = this.resultado()?.tercero_nombre ?? 'tercero';
      const resultado = await compartirArchivo(
        blob,
        `preliquidacion_${nombre}.pdf`.replace(/\s+/g, '_'),
        `Pre-liquidación de ${nombre}`,
        'Avance preliminar (no oficial).',
      );
      if (resultado === 'descargado') {
        this.snackbar.open(
          'Tu dispositivo no permite compartir directamente; se descargó el PDF',
          'OK',
          { duration: 4000 },
        );
      }
    } catch (err) {
      this.snackbar.open(this.mensajeError(err, 'No fue posible compartir la pre-liquidación'), 'OK', {
        duration: 5000,
      });
    } finally {
      this.compartiendo.set(false);
    }
  }

  /** Abre WhatsApp con un resumen en texto del avance (preliminar). */
  enviarWhatsApp(): void {
    const r = this.resultado();
    if (!r) return;
    const money = (m: unknown) => `$${Number(m).toLocaleString('es-CO')}`;
    const fecha = (iso: string) => iso.split('-').reverse().join('/');
    const valorLinea = this.esProveedor()
      ? `Valor total: ${money(r.valor_total)}`
      : `Transporte: ${money(r.valor_transporte)}`;
    const texto =
      `*Pre-liquidación de ${r.tercero_nombre}*\n` +
      `(avance preliminar, no oficial)\n` +
      `Período: ${fecha(r.periodo_inicio)} al ${fecha(r.periodo_fin)}\n` +
      `Total litros: ${Number(r.total_litros).toLocaleString('es-CO')} L\n` +
      `${valorLinea}\n` +
      `Anticipos: ${money(r.anticipos)}\n` +
      `Saldo estimado: ${money(r.saldo)}`;
    compartirWhatsApp(texto);
  }

  private payload() {
    const v = this.form.getRawValue();
    return {
      periodo_inicio: dateToIso(v.periodo_inicio)!,
      periodo_fin: dateToIso(v.periodo_fin)!,
      tipo: v.tipo,
      tercero_id: v.tercero_id,
    };
  }

  private mensajeError(err: unknown, generico: string): string {
    return err instanceof HttpErrorResponse ? (err.error?.error?.detail ?? generico) : generico;
  }
}
