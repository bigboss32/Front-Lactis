import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService } from '../../core/api.service';
import { Liquidacion, Monto } from '../../core/models';

export interface GenerarLiquidacionesPayload {
  periodo_inicio: string; // ISO 'YYYY-MM-DD'
  periodo_fin: string; // ISO 'YYYY-MM-DD'
  tipo: 'proveedor' | 'transportador' | 'ambos';
  proveedor_id?: string | null;
}

/** Pre-liquidación: pide cómo va un tercero sin generar ni guardar nada. */
export interface PrevisualizarPayload {
  periodo_inicio: string; // ISO 'YYYY-MM-DD'
  periodo_fin: string; // ISO 'YYYY-MM-DD'
  tipo: 'proveedor' | 'transportador';
  tercero_id: string;
}

export interface PreLiquidacionDetalle {
  fecha: string;
  litros: Monto;
  precio_litro: Monto;
  valor: Monto;
}

export interface PreLiquidacionAnticipo {
  fecha: string;
  valor: Monto;
  observaciones: string | null;
}

export interface PreLiquidacion {
  tipo: 'proveedor' | 'transportador';
  tercero_id: string;
  tercero_nombre: string;
  tercero_detalle: string | null;
  periodo_inicio: string;
  periodo_fin: string;
  total_litros: Monto;
  precio_promedio: Monto;
  valor_bruto: Monto;
  bonificaciones: Monto;
  descuentos: Monto;
  valor_transporte: Monto;
  anticipos: Monto;
  valor_total: Monto;
  saldo: Monto;
  detalles: PreLiquidacionDetalle[];
  anticipos_detalle: PreLiquidacionAnticipo[];
}

@Injectable({ providedIn: 'root' })
export class LiquidacionesService extends CrudService<Liquidacion> {
  constructor() {
    super('/liquidaciones');
  }

  /** Genera las liquidaciones del período; devuelve las creadas. */
  generar(payload: GenerarLiquidacionesPayload): Observable<Liquidacion[]> {
    return this.api.post<Liquidacion[]>(`${this.base}/generar`, payload);
  }

  aprobar(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/aprobar`);
  }

  pagar(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/pagar`);
  }

  anular(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/anular`);
  }

  descargarPdf(id: string): Observable<void> {
    return this.api.download(`${this.base}/${id}/pdf`, 'liquidacion.pdf');
  }

  /** PDF del recibo como Blob (para compartir por WhatsApp, etc.). */
  pdfBlob(id: string): Observable<Blob> {
    return this.api.getBlob(`${this.base}/${id}/pdf`);
  }

  /** Calcula cómo va un tercero en el período, sin generar la liquidación. */
  previsualizar(payload: PrevisualizarPayload): Observable<PreLiquidacion[]> {
    return this.api.post<PreLiquidacion[]>(`${this.base}/previsualizar`, payload);
  }

  /** PDF preliminar (no oficial) de una pre-liquidación, como Blob. */
  previsualizarPdfBlob(payload: PrevisualizarPayload): Observable<Blob> {
    return this.api.postBlob(`${this.base}/previsualizar/pdf`, payload);
  }
}
