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

/**
 * Qué se vende/registra: queso entero, borona (subproducto a menor precio) o
 * mozzarella.
 *
 * LA MOZZARELLA NO SE PESA, SE CUENTA: entra como barra y sale como barra, y el
 * peso de la barra no hace falta para ninguna cuenta. Por eso sus cantidades no
 * viven en los campos `kilos*` sino en los `barras*`, y NUNCA se suman con ellos:
 * "20 kg + 8 barras" no es un número. La plata sí se suma, que los pesos son
 * pesos.
 */
export type TipoVenta = 'queso' | 'borona' | 'mozzarella';

/** Qué se compra: queso (se pesa) o mozzarella (se cuenta por barras). */
export type TipoCompra = 'queso' | 'mozzarella';

/**
 * Los mismos dos tipos de arriba, como LISTA, para poder preguntar «¿este
 * producto ya se puede registrar?».
 *
 * Están tipadas contra las uniones de arriba a propósito: si mañana el backend
 * acepta un tipo más y se agrega a `TipoVenta`, TypeScript no obliga a agregarlo
 * aquí, pero si se escribe aquí uno que la unión no tiene, no compila. Es la
 * dirección que importa: la lista no puede inventar un tipo que el servidor
 * rechazaría.
 *
 * PARA QUÉ SIRVEN. La pestaña de Productos las usa para decirle al dueño, de
 * frente, cuáles de sus productos ya se ofrecen al registrar una compra o una
 * venta: en este corte los renglones siguen guardando el producto en su columna
 * `tipo` y el backend solo acepta estas cadenas, así que un producto nuevo del
 * catálogo todavía no aparece en los formularios. Callarlo dejaría al dueño
 * agregando "Cuajada" y buscándola en vano en la pantalla de ventas.
 */
export const TIPOS_COMPRA: readonly TipoCompra[] = ['queso', 'mozzarella'];
export const TIPOS_VENTA: readonly TipoVenta[] = ['queso', 'borona', 'mozzarella'];

/**
 * En qué se mide una fila. La deduce el backend del `tipo` (una sola fuente de
 * verdad, ver `unidad_de` en models.py) y viaja en la respuesta para que la
 * pantalla ponga el rótulo correcto sin tener que repetir la regla.
 */
export type Unidad = 'kg' | 'barra';

// ------------------------------------------- catálogo de productos de reventa
/**
 * En qué se mide un PRODUCTO del catálogo: se pesa ('kg') o se cuenta ('unidad').
 *
 * OJO, NO ES `Unidad`. Esa dice en qué está medida una FILA ya registrada y sus
 * valores son 'kg' y 'barra' (la barra es la pieza de mozzarella). Esta dice cómo
 * se mide el producto en el catálogo, y el backend la escribe 'unidad' porque no
 * toda pieza es una barra. Son dos vocabularios distintos y por eso son dos
 * tipos distintos: mezclarlos dejaría un 'barra' viajando a un campo que solo
 * acepta 'unidad'.
 */
export type UnidadProducto = 'kg' | 'unidad';

/**
 * UN PRODUCTO DEL CATÁLOGO: qué se compra y se revende, como dato y no como una
 * lista escrita en el código.
 *
 * `clave` es la identidad y NO cambia nunca, ni al renombrar: es la misma cadena
 * que las filas de compras y de ventas ya tienen guardada en su columna `tipo`
 * (ver el modelo del backend). `nombre` es solo el rótulo, y por eso renombrar no
 * tiene riesgo.
 *
 * `decimales` y `admite_ajustes` los DEDUCE el backend de la unidad y no se
 * preguntan; llegan aquí para poder mostrar cómo quedó el producto.
 */
export interface ProductoReventa extends TenantFields {
  nombre: string;
  clave: string;
  unidad: UnidadProducto;
  /** 2 si se pesa, 0 si se cuenta. */
  decimales: number;
  /** De qué producto es subproducto (la borona lo es del queso). */
  subproducto_de_id: string | null;
  /** El nombre del padre, ya resuelto por el servidor. */
  subproducto_de_nombre: string | null;
  /** Si su cantidad puede corregirse con merma o pasándola a borona. */
  admite_ajustes: boolean;
  /** La misma pregunta que `unidad === 'kg'`, dicha como se lee en el negocio. */
  se_pesa: boolean;
  /** Solo presentación: en qué orden se le muestran al dueño. */
  orden: number;
}

/**
 * Lo que se pregunta para agregar un producto: el nombre, cómo se mide y de quién
 * es subproducto. NADA MÁS.
 *
 * No van la clave, los decimales ni `admite_ajustes`: los deduce el backend (la
 * clave del nombre, los otros dos de la unidad). Un campo deducible que además se
 * pregunta es una segunda fuente para el mismo hecho. `orden` tampoco: sin él el
 * producto va al final, que es lo que uno espera al agregar.
 */
