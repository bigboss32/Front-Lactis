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

// ------------------------------------------------------------------ lotes
/**
 * Un lote de compra: todas las compras de queso de una misma FECHA.
 *
 * Las ventas no dicen de qué lote salió el queso, así que se reparten FIFO: se
 * vende del lote más viejo primero, que es lo que pasa en la bodega porque el
 * queso es perecedero. Cada lote tiene su propio costo por kilo.
 *
 * OJO con `ganancia`: es la de lo que YA se realizó (vendido y perdido como
 * merma), y NO le resta el costo de lo que sigue en inventario. Por eso NO
 * coincide con la "ganancia del período" del Resumen, que sí resta todas las
 * compras del período aunque no se hayan vendido. Las dos son correctas y
 * responden a preguntas distintas.
 */
/**
 * Una compra dentro del lote, con lo que dejaron SUS kilos.
 *
 * La ganancia es exacta, no la del lote repartida a prorrata: son los kilos de
 * ese productor costeados al precio que se le pagó a él. Por eso dos productores
 * del mismo lote pueden tener margen distinto, y por eso la suma da la del lote.
 */
export interface CompraDelLote {
  productor: string;
  kilos: Monto;
  borona_recibida: Monto;
  precio_kilo: Monto;
  valor_total: Monto;
  saldo: Monto;
  kilos_vendidos: Monto;
  kilos_a_borona: Monto;
  kilos_merma: Monto;
  kilos_sin_vender: Monto;
  borona_vendida: Monto;
  borona_sin_vender: Monto;
  ingresos: Monto;
  gastos: Monto;
  costo_realizado: Monto;
  costo_sin_vender: Monto;
  ganancia: Monto;
  margen_kilo: Monto;
}

/**
 * Una venta que se llevó kilos de este lote. `kilos` son los que salieron de ESTE
 * lote y `kilos_venta` los de la venta completa: una venta grande se parte entre
 * varios lotes.
 */
export interface VentaDelLote {
  fecha: string;
  cliente: string;
  tipo: TipoVenta;
  kilos: Monto;
  kilos_venta: Monto;
  precio_kilo: Monto;
  ingreso: Monto;
  gasto: Monto;
  costo: Monto;
  ganancia: Monto;
  partida: boolean;
}

export interface LoteResumen {
  fecha: string;
  productores: string[];
  compras: number;
  kilos_comprados: Monto;
  costo_total: Monto;
  costo_kilo: Monto;
  /** Lo que falta pagarles a los productores de ESTE lote (exacto, no repartido). */
  por_pagar: Monto;
  /** Borona que llegó con el lote y no se paga. */
  borona_recibida: Monto;
  // Los cuatro suman kilos_comprados
  kilos_vendidos: Monto;
  kilos_a_borona: Monto;
  kilos_merma: Monto;
  kilos_sin_vender: Monto;
  borona_vendida: Monto;
  borona_sin_vender: Monto;
  ingreso_queso: Monto;
  ingreso_borona: Monto;
  ingresos: Monto;
  gastos: Monto;
  costo_vendido: Monto;
  /** Solo la borona que venía de queso: la que llega gratis cuesta 0. */
  costo_borona_vendida: Monto;
  costo_merma: Monto;
  costo_sin_vender: Monto;
  ganancia: Monto;
  margen_kilo: Monto;
  precio_venta_kilo: Monto;
  cerrado: boolean;
  /** Quién aportó qué: la suma de sus ganancias da la del lote. */
  detalle_compras: CompraDelLote[];
  /** A quién se le vendió este lote, de la venta más reciente a la más vieja. */
  detalle_ventas: VentaDelLote[];
}

export interface LotesPanel {
  lotes: LoteResumen[];
  total_ganancia: Monto;
  total_kilos_comprados: Monto;
  total_costo: Monto;
  total_ingresos: Monto;
  total_por_pagar: Monto;
  total_kilos_sin_vender: Monto;
  total_costo_sin_vender: Monto;
  mejor: string | null;
  peor: string | null;
  /** Kilos vendidos que no encontraron lote: falta cargar una compra. */
  kilos_sin_lote: Monto;
  borona_sin_lote: Monto;
  ingreso_sin_lote: Monto;
}

