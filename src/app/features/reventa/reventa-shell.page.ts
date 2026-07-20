import { Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterOutlet } from '@angular/router';

import { PageHeader } from '../../shared/page-header';
import { RangoFechasRapido } from '../../shared/rango-fechas-rapido';
import { ReventaFiltroService } from './reventa-filtro.service';

/**
 * Contenedor del módulo de reventa: encabezado + filtro de fechas compartido y
 * un router-outlet para las sub-páginas (Resumen, Compras, Ventas, Ajustes).
 */
@Component({
  selector: 'app-reventa-shell',
  imports: [
    ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatDatepickerModule,
    RouterOutlet, PageHeader, RangoFechasRapido,
  ],
  template: `
    <div class="page">
      <app-page-header
        titulo="Compra y venta de queso"
        subtitulo="Queso comprado a productores para revender; contabilidad separada del libro de la quesera"
      />

      <div class="page-toolbar">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Desde</mat-label>
          <input matInput [matDatepicker]="pDesde" (click)="pDesde.open()" [formControl]="filtro.desde" />
          <mat-datepicker-toggle matSuffix [for]="pDesde" />
          <mat-datepicker #pDesde />
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Hasta</mat-label>
          <input matInput [matDatepicker]="pHasta" (click)="pHasta.open()" [formControl]="filtro.hasta" />
          <mat-datepicker-toggle matSuffix [for]="pHasta" />
          <mat-datepicker #pHasta />
        </mat-form-field>
        <app-rango-fechas-rapido [desde]="filtro.desde" [hasta]="filtro.hasta" />
      </div>

      <router-outlet />
    </div>
  `,
})
export class ReventaShellPage {
  readonly filtro = inject(ReventaFiltroService);
}
