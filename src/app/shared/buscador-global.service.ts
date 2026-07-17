import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth/auth.service';
import { NAV_GROUPS } from '../core/layout/nav';
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
    return NAV_GROUPS.flatMap((g) => g.items)
      .filter((item) => (item.siempre || this.auth.hasPermission(item.modulo)) && item.label.toLowerCase().includes(f))
      .map((item) => ({ grupo: 'Ir a', icono: item.icon, label: item.label, route: item.route }));
  }

  /** Registros reales (proveedores, clientes, productos) usando los buscadores existentes. */
  registros(q: string): Observable<ResultadoBusqueda[]> {
    const opts = { search: q, page_size: 5, estado: 'activo' };
    const vacio = of<Page<Entidad>>({ items: [], total: 0, page: 1, page_size: 5, pages: 0 });

    return forkJoin({
      proveedores: this.api
        .get<Page<Entidad>>('/proveedores/filtrar/avanzado', opts)
        .pipe(catchError(() => vacio)),
      clientes: this.api.get<Page<Entidad>>('/clientes', opts).pipe(catchError(() => vacio)),
      productos: this.api
        .get<Page<Entidad>>('/inventario/productos', opts)
        .pipe(catchError(() => vacio)),
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
