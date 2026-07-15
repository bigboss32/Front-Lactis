import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService, ListOpts } from '../../core/api.service';
import { Notificacion, Page } from '../../core/models';

export interface NotificacionOpts extends ListOpts {
  solo_no_leidas?: boolean;
}

export interface GenerarAlertasResponse {
  generadas: number;
  detalle: Record<string, number>;
}

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private readonly api = inject(ApiService);

  listar(opts: NotificacionOpts = {}): Observable<Page<Notificacion>> {
    return this.api.get<Page<Notificacion>>('/notificaciones', opts);
  }

  marcarLeida(id: string): Observable<Notificacion> {
    return this.api.post<Notificacion>(`/notificaciones/${id}/leer`);
  }

  marcarTodas(): Observable<{ marcadas: number }> {
    return this.api.post<{ marcadas: number }>('/notificaciones/leer-todas');
  }

  generarAlertas(): Observable<GenerarAlertasResponse> {
    return this.api.post<GenerarAlertasResponse>('/notificaciones/generar-alertas');
  }
}
