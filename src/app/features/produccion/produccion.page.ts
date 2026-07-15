import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';

import { PageHeader } from '../../shared/page-header';
import { ProduccionDiariaTab } from './produccion-diaria.tab';
import { TiposQuesoTab } from './tipos-queso.tab';

/** Página de producción con pestañas: registro diario y catálogo de tipos de queso. */
@Component({
  selector: 'app-produccion-page',
  imports: [MatTabsModule, PageHeader, ProduccionDiariaTab, TiposQuesoTab],
  template: `
    <div class="page">
      <app-page-header
        titulo="Producción"
        subtitulo="Registro diario de producción de queso y catálogo de tipos"
      />

      <mat-tab-group>
        <mat-tab label="Producción diaria">
          <ng-template matTabContent>
            <div class="tab-panel"><app-produccion-diaria-tab /></div>
          </ng-template>
        </mat-tab>
        <mat-tab label="Tipos de queso">
          <ng-template matTabContent>
            <div class="tab-panel"><app-tipos-queso-tab /></div>
          </ng-template>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: `
    .tab-panel { padding-top: 16px; }
  `,
})
export class ProduccionPage {}