export interface ProductoReventaPayload {
  nombre: string;
  unidad?: UnidadProducto;
  subproducto_de_id?: string | null;
}

/**
 * Lo que se puede corregir de un producto ya creado.
 *
 * NI LA CLAVE NI LA UNIDAD ESTÁN, igual que en el esquema del backend: la clave es
 * la identidad con la que su historia lo nombra, y la unidad decide la forma de la
 * cantidad. Renombrar sí, y siempre.
 */
export interface ProductoReventaUpdatePayload {
  nombre?: string;
  subproducto_de_id?: string | null;
  estado?: 'activo' | 'inactivo';
}

export interface ProductoListOpts extends QueryParams {
  page?: number;
  page_size?: number;
  search?: string | null;
  estado?: string | null;
}

export interface AbonoReventa {
  id: string;
  fecha: string;
  valor: Monto;
  observaciones: string | null;
}

export interface CompraQueso extends TenantFields {
  fecha: string;
  productor: string;
  /**
   * A qué FACTURA pertenece este renglón, y en qué lugar de ella.
   *
   * Un renglón es un producto: su cantidad, su precio, su plata y sus abonos. La
   * factura es la cabecera que agrupa varios, y no guarda ni una cifra de plata
   * (su total es la suma de estos renglones, ver `DocumentoReventa`). El `orden`
   * es el que escribió el usuario, que además es el orden en que se derraman los
   * abonos de la factura.
   *
   * `documento_id` en nulo = una compra de las de antes, sin cabecera.
   */
  documento_id: string | null;
  orden: number;
  tipo: TipoCompra;
  /** 'kg' o 'barra': cuál de los dos pares de campos mirar. */
  unidad: Unidad;
  kilos_brutos: Monto;
  borona_kilos: Monto;
  kilos_netos: Monto;
  precio_kilo: Monto;
  /** Barras y su precio. En una compra de kilos van en CERO (lo exige la base). */
  barras: Monto;
  precio_barra: Monto;
  valor_total: Monto;
  abonado: Monto;
  saldo: Monto;
  observaciones: string | null;
  abonos: AbonoReventa[];
  /** Cuántos soportes de pago tiene. Solo el número: las fotos se piden aparte. */
  adjuntos_count: number;
}

export interface VentaQueso extends TenantFields {
  fecha: string;
  cliente: string;
  /** Mismo criterio que en la compra: ver `CompraQueso.documento_id`. */
  documento_id: string | null;
  orden: number;
  tipo: TipoVenta;
  unidad: Unidad;
  kilos: Monto;
  precio_kilo: Monto;
  /** En una venta de kilos van en CERO, y al contrario. */
  barras: Monto;
  precio_barra: Monto;
  valor_total: Monto;
  /** Gastos que conlleva vender el lote (ej. transporte por kilo). No lo paga el cliente. */
  gasto_concepto: string | null;
  gasto_por_kilo: Monto;
  /**
   * El mismo gasto pero POR BARRA. Campo aparte y no reutilizando el de arriba:
   * un valor "por barra" guardado en algo que se llama por_kilo es justo la
   * confusión que hay que evitar.
   */
  gasto_por_barra: Monto;
  /** El gasto en PESOS: por_kilo × kilos, o por_barra × barras. */
  gasto_monto: Monto;
  abonado: Monto;
  saldo: Monto;
  observaciones: string | null;
  abonos: AbonoReventa[];
  /** Cuántos soportes de pago tiene. Solo el número: las fotos se piden aparte. */
  adjuntos_count: number;
}

// --------------------------------- documentos (la factura de varios productos)
/** De qué clase es la factura: una compra a un productor o una venta a un cliente. */
export type TipoDocumento = 'compra' | 'venta';

/** Cuántos productos caben en una factura (el tope es el mismo del backend). */
export const MAX_RENGLONES = 50;

/**
 * Lo COMÚN de una factura de reventa, que es casi todo: la cabecera y las cifras
 * que salen de sumar sus renglones.
 *
 * NINGUNA DE LAS CIFRAS ESTÁ GUARDADA en el servidor: todas se calculan al leer,
 * sumando los renglones. Por eso no pueden desactualizarse ni contradecir el
 * desglose que va al lado, y por eso la pantalla puede imprimir el desglose
 * confiada en que suma la cifra grande.
 *
 * LAS IGUALDADES QUE EL DUEÑO VERIFICA A MANO:
 *
 *     total + total_anulado           === la suma del valor_total de TODOS los renglones
 *     total − abonado + saldo_a_favor === saldo
 *
 * `total` y `abonado` solo cuentan los renglones NO anulados. La plata de un
 * renglón anulado no se esconde: sale aparte en `total_anulado`, que es la única
 * forma honesta de que la columna siga cerrando cuando algo se anula.
 */
