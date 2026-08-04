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

/** Un pago parcial contra una liquidación: los mismos campos que un abono de reventa. */
export interface PagoPayload {
  fecha: string; // ISO 'YYYY-MM-DD'
  valor: number;
  observaciones: string | null;
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
  /**
   * La ruta del renglón en la del transportador: sus renglones son por día Y
   * ruta, así que un día en que hizo dos rutas a tarifas distintas viene partido
   * en dos. Opcionales: la del proveedor no las trae. Ver `LiquidacionDetalle` en
   * core/models.ts, que es la misma idea en el comprobante ya generado.
   */
  ruta_id?: string | null;
  ruta_nombre?: string | null;
  /**
   * La ruta ya está borrada del catálogo. Opcional porque el backend todavía no
   * manda el campo; ver `ruta_borrada` en core/models.ts, es el mismo.
   */
  ruta_borrada?: boolean;
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

  /**
   * Vuelve a cuadrar la liquidación con lo que hay hoy en el sistema.
   *
   * Dos casos, y los dos terminan igual: el comprobante muestra una cifra que ya
   * no corresponde. El primero es el anticipo registrado DESPUÉS de generarla
   * ("Anticipos aplicados $0"); el segundo es la TARIFA del transportador mal
   * tecleada y corregida después en su ficha —los renglones del comprobante son
   * la foto del día en que se generó, así que se quedan con la tarifa vieja—.
   * Volver a "Generar" no arregla ninguno de los dos: las recepciones del período
   * ya están apartadas por esta liquidación.
   *
   * Devuelve la liquidación entera recalculada. Quien la llama compara sus cifras
   * con las que tenía en pantalla para poder decirle al usuario CUÁNTO cambió; la
   * API no manda un "antes" y no le hace falta.
   *
   * Una APROBADA vuelve a borrador: aprobar es un visto bueno sobre unas cifras y
   * si las cifras cambian hay que darlo otra vez (es la misma cuenta que hace el
   * backend cuando se corrige una recepción de una liquidación aprobada). Con
   * plata entregada —pagada, o con un solo abono— el servidor rebota: esa cifra ya
   * está en manos del tercero.
   */
  recalcular(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/recalcular`);
  }

  aprobar(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/aprobar`);
  }

  pagar(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/pagar`);
  }

  /**
   * Registra un pago PARCIAL (abono) contra una liquidación aprobada.
   *
   * Devuelve la liquidación entera —no solo el pago— porque al abonar cambian
   * `pagado`, `saldo`, el estado y el historial a la vez: pintar solo una parte
   * dejaría la pantalla contradiciéndose a la vista.
   *
   * El backend no deja abonar más que el saldo ni pagarle a un borrador.
   */
  registrarPago(id: string, payload: PagoPayload): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/pagos`, payload);
  }

  /** Elimina un pago mal registrado: el backend devuelve el saldo y el estado. */
  eliminarPago(id: string, pagoId: string): Observable<Liquidacion> {
    return this.api.delete<Liquidacion>(`${this.base}/${id}/pagos/${pagoId}`);
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
