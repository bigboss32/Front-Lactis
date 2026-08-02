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

  /**
   * Corrige el precio por litro de UN día de la liquidación.
   *
   * Devuelve la liquidación entera recalculada por el backend —y no solo el día—
   * porque al cambiar el precio también cambian el valor bruto, el promedio, el
   * total y el saldo: pintar solo la fila dejaría el resumen mintiendo.
   *
   * El backend solo lo permite en borrador; la pantalla oculta el campo fuera de
   * ese estado, pero el que dice que no de verdad es el servidor.
   */
  actualizarPrecioDetalle(
    id: string,
    detalleId: string,
    precioLitro: number,
  ): Observable<Liquidacion> {
    return this.api.put<Liquidacion>(`${this.base}/${id}/detalles/${detalleId}`, {
      precio_litro: precioLitro,
    });
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

  /**
   * Calcula cómo va un tercero en el período, sin generar la liquidación.
   *
   * `soloLectura`: usa POST porque el filtro va en el cuerpo, pero NO GUARDA
   * NADA (el propio diálogo lo dice). Sin la marca, un fallo de red aquí
   * mostraba "revisa en la lista si el registro quedó guardado" y, sin señal,
   * "vuelve a tocar Guardar" en una pantalla que no tiene botón Guardar.
   */
  previsualizar(payload: PrevisualizarPayload): Observable<PreLiquidacion[]> {
    return this.api.post<PreLiquidacion[]>(`${this.base}/previsualizar`, payload, undefined, {
      soloLectura: true,
    });
  }

  /** PDF preliminar (no oficial) de una pre-liquidación, como Blob. Tampoco guarda nada. */
  previsualizarPdfBlob(payload: PrevisualizarPayload): Observable<Blob> {
    return this.api.postBlob(`${this.base}/previsualizar/pdf`, payload, { soloLectura: true });
  }
}
