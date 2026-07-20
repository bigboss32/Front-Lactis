import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { CHART_COLORS } from '../../shared/chart';

/** Tarjeta-botón de acceso rápido. */
interface AccionRapida {
  titulo: string;
  descripcion: string;
  icono: string;
  color: string;
  link: string;
  permiso: string;
  tooltip: string;
}

/** Página de inicio: bienvenida + accesos directos a las tareas del día. */
@Component({
  selector: 'app-inicio-page',
  imports: [MatIconModule, MatTooltipModule, RouterLink, HasPermissionDirective],
  template: `
    <div class="page">
      <header class="bienvenida">
        <h1>Hola{{ auth.perfil()?.nombre ? ', ' + auth.perfil()?.nombre : '' }} 👋</h1>
        <p>Bienvenido a Lactis. ¿Qué quieres hacer hoy?</p>
      </header>

      <div class="acciones-grid">
        @for (a of acciones; track a.titulo) {
          <a
            class="accion-card"
            *hasPermission="a.permiso"
            [routerLink]="a.link"
            [style.--acento]="a.color"
            [matTooltip]="a.tooltip"
          >
            <div class="accion-icono">
              <mat-icon aria-hidden="true">{{ a.icono }}</mat-icon>
            </div>
            <div class="accion-texto">
              <p class="accion-titulo">{{ a.titulo }}</p>
              <p class="accion-desc">{{ a.descripcion }}</p>
            </div>
          </a>
        }
      </div>

      <a class="ver-stats" routerLink="/dashboard">
        <mat-icon>insights</mat-icon> Ver estadísticas del negocio
      </a>
    </div>
  `,
  styles: `
    .bienvenida {
      margin-bottom: 22px;
      h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
      p { margin: 4px 0 0; color: var(--mat-sys-on-surface-variant); }
    }

    .acciones-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }

    .accion-card {
      display: flex;
      align-items: center;
      gap: 14px;
      min-height: 92px;
      padding: 18px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-left: 6px solid var(--acento, var(--mat-sys-primary));
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);
      text-decoration: none;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;

      .accion-icono {
        width: 54px;
        height: 54px;
        border-radius: 14px;
        display: grid;
        place-items: center;
        flex-shrink: 0;
        background: color-mix(in srgb, var(--acento, var(--mat-sys-primary)) 16%, transparent);

        mat-icon {
          font-size: 30px;
          width: 30px;
          height: 30px;
          color: var(--acento, var(--mat-sys-primary));
        }
      }

      .accion-texto { min-width: 0; }
      .accion-titulo { margin: 0; font-size: 1rem; font-weight: 600; }
      .accion-desc { margin: 2px 0 0; font-size: 0.82rem; color: var(--mat-sys-on-surface-variant); }

      &:hover,
      &:focus-visible {
        transform: translateY(-3px);
        box-shadow: var(--mat-sys-level2, 0 2px 6px 2px rgba(0, 0, 0, 0.15));
        background: color-mix(
          in srgb,
          var(--acento, var(--mat-sys-primary)) 8%,
          var(--mat-sys-surface-container-low)
        );
      }
    }

    .ver-stats {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--mat-sys-primary);
      text-decoration: none;
      font-weight: 500;

      &:hover { text-decoration: underline; }
      mat-icon { font-size: 20px; width: 20px; height: 20px; }
    }
  `,
})
export class InicioPage {
  readonly auth = inject(AuthService);

  readonly acciones: AccionRapida[] = [
    {
      titulo: 'Registrar leche de hoy',
      descripcion: 'Anota los litros que entrega cada proveedor',
      icono: 'water_drop', color: CHART_COLORS[0],
      link: '/recepciones', permiso: 'recepcion:crear',
      tooltip: 'Abre el módulo de recepciones de leche',
    },
    {
      titulo: 'Generar liquidación',
      descripcion: 'Calcula el pago a proveedores y transportadores',
      icono: 'request_quote', color: CHART_COLORS[7],
      link: '/liquidaciones', permiso: 'liquidaciones:crear',
      tooltip: 'Abre el módulo de liquidaciones',
    },
    {
      titulo: 'Registrar venta',
      descripcion: 'Crea una factura o remisión para un cliente',
      icono: 'point_of_sale', color: CHART_COLORS[1],
      link: '/ventas', permiso: 'ventas:crear',
      tooltip: 'Abre el módulo de ventas',
    },
    {
      titulo: 'Compra y venta de queso',
      descripcion: 'Compra queso a productores y revéndelo',
      icono: 'swap_horiz', color: CHART_COLORS[5],
      link: '/reventa', permiso: 'reventa:crear',
      tooltip: 'Abre compra y venta de queso (reventa)',
    },
    {
      titulo: 'Registrar gasto',
      descripcion: 'Guarda una compra o un pago del negocio',
      icono: 'receipt_long', color: CHART_COLORS[6],
      link: '/gastos', permiso: 'gastos:crear',
      tooltip: 'Abre el módulo de gastos',
    },
    {
      titulo: 'Movimiento de caja',
      descripcion: 'Registra entradas y salidas de efectivo',
      icono: 'savings', color: CHART_COLORS[2],
      link: '/caja', permiso: 'caja:crear',
      tooltip: 'Abre el módulo de caja diaria',
    },
    {
      titulo: 'Ver inventario',
      descripcion: 'Consulta las existencias de productos e insumos',
      icono: 'inventory_2', color: CHART_COLORS[4],
      link: '/inventario', permiso: 'inventario:consultar',
      tooltip: 'Abre el módulo de inventario',
    },
  ];
}
