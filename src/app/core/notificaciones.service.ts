import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from './api.service';
import { Notificacion, Page } from './models';

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private readonly api = inject(ApiService);

  readonly noLeidas = signal(0);
  readonly ultimas = signal<Notificacion[]>([]);

  async refrescar(): Promise<void> {
    try {
      const page = await firstValueFrom(
        this.api.get<Page<Notificacion>>('/notificaciones', {
          solo_no_leidas: true,
          page_size: 10,
        }),
      );
      this.noLeidas.set(page.total);
      this.ultimas.set(page.items);
    } catch {
      // sin permiso de notificaciones: se ignora silenciosamente
    }
  }

  async marcarLeida(id: string): Promise<void> {
    await firstValueFrom(this.api.post(`/notificaciones/${id}/leer`));
    await this.refrescar();
  }

  async marcarTodas(): Promise<void> {
    await firstValueFrom(this.api.post('/notificaciones/leer-todas'));
    await this.refrescar();
  }
}
