import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService } from '../../core/api.service';
import { Empresa } from '../../core/models';

export interface EmpresaPayload {
  nombre: string;
  nit: string;
  direccion?: string | null;
  ciudad?: string | null;
  departamento?: string | null;
  pais?: string;
  telefono?: string | null;
  correo?: string | null;
  estado?: string;
}

@Injectable({ providedIn: 'root' })
export class EmpresasService extends CrudService<Empresa, EmpresaPayload> {
  constructor() {
    super('/empresas');
  }

  /**
   * Reinicia (borra) SOLO los datos transaccionales de una empresa.
   * Acción irreversible; únicamente permitida al superadmin.
   * Requiere confirmar escribiendo el nombre exacto de la empresa.
   * Devuelve un objeto { "<tabla>": <cantidad_borrada>, ... }.
   */
  reiniciar(empresaId: string, confirmacion: string): Observable<Record<string, number>> {
    return this.api.post<Record<string, number>>(
      `/empresas/${empresaId}/reiniciar`,
      { confirmacion },
    );
  }
}