interface DocumentoReventaBase extends TenantFields {
  fecha: string;
  /** El cliente (si es venta) o el productor (si es compra). */
  tercero: string;
  observaciones: string | null;
  total: Monto;
  abonado: Monto;
  /**
   * LO QUE DE VERDAD LE FALTA PAGAR: la suma de los saldos POSITIVOS de sus
   * renglones, y NO `total − abonado`.
   *
   * Las dos cuentas se separan cuando a un renglón se le rebajó el precio DESPUÉS
   * de pagarlo, que es un caso permitido a propósito (ver el comentario del
   * `actualizar` de ventas en el backend): ahí ese renglón queda con saldo
   * negativo. `total − abonado` le restaba ese sobrante al saldo de los OTROS
   * renglones, y entonces la factura decía que le faltaban $30.000 cuando de
   * verdad le faltaban $50.000. Acotando en cero el saldo de cada renglón, esta
   * cifra es la MISMA que acota el abono a la factura (ver `capacidad` en el
   * derrame) y la MISMA que suma la cartera (`saldo_pendiente`), así que las tres
   * no pueden contradecirse.
   */
  saldo: Monto;
  /**
   * LO QUE QUEDÓ PAGADO DE MÁS, en positivo y con su propio campo: la suma de los
   * saldos negativos de los renglones, con el signo volteado. Antes se escondía
   * restándose por dentro de `saldo`.
   *
   * OPCIONAL a propósito, y no por descuido: el backend la está agregando en este
   * mismo corte y la pantalla tiene que servir con las dos versiones. Cuando no
   * viene, la vista deriva las dos cifras de los renglones —que sí llegan
   * completos en la respuesta— y saca exactamente la misma cuenta; ver
   * `cifrasDelSaldo` en documento-list.tab.ts.
   */
  saldo_a_favor?: Monto;
  /** La plata de los renglones anulados, aparte. Ver la igualdad de arriba. */
  total_anulado: Monto;
  /** Derivado de los renglones: pendiente | parcial | pagada | anulada. */
  estado_pago: string;
  cantidad_renglones: number;
}

/** Una factura de COMPRA: sus renglones son filas de `compras_queso`. */
export interface DocumentoCompra extends DocumentoReventaBase {
  tipo: 'compra';
  renglones: CompraQueso[];
}

/** Una factura de VENTA: sus renglones son filas de `ventas_queso`. */
export interface DocumentoVenta extends DocumentoReventaBase {
  tipo: 'venta';
  renglones: VentaQueso[];
}

/**
 * Una factura de reventa. Se discrimina por `tipo`, igual que en el backend: es
 * lo que hace que `documento.renglones` tenga la forma correcta sin castings ni
 * `any` en las pantallas.
 */
export type DocumentoReventa = DocumentoCompra | DocumentoVenta;

/**
 * UN PRODUCTO de una venta: qué, cuánto y a qué precio. Sin fecha ni cliente,
 * que son de la factura y no del renglón.
 *
 * Solo viaja el par de campos de LA UNIDAD del producto (kilos para el queso y
 * la borona, barras para la mozzarella) y los del otro par no viajan ni en cero:
 * es el mismo criterio del payload plano, y es lo que hace imposible que un
 * intento previo en kilos se cuele en un renglón de barras.
 */
export interface RenglonVentaPayload {
  tipo: TipoVenta;
  // --- si tipo = queso o borona (se pesa)
  kilos?: number;
  precio_kilo?: number;
  gasto_por_kilo?: number;
  // --- si tipo = mozzarella (barras COMPLETAS: el backend rechaza decimales)
  barras?: number;
  precio_barra?: number;
  gasto_por_barra?: number;
  gasto_concepto?: string | null;
  observaciones?: string | null;
}

/** UN PRODUCTO de una compra. Mismo criterio que el renglón de venta. */
export interface RenglonCompraPayload {
  tipo: TipoCompra;
  // --- si tipo = queso (se pesa)
  kilos_brutos?: number;
  borona_kilos?: number;
  precio_kilo?: number;
  // --- si tipo = mozzarella (se cuenta)
  barras?: number;
  precio_barra?: number;
  observaciones?: string | null;
}

/**
 * Una VENTA de varios productos: la cabecera y sus renglones.
 *
 * La cabecera NO LLEVA NI UNA CIFRA DE PLATA, a propósito y por contrato: el
 * total es la suma de los renglones y se calcula al leer. Dos fuentes para el
 * mismo hecho terminan contradiciéndose.
 */
