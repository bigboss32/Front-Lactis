import { Component, inject } from '@angular/core';

import { ReventaFiltroService } from './reventa-filtro.service';
import { VentaQuesoListTab } from './venta-list.tab';

/** Sub-página: ventas de queso (usa el filtro de fechas compartido). */
@Component({
  selector: 'app-reventa-ventas',
  imports: [VentaQuesoListTab],
  template: `
    <div class="panel">
      <app-venta-queso-list-tab [desde]="filtro.desdeIso()" [hasta]="filtro.hastaIso()" />
    </div>
  `,
  styles: `.panel { display: block; padding-top: 8px; }`,
})
export class ReventaVentasPage {
  readonly filtro = inject(ReventaFiltroService);
}
