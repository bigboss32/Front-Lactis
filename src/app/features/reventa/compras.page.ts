import { Component, inject } from '@angular/core';

import { DocumentoReventaListTab } from './documento-list.tab';
import { ReventaFiltroService } from './reventa-filtro.service';

/**
 * Sub-página: facturas de compra a productores (usa el filtro de fechas
 * compartido).
 */
@Component({
  selector: 'app-reventa-compras',
  imports: [DocumentoReventaListTab],
  template: `
    <div class="panel">
      <app-documento-reventa-list
        tipo="compra"
        [desde]="filtro.desdeIso()"
        [hasta]="filtro.hastaIso()"
      />
    </div>
  `,
  styles: `.panel { display: block; padding-top: 8px; }`,
})
export class ReventaComprasPage {
  readonly filtro = inject(ReventaFiltroService);
}