export interface DocumentoVentaPayload {
  tipo: 'venta';
  fecha: string;
  tercero: string;
  observaciones?: string | null;
  renglones: RenglonVentaPayload[];
  /** Registra la factura completa ya pagada. Se derrama sobre los renglones. */
  pagada_de_contado?: boolean;
}

/** Una COMPRA de varios productos. Sin `pagada_de_contado`: no existe al comprar. */
export interface DocumentoCompraPayload {
  tipo: 'compra';
  fecha: string;
  tercero: string;
  observaciones?: string | null;
  renglones: RenglonCompraPayload[];
}

export type DocumentoReventaPayload = DocumentoCompraPayload | DocumentoVentaPayload;

/**
 * Edición de una factura.
 *
 * `tipo` ES OBLIGATORIO aunque el id ya diga cuál es: es el discriminador con el
 * que el backend decide la forma de los renglones, y tiene que coincidir con el
 * de la factura guardada.
 *
 * `renglones` AUSENTE (o en nulo) significa «no me toque los productos»: es la
 * edición de solo cabecera, la única que se permite cuando la factura ya tiene
 * abonos. Mandar la lista significa REHACERLOS.
 */
export interface DocumentoVentaUpdatePayload {
  tipo: 'venta';
  fecha: string;
  tercero: string;
  observaciones?: string | null;
  renglones?: RenglonVentaPayload[] | null;
}

export interface DocumentoCompraUpdatePayload {
  tipo: 'compra';
  fecha: string;
  tercero: string;
  observaciones?: string | null;
  renglones?: RenglonCompraPayload[] | null;
}

export type DocumentoReventaUpdatePayload =
  | DocumentoCompraUpdatePayload
  | DocumentoVentaUpdatePayload;

/**
 * Filtros del listado de facturas.
 *
 * NO LLEVA `estado`: el backend todavía no sabe filtrar facturas por estado de
 * pago (el estado de la factura es DERIVADO de sus renglones, no una columna que
 * se pueda comparar en SQL). Las pestañas lo resuelven mirando la página que ya
 * tienen y diciéndolo de frente; ver `coincideEstado` en las listas.
 */
export interface DocumentoListOpts extends QueryParams {
  page?: number;
  page_size?: number;
  tipo?: TipoDocumento | null;
  /** Busca por el nombre del tercero. */
  search?: string | null;
  desde?: string | null;
  hasta?: string | null;
}

// ------------------------------------- adjuntos (soportes de transferencia)
/**
 * Un soporte de pago con su enlace TEMPORAL.
 *
 * `url` no está guardada en ninguna parte: el backend la firma cada vez que se
 * pide la lista y se muere sola a los pocos minutos (`url_expira`). Si la
 * pantalla queda abierta media hora, los enlaces que tiene en memoria ya no
 * sirven y hay que volver a pedir la lista.
 *
 * Es `null` cuando el almacenamiento no está configurado en el servidor: la
 * fila igual se muestra, pero sin poder abrirla.
 */
export interface AdjuntoReventa {
  id: string;
  compra_id: string | null;
  venta_id: string | null;
  nombre_archivo: string;
  content_type: string;
  tamano_bytes: number;
  es_imagen: boolean;
  subido_por_nombre: string | null;
  created_at: string;
  url: string | null;
  url_expira: string | null;
}

export interface AdjuntosLista {
  /** false = el servidor no tiene configurado el almacenamiento de imágenes. */
  disponible: boolean;
  mensaje: string | null;
  cupo_restante: number;
  adjuntos: AdjuntoReventa[];
}

