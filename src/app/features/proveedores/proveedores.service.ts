import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService, ListOpts } from '../../core/api.service';
import { Page, Proveedor } from '../../core/models';

export interface ProveedorPayload {
  nombre: string;
  documento?: string | null;
  vereda?: string | null;
  municipio?: string | null;
  telefono?: string | null;
  precio_litro: number | string;
  ruta_id?: string | null;
  observaciones?: string | null;
  estado?: string;
}

@Injectable({ providedIn: 'root' })
export class ProveedoresService extends CrudService<Proveedor, ProveedorPayload> {
  constructor() {
    super('/proveedores');
  }

  /** Listado con búsqueda, estado y filtro por ruta. */
  filtrar(opts: ListOpts & { ruta_id?: string | null } = {}): Observable<Page<Proveedor>> {
    return this.api.get<Page<Proveedor>>('/proveedores/filtrar/avanzado', opts);
  }
}
