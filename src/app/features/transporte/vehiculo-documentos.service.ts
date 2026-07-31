import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService, ListOpts } from '../../core/api.service';
import { Page, VehiculoDocumento } from '../../core/models';

/** Tipos de documento legal del vehículo (constantes del backend). */
export const TIPOS_DOCUMENTO_VEHICULO = [
  'soat',
  'tecnomecanica',
  'seguro',
  'impuesto',
  'otro',
] as const;

export const ETIQUETAS_TIPO_DOCUMENTO: Record<string, string> = {
  soat: 'SOAT',
  tecnomecanica: 'Tecnomecánica',
  seguro: 'Seguro',
  impuesto: 'Impuesto',
  otro: 'Otro',
};

export interface VehiculoDocumentoPayload {
  vehiculo_id: string;
  tipo: string;
  descripcion?: string | null;
  numero?: string | null;
  fecha_expedicion?: string | null;
  fecha_vencimiento: string; // ISO 'YYYY-MM-DD'
  valor: number;
  estado?: string;
}

/** Filtros de GET /transporte/documentos/filtrar/avanzado.
 *  El rango desde/hasta filtra por FECHA DE VENCIMIENTO (es lo que se busca). */
export interface VehiculoDocumentoFiltro extends ListOpts {
  vehiculo_id?: string | null;
  tipo?: string | null;
  desde?: string | null;
  hasta?: string | null;
}

@Injectable({ providedIn: 'root' })
export class VehiculoDocumentosService extends CrudService<VehiculoDocumento, VehiculoDocumentoPayload> {
  constructor() {
    super('/transporte/documentos');
  }

  /** Listado con filtros por vehículo, tipo y rango de vencimiento. */
  filtrar(opts: VehiculoDocumentoFiltro = {}): Observable<Page<VehiculoDocumento>> {
    return this.api.get<Page<VehiculoDocumento>>(`${this.base}/filtrar/avanzado`, opts);
  }

  /** Sube la copia del documento (POST /transporte/documentos/{id}/adjunto). */
  adjuntar(id: string, file: File): Observable<VehiculoDocumento> {
    return this.api.upload<VehiculoDocumento>(`${this.base}/${id}/adjunto`, file);
  }
}
