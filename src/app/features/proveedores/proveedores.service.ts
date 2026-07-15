import { Injectable } from '@angular/core';

import { CrudService } from '../../core/api.service';
import { Proveedor } from '../../core/models';

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
}
