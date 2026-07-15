import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';

import { PageHeader } from '../../shared/page-header';
import { CategoriaGastoListPage } from './categoria-gasto-list.page';
import { GastoListPage } from './gasto-list.page';

/** Página de gastos con pestañas: registro de gastos y catálogo de categorías. */
@Component({
  selector: 'app-gastos-page',
  imports: [MatTabsModule, PageHeader, GastoListPage, CategoriaGastoListPage],
  template: `
    <div class="page">
      <app-page-header
        titulo="Gastos"
        subtitulo="Registro de gastos operativos y sus categorías"
      />
      <mat-tab-group>
        <mat-tab label="Gastos">
          <app-gasto-list />
        </mat-tab>
        <mat-tab label="Categorías">
          <app-categoria-gasto-list />
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
})
export class GastosPage {}
