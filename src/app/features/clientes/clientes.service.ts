import { Injectable } from '@angular/core';

import { CrudService } from '../../core/api.service';
import { Cliente } from '../../core/models';

export interface ClientePayload {
  nombre: string;
  documento?: string | null;
  telefono?: string | null;
  correo?: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  observaciones?: string | null;
  estado?: string;
}

@Injectable({ providedIn: 'root' })
export class ClientesService extends CrudService<Cliente, ClientePayload> {
  constructor() {
    super('/clientes');
  }
}
