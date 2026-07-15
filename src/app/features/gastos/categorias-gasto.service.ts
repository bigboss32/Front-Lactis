import { Injectable } from '@angular/core';

import { CrudService } from '../../core/api.service';
import { CategoriaGasto } from '../../core/models';

export interface CategoriaGastoPayload {
  nombre: string;
  descripcion?: string | null;
  estado?: string;
}

@Injectable({ providedIn: 'root' })
export class CategoriasGastoService extends CrudService<CategoriaGasto, CategoriaGastoPayload> {
  constructor() {
    super('/categorias-gasto');
  }
}
