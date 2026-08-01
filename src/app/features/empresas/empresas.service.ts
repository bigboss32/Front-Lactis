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

/**
 * Body de PUT /empresas/{id}/suscripcion. Los null explícitos APLICAN (el
 * backend usa exclude_unset): tarifa_mensual null = volver a la tarifa global
 * del sistema; pagada_hasta null = volver al período de prueba.
 */
export interface SuscripcionEmpresaPayload {
  tarifa_mensual: number | null;
  exenta: boolean;
  pagada_hasta: string | null;
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

  /**
   * Tarifa, exención y vigencia de la suscripción de una empresa.
   * Únicamente permitida al superadmin (lo valida el backend en el service,
   * mismo patrón que reiniciar). Devuelve la empresa ya actualizada.
   */
  actualizarSuscripcion(
    empresaId: string,
    payload: SuscripcionEmpresaPayload,
  ): Observable<Empresa> {
    return this.api.put<Empresa>(`/empresas/${empresaId}/suscripcion`, payload);
  }
}
