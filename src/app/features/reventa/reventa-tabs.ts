import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * Pestañas internas del módulo de reventa. El módulo no está en el menú
 * lateral (es un negocio aparte y ahí se confundía con la operación de la
 * quesera): se entra por su tarjeta del Inicio y se navega con estas pestañas,
 * que van al tope de la shell y de las páginas que viven fuera de ella
 * (lotes, temporadas y libro anterior).
 */
@Component({
  selector: 'app-reventa-tabs',
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
export class ReventaTabs {
  readonly tabs = [
    { label: 'Resumen', route: '/reventa/resumen' },
    { label: 'Compras', route: '/reventa/compras' },
    { label: 'Ventas', route: '/reventa/ventas' },
    { label: 'Ajustes', route: '/reventa/ajustes' },
    { label: 'Ganancia por lote', route: '/reventa/lotes' },
    { label: 'Temporadas', route: '/reventa/temporadas' },
    { label: 'Libro anterior', route: '/reventa/libro-anterior' },
  ];
}
