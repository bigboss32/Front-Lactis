import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService, ListOpts } from '../../core/api.service';
import { Auditoria, LoginAudit, Page } from '../../core/models';

export interface AuditoriaOpts extends ListOpts {
  modulo?: string | null;
  accion?: string | null;
  desde?: string | null;
  hasta?: string | null;
}

export interface LoginAuditOpts extends ListOpts {
  exito?: boolean | null;
}

@Injectable({ providedIn: 'root' })
export class AuditoriaService {
  private readonly api = inject(ApiService);

  listar(opts: AuditoriaOpts = {}): Observable<Page<Auditoria>> {
    return this.api.get<Page<Auditoria>>('/auditoria', opts);
  }

  logins(opts: LoginAuditOpts = {}): Observable<Page<LoginAudit>> {
    return this.api.get<Page<LoginAudit>>('/auditoria/logins', opts);
  }
}
