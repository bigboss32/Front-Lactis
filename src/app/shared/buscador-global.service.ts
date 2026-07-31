import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth/auth.service';
import { NAV_GROUPS, SECCIONES_OCULTAS } from '../core/layout/nav';
import { Page } from '../core/models';

export interface ResultadoBusqueda {
  grupo: string;
  icono: string;
  label: string;
  sublabel?: string;
  route: string;
  /** Clave de filtro para prefiltrar el listado destino (opcional). */
  claveFiltro?: string;
  termino?: string;
}

/** Forma mínima de una entidad buscable. */
interface Entidad {
  id: string;
  nombre: string;
  documento?: string | null;
  telefono?: string | null;
  vereda?: string | null;
  categoria_nombre?: string | null;
}

@Injectable({ providedIn: 'root' })
export class BuscadorGlobalService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  /** Secciones/módulos accesibles cuyo nombre coincide con el texto. */
  secciones(q: string): ResultadoBusqueda[] {
    const f = q.toLowerCase().trim();
    if (!f) return [];
    return [...NAV_GROUPS.flatMap((g) => g.items), ...SECCIONES_OCULTAS]
      .filter((item) => (item.siempre || this.auth.hasPermission(item.modulo)) && item.label.toLowerCase().includes(f))
      .map((item) => ({ grupo: 'Ir a', icono: item.icon, label: item.label, route: item.route }));
  }

  /** Módulos que consulta la búsqueda de registros, con el permiso que exige cada uno. */
  private readonly MODULOS_BUSCABLES = ['proveedores', 'clientes', 'inventario'] as const;

  /**
   * ¿Tiene sentido buscar registros para este usuario?
   *
   * La barra sigue siendo útil aunque sea `false`: la búsqueda de secciones
   * funciona igual (y 'Inicio' está marcado como `siempre` en NAV_GROUPS, así
   * que nunca se queda sin nada que ofrecer). Por eso no se esconde la barra
   * entera —además de que Ctrl+K y '/' son de la aplicación, no del módulo—;
   * simplemente no se pide a la API lo que el usuario no puede ver.
   */
  puedeBuscarRegistros(): boolean {
    return this.MODULOS_BUSCABLES.some((m) => this.auth.hasPermission(m));
  }

  /**
   * Registros reales (proveedores, clientes, productos) usando los buscadores existentes.
   *
   * Cada rama se pide SOLO con su permiso `modulo:consultar`, igual que ya hacía
   * `secciones()`. Antes se pedían siempre las tres: al cliente que solo tiene
   * el módulo de reventa cada tecla le disparaba tres 403 contra la API para
   * acabar mostrando "Sin resultados".
   */
  registros(q: string): Observable<ResultadoBusqueda[]> {
    if (!this.puedeBuscarRegistros()) return of<ResultadoBusqueda[]>([]);

    const opts = { search: q, page_size: 5, estado: 'activo' };
    const vacio = of<Page<Entidad>>({ items: [], total: 0, page: 1, page_size: 5, pages: 0 });
    // catchError sigue ahí para los fallos de red y para el caso en que el
    // backend sea más estricto que el perfil: una rama caída no debe tumbar
    // el forkJoin y dejar la barra sin resultados de las demás.
    const siPuede = (modulo: string, ruta: string) =>
      this.auth.hasPermission(modulo)
        ? this.api.get<Page<Entidad>>(ruta, opts).pipe(catchError(() => vacio))
        : vacio;

    return forkJoin({
      proveedores: siPuede('proveedores', '/proveedores/filtrar/avanzado'),
      clientes: siPuede('clientes', '/clientes'),
      productos: siPuede('inventario', '/inventario/productos'),
    }).pipe(
      map(({ proveedores, clientes, productos }) => [
        ...proveedores.items.map((p) => this.aResultado(p, 'Proveedores', 'agriculture', '/proveedores', 'proveedores', p.vereda)),
        ...clientes.items.map((c) => this.aResultado(c, 'Clientes', 'group', '/clientes', 'clientes', c.telefono ?? c.documento)),
        ...productos.items.map((p) => this.aResultado(p, 'Productos', 'inventory_2', '/inventario', 'inventario-productos', p.categoria_nombre)),
      ]),
    );
  }

  private aResultado(
    e: Entidad,
    grupo: string,
    icono: string,
    route: string,
    claveFiltro: string,
    sublabel?: string | null,
  ): ResultadoBusqueda {
    return { grupo, icono, label: e.nombre, sublabel: sublabel ?? undefined, route, claveFiltro, termino: e.nombre };
  }
}
