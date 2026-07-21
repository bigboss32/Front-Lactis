import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService, QueryParams } from '../../core/api.service';
import { Monto, Page, TenantFields } from '../../core/models';

/** Fecha local de hoy en formato ISO YYYY-MM-DD (el backend espera date). */
export function hoyIso(): string {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

// ------------------------------------------------------------------ modelos
// Espejo de los schemas del backend (app/modules/reventa/schemas.py).
// Los Decimal llegan como string; se formatean con | money y | cantidad.

/** Qué se vende/registra: queso entero o borona (subproducto a menor precio). */
export type TipoVenta = 'queso' | 'borona';

export interface AbonoReventa {
  id: string;
  fecha: string;
  valor: Monto;
  observaciones: string | null;
}

export interface CompraQueso extends TenantFields {
  fecha: string;
  productor: string;
  kilos_brutos: Monto;
  borona_kilos: Monto;
  kilos_netos: Monto;
  precio_kilo: Monto;
  valor_total: Monto;
  abonado: Monto;
  saldo: Monto;
  observaciones: string | null;
  abonos: AbonoReventa[];
}

export interface VentaQueso extends TenantFields {
  fecha: string;
  cliente: string;
  tipo: TipoVenta;
  kilos: Monto;
  precio_kilo: Monto;
  valor_total: Monto;
  /** Gastos que conlleva vender el lote (ej. transporte por kilo). No lo paga el cliente. */
  gasto_concepto: string | null;
  gasto_por_kilo: Monto;
  gasto_monto: Monto; // total = gasto_por_kilo × kilos
  abonado: Monto;
  saldo: Monto;
  observaciones: string | null;
  abonos: AbonoReventa[];
}

/** Destino de un ajuste que baja el queso disponible: borona (vendible) o merma (pérdida). */
export type DestinoConversion = 'borona' | 'merma';

/** Ajuste que reduce el queso disponible de reventa (pasa a borona o se pierde como merma). */
export interface ConversionBorona extends TenantFields {
  fecha: string;
  kilos: Monto;
  destino: DestinoConversion;
  /** Precio por kilo de la borona (0 en la merma). */
  precio_kilo: Monto;
  observaciones: string | null;
}

export interface ResumenReventa {
  desde: string;
  hasta: string;
  // Del período (queso)
  kilos_comprados: Monto;
  total_compras: Monto;
  kilos_vendidos: Monto; // solo ventas tipo queso
  total_ventas: Monto; // queso + borona
  precio_promedio_compra: Monto;
  precio_promedio_venta: Monto; // solo queso
  total_gastos: Monto; // gastos de venta del período
  merma_estimada: Monto; // kilos comprados - vendidos (queso) del período
  ganancia_estimada: Monto; // ventas - costo - gastos (neta)
  margen_por_kilo: Monto; // ganancia neta por kilo de queso vendido
  // Del período (borona)
  kilos_borona_vendidos: Monto;
  total_ventas_borona: Monto;
  // Acumulados (histórico, sin filtro de fechas)
  kilos_disponibles: Monto;
  borona_disponible: Monto; // de compras + conversiones - vendida
  por_pagar_productores: Monto;
  por_cobrar_clientes: Monto;
}

/** Nombres ya usados para autocompletar al crear compras/ventas. */
export interface SugerenciasReventa {
  productores: string[];
  clientes: string[];
}

// ------------------------------------------------------------------ payloads
export interface CompraQuesoPayload {
  fecha: string;
  productor: string;
  kilos_brutos: number;
  borona_kilos?: number;
  precio_kilo: number;
  observaciones?: string | null;
}

export interface VentaQuesoPayload {
  fecha: string;
  cliente: string;
  /** Solo al crear: queso o borona (no editable después). */
  tipo: TipoVenta;
  kilos: number;
  precio_kilo: number;
  gasto_concepto?: string | null;
  gasto_por_kilo?: number;
  observaciones?: string | null;
  /** Solo al crear: registra la venta ya pagada por completo. */
  pagada_de_contado?: boolean;
}

export interface ConversionBoronaPayload {
  fecha: string;
  kilos: number;
  destino?: DestinoConversion;
  precio_kilo?: number;
  observaciones?: string | null;
}

export interface AbonoPayload {
  fecha: string;
  valor: number;
  observaciones?: string | null;
}

export interface ReventaListOpts extends QueryParams {
  page?: number;
  page_size?: number;
  search?: string | null;
  estado?: string | null;
  desde?: string | null;
  hasta?: string | null;
}

// ------------------------------------------------------------------ servicio
@Injectable({ providedIn: 'root' })
export class ReventaService {
  private readonly api = inject(ApiService);
  private readonly base = '/reventa';

  resumen(desde: string, hasta: string): Observable<ResumenReventa> {
    return this.api.get<ResumenReventa>(`${this.base}/resumen`, { desde, hasta });
  }

  /** Nombres ya usados de productores y clientes, para autocompletar. */
  sugerencias(): Observable<SugerenciasReventa> {
    return this.api.get<SugerenciasReventa>(`${this.base}/sugerencias`);
  }

  // ----------------------------------------------------------------- compras
  listarCompras(opts: ReventaListOpts = {}): Observable<Page<CompraQueso>> {
    return this.api.get<Page<CompraQueso>>(`${this.base}/compras`, opts);
  }

  crearCompra(payload: CompraQuesoPayload): Observable<CompraQueso> {
    return this.api.post<CompraQueso>(`${this.base}/compras`, payload);
  }

  editarCompra(id: string, payload: Partial<CompraQuesoPayload>): Observable<CompraQueso> {
    return this.api.put<CompraQueso>(`${this.base}/compras/${id}`, payload);
  }

  eliminarCompra(id: string): Observable<void> {
    return this.api.delete(`${this.base}/compras/${id}`);
  }

  abonarCompra(id: string, payload: AbonoPayload): Observable<CompraQueso> {
    return this.api.post<CompraQueso>(`${this.base}/compras/${id}/abonos`, payload);
  }

  /** Elimina un abono mal registrado de una compra; devuelve la compra actualizada. */
  eliminarAbonoCompra(compraId: string, abonoId: string): Observable<CompraQueso> {
    return this.api.delete<CompraQueso>(`${this.base}/compras/${compraId}/abonos/${abonoId}`);
  }

  anularCompra(id: string): Observable<CompraQueso> {
    return this.api.post<CompraQueso>(`${this.base}/compras/${id}/anular`);
  }

  // ------------------------------------------------------------------ ventas
  listarVentas(opts: ReventaListOpts = {}): Observable<Page<VentaQueso>> {
    return this.api.get<Page<VentaQueso>>(`${this.base}/ventas`, opts);
  }

  crearVenta(payload: VentaQuesoPayload): Observable<VentaQueso> {
    return this.api.post<VentaQueso>(`${this.base}/ventas`, payload);
  }

  editarVenta(
    id: string,
    payload: Partial<Omit<VentaQuesoPayload, 'pagada_de_contado' | 'tipo'>>,
  ): Observable<VentaQueso> {
    return this.api.put<VentaQueso>(`${this.base}/ventas/${id}`, payload);
  }

  eliminarVenta(id: string): Observable<void> {
    return this.api.delete(`${this.base}/ventas/${id}`);
  }

  abonarVenta(id: string, payload: AbonoPayload): Observable<VentaQueso> {
    return this.api.post<VentaQueso>(`${this.base}/ventas/${id}/abonos`, payload);
  }

  /** Elimina un abono mal registrado de una venta; devuelve la venta actualizada. */
  eliminarAbonoVenta(ventaId: string, abonoId: string): Observable<VentaQueso> {
    return this.api.delete<VentaQueso>(`${this.base}/ventas/${ventaId}/abonos/${abonoId}`);
  }

  anularVenta(id: string): Observable<VentaQueso> {
    return this.api.post<VentaQueso>(`${this.base}/ventas/${id}/anular`);
  }

  // ------------------------------------------------------------ conversiones
  listarConversiones(opts: ReventaListOpts = {}): Observable<Page<ConversionBorona>> {
    return this.api.get<Page<ConversionBorona>>(`${this.base}/conversiones`, opts);
  }

  crearConversion(payload: ConversionBoronaPayload): Observable<ConversionBorona> {
    return this.api.post<ConversionBorona>(`${this.base}/conversiones`, payload);
  }

  eliminarConversion(id: string): Observable<void> {
    return this.api.delete(`${this.base}/conversiones/${id}`);
  }
}
