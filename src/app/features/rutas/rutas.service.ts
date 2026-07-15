import { Injectable } from '@angular/core';

import { CrudService } from '../../core/api.service';
import { Ruta } from '../../core/models';

export interface RutaPayload {
  nombre: string;
  municipio?: string | null;
  descripcion?: string | null;
  estado?: string;
}

@Injectable({ providedIn: 'root' })
export class RutasService extends CrudService<Ruta, RutaPayload> {
  constructor() {
    super('/rutas');
  }
}
