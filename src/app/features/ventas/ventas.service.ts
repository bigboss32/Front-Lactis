import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService } from '../../core/api.service';
import { CarteraCliente, Page, Pago, Venta } from '../../core/models';

export interface VentaLineaPayload {
  producto_id: string;
  descripcion?: string | null;
  cantidad: number;
  precio_unitario: number;
}

export interface VentaPayload {
  tipo: 'factura' | 'remision';
  cliente_id: string;
  fecha: string; // ISO YYYY-MM-DD
  descuento: number;
  observaciones?: string | null;
  detalles: VentaLineaPayload[];
  descontar_inventario: boolean;
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
}
