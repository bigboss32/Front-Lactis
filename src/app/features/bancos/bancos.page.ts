import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';

import { PageHeader } from '../../shared/page-header';
import { CuentaListTab } from './cuenta-list.tab';
import { MovimientoBancarioListTab } from './movimiento-list.tab';

@Component({
  selector: 'app-bancos-page',
  imports: [MatTabsModule, PageHeader, CuentaListTab, MovimientoBancarioListTab],
  template: `
    <div class="page">
      <app-page-header
        titulo="Bancos"
        subtitulo="Cuentas bancarias, movimientos y conciliación"
      />

      <mat-tab-group>
        <mat-tab label="Cuentas">
          <ng-template matTabContent>
            <div class="tab-panel"><app-cuenta-list-tab /></div>
          </ng-template>
        </mat-tab>
        <mat-tab label="Movimientos">
          <ng-template matTabContent>
            <div class="tab-panel"><app-movimiento-bancario-list-tab /></div>
          </ng-template>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: `
    .tab-panel { padding-top: 16px; }
  `,
})
export class BancosPage {}
