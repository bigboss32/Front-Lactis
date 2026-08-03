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
  /** La parte del flete de ese despacho que le toca a este lote. */
  gasto: Monto;
  /** Lo que costó el kilo PUESTO en el destino: el queso más el flete. */
  costo_puesto_kilo: Monto;
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
  /**
   * 'produccion' = se hizo aquí, con su leche detrás.
   * 'existencia' = ya estaba en bodega y se cargó a mano; su costo es el que se
   * cargó y no tiene leche. Es el caso normal al empezar a usar el sistema.
   */
  origen: 'produccion' | 'existencia';
  referencia: string | null;
  /** Existencia cargada SIN costo: hace ver la utilidad mejor de lo que es. */
  sin_costo: boolean;
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
  /** Ajustes de inventario hacia abajo: se dañó o se corrigió un sobrante. */
  kilos_de_baja: Monto;
  /**
   * DE `kilos_de_baja`, la parte que es merma de un CIERRE DE CICLO: queso que se
   * secó entre que se pesó al hacerlo y se pesó al venderlo. Es un SUBCONJUNTO y
   * no un cuarto destino: no se vuelve a sumar en el desglose, que ya lo lleva
   * dentro de la baja. Va aparte para distinguir lo normal del oficio (se secó)
   * de lo que sí hay que ir a mirar (se dañó).
   */
  kilos_merma_ciclo: Monto;
  kilos_en_bodega: Monto;
  ingresos: Monto;
  /** Fletes de los despachos, en la parte que le toca a este lote. */
  gastos: Monto;
  /**
   * Lo que costó el kilo PUESTO en el destino (queso + flete), sobre los kilos
   * VENDIDOS: el flete solo se pagó por los que se despacharon, así que dividirlo
   * entre todos le cargaría al queso de bodega un flete que nadie pagó.
   */
  costo_puesto_kilo: Monto;
  costo_vendido: Monto;
  costo_de_baja: Monto;
  /** Subconjunto de `costo_de_baja`: lo que valía el queso que se secó. */
  costo_merma_ciclo: Monto;
  costo_en_bodega: Monto;
  utilidad: Monto;
  precio_venta_kilo: Monto;
  vendido_completo: boolean;
  litros_sin_recepcion: Monto;
  detalle_leche: LecheDelLote[];
  detalle_ventas: VentaDelLoteProduccion[];
}

/**
 * El panel de lotes. Ojo con las dos naturalezas de sus cifras, porque la
 * pantalla las separa a propósito:
 *
 * - Los `total_*` son de los lotes que quedaron DENTRO del rango pedido.
 * - `litros_sin_usar`, `kilos_sin_lote` y los demás avisos son de TODA la
 *   historia: son fotos de hoy y alertas de que falta cargar algo, y esconderlas
 *   al cambiar de mes sería lo contrario de lo que se busca.
 *
 * Y los dos desgloses que tienen que cuadrar al peso, porque el dueño los suma a
 * mano:
 *   total_ingresos − total_costo_vendido − total_costo_de_baja − total_gastos
 *       = total_utilidad
 *   total_costo_vendido + total_costo_de_baja + total_costo_en_bodega
 *       = total_costo
 */
export interface LotesProduccionPanel {
  lotes: LoteProduccion[];
  total_utilidad: Monto;
  total_litros: Monto;
  total_kilos: Monto;
  total_costo: Monto;
  total_ingresos: Monto;
  total_gastos: Monto;
  /** Lo que costó el queso que ya salió del lote: la bisagra entre los dos desgloses. */
  total_costo_vendido: Monto;
  total_costo_de_baja: Monto;
  total_kilos_vendidos: Monto;
  total_kilos_de_baja: Monto;
  /** De las bajas, la parte que se secó. SUBCONJUNTO: no se suma dos veces. */
  total_kilos_merma_ciclo: Monto;
  total_costo_merma_ciclo: Monto;
  total_kilos_en_bodega: Monto;
  total_costo_en_bodega: Monto;
  mejor: string | null;
  peor: string | null;
  /** Queso vendido que no salió de ninguna producción registrada. */
  kilos_sin_lote: Monto;
  ingreso_sin_lote: Monto;
  /** Existencia cargada a mano sin costo: hace ver la utilidad mejor de lo real. */
  kilos_existencia_sin_costo: Monto;
  /** Litros usados en producciones sin leche registrada que los respalde. */
  litros_sin_recepcion: Monto;
  /** Leche recibida que todavía no se ha usado en ninguna producción. */
  litros_sin_usar: Monto;
  costo_litros_sin_usar: Monto;
}

// ---------------------------------------------- cierre de ciclo de despacho
/**
 * La cuenta de la merma para UN tipo de queso dentro del ciclo.
 *
 * Va por tipo y no en un solo total porque no se puede compensar el doble crema
 * que faltó con el campesino que sobró: son dos productos con rendimientos y
 * colas de inventario distintas.
 *
 * La cuenta que lee el dueño, renglón por renglón:
 *   producido − vendido − ya bajado a mano = MERMA
 */
