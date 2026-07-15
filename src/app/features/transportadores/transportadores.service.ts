import { Injectable } from '@angular/core';

import { CrudService } from '../../core/api.service';
import { Transportador } from '../../core/models';

export interface TransportadorPayload {
  nombre: string;
  documento?: string | null;
  telefono?: string | null;
  ruta_id?: string | null;
  valor_transporte: number | string;
  estado?: string;
}

@Injectable({ providedIn: 'root' })
export class TransportadoresService extends CrudService<Transportador, TransportadorPayload> {
  constructor() {
    super('/transportadores');
  }
}
