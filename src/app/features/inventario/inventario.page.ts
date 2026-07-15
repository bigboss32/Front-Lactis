import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';

import { PageHeader } from '../../shared/page-header';
import { MovimientoListTab } from './movimiento-list.tab';
import { ProductoListTab } from './producto-list.tab';
import { StockListTab } from './stock-list.tab';

@Component({
  selector: 'app-inventario-page',
  imports: [MatTabsModule, PageHeader, StockListTab, MovimientoListTab, ProductoListTab],
  template: `
    <div class="page">
      <app-page-header
        titulo="Inventario"
        subtitulo="Stock actual, movimientos y catálogo de productos"
      />

      <mat-tab-group>
        <mat-tab label="Stock">
          <ng-template matTabContent>
            <div class="tab-panel"><app-stock-list-tab /></div>
          </ng-template>
        </mat-tab>
        <mat-tab label="Movimientos">
          <ng-template matTabContent>
            <div class="tab-panel"><app-movimiento-list-tab /></div>
          </ng-template>
        </mat-tab>
        <mat-tab label="Productos">
          <ng-template matTabContent>
            <div class="tab-panel"><app-producto-list-tab /></div>
          </ng-template>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: `
    .tab-panel { padding-top: 16px; }
  `,
})
export class InventarioPage {}
