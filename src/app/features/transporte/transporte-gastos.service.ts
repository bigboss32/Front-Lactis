import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService, ListOpts } from '../../core/api.service';
import { Page, VehiculoGasto } from '../../core/models';

/** Categorías de gasto del vehículo (constantes del backend). Los documentos
 *  legales (SOAT, seguro…) NO van aquí: tienen su propio registro y bucket. */
export const CATEGORIAS_GASTO_VEHICULO = [
  'combustible',
  'peajes',
  'viaticos',
  'cargue_descargue',
  'lavada',
  'parqueadero',
  'multa',
  'otros',
] as const;

export const ETIQUETAS_CATEGORIA_GASTO: Record<string, string> = {
  combustible: 'Combustible',
  peajes: 'Peajes',
  viaticos: 'Viáticos',
  cargue_descargue: 'Cargue y descargue',
  lavada: 'Lavada',
  parqueadero: 'Parqueadero',
  multa: 'Multa',
  otros: 'Otros',
};

export interface VehiculoGastoPayload {
  vehiculo_id: string;
  /** Null = gasto general del vehículo (no atado a un viaje). */
  viaje_id?: string | null;
  fecha: string; // ISO 'YYYY-MM-DD'
  categoria: string;
  concepto?: string | null;
  valor: number;
  odometro?: number | null;
  estado?: string;
}

/** Filtros de GET /transporte/gastos/filtrar/avanzado. */
export interface VehiculoGastoFiltro extends ListOpts {
  vehiculo_id?: string | null;
  viaje_id?: string | null;
  categoria?: string | null;
  desde?: string | null;
  hasta?: string | null;
  /** Solo gastos sin viaje (generales del vehículo). */
  solo_generales?: boolean;
}

@Injectable({ providedIn: 'root' })
export class TransporteGastosService extends CrudService<VehiculoGasto, VehiculoGastoPayload> {
  constructor() {
    super('/transporte/gastos');
  }

  /** Listado con filtros por vehículo, viaje, categoría y rango de fechas. */
  filtrar(opts: VehiculoGastoFiltro = {}): Observable<Page<VehiculoGasto>> {
    return this.api.get<Page<VehiculoGasto>>(`${this.base}/filtrar/avanzado`, opts);
  }

  /** Sube el recibo o soporte del gasto (POST /transporte/gastos/{id}/adjunto). */
  adjuntar(id: string, file: File): Observable<VehiculoGasto> {
    return this.api.upload<VehiculoGasto>(`${this.base}/${id}/adjunto`, file);
  }
}
