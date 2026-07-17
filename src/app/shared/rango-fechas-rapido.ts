import { Component, input } from '@angular/core';
import { FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';

type Rango = 'hoy' | 'quincena' | 'mes' | 'mesPasado';

/**
 * Chips para fijar rápido el rango de fechas de un listado/reporte.
 * Uso: <app-rango-fechas-rapido [desde]="desde" [hasta]="hasta" />
 * (desde/hasta son los mismos FormControl<Date|null> de la pantalla).
 */
@Component({
  selector: 'app-rango-fechas-rapido',
  imports: [MatButtonModule],
  template: `
    <div class="rangos">
      <span class="etiqueta">Rápido:</span>
      <button mat-stroked-button type="button" (click)="aplicar('hoy')">Hoy</button>
      <button mat-stroked-button type="button" (click)="aplicar('quincena')">Esta quincena</button>
      <button mat-stroked-button type="button" (click)="aplicar('mes')">Este mes</button>
      <button mat-stroked-button type="button" (click)="aplicar('mesPasado')">Mes pasado</button>
    </div>
  `,
  styles: `
    .rangos {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .etiqueta {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8rem;
      margin-right: 2px;
    }
    button {
      --mat-standard-button-toggle-height: 32px;
      line-height: 30px;
      padding: 0 12px;
      min-width: 0;
    }
  `,
})
export class RangoFechasRapido {
  readonly desde = input.required<FormControl<Date | null>>();
  readonly hasta = input.required<FormControl<Date | null>>();

  aplicar(rango: Rango): void {
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = hoy.getMonth();
    let desde: Date;
    let hasta: Date = hoy;

    switch (rango) {
      case 'hoy':
        desde = hoy;
        break;
      case 'quincena':
        desde = new Date(y, m, hoy.getDate() <= 15 ? 1 : 16);
        break;
      case 'mes':
        desde = new Date(y, m, 1);
        break;
      case 'mesPasado':
        desde = new Date(y, m - 1, 1);
        hasta = new Date(y, m, 0); // último día del mes pasado
        break;
    }

    this.desde().setValue(desde);
    this.hasta().setValue(hasta);
  }
}
