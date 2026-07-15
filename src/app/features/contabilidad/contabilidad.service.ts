import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Balance, EstadoResultados, LibroDiario } from '../../core/models';

@Injectable({ providedIn: 'root' })
export class ContabilidadService {
  private readonly api = inject(ApiService);

  estadoResultados(desde: string, hasta: string): Observable<EstadoResultados> {
    return this.api.get<EstadoResultados>('/contabilidad/estado-resultados', { desde, hasta });
  }

  libroDiario(desde: string, hasta: string): Observable<LibroDiario> {
    return this.api.get<LibroDiario>('/contabilidad/libro-diario', { desde, hasta });
  }

  balance(): Observable<Balance> {
    return this.api.get<Balance>('/contabilidad/balance');
  }
}
