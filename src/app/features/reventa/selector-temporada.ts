import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';

import { Monto } from '../../core/models';
import { dateToIso, isoToDate } from '../../shared/date-utils';
import { MoneyPipe } from '../../shared/pipes';
import { ReventaFiltroService } from './reventa-filtro.service';
import { ReventaService, TemporadaResumen } from './reventa.service';

/**
 * Botón de la barra de filtros que lista las temporadas CON SU GANANCIA y, al
 * escoger una, pone el rango de fechas en el filtro compartido.
 *
 * Es el atajo para "cuánto gané en tal temporada" sin acordarse de las fechas ni
 * teclearlas: se ve la cifra en el propio menú y, si se escoge, todo el Resumen
 * (desgloses, productores, productos) se recalcula para esas fechas.
 *
 * La consulta se hace la PRIMERA VEZ que se abre el menú, no al cargar la
 * página: quien nunca lo usa no paga un viaje al servidor en cada pantalla de
 * reventa, y en el campo la señal es mala.
 */
@Component({
  selector: 'app-selector-temporada',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, RouterLink, MoneyPipe],
  template: `
    <button
      mat-stroked-button
      type="button"
      class="boton-temporada"
      [class.activa]="!!temporadaActiva()"
      [matMenuTriggerFor]="menu"
      (menuOpened)="alAbrir()"
    >
      <mat-icon>event_repeat</mat-icon>
      {{ temporadaActiva()?.nombre ?? 'Temporada' }}
      <mat-icon iconPositionEnd>arrow_drop_down</mat-icon>
    </button>

    <mat-menu #menu class="menu-temporadas">
      @if (cargando()) {
        <span class="estado" mat-menu-item disabled>Consultando…</span>
      } @else if (error()) {
        <button mat-menu-item (click)="cargar()">
          <mat-icon>refresh</mat-icon>
          <span>No se pudo consultar. Reintentar</span>
        </button>
      } @else if (temporadas().length === 0) {
        <span class="estado" mat-menu-item disabled>Todavía no hay temporadas</span>
        <a mat-menu-item routerLink="/reventa/temporadas">
          <mat-icon>add</mat-icon>
          <span>Crear la primera</span>
        </a>
      } @else {
        @for (t of temporadas(); track t.id) {
          <button mat-menu-item (click)="aplicar(t)" [class.elegida]="t.id === temporadaActiva()?.id">
            <mat-icon>{{ t.abierta ? 'play_circle' : 'check_circle' }}</mat-icon>
            <span class="fila">
              <span class="nombre">{{ t.nombre }}</span>
              <span class="cifra" [class.perdida]="esPerdida(t)">{{ t.ganancia | money }}</span>
            </span>
          </button>
        }
        <a mat-menu-item routerLink="/reventa/temporadas">
          <mat-icon>open_in_new</mat-icon>
          <span>Ver todas con su detalle</span>
        </a>
      }
    </mat-menu>
  `,
  styles: `
    .boton-temporada {
      line-height: 30px;
      padding: 0 10px;
      min-width: 0;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .boton-temporada.activa {
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      color: var(--mat-sys-primary);
    }
    .estado { color: var(--mat-sys-on-surface-variant); font-size: 0.85rem; }
    .fila {
      display: flex;
      align-items: baseline;
      gap: 14px;
      min-width: 230px;
    }
    .fila .nombre {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .fila .cifra {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--mat-sys-primary);
    }
    .fila .cifra.perdida { color: var(--mat-sys-error); }
    .elegida { background: var(--mat-sys-surface-container-high); }
  `,
})
export class SelectorTemporada {
  private readonly servicio = inject(ReventaService);
  private readonly filtro = inject(ReventaFiltroService);

  readonly temporadas = signal<TemporadaResumen[]>([]);
  readonly cargando = signal(false);
  readonly error = signal(false);
  private cargado = false;

  /**
   * La temporada cuyo rango coincide EXACTO con el filtro puesto, si hay alguna.
   *
   * Mira primero lo que este componente cargó y, si todavía no ha cargado nada,
   * la caché compartida del filtro (la llena la pantalla de Temporadas). Así, al
   * entrar al Resumen desde una temporada, el botón muestra su nombre de una.
   *
   * Se compara en texto ISO y no con Date porque dos Date del mismo día no son
   * iguales entre sí (llevan hora) y el botón nunca se marcaría.
   */
  readonly temporadaActiva = computed(() => {
    const desde = this.filtro.desdeIso();
    const hasta = this.filtro.hastaIso();
    if (!desde || !hasta) return null;
    const propias = this.temporadas();
    const donde = propias.length ? propias : this.filtro.temporadasConocidas();
    return donde.find((t) => t.fecha_inicio === desde && t.fecha_fin === hasta) ?? null;
  });

  esPerdida(t: TemporadaResumen): boolean {
    return Number(t.ganancia as Monto) < 0;
  }

  alAbrir(): void {
    if (!this.cargado) this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set(false);
    this.servicio.temporadas().subscribe({
      next: (p) => {
        this.temporadas.set(p.temporadas);
        this.cargado = true;
        this.cargando.set(false);
      },
      error: () => {
        // No se marca como cargado: así el siguiente intento vuelve a consultar
        this.error.set(true);
        this.cargando.set(false);
      },
    });
  }

  aplicar(t: TemporadaResumen): void {
    this.filtro.desde.setValue(isoToDate(t.fecha_inicio));
    this.filtro.hasta.setValue(isoToDate(t.fecha_fin));
  }

  /** Por si en el futuro hace falta el ISO del rango puesto. */
  protected isoDe(fecha: Date | null): string | null {
    return dateToIso(fecha);
  }
}
