import { Component, computed, inject, input, model, signal } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Page, PermisoRbac } from '../../core/models';

/** Acciones del RBAC del backend, en el orden de las columnas de la matriz. */
const ACCIONES = [
  'crear',
  'editar',
  'eliminar',
  'consultar',
  'exportar',
  'imprimir',
  'administrar',
];

/**
 * Matriz de checkboxes módulo × acción construida desde el catálogo GET /permisos.
 * Expone los ids seleccionados como model() para enlace bidireccional.
 */
@Component({
  selector: 'app-permisos-matriz',
  imports: [MatCheckboxModule, MatProgressBarModule],
  template: `
    @if (cargando()) {
      <mat-progress-bar mode="indeterminate" />
    }
    <div class="matriz-scroll">
      <table class="matriz">
        <thead>
          <tr>
            <th class="modulo">Módulo</th>
            @for (accion of acciones; track accion) {
              <th>{{ accion }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (modulo of modulos(); track modulo) {
            <tr>
              <td class="modulo">{{ modulo }}</td>
              @for (accion of acciones; track accion) {
                <td class="celda">
                  @if (permisoDe(modulo, accion); as permiso) {
                    <mat-checkbox
                      [checked]="estaSeleccionado(permiso.id)"
                      [disabled]="deshabilitado()"
                      (change)="alternar(permiso.id, $event.checked)"
                    />
                  } @else {
                    <span class="sin-permiso">—</span>
                  }
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .matriz-scroll { overflow-x: auto; }
    .matriz {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;

      th, td {
        padding: 2px 8px;
        border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
      }
      th {
        text-transform: capitalize;
        font-weight: 500;
        color: var(--mat-sys-on-surface-variant);
        text-align: center;
        padding: 8px;
      }
      th.modulo, td.modulo { text-align: left; }
      td.modulo {
        text-transform: capitalize;
        font-weight: 500;
        white-space: nowrap;
      }
      td.celda { text-align: center; }
      .sin-permiso { color: var(--mat-sys-on-surface-variant); opacity: 0.4; }
    }
  `,
})
export class PermisosMatriz {
  private readonly api = inject(ApiService);

  /** Ids de permisos marcados (enlace bidireccional con [(seleccionados)]). */
  readonly seleccionados = model<string[]>([]);
  readonly deshabilitado = input(false);

  readonly acciones = ACCIONES;
  readonly cargando = signal(true);
  private readonly permisos = signal<PermisoRbac[]>([]);

  readonly modulos = computed(() =>
    [...new Set(this.permisos().map((permiso) => permiso.modulo))].sort((a, b) =>
      a.localeCompare(b),
    ),
  );

  private readonly porCelda = computed(() => {
    const mapa = new Map<string, PermisoRbac>();
    for (const permiso of this.permisos()) {
      mapa.set(`${permiso.modulo}:${permiso.accion}`, permiso);
    }
    return mapa;
  });

  constructor() {
    firstValueFrom(this.api.get<Page<PermisoRbac>>('/permisos', { page_size: 200 }))
      .then((page) => this.permisos.set(page.items))
      .finally(() => this.cargando.set(false));
  }

  permisoDe(modulo: string, accion: string): PermisoRbac | undefined {
    return this.porCelda().get(`${modulo}:${accion}`);
  }

  estaSeleccionado(id: string): boolean {
    return this.seleccionados().includes(id);
  }

  alternar(id: string, marcado: boolean): void {
    const ids = new Set(this.seleccionados());
    if (marcado) {
      ids.add(id);
    } else {
      ids.delete(id);
    }
    this.seleccionados.set([...ids]);
  }
}
