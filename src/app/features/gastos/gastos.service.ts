import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService, ListOpts } from '../../core/api.service';
import { Gasto, Page } from '../../core/models';
import { EnlaceSoporte, SoporteArchivo, SoportesLista } from '../../shared/soportes.model';

export interface GastoPayload {
  fecha: string; // ISO 'YYYY-MM-DD'
  categoria_id: string;
  concepto: string;
  proveedor?: string | null;
  valor: number | string;
  numero_factura?: string | null;
  observaciones?: string | null;
  sucursal_id?: string | null;
  estado?: string;
}

/** Filtros del listado avanzado GET /gastos/filtrar/avanzado. */
export interface GastoFiltro extends ListOpts {
  categoria_id?: string | null;
  desde?: string | null;
  hasta?: string | null;
}

/** Una factura del gasto. Es la misma forma de los soportes de los otros módulos. */
export interface AdjuntoGasto extends SoporteArchivo {
  gasto_id: string;
}

export interface AdjuntosGastoLista extends SoportesLista {
  adjuntos: AdjuntoGasto[];
}

@Injectable({ providedIn: 'root' })
export class GastosService extends CrudService<Gasto, GastoPayload> {
  constructor() {
    super('/gastos');
  }

  /** Listado con filtros por categoría y rango de fechas. */
  filtrar(opts: GastoFiltro = {}): Observable<Page<Gasto>> {
    return this.api.get<Page<Gasto>>(`${this.base}/filtrar/avanzado`, opts);
  }

  /**
   * Cuánto suman TODOS los gastos que cumplen los filtros, no solo la página.
   *
   * RECIBE LOS MISMOS FILTROS QUE `filtrar` y no unos parecidos: es la cifra que
   * el dueño compara contra los renglones de la tabla, sumándolos a mano.
   */
  sumaTotales(opts: GastoFiltro = {}): Observable<number> {
    const { search, categoria_id, desde, hasta } = opts;
    return this.api.get<number>(`${this.base}/totales/suma`, {
      search,
      categoria_id,
      desde,
      hasta,
    });
  }

  // ------------------------------------------------------------- facturas
  // Las cuatro llamadas que necesita el diálogo compartido de soportes
  // (`shared/soportes.dialog.ts`), el mismo que ya usan reventa y liquidaciones.

  /** Las facturas del gasto, con enlaces firmados de CORTA duración. */
  adjuntos(id: string): Observable<AdjuntosGastoLista> {
    return this.api.get<AdjuntosGastoLista>(`${this.base}/${id}/adjuntos`);
  }

  /**
   * Sube N facturas en UNA sola petición e informa el progreso.
   *
   * Una petición por archivo sería más simple, pero con la señal del campo unas
   * pasarían y otras no, y el dueño quedaría sin saber cuáles alcanzaron a subir.
   * Así es todo o nada, y el backend además valida todos los archivos antes de
   * guardar el primero.
   *
   * La respuesta es la LISTA COMPLETA ya actualizada y con enlaces frescos, así
   * que no hay que volver a pedirla después de subir.
   */
  subirAdjuntos(
    id: string,
    archivos: File[],
  ): Observable<{ progreso: number; cuerpo?: AdjuntosGastoLista }> {
    return this.api.uploadVarios<AdjuntosGastoLista>(`${this.base}/${id}/adjuntos`, archivos);
  }

  /**
   * Enlace largo para mandar UNA factura por fuera. Queda en la auditoría.
   *
   * Va por el id de la factura y sin el gasto en la ruta: es el mismo camino que
   * en reventa y en liquidaciones, y el backend aísla por empresa con la columna
   * que la propia factura lleva adentro.
   */
  compartirAdjunto(adjuntoId: string): Observable<EnlaceSoporte> {
    return this.api.post<EnlaceSoporte>(`${this.base}/adjuntos/${adjuntoId}/compartir`);
  }

  /** Quita la factura y también el archivo del almacenamiento. */
  eliminarAdjunto(adjuntoId: string): Observable<void> {
    return this.api.delete(`${this.base}/adjuntos/${adjuntoId}`);
  }
}
