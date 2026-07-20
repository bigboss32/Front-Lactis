import { Component, inject } from '@angular/core';

import { CompraListTab } from './compra-list.tab';
import { ReventaFiltroService } from './reventa-filtro.service';

/** Sub-página: compras de queso a productores (usa el filtro de fechas compartido). */
@Component({
  selector: 'app-reventa-compras',
  imports: [CompraListTab],
  template: `
    <div class="panel">
      <app-compra-list-tab [desde]="filtro.desdeIso()" [hasta]="filtro.hastaIso()" />
    </div>
  `,
  styles: `.panel { display: block; padding-top: 8px; }`,
})
export class ReventaComprasPage {
  readonly filtro = inject(ReventaFiltroService);
}
