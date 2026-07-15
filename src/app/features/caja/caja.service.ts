import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService, ListOpts } from '../../core/api.service';
import { CajaDiaria, MovimientoCaja, Page } from '../../core/models';

export interface AbrirCajaPayload {
  fecha: string; // ISO YYYY-MM-DD
  sucursal_id?: string | null;
  saldo_inicial: number | string;
  observaciones?: string | null;
}

export interface CerrarCajaPayload {
  efectivo_contado: number | string;
  observaciones?: string | null;
}

export interface MovimientoCajaPayload {
  caja_id: string;
  tipo: 'ingreso' | 'egreso';
  concepto: string;
  valor: number | string;
  referencia?: string | null;
}

export interface CajaListOpts extends ListOpts {
  desde?: string | null;
  hasta?: string | null;
}

@Injectable({ providedIn: 'root' })
export class CajaService {
  private readonly api = inject(ApiService);

  list(opts: CajaListOpts = {}): Observable<Page<CajaDiaria>> {
    return this.api.get<Page<CajaDiaria>>('/caja', opts);
  }

  getById(id: string): Observable<CajaDiaria> {
    return this.api.get<CajaDiaria>(`/caja/${id}`);
  }

  abrir(payload: AbrirCajaPayload): Observable<CajaDiaria> {
    return this.api.post<CajaDiaria>('/caja/abrir', payload);
  }

  cerrar(id: string, payload: CerrarCajaPayload): Observable<CajaDiaria> {
    return this.api.post<CajaDiaria>(`/caja/${id}/cerrar`, payload);
  }

  registrarMovimiento(payload: MovimientoCajaPayload): Observable<MovimientoCaja> {
    return this.api.post<MovimientoCaja>('/caja/movimientos', payload);
  }
}