// ------------------------------------------------------------- temporadas
/**
 * Un ciclo de compra y reventa con nombre y fechas. NO guarda plata: la ganancia
 * se calcula con el mismo motor del Resumen sobre sus fechas, así que la cifra de
 * la temporada es la MISMA que muestra el Resumen filtrado a ese rango.
 */
export interface Temporada extends TenantFields {
  nombre: string;
  fecha_inicio: string;
  /** null = temporada abierta (la que está corriendo). */
  fecha_fin: string | null;
  notas: string | null;
  abierta: boolean;
}

/** Una temporada con sus cifras ya calculadas. */
export interface TemporadaResumen {
  id: string;
  nombre: string;
  fecha_inicio: string;
  /** En la abierta es HOY: hasta dónde llegan las cifras que se muestran. */
  fecha_fin: string;
  abierta: boolean;
  dias: number;
  notas: string | null;
  kilos_comprados: Monto;
  kilos_vendidos: Monto;
  kilos_borona_vendidos: Monto;
  kilos_a_borona: Monto;
  kilos_merma: Monto;
  kilos_pendientes: Monto;
  total_compras: Monto;
  total_ventas: Monto;
  total_gastos: Monto;
  ganancia: Monto;
  margen_por_kilo: Monto;
  precio_promedio_compra: Monto;
  precio_promedio_venta: Monto;
  /** Lo que falta de ESTA temporada: no la cartera de siempre ni el libro anterior. */
  por_cobrar: Monto;
  por_pagar: Monto;
  cerrada_de_verdad: boolean;
}

export interface TemporadasPanel {
  temporadas: TemporadaResumen[];
  /** Los totales son la suma EXACTA de las temporadas listadas, no el histórico. */
  total_ganancia: Monto;
  total_kilos_comprados: Monto;
  total_ventas: Monto;
  total_compras: Monto;
  mejor: string | null;
  peor: string | null;
  /** Días con compras o ventas que no caen en ninguna temporada (huecos). */
  dias_sin_temporada: number;
  /** Inicio que se propone para la próxima: día siguiente al último cierre. */
  proximo_inicio: string | null;
}

export interface TemporadaPayload {
  nombre: string;
  fecha_inicio: string;
  /** Sin fecha_fin queda ABIERTA. */
  fecha_fin?: string | null;
  notas?: string | null;
}

// ------------------------------------------- saldos de la cuenta anterior
/** De qué lado está la cuenta vieja: un cliente le debe ('cobrar') o él le debe a un productor ('pagar'). */
export type TipoSaldoAnterior = 'cobrar' | 'pagar';

/**
 * Una cuenta a medio pagar traída del sistema que el cliente usaba antes.
 *
 * NO es una venta ni una compra de aquí: no mueve kilos, ni el queso
 * disponible, ni la ganancia. Solo suma en lo que hay por cobrar y por pagar,
 * acepta abonos y sale en el estado de cuenta del cliente.
 */