/** Enlace de más duración para mandar UNA imagen por fuera (WhatsApp). */
export interface EnlaceCompartido {
  url: string;
  nombre_archivo: string;
  expira: string;
  /** Ya viene en cristiano y en hora de Colombia: "hasta el martes 5 de agosto...". */
  expira_texto: string;
  dias: number;
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

/** Un día del informe "cuánto gané": lo vendido ese día menos lo que costó. */
export interface GananciaDia {
  fecha: string;
  kilos: Monto;
  ingresos: Monto;
  /** Lo que había costado ESE queso (reparto FIFO exacto, no un promedio). */
  costo: Monto;
  gastos: Monto;
  ganancia: Monto;
}

/**
 * GET /reventa/ganancia-por-dia: la ganancia REAL entre dos fechas.
 *
 * No confundir con la del resumen ("ventas menos compras del período"), que sale
 * negativa cuando se compra mucho y se vende poco aunque no se haya perdido
 * nada: el queso está en la bodega. Aquí las compras no restan, porque comprar
 * es cambiar plata por queso, no gastarla.
 *
 * Los días SUMAN los totales: el total se calcula sumándolos, así que el
 * desglose cuadra por construcción.
 */
export interface GananciaPorDia {
  desde: string;
  hasta: string;
  dias: GananciaDia[];
  kilos: Monto;
  ingresos: Monto;
  costo: Monto;
  gastos: Monto;
  ganancia: Monto;
}

/**
 * Los lotes con lo que dejó cada uno.
 *
 * ESTE PANEL ES SOLO DE KILOS. La mozzarella no entra en el reparto por lotes (el
 * motor cuesta en kilos de punta a punta), así que ninguna cifra de aquí la
 * incluye. Eso no se esconde: `barras_fuera_del_reparto` dice cuántas barras hay
 * compradas que no están contadas acá, y la pantalla lo advierte y manda a leer la
 * ganancia de la mozzarella en el Resumen, que la tiene completa y en su unidad.
 */
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
  /**
   * Barras compradas (histórico) que NO están contadas en este panel. A
   * diferencia de las tres de arriba NO es un error: es el alcance del panel
   * dicho de frente. Cero = el panel cubre todo el negocio.
   */
  barras_fuera_del_reparto: Monto;
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
  // Mozzarella de la temporada, en BARRAS y nunca sumada con los kilos de arriba
  barras_compradas: Monto;
  barras_vendidas: Monto;
  barras_pendientes: Monto;
  // Plata: incluye las dos unidades (los pesos son pesos)
  total_compras: Monto;
  total_ventas: Monto;
  total_gastos: Monto;
  ganancia: Monto;
  margen_por_kilo: Monto;
  precio_promedio_compra: Monto;
  precio_promedio_venta: Monto;
  precio_promedio_compra_barra: Monto;
  precio_promedio_venta_barra: Monto;
  /** Lo que falta de ESTA temporada: no la cartera de siempre ni el libro anterior. */
  por_cobrar: Monto;
  por_pagar: Monto;
  /**
   * Ya no falta nada: sin queso pendiente, SIN BARRAS PENDIENTES, sin cobrar y
   * sin pagar. Mira las dos unidades por separado: una temporada con 8 barras en
   * la bodega no está cerrada aunque no le quede un gramo de queso.
   */
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
export type ProductoGanancia =
  | 'queso'
  | 'borona'
  | 'merma'
  | 'pendiente'
  | 'anterior'
  // Los de la mozzarella, medidos en BARRAS. Solo llegan si hubo mozzarella en el
  // período: un negocio de puro queso sigue recibiendo los cinco de arriba.
  | 'mozzarella'
  | 'mozzarella_pendiente'
  | 'mozzarella_anterior';

/**
 * Fila del desglose de ganancia por producto.
 *
 * CADA RENGLÓN TIENE SU PROPIA UNIDAD y las cantidades NO se suman entre
 * renglones distintos. En un renglón de barras los campos de kilos llegan en
 * CERO y al contrario, así que sumar la columna `kilos` de toda la tabla da kilos
 * de verdad. `unidad` dice cuál de los dos pares mirar.
 *
 * Los pesos (ingreso, costo, gastos, ganancia) sí son comparables y sumables
 * entre TODOS los renglones: su suma es `ganancia_estimada`.
 */
export interface GananciaProducto {
  producto: ProductoGanancia;
  etiqueta: string; // texto listo para mostrar en la UI
  nota: string; // sub-texto explicativo corto
  /** 'kg' o 'barra': en qué se mide ESTE renglón. */
  unidad: Unidad;
  /** Kilos DEL LOTE COMPRADO que fueron a este destino (siempre >= 0). */
  kilos: Monto;
  /** Kilos realmente vendidos. Solo difiere de `kilos` en la borona. */
  kilos_vendidos: Monto;
  /** Lo mismo en barras. Solo tienen valor en los renglones de mozzarella. */
  barras: Monto;
  barras_vendidas: Monto;
  ingreso: Monto;
  costo: Monto; // negativo solo en la fila 'anterior': se pagó en otra temporada
  gastos: Monto;
  ganancia: Monto; // ingreso - costo - gastos
  precio_venta_kilo: Monto; // ingreso / kilos_vendidos (0 si no se vendió)
  costo_kilo: Monto; // = precio_promedio_compra
  /** Los mismos dos precios, POR BARRA. Campos aparte: ver el comentario del tipo. */
  precio_venta_barra: Monto;
  costo_barra: Monto;
}

/**
 * Ganancia estimada de lo que se le compró a cada productor en el período.
 *
 * El reparto se hace POR UNIDAD y por separado (lo neto de las ventas en kilos
 * entre los kilos comprados, y lo de las ventas en barras entre las barras), y
 * las dos partes se SUMAN en `ganancia_estimada` porque son pesos. Las
 * cantidades `kilos` y `barras` van en columnas separadas y nunca se suman.
 */
export interface GananciaProductor {
  productor: string;
  compras: number; // cuántas compras en el período
  kilos: Monto;
  barras: Monto;
  /** Valor de TODAS sus compras (kilos + barras). NO es lo que se le ha pagado. */
  total_comprado: Monto;
  /** De ese total, el pedazo de sus compras de mozzarella. */
  total_comprado_barras: Monto;
  precio_promedio: Monto; // (total_comprado - total_comprado_barras) / kilos
  precio_promedio_barra: Monto; // total_comprado_barras / barras
  por_pagar: Monto; // lo que se le debe hoy (histórico, no solo del período)
  margen_por_kilo: Monto; // valor_realizado_kilo - precio_promedio
  margen_por_barra: Monto; // el mismo margen, por barra
  ganancia_estimada: Monto; // la de kilos MÁS la de barras (pesos con pesos)
}

/**
 * El resumen del período.
 *
 * CÓMO LEER LAS CANTIDADES: los campos `kilos_*` son kilos y los `barras_*` son
 * barras, y NUNCA hay uno que pueda ser lo uno o lo otro. No existe ni existirá
 * un "total de unidades" que las junte: 20 kg de queso y 8 barras de mozzarella
 * no son 28 de nada.
 *
 * LA PLATA SÍ SE SUMA. `total_compras`, `total_ventas`, `total_gastos` y
 * `ganancia_estimada` incluyen las dos unidades. Enseguida de cada uno va el
 * pedazo de la mozzarella por separado, para poder cuadrar el desglose a mano:
 *   total_compras = (compras en kilos) + total_compras_mozzarella
 *   total_ventas  = ventas de queso + ventas de borona + total_ventas_mozzarella
 */
export interface ResumenReventa {
  desde: string;
  hasta: string;
  // Del período (queso)
  kilos_comprados: Monto;
  total_compras: Monto; // TODA la plata comprada: kilos + barras
  kilos_vendidos: Monto; // solo ventas tipo queso
  total_ventas: Monto; // queso + borona + mozzarella (pesos con pesos)
  precio_promedio_compra: Monto; // por KILO: (compras en kilos) / kilos_comprados
  precio_promedio_venta: Monto; // solo queso
  total_gastos: Monto; // gastos de venta del período
  ganancia_estimada: Monto; // ventas - compras del período - gastos (neta)
  /**
   * Ganancia neta por kilo vendido (queso + borona). Solo mira la plata de las
   * ventas EN KILOS: meterle la de la mozzarella daría pesos por kilo inflados
   * con plata que no salió de ningún kilo.
   */
  margen_por_kilo: Monto;
  // Del período (borona)
  kilos_borona_vendidos: Monto;
  total_ventas_borona: Monto;
  // Del período (MOZZARELLA, en barras: su propio renglón de punta a punta)
  barras_compradas: Monto;
  total_compras_mozzarella: Monto;
  barras_vendidas: Monto;
  total_ventas_mozzarella: Monto;
  total_gastos_mozzarella: Monto;
  precio_promedio_compra_barra: Monto;
  precio_promedio_venta_barra: Monto;
  margen_por_barra: Monto; // ganancia de la mozzarella / barras vendidas
  valor_realizado_barra: Monto; // (ventas − gastos) de barras / barras COMPRADAS
  /** Residuo CON SIGNO: barras compradas − vendidas en el período. */
  barras_pendientes: Monto;
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
  /**
   * Barras de mozzarella en bodega: compradas − vendidas. Su propio inventario,
   * con su propia unidad, jamás sumado con los dos de arriba.
   */
  barras_disponibles: Monto;
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

/**
 * Una compra del cliente dentro de su estado de cuenta.
 *
 * La cantidad va en el campo de SU unidad y el otro en cero; `unidad` dice cuál
 * mirar. Le importa al cliente: si su fila de mozzarella dijera "0 kg" no
 * reconocería su propia compra, y si dijera "8 kg" por 8 barras el documento
 * estaría mintiendo sobre lo que se le despachó.
 */
export interface EstadoCuentaVenta {
  fecha: string;
  tipo: TipoVenta;
  /** Nombre del producto listo para mostrar: 'Queso', 'Borona' o 'Mozzarella'. */
  producto: string;
  unidad: Unidad;
  kilos: Monto;
  precio_kilo: Monto;
  barras: Monto;
  precio_barra: Monto;
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
  /**
   * LAS DOS CANTIDADES VAN SEPARADAS y no hay un total que las junte: si compró
   * 40 kg de queso y 8 barras, "48" no es nada. `total_kilos` no incluye barras y
   * `total_barras` no incluye kilos.
   */
  total_kilos: Monto;
  total_barras: Monto;
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

/**
 * Una compra que se le hizo al productor dentro de su estado de cuenta.
 *
 * Mismo criterio que en el documento del cliente: la cantidad en el campo de SU
 * unidad y `unidad` diciendo cuál mirar. Al productor le importa igual o más: si
 * su fila de mozzarella dijera "0 kg" no reconocería la entrega que él mismo hizo
 * y cuadrar cuentas con él terminaría en discusión.
 */
export interface EstadoCuentaCompra {
  fecha: string;
  tipo: TipoCompra;
  unidad: Unidad;
  /** Kilos netos: los que se le pagan. */
  kilos: Monto;
  /** Borona que vino con el lote y NO se paga (0 si no hubo). */
  borona_kilos: Monto;
  precio_kilo: Monto;
  barras: Monto;
  precio_barra: Monto;
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
  /** Kilos netos, los que se le pagan. NO incluye barras. */
  total_kilos: Monto;
  /** Barras de mozzarella que se le compraron, en su propio total. */
  total_barras: Monto;
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
// EL TIPO SOLO VIAJA AL CREAR. Una compra o una venta nace en kilos o en barras y
// se queda así: cambiárselo a una que ya tiene movimientos encima movería la
// mercancía de una cola de inventario a la otra. El backend ni lo acepta en el
// PUT (ver CompraQuesoUpdate/VentaQuesoUpdate en schemas.py).
//
// Los campos de las DOS unidades son opcionales porque solo se manda el par de la
// unidad del tipo: una compra de mozzarella no tiene kilos que informar y una de
// queso no tiene barras. El backend exige el par correcto y pone el otro en cero.
export interface CompraQuesoPayload {
  fecha: string;
  productor: string;
  /** Solo al crear: queso (se pesa) o mozzarella (se cuenta por barras). */
  tipo?: TipoCompra;
  // --- si tipo = queso
  kilos_brutos?: number;
  borona_kilos?: number;
  precio_kilo?: number;
  // --- si tipo = mozzarella (barras COMPLETAS: el backend rechaza decimales)
  barras?: number;
  precio_barra?: number;
  observaciones?: string | null;
}

export interface VentaQuesoPayload {
  fecha: string;
  cliente: string;
  /** Solo al crear: queso, borona o mozzarella (no editable después). */
  tipo: TipoVenta;
  // --- si tipo = queso o borona
  kilos?: number;
  precio_kilo?: number;
  gasto_por_kilo?: number;
  // --- si tipo = mozzarella (barras COMPLETAS: el backend rechaza decimales)
  barras?: number;
  precio_barra?: number;
  gasto_por_barra?: number;
  gasto_concepto?: string | null;
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

