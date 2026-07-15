import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import {
  Chart,
  ChartData,
  ChartOptions,
  ChartType,
  registerables,
} from 'chart.js';

import { ThemeService } from '../core/theme.service';

Chart.register(...registerables);

/** Paleta corporativa para las series de los gráficos. */
export const CHART_COLORS = [
  '#1565c0', '#2e7d32', '#f9a825', '#c62828', '#6a1b9a',
  '#00838f', '#ef6c00', '#4527a0', '#558b2f', '#ad1457',
];

/**
 * Envoltorio de Chart.js con signals: re-renderiza al cambiar datos o tema.
 * Uso: <app-chart type="line" [data]="datos()" [options]="opciones" />
 */
@Component({
  selector: 'app-chart',
  template: `<div class="lienzo"><canvas #lienzo></canvas></div>`,
  styles: `
    :host { display: block; }
    .lienzo { position: relative; height: 280px; }
  `,
})
export class AppChart implements AfterViewInit, OnDestroy {
  private readonly theme = inject(ThemeService);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('lienzo');

  readonly type = input.required<ChartType>();
  readonly data = input.required<ChartData>();
  readonly options = input<ChartOptions>({});

  private chart: Chart | null = null;
  private listo = false;

  constructor() {
    effect(() => {
      this.data();
      this.theme.dark();
      if (this.listo) this.render();
    });
  }

  ngAfterViewInit(): void {
    this.listo = true;
    this.render();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private render(): void {
    this.chart?.destroy();
    const texto = this.theme.dark() ? '#e0e0e0' : '#424242';
    const grid = this.theme.dark() ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)';
    Chart.defaults.color = texto;
    Chart.defaults.borderColor = grid;
    this.chart = new Chart(this.canvas().nativeElement, {
      type: this.type(),
      data: this.data(),
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        ...this.options(),
      },
    });
  }
}
