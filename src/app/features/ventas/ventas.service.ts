import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService } from '../../core/api.service';
import { CarteraCliente, Monto, Page, Pago, Venta } from '../../core/models';

export interface VentaLineaPayload {
  producto_id: string;
  descripcion?: string | null;
  cantidad: number;
  precio_unitario: number;
}

/**
 * Un tramo del recorrido: "de la quesera a San Vicente, 400 el kilo, lo lleva
 * Jose Lavado". El conductor va como texto libre y lo canoniza el backend.
 */
export interface TramoFletePayload {
  origen?: string | null;
  destino: string;
  conductor?: string | null;
  valor_por_kilo: number;
}

export interface VentaPayload {
  tipo: 'factura' | 'remision';
  cliente_id: string;
  fecha: string; // ISO YYYY-MM-DD
  descuento: number;
  /**
   * Flete del despacho, por tramos. No se le suma al total que paga el cliente.
   * Mandarlo REEMPLAZA todos los tramos del despacho; una lista vacía lo deja
   * sin flete (se lo recogieron en la planta).
   */
  tramos?: TramoFletePayload[];
  /**
   * La forma vieja de mandar el flete, de un solo valor. El backend la traduce a
   * un tramo. Se conserva para no romper llamadas antiguas; el formulario ya
   * manda `tramos`.
   */
  gasto_concepto?: string | null;
  gasto_por_kilo?: number;
  observaciones?: string | null;
  detalles: VentaLineaPayload[];
  descontar_inventario: boolean;
}

// ------------------------------ lo que se le debe a cada conductor de despachos
export interface ConductorTramo {
  venta_id: string;
  venta_numero: number;
  fecha: string;
  cliente: string | null;
  origen: string | null;
  destino: string | null;
  kilos: Monto;
  valor_por_kilo: Monto;
  valor: Monto;
}

export interface PagoConductor {
  id: string;
  conductor: string;
  fecha: string;
  valor: Monto;
  observaciones: string | null;
}

export interface ConductorResumen {
  conductor: string;
  /** Lo del rango que se está mirando: suma exacto el detalle de abajo. */
  acumulado_periodo: Monto;
  pagado_periodo: Monto;
  /**
   * Lo de siempre. `saldo` es lo que de verdad se le debe hoy y NO depende del
   * filtro de fechas: es la cifra con la que el dueño le paga.
   */
  total_acumulado: Monto;
  total_pagado: Monto;
  saldo: Monto;
  tramos: ConductorTramo[];
  pagos: PagoConductor[];
}

export interface ConductoresPanel {
  desde: string | null;
  hasta: string | null;
  conductores: ConductorResumen[];
  total_acumulado_periodo: Monto;
  total_pagado_periodo: Monto;
  total_saldo: Monto;
}

export interface PagoConductorPayload {
  conductor: string;
  fecha: string; // ISO YYYY-MM-DD
  valor: number;
  observaciones?: string | null;
}

export interface PagoPayload {
  venta_id: string;
  fecha: string; // ISO YYYY-MM-DD
  valor: number;
  metodo: 'efectivo' | 'transferencia' | 'otro';
  referencia?: string | null;
  observaciones?: string | null;
}

@Injectable({ providedIn: 'root' })
export class VentasService extends CrudService<Venta, VentaPayload> {
  constructor() {
    super('/ventas');
  }

  /** Anula la venta y reintegra el inventario descontado. */
  anular(id: string): Observable<Venta> {
    return this.api.post<Venta>(`/ventas/${id}/anular`);
  }

  /** Estado de cartera (saldo pendiente) agrupado por cliente. */
  cartera(): Observable<CarteraCliente[]> {
    return this.api.get<CarteraCliente[]>('/ventas/cartera');
  }

  /** Pagos registrados sobre una venta. */
  pagosDeVenta(ventaId: string): Observable<Page<Pago>> {
    return this.api.get<Page<Pago>>('/pagos', { venta_id: ventaId, page_size: 100 });
  }

  /** Registra un abono/pago sobre una venta. */
  registrarPago(payload: PagoPayload): Observable<Pago> {
    return this.api.post<Pago>('/pagos', payload);
  }

  // ---------------------------------------------------------- conductores
  /**
   * Lo que se le debe a cada conductor de despachos.
   *
   * Cuelga de /ventas y no de un módulo propio: el dato nace en el tramo del
   * flete de la venta y usa el mismo permiso.
   */
  conductores(desde?: string | null, hasta?: string | null): Observable<ConductoresPanel> {
    return this.api.get<ConductoresPanel>('/ventas/conductores', {
      ...(desde ? { desde } : {}),
      ...(hasta ? { hasta } : {}),
    });
  }

  /** Nombres de conductor ya usados, para autocompletar sin obligar a registrar. */
  sugerenciasConductores(): Observable<{ conductores: string[] }> {
    return this.api.get<{ conductores: string[] }>('/ventas/conductores/sugerencias');
  }

  /** Le paga a un conductor. El backend no deja pasarse de lo que se le debe. */
  pagarConductor(payload: PagoConductorPayload): Observable<PagoConductor> {
    return this.api.post<PagoConductor>('/ventas/conductores/pagos', payload);
  }

  /** Borra un pago mal registrado: lo que se le debe vuelve a subir. */
  eliminarPagoConductor(pagoId: string): Observable<void> {
    return this.api.delete<void>(`/ventas/conductores/pagos/${pagoId}`);
  }
}
