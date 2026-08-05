import { Component, inject } from '@angular/core';

import { DocumentoReventaListTab } from './documento-list.tab';
import { ReventaFiltroService } from './reventa-filtro.service';

/** Sub-página: facturas de venta de reventa (usa el filtro de fechas compartido). */
@Component({
  selector: 'app-reventa-ventas',
  imports: [DocumentoReventaListTab],
  template: `
    <div class="panel">
      <app-documento-reventa-list
        tipo="venta"
        [desde]="filtro.desdeIso()"
        [hasta]="filtro.hastaIso()"
      />
    </div>
  `,
  styles: `.panel { display: block; padding-top: 8px; }`,
})
export class ReventaVentasPage {
  readonly filtro = inject(ReventaFiltroService);
}
