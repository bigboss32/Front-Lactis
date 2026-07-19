import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService, QueryParams } from '../../core/api.service';
import { Page, Produccion, TipoQueso } from '../../core/models';

export interface ProduccionPayload {
  fecha: string; // ISO 'YYYY-MM-DD'
  tipo_queso_id: string;
  sucursal_id?: string | null;
  cantidad: number | string;
  peso_kg: number | string;
  litros_usados: number | string;
  merma?: number | string;
  observaciones?: string | null;
  estado?: string;
}

/** Filtros del endpoint GET /produccion/filtrar/avanzado. */
export interface FiltroProduccion extends QueryParams {
  page?: number;
  page_size?: number;
  tipo_queso_id?: string | null;
  desde?: string | null; // ISO 'YYYY-MM-DD'
  hasta?: string | null; // ISO 'YYYY-MM-DD'
}

@Injectable({ providedIn: 'root' })
export class ProduccionService extends CrudService<Produccion, ProduccionPayload> {
  constructor() {
    super('/produccion');
  }

  /** Lista producción con filtros de fecha y tipo de queso (paginado). */
  filtrar(filtros: FiltroProduccion): Observable<Page<Produccion>> {
    return this.api.get<Page<Produccion>>(`${this.base}/filtrar/avanzado`, filtros);
  }
}

export interface TipoQuesoPayload {
  nombre: string;
  descripcion?: string | null;
  precio_referencia: number | string;
  estado?: string;
}

@Injectable({ providedIn: 'root' })
export class TiposQuesoService extends CrudService<TipoQueso, TipoQuesoPayload> {
  constructor() {
    super('/tipos-queso');
  }
}
