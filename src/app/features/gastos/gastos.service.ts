import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService, ListOpts } from '../../core/api.service';
import { Gasto, Page } from '../../core/models';

export interface GastoPayload {
  fecha: string; // ISO 'YYYY-MM-DD'
  categoria_id: string;
  concepto: string;
  proveedor?: string | null;
  valor: number | string;
  numero_factura?: string | null;
  observaciones?: string | null;
  sucursal_id?: string | null;
  estado?: string;
}

/** Filtros del listado avanzado GET /gastos/filtrar/avanzado. */
export interface GastoFiltro extends ListOpts {
  categoria_id?: string | null;
  desde?: string | null;
  hasta?: string | null;
}

@Injectable({ providedIn: 'root' })
export class GastosService extends CrudService<Gasto, GastoPayload> {
  constructor() {
    super('/gastos');
  }

  /** Listado con filtros por categoría y rango de fechas. */
  filtrar(opts: GastoFiltro = {}): Observable<Page<Gasto>> {
    return this.api.get<Page<Gasto>>(`${this.base}/filtrar/avanzado`, opts);
  }

  /** Sube la factura o soporte del gasto (POST /gastos/{id}/adjunto). */
  adjuntar(id: string, file: File): Observable<Gasto> {
    return this.api.upload<Gasto>(`${this.base}/${id}/adjunto`, file);
  }
}