  // ------------------------------------------ catálogo de productos de reventa
  /** El catálogo EN EL ORDEN EN QUE EL DUEÑO LO PUSO (no por fecha: lo ordena el servidor). */
  listarProductos(opts: ProductoListOpts = {}): Observable<Page<ProductoReventa>> {
    return this.api.get<Page<ProductoReventa>>(`${this.base}/productos`, opts);
  }

  /**
   * Agrega un producto. Si ese producto YA EXISTIÓ y se había quitado, el servidor
   * devuelve LA MISMA FILA reactivada —mismo id y misma clave, para que sus
   * movimientos viejos sigan cuadrando con él— y no la redefine: vuelve con la
   * unidad que tenía. Por eso la pantalla mira la unidad de la respuesta y no la
   * que se pidió.
   */
  crearProducto(payload: ProductoReventaPayload): Observable<ProductoReventa> {
    return this.api.post<ProductoReventa>(`${this.base}/productos`, payload);
  }

  /** Renombrar, moverlo de padre (solo sin movimientos) o activarlo/desactivarlo. */
  editarProducto(
    id: string,
    payload: ProductoReventaUpdatePayload,
  ): Observable<ProductoReventa> {
    return this.api.put<ProductoReventa>(`${this.base}/productos/${id}`, payload);
  }

