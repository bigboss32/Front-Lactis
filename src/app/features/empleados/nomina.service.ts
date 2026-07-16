import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Page, PagoEmpleado } from '../../core/models';

export interface PagoEmpleadoPayload {
  empleado_id: string;
  fecha: string; // ISO 'yyyy-MM-dd'
  dias_trabajados: number;
  valor_dia?: number | null;
  periodo?: string | null;
  observaciones?: string | null;
}

@Injectable({ providedIn: 'root' })
export class NominaService {
  private readonly api = inject(ApiService);

  listar(empleadoId: string): Observable<Page<PagoEmpleado>> {
    return this.api.get<Page<PagoEmpleado>>('/nomina', { empleado_id: empleadoId });
  }

  crear(payload: PagoEmpleadoPayload): Observable<PagoEmpleado> {
    return this.api.post<PagoEmpleado>('/nomina', payload);
  }

  eliminar(id: string): Observable<void> {
    return this.api.delete(`/nomina/${id}`);
  }
}
