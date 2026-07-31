import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService, ListOpts } from '../../core/api.service';
import {
  CarteraFleteCliente,
  CarteraFleteDetalle,
  ResumenTransporte,
  VehiculoGasto,
  Viaje,
  ViajeDetalle,
  ViajeServicio,
} from '../../core/models';

/**
 * Etiquetas legibles de los estados del viaje. El backend maneja `en_curso`
 * (con guion bajo); el chip de estado colorea por la etiqueta legible.
 */
export const ETIQUETAS_ESTADO_VIAJE: Record<string, string> = {
  en_curso: 'en curso',
  finalizado: 'finalizado',
  anulado: 'anulado',
};

export interface ViajePayload {
  vehiculo_id: string;
  fecha_salida: string; // ISO 'YYYY-MM-DD'
  origen: string;
  destino: string;
  conductor_nombre?: string | null;
  /** Pago al conductor por el viaje; cuenta como gasto del viaje. */
  pago_conductor: number;
  odometro_salida?: number | null;
  observaciones?: string | null;
}

/** Filtros del listado GET /transporte/viajes. */
export interface ViajeFiltro extends ListOpts {
  vehiculo_id?: string | null;
  desde?: string | null;
  hasta?: string | null;
}

export interface ViajeFinalizarPayload {
  fecha_regreso?: string | null;
  odometro_regreso?: number | null;
}

export interface ViajeServicioPayload {
  sentido: 'ida' | 'regreso';
  tipo_cobro: 'por_kilo' | 'precio_fijo';
  es_interno: boolean;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  descripcion: string;
  kilos?: number | null;
  /** Por kilo: si no viene, el backend usa la tarifa base del vehículo. */
  tarifa_kilo?: number | null;
  /** Precio fijo: obligatorio. Por kilo lo calcula el backend (kilos × tarifa). */
  valor_total?: number | null;
  observaciones?: string | null;
  /** Solo al crear: registra el abono automático y deja el servicio pagado. */
  pagado_de_contado?: boolean;
}

export interface AbonoFletePayload {
  fecha: string; // ISO 'YYYY-MM-DD'
  valor: number;
  metodo: 'efectivo' | 'transferencia' | 'otro';
  referencia?: string | null;
  observaciones?: string | null;
}

/** Atajo POST /viajes/{id}/gastos: el backend fija vehículo y viaje. */
export interface ViajeGastoPayload {
  fecha: string; // ISO 'YYYY-MM-DD'
  categoria: string;
  concepto?: string | null;
  valor: number;
  odometro?: number | null;
}

@Injectable({ providedIn: 'root' })
export class ViajesService extends CrudService<Viaje, ViajePayload> {
  constructor() {
    super('/transporte/viajes');
  }

  /** Detalle completo del viaje: servicios, gastos y totales de rentabilidad. */
  detalle(id: string): Observable<ViajeDetalle> {
    return this.api.get<ViajeDetalle>(`${this.base}/${id}`);
  }

  /** Cierra el viaje; con odómetro de regreso actualiza el del vehículo. */
  finalizar(id: string, payload: ViajeFinalizarPayload = {}): Observable<ViajeDetalle> {
    return this.api.post<ViajeDetalle>(`${this.base}/${id}/finalizar`, payload);
  }

  /** Reabre un viaje finalizado para corregir servicios o gastos. */
  reabrir(id: string): Observable<ViajeDetalle> {
    return this.api.post<ViajeDetalle>(`${this.base}/${id}/reabrir`);
  }

  /** Anula el viaje y sus servicios en cascada (exige cero abonos). */
  anular(id: string): Observable<ViajeDetalle> {
    return this.api.post<ViajeDetalle>(`${this.base}/${id}/anular`);
  }

  // --------------------------------------------------------------- servicios
  agregarServicio(viajeId: string, payload: ViajeServicioPayload): Observable<ViajeServicio> {
    return this.api.post<ViajeServicio>(`${this.base}/${viajeId}/servicios`, payload);
  }

  actualizarServicio(
    viajeId: string,
    servicioId: string,
    payload: Omit<ViajeServicioPayload, 'pagado_de_contado'>,
  ): Observable<ViajeServicio> {
    return this.api.put<ViajeServicio>(`${this.base}/${viajeId}/servicios/${servicioId}`, payload);
  }

  /** Elimina un servicio (solo sin abonos y con el viaje en curso). */
  eliminarServicio(viajeId: string, servicioId: string): Observable<void> {
    return this.api.delete(`${this.base}/${viajeId}/servicios/${servicioId}`);
  }

  /** Anula un servicio conservando el registro (exige permiso administrar). */
  anularServicio(viajeId: string, servicioId: string): Observable<ViajeServicio> {
    return this.api.post<ViajeServicio>(`${this.base}/${viajeId}/servicios/${servicioId}/anular`);
  }

  // ------------------------------------------------------------------ abonos
  /** Registra un abono al flete; devuelve el servicio con el saldo recalculado. */
  registrarAbono(servicioId: string, payload: AbonoFletePayload): Observable<ViajeServicio> {
    return this.api.post<ViajeServicio>(`/transporte/servicios/${servicioId}/abonos`, payload);
  }

  /** Elimina un abono mal registrado; devuelve el servicio actualizado. */
  eliminarAbono(servicioId: string, abonoId: string): Observable<ViajeServicio> {
    return this.api.delete<ViajeServicio>(`/transporte/servicios/${servicioId}/abonos/${abonoId}`);
  }

  // ------------------------------------------------------------------ gastos
  gastosDeViaje(viajeId: string): Observable<VehiculoGasto[]> {
    return this.api.get<VehiculoGasto[]>(`${this.base}/${viajeId}/gastos`);
  }

  /** Atajo que registra el gasto ya atado al viaje y a su vehículo. */
  agregarGasto(viajeId: string, payload: ViajeGastoPayload): Observable<VehiculoGasto> {
    return this.api.post<VehiculoGasto>(`${this.base}/${viajeId}/gastos`, payload);
  }

  // ---------------------------------------------------------------- reportes
  /** Saldos de fletes pendientes de cobro, agrupados por cliente. */
  cartera(): Observable<CarteraFleteCliente[]> {
    return this.api.get<CarteraFleteCliente[]>('/transporte/cartera');
  }

  /** Detalle de la cartera de un cliente (por id del directorio o por nombre). */
  carteraDetalle(params: {
    cliente_id?: string | null;
    cliente_nombre?: string | null;
  }): Observable<CarteraFleteDetalle> {
    return this.api.get<CarteraFleteDetalle>('/transporte/cartera/detalle', params);
  }

  /** Resumen de rentabilidad del período (GET /transporte/resumen-mensual). */
  resumen(desde: string, hasta: string, vehiculoId?: string | null): Observable<ResumenTransporte> {
    return this.api.get<ResumenTransporte>('/transporte/resumen-mensual', {
      desde,
      hasta,
      vehiculo_id: vehiculoId,
    });
  }
}