export interface SaldoAnterior extends TenantFields {
  tipo: TipoSaldoAnterior;
  /** Nombre del cliente (si es 'cobrar') o del productor (si es 'pagar'). */
  tercero: string;
  /** La fecha ORIGINAL del documento en el libro viejo, no la de carga. */
  fecha: string;
  concepto: string;
  valor_total: Monto;
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
  /** Incluye lo que quede pendiente del libro anterior (ver `por_pagar_libro_anterior`). */
  por_pagar_productores: Monto;
  /** Incluye lo que quede pendiente del libro anterior (ver `por_cobrar_libro_anterior`). */
  por_cobrar_clientes: Monto;
  /**
   * Cuánto de esas dos cifras viene de los saldos de la cuenta anterior. Está
   * aparte para poder mostrar el desglose: la tarjeta tiene que explicar de
   * dónde sale su propia suma.
   */
  por_cobrar_libro_anterior: Monto;
  por_pagar_libro_anterior: Monto;
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

/**
 * Una cuenta a medio pagar que el cliente traía del sistema anterior.
 *
 * Solo lleva lo que el cliente reconoce de su propia deuda: la fecha del
 * documento viejo, de qué era, cuánto valía, cuánto abonó y cuánto queda. Las
 * `observaciones` del saldo NO vienen: son la nota interna de la quesera, igual
 * que en EstadoCuentaPago.
 */
export interface EstadoCuentaSaldoAnterior {
  /** La fecha ORIGINAL del documento en el libro viejo. */
  fecha: string;
  concepto: string;
  valor_total: Monto;
  abonado: Monto;
  saldo: Monto;
}

/** Cómo va la cuenta de un cliente: sus compras, sus pagos y el saldo. */
export interface EstadoCuentaCliente {
  cliente: string;
  /** Null en los dos si el estado de cuenta cubre todo el histórico. */
  desde: string | null;
  hasta: string | null;
  emitido: string; // fecha de generación
  compras: number; // cuántas ventas se le hicieron (las del sistema, no las del libro)
  total_kilos: Monto;
  /** Solo del sistema; lo del libro anterior va aparte en los tres campos libro_anterior_*. */
  total_facturado: Monto;
  total_abonado: Monto;
  /**
   * TODO lo que el cliente debe hoy, que es la única cifra que le importa:
   * (total_facturado − total_abonado) + libro_anterior_saldo = saldo.
   */
  saldo: Monto;
  ventas: EstadoCuentaVenta[];
  pagos: EstadoCuentaPago[];
  /** Lo que traía debiendo del sistema anterior (vacío para casi todos). */
  saldos_anteriores: EstadoCuentaSaldoAnterior[];
  libro_anterior_total: Monto;
  libro_anterior_abonado: Monto;
  libro_anterior_saldo: Monto;
}

// ---------------------------------------------- estado de cuenta (productor)
// ESPEJO del bloque del cliente, pero al revés: ESTE se le entrega AL PRODUCTOR,
// así que NO trae ni puede traer a qué precio se revendió su queso, el total de
// ventas, el margen, la ganancia, los gastos de venta ni nombres de clientes.
// Tampoco los saldos del libro anterior de tipo 'cobrar', que son deudas de
// CLIENTES con la quesera y no tienen nada que ver con él.
//
// OJO CON LOS SIGNOS: aquí un saldo positivo significa que LA QUESERA LE DEBE A
// ÉL (al contrario del estado de cuenta del cliente).

/** Una compra que se le hizo al productor dentro de su estado de cuenta. */
export interface EstadoCuentaCompra {
  fecha: string;
  /** Kilos netos: los que se le pagan. */
  kilos: Monto;
  /** Borona que vino con el lote y NO se paga (0 si no hubo). */
  borona_kilos: Monto;
  precio_kilo: Monto;
  valor_total: Monto;
  abonado: Monto;
  saldo: Monto;
  estado: string; // pendiente | parcial | pagada
}

/**
 * Un pago hecho al productor (abono de cualquiera de sus compras).
 *
 * NO trae `observaciones` a propósito: la observación del abono es la nota
 * INTERNA de la quesera y este bloque se le entrega al productor. Es el mismo
 * criterio de EstadoCuentaPago (ver el incidente que se corrigió allá).
 */
export interface EstadoCuentaPagoProductor {
  fecha: string;
  valor: Monto;
}

/** Cómo va la cuenta con un productor: lo que se le compró, lo que se le pagó y lo que se le debe. */
export interface EstadoCuentaProductor {
  productor: string;
  /** Null en los dos si el estado de cuenta cubre todo el histórico. */
  desde: string | null;
  hasta: string | null;
  emitido: string; // fecha de generación
  compras: number; // cuántas compras se le hicieron (las del sistema, no las del libro)
  total_kilos: Monto;
  /** Lo que valen sus compras. Solo del sistema; el libro anterior va aparte. */
  total_comprado: Monto;
  /** Lo que se le ha abonado por esas compras. */
  total_pagado: Monto;
  /**
   * TODO lo que se le debe hoy, que es la única cifra que le importa:
   * (total_comprado − total_pagado) + libro_anterior_saldo = saldo.
   * Positivo = la quesera le debe a él.
   */
  saldo: Monto;
  compras_detalle: EstadoCuentaCompra[];
  pagos: EstadoCuentaPagoProductor[];
  /** Lo que se le venía debiendo del sistema anterior (solo los de tipo 'pagar'). */
  saldos_anteriores: EstadoCuentaSaldoAnterior[];
  libro_anterior_total: Monto;
  libro_anterior_abonado: Monto;
  libro_anterior_saldo: Monto;
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

export interface SaldoAnteriorPayload {
  /** Solo al crear: de qué lado va la cuenta (la pestaña ya lo decide). */
  tipo: TipoSaldoAnterior;
  tercero: string;
  fecha: string;
  concepto: string;
  valor_total: number;
  /**
   * Solo al crear: lo que el tercero YA había pagado en el libro viejo. Después
   * el abonado solo se mueve registrando o eliminando abonos, igual que en las
   * compras y las ventas.
   */
  abonado?: number;
  observaciones?: string | null;
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

/** Mismos filtros del listado, más el lado del libro anterior que se está viendo. */
export interface SaldoAnteriorListOpts extends ReventaListOpts {
  tipo?: TipoSaldoAnterior | null;
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

