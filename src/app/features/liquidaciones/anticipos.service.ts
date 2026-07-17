import { Injectable } from '@angular/core';

import { CrudService } from '../../core/api.service';
import { Anticipo } from '../../core/models';

export interface AnticipoCreatePayload {
  tipo: 'proveedor' | 'transportador' | 'empleado';
  proveedor_id?: string;
  transportador_id?: string;
  empleado_id?: string;
  fecha: string; // ISO 'YYYY-MM-DD'
  valor: number | string;
  observaciones?: string | null;
}

export interface AnticipoUpdatePayload {
  fecha?: string;
  valor?: number | string;
  observaciones?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AnticiposService extends CrudService<Anticipo, AnticipoCreatePayload, AnticipoUpdatePayload> {
  constructor() {
    super('/anticipos');
  }
}
