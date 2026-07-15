import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService, CrudService, ListOpts } from '../../core/api.service';
import { CuentaBancaria, CuentaSaldo, MovimientoBancario, Page } from '../../core/models';

export interface CuentaPayload {
  banco: string;
  numero_cuenta: string;
  tipo: 'ahorros' | 'corriente';
  titular?: string | null;
  saldo_inicial?: number | string;
  estado?: string;
}

@Injectable({ providedIn: 'root' })
export class CuentasBancariasService extends CrudService<CuentaBancaria, CuentaPayload> {
  constructor() {
    super('/bancos/cuentas');
  }

  saldo(id: string): Observable<CuentaSaldo> {
    return this.api.get<CuentaSaldo>(`/bancos/cuentas/${id}/saldo`);
  }
}

export interface MovimientoBancarioPayload {
  cuenta_id: string;
  fecha: string; // ISO YYYY-MM-DD
  tipo: 'ingreso' | 'egreso';
  valor: number | string;
  concepto: string;
  referencia?: string | null;
}

export interface MovimientoBancarioListOpts extends ListOpts {
  cuenta_id?: string | null;
  conciliado?: boolean | null;
  desde?: string | null;
  hasta?: string | null;
}

@Injectable({ providedIn: 'root' })
export class MovimientosBancariosService {
  private readonly api = inject(ApiService);

  list(opts: MovimientoBancarioListOpts = {}): Observable<Page<MovimientoBancario>> {
    return this.api.get<Page<MovimientoBancario>>('/bancos/movimientos', opts);
  }

  crear(payload: MovimientoBancarioPayload): Observable<MovimientoBancario> {
    return this.api.post<MovimientoBancario>('/bancos/movimientos', payload);
  }

  conciliar(movimientoIds: string[]): Observable<MovimientoBancario[]> {
    return this.api.post<MovimientoBancario[]>('/bancos/movimientos/conciliar', {
      movimiento_ids: movimientoIds,
    });
  }
}