  /**
   * Quita un producto del catálogo. El servidor lo RECHAZA si ya tiene compras o
   * ventas, y en el mensaje dice cuántas y ofrece la salida: desactivarlo. Ese
   * mensaje se muestra tal cual, porque es el que trae la cuenta exacta.
   */
  eliminarProducto(id: string): Observable<void> {
    return this.api.delete(`${this.base}/productos/${id}`);
  }

  // ------------------------------------- documentos (facturas de N productos)
  /**
   * Las facturas de VENTA con sus renglones y su total calculado.
   *
   * Hay un método por clase de factura, y no uno con el tipo por parámetro, para
   * que el tipo de la respuesta sea el correcto: quien pide ventas recibe
   * `DocumentoVenta` y sus renglones son `VentaQueso`, sin castings.
   */
  listarDocumentosVenta(opts: DocumentoListOpts = {}): Observable<Page<DocumentoVenta>> {
    return this.api.get<Page<DocumentoVenta>>(`${this.base}/documentos`, {
      ...opts,
      tipo: 'venta',
    });
  }

  listarDocumentosCompra(opts: DocumentoListOpts = {}): Observable<Page<DocumentoCompra>> {
    return this.api.get<Page<DocumentoCompra>>(`${this.base}/documentos`, {
      ...opts,
      tipo: 'compra',
    });
  }

