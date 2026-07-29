import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService, QueryParams } from '../../core/api.service';
import { Monto, Page, Produccion, TipoQueso } from '../../core/models';

// ------------------------------------------- utilidad por lote de producción
/** De qué proveedor vino la leche que usó un lote, y cuánto costó. */
export interface LecheDelLote {
  proveedor: string;
  fecha_recepcion: string;
  litros: Monto;
  costo_leche: Monto;
  costo_transporte: Monto;
  costo: Monto;
}

/**
 * Una venta que se llevó kilos de este lote. `kilos` son los que salieron de ESTE
 * lote y `kilos_venta` los del renglón completo: un despacho grande se reparte
 * entre varios lotes.
 */
export interface VentaDelLoteProduccion {
  fecha: string;
  cliente: string;
  producto: string;
  kilos: Monto;
  kilos_venta: Monto;
  precio_kilo: Monto;
  ingreso: Monto;
  costo: Monto;
  utilidad: Monto;
  partida: boolean;
}

/**
 * Una producción con lo que costó y lo que dejó.
 *
 * OJO con `utilidad`: es la de lo que YA se vendió, y NO le resta el costo del
 * queso que sigue en bodega. Restárselo es lo que hace que el estado de resultados
 * del mes salga negativo cuando el negocio va bien: la plata de la leche está ahí,
 * convertida en queso, esperando venderse.
 */
export interface LoteProduccion {
  fecha: string;
  tipo_queso: string;
  litros_usados: Monto;
  kilos_producidos: Monto;
  merma: Monto;
  /** Kilos de queso por litro de leche. */
  rendimiento: Monto;
  costo_leche: Monto;
  costo_transporte: Monto;
  costo_total: Monto;
  costo_kilo: Monto;
  kilos_vendidos: Monto;
  kilos_en_bodega: Monto;
  ingresos: Monto;
  costo_vendido: Monto;
  costo_en_bodega: Monto;
  utilidad: Monto;
  precio_venta_kilo: Monto;
  vendido_completo: boolean;
  litros_sin_recepcion: Monto;
  detalle_leche: LecheDelLote[];
  detalle_ventas: VentaDelLoteProduccion[];
}

export interface LotesProduccionPanel {
  lotes: LoteProduccion[];
  total_utilidad: Monto;
  total_litros: Monto;
  total_kilos: Monto;
  total_costo: Monto;
  total_ingresos: Monto;
  total_kilos_en_bodega: Monto;
  total_costo_en_bodega: Monto;
  mejor: string | null;
  peor: string | null;
  /** Queso vendido que no salió de ninguna producción registrada. */
  kilos_sin_lote: Monto;
  ingreso_sin_lote: Monto;
  /** Litros usados en producciones sin leche registrada que los respalde. */
  litros_sin_recepcion: Monto;
  /** Leche recibida que todavía no se ha usado en ninguna producción. */
  litros_sin_usar: Monto;
  costo_litros_sin_usar: Monto;
}

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

  /**
   * Utilidad por lote de producción.
   *
   * `desde`/`hasta` recortan qué lotes se muestran, NO el cálculo: la leche del 30
   * de junio es el queso de julio, y el queso de julio se vende en septiembre, así
   * que el reparto se hace siempre sobre toda la historia.
   */
  lotes(desde?: string | null, hasta?: string | null): Observable<LotesProduccionPanel> {
    const params: QueryParams = {};
    if (desde) params['desde'] = desde;
    if (hasta) params['hasta'] = hasta;
    return this.api.get<LotesProduccionPanel>(`${this.base}/lotes`, params);
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
