import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService, QueryParams } from '../../core/api.service';
import { AlertasTransporte, Vehiculo } from '../../core/models';

export interface VehiculoPayload {
  placa: string;
  nombre?: string | null;
  marca?: string | null;
  linea?: string | null;
  anio?: number | null;
  capacidad_kg?: number | null;
  tarifa_kilo: number;
  odometro_actual: number;
  observaciones?: string | null;
  estado?: string;
}

/** Parámetros de GET /transporte/alertas. */
export interface AlertasOpts extends QueryParams {
  /** Documentos/mantenimientos que vencen dentro de estos días (default 30). */
  dias?: number;
  /** Mantenimientos a menos de estos km del próximo odómetro (default 500). */
  umbral_km?: number;
  vehiculo_id?: string | null;
}

@Injectable({ providedIn: 'root' })
export class VehiculosService extends CrudService<Vehiculo, VehiculoPayload> {
  constructor() {
    super('/transporte/vehiculos');
  }

  /** Documentos y mantenimientos vencidos o por vencer. */
  alertas(opts: AlertasOpts = {}): Observable<AlertasTransporte> {
    return this.api.get<AlertasTransporte>('/transporte/alertas', opts);
  }
}
