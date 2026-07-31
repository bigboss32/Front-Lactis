import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * Pestañas internas del módulo de transporte. El módulo no está en el menú
 * lateral (es un negocio aparte y ahí se confundía con la operación de la
 * quesera): se entra por su tarjeta del Inicio y se navega con estas pestañas,
 * que van al tope de cada página del módulo.
 */
@Component({
  selector: 'app-transporte-tabs',
  imports: [MatTabsModule, RouterLink, RouterLinkActive],
  template: `
    <nav mat-tab-nav-bar [tabPanel]="panel" class="modulo-tabs">
      @for (t of tabs; track t.route) {
        <a mat-tab-link [routerLink]="t.route" routerLinkActive #rla="routerLinkActive" [active]="rla.isActive">
          {{ t.label }}
        </a>
      }
    </nav>
    <mat-tab-nav-panel #panel />
  `,
  styles: `
    .modulo-tabs { margin-bottom: 18px; }
  `,
})
export class TransporteTabs {
  readonly tabs = [
    { label: 'Viajes', route: '/transporte/viajes' },
    { label: 'Cartera de fletes', route: '/transporte/cartera' },
    { label: 'Vehículos', route: '/transporte/vehiculos' },
    { label: 'Mantenimiento', route: '/transporte/mantenimiento' },
    { label: 'Resumen', route: '/transporte/resumen' },
  ];
}