  // ------------------------------------------------------------------- lotes
  /**
   * Los lotes de compra con lo que dejó cada uno.
   *
   * `desde`/`hasta` recortan qué lotes se muestran, NO el cálculo: el reparto FIFO
   * se hace siempre sobre toda la historia, porque para saber qué había en
   * inventario en una fecha hay que haber procesado lo de antes.
   */
  lotes(desde?: string | null, hasta?: string | null): Observable<LotesPanel> {
    const params: QueryParams = {};
    if (desde) params['desde'] = desde;
    if (hasta) params['hasta'] = hasta;
    return this.api.get<LotesPanel>(`${this.base}/lotes`, params);
  }

  // -------------------------------------------------------------- temporadas
  /** Las temporadas con la ganancia de cada una, de la más reciente a la más vieja. */
  temporadas(): Observable<TemporadasPanel> {
    return this.api.get<TemporadasPanel>(`${this.base}/temporadas`);
  }

  /** Sin `fecha_fin` la temporada queda ABIERTA. Se puede registrar una ya pasada. */
  crearTemporada(payload: TemporadaPayload): Observable<Temporada> {
    return this.api.post<Temporada>(`${this.base}/temporadas`, payload);
  }

  editarTemporada(id: string, payload: Partial<TemporadaPayload>): Observable<Temporada> {
    return this.api.put<Temporada>(`${this.base}/temporadas/${id}`, payload);
  }

  /** Borra solo el rango con nombre: las compras y las ventas se quedan. */
  eliminarTemporada(id: string): Observable<void> {
    return this.api.delete(`${this.base}/temporadas/${id}`);
  }

  /** Le pone fecha de fin (hoy si no se manda). No congela las cifras. */
  cerrarTemporada(id: string, fechaFin?: string | null): Observable<Temporada> {
    return this.api.post<Temporada>(`${this.base}/temporadas/${id}/cerrar`, {
      fecha_fin: fechaFin ?? null,
    });
  }

  reabrirTemporada(id: string): Observable<Temporada> {
    return this.api.post<Temporada>(`${this.base}/temporadas/${id}/reabrir`);
  }

  // ----------------------------------------- saldos de la cuenta anterior
  listarSaldosAnteriores(opts: SaldoAnteriorListOpts = {}): Observable<Page<SaldoAnterior>> {
    return this.api.get<Page<SaldoAnterior>>(`${this.base}/saldos-anteriores`, opts);
  }

