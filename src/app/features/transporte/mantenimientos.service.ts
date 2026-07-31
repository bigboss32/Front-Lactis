import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService, ListOpts } from '../../core/api.service';
import { Page, VehiculoMantenimiento } from '../../core/models';

export const ETIQUETAS_TIPO_MANTENIMIENTO: Record<string, string> = {
  preventivo: 'Preventivo',
  correctivo: 'Correctivo',
};

export interface MantenimientoPayload {
  vehiculo_id: string;
  fecha: string; // ISO 'YYYY-MM-DD'
  tipo: 'preventivo' | 'correctivo';
  descripcion: string;
  taller?: string | null;
  odometro?: number | null;
  valor: number;
  /** Próximo mantenimiento: por odómetro y/o por fecha (para las alertas). */
  proximo_odometro?: number | null;
  proxima_fecha?: string | null;
  estado?: string;
}

/** Filtros de GET /transporte/mantenimientos/filtrar/avanzado. */
export interface MantenimientoFiltro extends ListOpts {
  vehiculo_id?: string | null;
  tipo?: string | null;
  desde?: string | null;
  hasta?: string | null;
}

@Injectable({ providedIn: 'root' })
export class MantenimientosService extends CrudService<VehiculoMantenimiento, MantenimientoPayload> {
  constructor() {
    super('/transporte/mantenimientos');
  }

  /** Listado con filtros por vehículo, tipo y rango de fechas. */
  filtrar(opts: MantenimientoFiltro = {}): Observable<Page<VehiculoMantenimiento>> {
    return this.api.get<Page<VehiculoMantenimiento>>(`${this.base}/filtrar/avanzado`, opts);
  }

  /** Sube la factura del taller (POST /transporte/mantenimientos/{id}/adjunto). */
  adjuntar(id: string, file: File): Observable<VehiculoMantenimiento> {
    return this.api.upload<VehiculoMantenimiento>(`${this.base}/${id}/adjunto`, file);
  }
}
