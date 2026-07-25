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

/**
 * A dónde fue a parar el queso comprado en el período.
 * Las tres primeras son salidas reales; 'pendiente' y 'anterior' son el residuo con signo.
 */
export type ProductoGanancia = 'queso' | 'borona' | 'merma' | 'pendiente' | 'anterior';

/** Fila del desglose de ganancia por producto (siempre llegan 4: queso, borona, merma y residuo). */
export interface GananciaProducto {
  producto: ProductoGanancia;
  etiqueta: string; // texto listo para mostrar en la UI
  nota: string; // sub-texto explicativo corto
  /** Kilos DEL LOTE COMPRADO que fueron a este destino (siempre >= 0). */
  kilos: Monto;
  /** Kilos realmente vendidos. Solo difiere de `kilos` en la borona. */
  kilos_vendidos: Monto;
  ingreso: Monto;
  costo: Monto; // negativo solo en la fila 'anterior': se pagó en otra temporada
  gastos: Monto;
  ganancia: Monto; // ingreso - costo - gastos
  precio_venta_kilo: Monto; // ingreso / kilos_vendidos (0 si no se vendió)
  costo_kilo: Monto; // = precio_promedio_compra
}

/** Ganancia estimada de lo que se le compró a cada productor en el período. */
export interface GananciaProductor {
  productor: string;
  compras: number; // cuántas compras en el período
  kilos: Monto;
  /** Valor de sus compras. NO es lo que se le ha pagado (eso es el abonado). */
  total_comprado: Monto;
  precio_promedio: Monto; // total_comprado / kilos
  por_pagar: Monto; // lo que se le debe hoy (histórico, no solo del período)
  margen_por_kilo: Monto; // valor_realizado_kilo - precio_promedio
  ganancia_estimada: Monto; // estimación: reparte la venta neta entre sus kilos
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
  ganancia_estimada: Monto; // ventas - compras del período - gastos (neta)
  margen_por_kilo: Monto; // ganancia neta por kilo vendido (queso + borona)
  // Del período (borona)
  kilos_borona_vendidos: Monto;
  total_ventas_borona: Monto;
  // Ajustes del período que bajan el queso disponible
  kilos_a_borona: Monto; // conversiones con destino 'borona'
  kilos_merma: Monto; // conversiones con destino 'merma': la merma real
  /**
   * Residuo CON SIGNO del lote comprado: comprado − vendido como queso −
   * pasado a borona − merma. Negativo = salió de inventario anterior.
   */
  kilos_pendientes: Monto;
  /** (ventas − gastos) / kilos COMPRADOS: lo neto que dejó cada kilo comprado. */
  valor_realizado_kilo: Monto;
  /** Desglose de la ganancia por producto: queso, borona, merma y el residuo. */
  por_producto: GananciaProducto[];
  /** Ganancia estimada por productor, ordenada de mayor a menor. */
  por_productor: GananciaProductor[];
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

// ------------------------------------------------- estado de cuenta (cliente)
// ESTE bloque se le entrega AL CLIENTE (vista previa y PDF), así que NO trae ni
// puede traer datos internos de la quesera: gastos de la venta, venta libre,
// costos de compra, margen, ganancia ni nombres de productores.

/** Una compra del cliente dentro de su estado de cuenta. */
export interface EstadoCuentaVenta {
  fecha: string;
  tipo: TipoVenta;
  /** Nombre del producto listo para mostrar: 'Queso' o 'Borona'. */
  producto: string;
  kilos: Monto;
  precio_kilo: Monto;
  valor_total: Monto;
  abonado: Monto;
  saldo: Monto;
  estado: string; // pendiente | parcial | pagada
}

/**
 * Un pago recibido del cliente (abono de cualquiera de sus ventas).
 *
 * NO trae `observaciones` a propósito: la observación del abono es la nota
 * INTERNA de la quesera ("le rebajé el flete", "al productor le pagamos tanto")
 * y este bloque se le entrega al cliente. El backend ya no la envía.
 */
export interface EstadoCuentaPago {
  fecha: string;
  valor: Monto;
}

/** Cómo va la cuenta de un cliente: sus compras, sus pagos y el saldo. */
export interface EstadoCuentaCliente {
  cliente: string;
  /** Null en los dos si el estado de cuenta cubre todo el histórico. */
  desde: string | null;
  hasta: string | null;
  emitido: string; // fecha de generación
  compras: number; // cuántas ventas se le hicieron
  total_kilos: Monto;
  total_facturado: Monto;
  total_abonado: Monto;
  saldo: Monto; // total_facturado - total_abonado
  ventas: EstadoCuentaVenta[];
  pagos: EstadoCuentaPago[];
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

  // --------------------------------------------------------- estado de cuenta
  /**
   * Estado de cuenta de un cliente. Sin `desde`/`hasta` cubre todo el histórico
   * (el saldo real que debe); con rango se limita a ese período.
   */
  estadoCuenta(
    cliente: string,
    desde?: string | null,
    hasta?: string | null,
  ): Observable<EstadoCuentaCliente> {
    return this.api.get<EstadoCuentaCliente>(
      `${this.base}/estado-cuenta`,
      this.paramsEstadoCuenta(cliente, desde, hasta),
    );
  }

  /** PDF del estado de cuenta como Blob, para compartirlo por WhatsApp. */
  estadoCuentaPdfBlob(
    cliente: string,
    desde?: string | null,
    hasta?: string | null,
  ): Observable<Blob> {
    return this.api.getBlob(
      `${this.base}/estado-cuenta/pdf`,
      this.paramsEstadoCuenta(cliente, desde, hasta),
    );
  }

  /**
   * Descarga el PDF del estado de cuenta en el navegador.
   *
   * `nombreArchivo` es el nombre de RESPALDO, que se usa cuando el navegador no
   * puede leer la cabecera Content-Disposition (petición cross-origin). Tiene que
   * llevar el nombre del cliente: con el genérico 'estado_cuenta.pdf' todas las
   * carteras se guardan igual y es fácil mandarle a un cliente la de otro.
   */
  descargarEstadoCuenta(
    cliente: string,
    desde?: string | null,
    hasta?: string | null,
    nombreArchivo?: string,
  ): Observable<void> {
    return this.api.download(
      `${this.base}/estado-cuenta/pdf`,
      nombreArchivo || 'estado_cuenta.pdf',
      this.paramsEstadoCuenta(cliente, desde, hasta),
    );
  }

  /**
   * Query del estado de cuenta: `desde`/`hasta` solo viajan si tienen valor, para
   * que el backend entienda "todo el histórico" (además `toHttpParams` descarta
   * null, undefined y cadena vacía, nunca manda el texto "null").
   */
  private paramsEstadoCuenta(
    cliente: string,
    desde?: string | null,
    hasta?: string | null,
  ): QueryParams {
    const params: QueryParams = { cliente };
    if (desde) params['desde'] = desde;
    if (hasta) params['hasta'] = hasta;
    return params;
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
