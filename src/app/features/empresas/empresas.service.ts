import { Injectable } from '@angular/core';

import { CrudService } from '../../core/api.service';
import { Empresa } from '../../core/models';

export interface EmpresaPayload {
  nombre: string;
  nit: string;
  direccion?: string | null;
  ciudad?: string | null;
  departamento?: string | null;
  pais?: string;
  telefono?: string | null;
  correo?: string | null;
  estado?: string;
}

@Injectable({ providedIn: 'root' })
export class EmpresasService extends CrudService<Empresa, EmpresaPayload> {
  constructor() {
    super('/empresas');
  }
}