  crearSaldoAnterior(payload: SaldoAnteriorPayload): Observable<SaldoAnterior> {
    return this.api.post<SaldoAnterior>(`${this.base}/saldos-anteriores`, payload);
  }

  /** El `abonado` no se edita aquí: se mueve solo con abonos (igual que compras y ventas). */
  editarSaldoAnterior(
    id: string,
    payload: Partial<Omit<SaldoAnteriorPayload, 'abonado'>>,
  ): Observable<SaldoAnterior> {
    return this.api.put<SaldoAnterior>(`${this.base}/saldos-anteriores/${id}`, payload);
  }

  eliminarSaldoAnterior(id: string): Observable<void> {
    return this.api.delete(`${this.base}/saldos-anteriores/${id}`);
  }

  abonarSaldoAnterior(id: string, payload: AbonoPayload): Observable<SaldoAnterior> {
    return this.api.post<SaldoAnterior>(`${this.base}/saldos-anteriores/${id}/abonos`, payload);
  }

  /** Elimina un abono mal registrado; devuelve el saldo con el estado recalculado. */
  eliminarAbonoSaldoAnterior(saldoId: string, abonoId: string): Observable<SaldoAnterior> {
    return this.api.delete<SaldoAnterior>(
      `${this.base}/saldos-anteriores/${saldoId}/abonos/${abonoId}`,
    );
  }

  anularSaldoAnterior(id: string): Observable<SaldoAnterior> {
    return this.api.post<SaldoAnterior>(`${this.base}/saldos-anteriores/${id}/anular`);
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

  // ---------------------------------------- estado de cuenta del productor
  /**
   * Estado de cuenta de un productor: lo que se le compró, lo que se le pagó y
   * lo que se le debe. Sin `desde`/`hasta` cubre todo el histórico (el saldo real
   * que se le debe, que es el caso normal); con rango se limita a ese período.
   */
  estadoCuentaProductor(
    productor: string,
    desde?: string | null,
    hasta?: string | null,
  ): Observable<EstadoCuentaProductor> {
    return this.api.get<EstadoCuentaProductor>(
      `${this.base}/estado-cuenta-productor`,
      this.paramsEstadoCuentaProductor(productor, desde, hasta),
    );
  }

  /** PDF del estado de cuenta del productor como Blob, para compartírselo. */
  estadoCuentaProductorPdfBlob(
    productor: string,
    desde?: string | null,
    hasta?: string | null,
  ): Observable<Blob> {
    return this.api.getBlob(
      `${this.base}/estado-cuenta-productor/pdf`,
      this.paramsEstadoCuentaProductor(productor, desde, hasta),
    );
  }

  /**
   * Descarga el PDF del estado de cuenta del productor en el navegador.
   *
   * `nombreArchivo` es el nombre de RESPALDO, que se usa cuando el navegador no
   * puede leer la cabecera Content-Disposition (petición cross-origin). Tiene que
   * llevar el nombre del productor: con el genérico todas las cuentas se guardan
   * igual y es fácil entregarle a un productor la cuenta de otro.
   */
  descargarEstadoCuentaProductor(
    productor: string,
    desde?: string | null,
    hasta?: string | null,
    nombreArchivo?: string,
  ): Observable<void> {
    return this.api.download(
      `${this.base}/estado-cuenta-productor/pdf`,
      nombreArchivo || 'estado_cuenta_productor.pdf',
      this.paramsEstadoCuentaProductor(productor, desde, hasta),
    );
  }

  /**
   * Query del estado de cuenta del productor: `desde`/`hasta` solo viajan si
   * tienen valor, para que el backend entienda "todo el histórico" (además
   * `toHttpParams` descarta null, undefined y cadena vacía, nunca manda "null").
   */
  private paramsEstadoCuentaProductor(
    productor: string,
    desde?: string | null,
    hasta?: string | null,
  ): QueryParams {
    const params: QueryParams = { productor };
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
