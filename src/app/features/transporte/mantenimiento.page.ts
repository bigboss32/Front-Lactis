import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';

import { PageHeader } from '../../shared/page-header';
import { DocumentoListTab } from './documento-list.tab';
import { GastoGeneralListTab } from './gasto-general-list.tab';
import { MantenimientoListTab } from './mantenimiento-list.tab';
import { TransporteTabs } from './transporte-tabs';

/**
 * Página de mantenimiento del vehículo con pestañas: mantenimientos, documentos
 * legales (con alertas de vencimiento) y gastos generales (sin viaje).
 */
@Component({
  selector: 'app-mantenimiento-page',
  imports: [MatTabsModule, PageHeader, MantenimientoListTab, DocumentoListTab, GastoGeneralListTab, TransporteTabs],
  template: `
    <div class="page">
      <app-transporte-tabs />
      <app-page-header
        titulo="Mantenimiento"
        subtitulo="Mantenimientos, documentos legales y gastos generales de los vehículos"
      />
      <mat-tab-group>
        <mat-tab label="Mantenimientos">
          <app-mantenimiento-list-tab />
        </mat-tab>
        <mat-tab label="Documentos">
          <app-documento-list-tab />
        </mat-tab>
        <mat-tab label="Gastos generales">
          <app-gasto-general-list-tab />
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
})
export class MantenimientoPage {}
