import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { ChartData } from 'chart.js';
import { debounceTime, firstValueFrom, merge } from 'rxjs';

import { Balance, EstadoResultados, LibroDiario } from '../../core/models';
import { AppChart, CHART_COLORS } from '../../shared/chart';
import { PageHeader } from '../../shared/page-header';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { ContabilidadService } from './contabilidad.service';

/** Fecha local en formato ISO 'YYYY-MM-DD' (lo que espera el backend). */
function fechaIso(fecha: Date): string {
  const mes = `${fecha.getMonth() + 1}`.padStart(2, '0');
  const dia = `${fecha.getDate()}`.padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

const ETIQUETAS_ORIGEN: Record<string, string> = {
  venta: 'Venta',
  pago: 'Pago',
  gasto: 'Gasto',
  caja: 'Caja',
  banco: 'Banco',
  recepcion: 'Recepción',
};

@Component({
  selector: 'app-contabilidad-page',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTabsModule, MatTableModule,
    MatFormFieldModule, MatInputModule, MatIconModule, MatProgressBarModule,
    PageHeader, AppChart, MoneyPipe, CantidadPipe,
  ],
  templateUrl: './contabilidad.page.html',
  styles: `
    .rango { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }

    .estado-financiero {
      display: grid;
      grid-template-columns: minmax(320px, 1.2fr) minmax(280px, 1fr);
      gap: 16px;
      align-items: start;
      @media (max-width: 900px) { grid-template-columns: 1fr; }
    }

    .linea {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 6px 0;
      font-variant-numeric: tabular-nums;
    }
    .linea.sub { padding-left: 20px; color: var(--mat-sys-on-surface-variant); }
    .linea.total {
      border-top: 1px solid var(--mat-sys-outline-variant);
      font-weight: 600;
      margin-top: 4px;
      padding-top: 10px;
    }
    .positivo { color: #2e7d32; }
    .negativo { color: #c62828; }
    :host-context(html.dark) {
      .positivo { color: #81c784; }
      .negativo { color: #e57373; }
    }

    .chip-origen {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      background: color-mix(in srgb, currentColor 12%, transparent);
      color: var(--mat-sys-on-surface-variant);
    }

    .tarjetas-balance {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }
    .tarjeta-saldo {
      mat-card-content { padding-top: 16px; }
      .etiqueta { color: var(--mat-sys-on-surface-variant); font-size: 0.85rem; margin: 0; }
      .valor { margin: 4px 0 0; font-size: 1.35rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    }
    .fecha-corte { color: var(--mat-sys-on-surface-variant); font-size: 0.85rem; margin: 0 0 12px; }
    tr.mat-mdc-footer-row { font-weight: 600; }
    .contenido-tab { padding-top: 16px; }
  `,
})
export class ContabilidadPage implements OnInit {
  private readonly servicio = inject(ContabilidadService);

  readonly desde = new FormControl(fechaIso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), {
    nonNullable: true,
  });
  readonly hasta = new FormControl(fechaIso(new Date()), { nonNullable: true });

  readonly cargando = signal(false);
  readonly resultados = signal<EstadoResultados | null>(null);
  readonly libro = signal<LibroDiario | null>(null);
  readonly balance = signal<Balance | null>(null);

  readonly columnasLibro = ['fecha', 'origen', 'concepto', 'ingreso', 'egreso'];

  /** Donut de gastos por categoría para la pestaña de estado de resultados. */
  readonly donutGastos = computed<ChartData<'doughnut'> | null>(() => {
    const er = this.resultados();
    if (!er || er.gastos_por_categoria.length === 0) return null;
    return {
      labels: er.gastos_por_categoria.map((g) => g.categoria),
      datasets: [
        {
          data: er.gastos_por_categoria.map((g) => Number(g.total)),
          backgroundColor: CHART_COLORS,
        },
      ],
    };
  });

  constructor() {
    merge(this.desde.valueChanges, this.hasta.valueChanges)
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.cargar());
  }

  ngOnInit(): void {
    this.cargar();
  }

  etiquetaOrigen(origen: string): string {
    return ETIQUETAS_ORIGEN[origen] ?? origen;
  }

  esPositiva(valor: number | string): boolean {
    return Number(valor) >= 0;
  }

  async cargar(): Promise<void> {
    const desde = this.desde.value;
    const hasta = this.hasta.value;
    if (!desde || !hasta) return;
    this.cargando.set(true);
    try {
      const [resultados, libro, balance] = await Promise.all([
        firstValueFrom(this.servicio.estadoResultados(desde, hasta)),
        firstValueFrom(this.servicio.libroDiario(desde, hasta)),
        firstValueFrom(this.servicio.balance()),
      ]);
      this.resultados.set(resultados);
      this.libro.set(libro);
      this.balance.set(balance);
    } finally {
      this.cargando.set(false);
    }
  }
}
