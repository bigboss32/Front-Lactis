import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService, QueryParams } from '../../core/api.service';
import { Monto, Page, Recepcion, ResumenPeriodo } from '../../core/models';

export interface RecepcionPayload {
  fecha: string;
  proveedor_id?: string;
  transportador_id?: string | null;
  ruta_id?: string | null;
  sucursal_id?: string | null;
  cantidad_litros: number | string;
  precio_litro?: number | string | null;
  bonificaciones?: number | string;
  descuentos?: number | string;
  observaciones?: string | null;
  estado?: string;
}

/** Filtros del endpoint GET /recepciones/filtrar/avanzado. */
export interface RecepcionFiltro extends QueryParams {
  page?: number;
  page_size?: number;
  proveedor_id?: string | null;
  ruta_id?: string | null;
  transportador_id?: string | null;
  desde?: string | null;
  hasta?: string | null;
  /** Búsqueda por nombre de proveedor. */
  search?: string | null;
}

// ---------------------------------------------------------- grilla quincena
// Tipos locales del endpoint GET /recepciones/grilla/quincena (espejo de los
// schemas CeldaGrilla / FilaGrilla / GrillaQuincena del backend). Los Decimal
// llegan como string en JSON: convertir con Number() si se opera con ellos.

/** Una recepción vista como celda proveedor × día de la grilla. */
export interface CeldaGrilla {
  recepcion_id: string;
  litros: Monto;
  liquidada: boolean;
}

export interface FilaGrilla {
  proveedor_id: string;
  proveedor_nombre: string;
  vereda: string | null;
  precio_litro: Monto;
  /** Clave: fecha ISO 'YYYY-MM-DD'. */
  celdas: Record<string, CeldaGrilla>;
  total_litros: Monto;
  valor_bruto: Monto;
  descuentos: Monto;
  bonificaciones: Monto;
  valor_neto: Monto;
  valor_transporte: Monto;
}

/** Vista proveedores × días, equivalente a la hoja 'LITROS Y TRANSPORTE'. */
export interface GrillaQuincena {
  desde: string;
  hasta: string;
  fechas: string[];
  filas: FilaGrilla[];
  /** Clave: fecha ISO 'YYYY-MM-DD'. */
  totales_dia: Record<string, Monto>;
  total_litros: Monto;
  total_valor_neto: Monto;
  total_transporte: Monto;
}

@Injectable({ providedIn: 'root' })
export class RecepcionesService extends CrudService<Recepcion, RecepcionPayload> {
  constructor() {
    super('/recepciones');
  }

  /** Listado con filtros por proveedor, ruta, transportador y rango de fechas. */
  filtrar(filtro: RecepcionFiltro = {}): Observable<Page<Recepcion>> {
    return this.api.get<Page<Recepcion>>(`${this.base}/filtrar/avanzado`, filtro);
  }

  /** Totales diarios y agregados de un período (fechas ISO 'YYYY-MM-DD'). */
  resumenPeriodo(desde: string, hasta: string): Observable<ResumenPeriodo> {
    return this.api.get<ResumenPeriodo>(`${this.base}/resumen/periodo`, { desde, hasta });
  }

  /** Grilla proveedores × días de un período, con filtros por nombre y ruta. */
  grilla(
    desde: string,
    hasta: string,
    search?: string | null,
    ruta_id?: string | null,
  ): Observable<GrillaQuincena> {
    return this.api.get<GrillaQuincena>(`${this.base}/grilla/quincena`, {
      desde,
      hasta,
      search,
      ruta_id,
    });
  }
}