export interface MermaDelTipo {
  tipo_queso_id: string;
  tipo_queso: string;
  kilos_producidos: Monto;
  kilos_vendidos: Monto;
  /** Lo que el dueño YA había bajado a mano: el renglón que evita cobrar dos veces. */
  kilos_ajuste_manual: Monto;
  /** Queso cargado a mano HACIA ARRIBA dentro del ciclo. No entra en la cuenta. */
  kilos_entrada_manual: Monto;
  /** Puede salir NEGATIVO: se vendió más de lo que se produjo. Eso es un aviso. */
  kilos_merma: Monto;
  porcentaje: Monto;
}

/** La parte de la merma que le toca a UNA tanda. La suma da la merma exacta. */
export interface MermaDelLote {
  produccion_id: string;
  fecha: string;
  tipo_queso: string;
  kilos_producidos: Monto;
  kilos_merma: Monto;
  costo_merma: Monto;
}

/**
 * La cuenta de un ciclo ANTES de cerrarlo: lo que el dueño va a aceptar.
 *
 * No escribe nada. Es la pantalla de "se produjeron X kg, salieron Y, la
 * diferencia son Z kg que valen $W", con el desglose por tipo y por tanda.
 */
export interface CicloPropuesta {
  fecha_inicio: string;
  fecha_fin: string;
  dias: number;
  nombre_sugerido: string;
  kilos_producidos: Monto;
  kilos_vendidos: Monto;
  kilos_ajuste_manual: Monto;
  kilos_merma: Monto;
  costo_merma: Monto;
  porcentaje: Monto;
  por_tipo: MermaDelTipo[];
  por_lote: MermaDelLote[];
  /** Merma negativa, desproporcionada, o queso cargado a mano dentro del ciclo. */
  advertencias: string[];
  /** Si ya pasaron los siete días: es lo que hace que el sistema PROPONGA. */
  toca_cerrar: boolean;
  dias_desde_ultimo_cierre: number;
  vacio: boolean;
}

/** Un ciclo con la cuenta que se aceptó al cerrarlo. */
export interface CicloDespacho {
  id: string;
  empresa_id: string;
  estado: string;
  created_at: string;
  updated_at: string;
  nombre: string;
  fecha_inicio: string;
  fecha_fin: string;
  notas: string | null;
  cerrado: boolean;
  cerrado_at: string | null;
  kilos_producidos: Monto;
  kilos_vendidos: Monto;
  kilos_ajuste_manual: Monto;
  kilos_merma: Monto;
  costo_merma: Monto;
  porcentaje: Monto;
  advertencias: string[];
  dias: number;
  por_lote: MermaDelLote[];
}

export interface CiclosPanel {
  ciclos: CicloDespacho[];
  /** Suma EXACTA de los ciclos de la lista, no un recálculo del histórico. */
  total_kilos_producidos: Monto;
  total_kilos_merma: Monto;
  total_costo_merma: Monto;
  /** El ciclo que toca cerrar ahora, con su cuenta ya hecha. */
  propuesta: CicloPropuesta | null;
}

export interface CicloCerrarPayload {
  fecha_inicio: string;
  fecha_fin: string;
  nombre?: string | null;
  notas?: string | null;
  /** Obliga a que quien cierre haya visto la cuenta rara y decida igual. */
  aceptar_advertencias?: boolean;
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

  // ------------------------------------------ cierre de ciclo de despacho
  /** Los ciclos cerrados y el que toca cerrar ahora, con su cuenta ya hecha. */
  ciclos(): Observable<CiclosPanel> {
    return this.api.get<CiclosPanel>(`${this.base}/ciclos`);
  }

  /**
   * La cuenta de un ciclo SIN cerrarlo. Sin fechas propone el que sigue; con
   * fechas calcula el rango que se le pida, que es lo que permite corregir la
   * propuesta antes de aceptarla.
   */
  propuestaCiclo(desde?: string | null, hasta?: string | null): Observable<CicloPropuesta | null> {
    const params: QueryParams = {};
    if (desde) params['desde'] = desde;
    if (hasta) params['hasta'] = hasta;
    return this.api.get<CicloPropuesta | null>(`${this.base}/ciclos/propuesta`, params);
  }

  /** ESTO SÍ ESCRIBE: registra la merma y la baja de la bodega. */
  cerrarCiclo(payload: CicloCerrarPayload): Observable<CicloDespacho> {
    return this.api.post<CicloDespacho>(`${this.base}/ciclos/cerrar`, payload);
  }

  /** Deshace la merma de un ciclo cerrado por equivocación. */
  reabrirCiclo(id: string): Observable<CicloDespacho> {
    return this.api.post<CicloDespacho>(`${this.base}/ciclos/${id}/reabrir`);
  }

  /** Solo se puede borrar un ciclo REABIERTO. */
  eliminarCiclo(id: string): Observable<void> {
    return this.api.delete(`${this.base}/ciclos/${id}`);
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
