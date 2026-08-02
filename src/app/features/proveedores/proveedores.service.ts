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

  /**
   * Aparta a un proveedor que dejó de entregar leche. No le borra nada: sus
   * recepciones, liquidaciones y pagos se quedan tal cual, y el backend es el
   * que impide que le entre leche nueva mientras esté así.
   */
  desactivar(id: string): Observable<Proveedor> {
    return this.api.post<Proveedor>(`/proveedores/${id}/desactivar`);
  }

  /** Lo vuelve a habilitar cuando regresa. */
  activar(id: string): Observable<Proveedor> {
    return this.api.post<Proveedor>(`/proveedores/${id}/activar`);
  }
}