  crearDocumento(payload: DocumentoReventaPayload): Observable<DocumentoReventa> {
    return this.api.post<DocumentoReventa>(`${this.base}/documentos`, payload);
  }

  /**
   * Corrige una factura. La fecha, el nombre y la nota se pueden cambiar SIEMPRE
   * (y el backend se los copia a todos los renglones, que es de donde leen el
   * resumen y la cartera). Mandar `renglones` REHACE los productos, y eso el
   * backend solo lo permite si la factura no tiene abonos.
   */
  editarDocumento(
    id: string,
    payload: DocumentoReventaUpdatePayload,
  ): Observable<DocumentoReventa> {
    return this.api.put<DocumentoReventa>(`${this.base}/documentos/${id}`, payload);
  }

  /**
   * Un abono a la factura entera. SE DERRAMA, NO SE DIVIDE: entra a los renglones
   * en su orden, `min(lo que queda, el saldo del renglón)` a cada uno. Sin
   * división no hay redondeo, así que la suma de los abonos da el abono exacto.
   */
  abonarDocumento(id: string, payload: AbonoPayload): Observable<DocumentoReventa> {
    return this.api.post<DocumentoReventa>(`${this.base}/documentos/${id}/abonos`, payload);
  }

  /** Anula la factura anulando todos sus renglones (uno por uno, con sus reglas). */
  anularDocumento(id: string): Observable<DocumentoReventa> {
    return this.api.post<DocumentoReventa>(`${this.base}/documentos/${id}/anular`);
  }

  eliminarDocumento(id: string): Observable<void> {
    return this.api.delete(`${this.base}/documentos/${id}`);
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

  /**
   * Cuánto se ganó DE VERDAD entre dos fechas, día por día.
   *
   * Distinto del resumen: allá se restan las compras del período y por eso un
   * mes de mucha compra sale en pérdida. Aquí solo cuentan las ventas de esos
   * días, con el costo exacto del queso que salió en cada una.
   */
  gananciaPorDia(desde: string, hasta: string): Observable<GananciaPorDia> {
    return this.api.get<GananciaPorDia>(`${this.base}/ganancia-por-dia`, { desde, hasta });
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

  // ------------------------------------ adjuntos (soportes de transferencia)
  /** Los soportes del documento, con enlaces firmados de corta duración. */
  adjuntosDeCompra(compraId: string): Observable<AdjuntosLista> {
    return this.api.get<AdjuntosLista>(`${this.base}/compras/${compraId}/adjuntos`);
  }

  adjuntosDeVenta(ventaId: string): Observable<AdjuntosLista> {
    return this.api.get<AdjuntosLista>(`${this.base}/ventas/${ventaId}/adjuntos`);
  }

  /**
   * Sube N soportes en UNA sola petición e informa el progreso.
   *
   * Una petición por archivo sería más simple, pero con la señal del campo unas
   * pasarían y otras no, y el dueño quedaría sin saber cuáles de sus fotos
   * alcanzaron a subir. Así es todo o nada, y el backend además valida todos los
   * archivos antes de guardar el primero.
   */
  subirAdjuntosDeCompra(
    compraId: string,
    archivos: File[],
  ): Observable<{ progreso: number; cuerpo?: AdjuntosLista }> {
    return this.api.uploadVarios<AdjuntosLista>(
      `${this.base}/compras/${compraId}/adjuntos`,
      archivos,
    );
  }

  subirAdjuntosDeVenta(
    ventaId: string,
    archivos: File[],
  ): Observable<{ progreso: number; cuerpo?: AdjuntosLista }> {
    return this.api.uploadVarios<AdjuntosLista>(
      `${this.base}/ventas/${ventaId}/adjuntos`,
      archivos,
    );
  }

  /** Enlace largo para mandar UNA imagen por fuera. Queda en la auditoría. */
  compartirAdjunto(adjuntoId: string): Observable<EnlaceCompartido> {
    return this.api.post<EnlaceCompartido>(`${this.base}/adjuntos/${adjuntoId}/compartir`);
  }

  /** Borra el soporte y también el archivo del almacenamiento. */
  eliminarAdjunto(adjuntoId: string): Observable<void> {
    return this.api.delete(`${this.base}/adjuntos/${adjuntoId}`);
  }
}
