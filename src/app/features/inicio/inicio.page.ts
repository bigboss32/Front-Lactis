import { Component, computed, inject } from '@angular/core';
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
  /**
   * Permiso de la acción que anuncia la tarjeta (`modulo:accion`). Para
   * mostrarla se exige además `modulo:consultar`, que es lo que hace falta para
   * abrir el destino; ver el computed `acciones`.
   */
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
        @for (a of acciones(); track a.titulo) {
          <a
            class="accion-card"
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
        } @empty {
          <!-- Sin accesos de la quesera pero CON un negocio aparte: es el caso
               del cliente de reventa, que no usa el resto del ERP. Mandarlo al
               menú lateral sería mandarlo a donde no tiene nada; lo suyo está
               justo debajo, en "Negocios aparte". -->
          @if (!negocios().length) {
            <p class="sin-acciones">
              Tu usuario no tiene accesos directos para mostrar aquí. Abre el menú lateral
              para entrar a los módulos que tienes habilitados.
            </p>
          }
        }
      </div>

      @if (negocios().length) {
        <h2 class="seccion-titulo">Negocios aparte</h2>
        <p class="seccion-desc">
          Llevan su propia contabilidad: nada de lo que registres ahí se mezcla con el libro de
          la quesera.
        </p>
        <div class="acciones-grid">
          @for (a of negocios(); track a.titulo) {
            <a
              class="accion-card"
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
      }

      <a class="ver-stats" *hasPermission="'reportes:consultar'" routerLink="/dashboard">
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

    /* Encabezado de la sección de negocios aparte: separa visualmente estos
       módulos de las tareas de la quesera, que es justo lo que confundía en el
       menú lateral. */
    .seccion-titulo {
      margin: 8px 0 2px;
      font-size: 1.15rem;
      font-weight: 600;
    }
    .seccion-desc {
      margin: 0 0 14px;
      max-width: 62ch;
      color: var(--mat-sys-on-surface-variant);
    }

    /* Texto de respaldo cuando ningún acceso directo pasa el filtro de permisos
       (p. ej. el cliente que solo consulta reventa): así la página no queda con
       un hueco en blanco entre el saludo y el pie. */
    .sin-acciones {
      grid-column: 1 / -1;
      margin: 0;
      max-width: 56ch;
      color: var(--mat-sys-on-surface-variant);
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

  /**
   * Accesos directos que el usuario puede usar DE VERDAD.
   *
   * Antes el filtro estaba en la plantilla (*hasPermission por tarjeta), pero
   * así no había manera de saber si quedaba alguna: a un usuario sin ninguna
   * —el cliente que solo consulta reventa— la cuadrícula le quedaba vacía. Con
   * la lista ya filtrada aquí, la plantilla puede mostrar el texto de respaldo.
   *
   * Se exigen DOS permisos por tarjeta: el de la acción que anuncia (crear) y
   * además `modulo:consultar`, que es lo que piden el menú lateral y el guard
   * de las rutas para dejar entrar a la pantalla. Con solo el primero la página
   * enseñaba una tarjeta que su propio guard rechazaba: con un rol de un único
   * permiso (recepcion:crear) el menú quedaba vacío, se veía una tarjeta a
   * /recepciones y al pulsarla volvía a /inicio con "No tienes acceso a esa
   * sección" — el usuario encerrado en Inicio con un botón inútil.
   *
   * Se resuelve aquí y no en la directiva *hasPermission porque la directiva no
   * interviene en este filtro (las tarjetas se filtran en este computed; la
   * directiva solo envuelve el enlace de estadísticas, que ya pide 'consultar').
   * Hacer que acepte varios permisos sería complejidad sin usar, y además la
   * regla "para abrir una pantalla hace falta consultar" es de la navegación:
   * su sitio es donde se declara a dónde lleva cada tarjeta.
   */
  readonly acciones = computed(() => this.visibles(ACCIONES_RAPIDAS));

  /** Negocios aparte (reventa y transporte) que el usuario puede abrir. */
  readonly negocios = computed(() => this.visibles(NEGOCIOS_APARTE));

  private visibles(lista: AccionRapida[]): AccionRapida[] {
    this.auth.perfil(); // re-evalúa cuando llega el perfil
    return lista.filter((a) => {
      const [modulo, accion] = a.permiso.split(':');
      return (
        this.auth.hasPermission(modulo, accion ?? 'consultar') &&
        this.auth.hasPermission(modulo) // 'consultar': el permiso para entrar
      );
    });
  }
}

/** Catálogo de accesos directos; se filtra por permiso antes de pintarlo. */
const ACCIONES_RAPIDAS: AccionRapida[] = [
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

/**
 * Negocios con contabilidad APARTE de la quesera. Salieron del menú lateral
 * porque ahí los usuarios los confundían con la operación diaria (creían que
 * la reventa y la turbo se mezclaban con el libro de la quesera): ahora se
 * entra solo por aquí y cada módulo navega con sus pestañas internas.
 */
const NEGOCIOS_APARTE: AccionRapida[] = [
  {
    titulo: 'Compra y venta de queso',
    descripcion: 'Compra queso a productores y revéndelo',
    icono: 'swap_horiz', color: CHART_COLORS[5],
    link: '/reventa', permiso: 'reventa:consultar',
    tooltip: 'Abre la reventa de queso (contabilidad aparte de la quesera)',
  },
  {
    titulo: 'Transporte — la turbo',
    descripcion: 'Viajes, fletes, cartera y mantenimiento del camión',
    icono: 'local_shipping', color: CHART_COLORS[8],
    link: '/transporte', permiso: 'transporte:consultar',
    tooltip: 'Abre el transporte (contabilidad aparte de la quesera)',
  },
];
