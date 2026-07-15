import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService } from '../../core/api.service';
import { Usuario } from '../../core/models';

/** Campos aceptados por POST /usuarios (schema UsuarioCreate). */
export interface UsuarioCreatePayload {
  nombre: string;
  apellido: string;
  documento?: string | null;
  correo: string;
  telefono?: string | null;
  username: string;
  password: string;
  rol_ids: string[];
}

/** Campos aceptados por PUT /usuarios/{id} (schema UsuarioUpdate, sin username/password). */
export interface UsuarioUpdatePayload {
  nombre?: string;
  apellido?: string;
  documento?: string | null;
  correo?: string;
  telefono?: string | null;
  estado?: string;
}

@Injectable({ providedIn: 'root' })
export class UsuariosService extends CrudService<Usuario, UsuarioCreatePayload, UsuarioUpdatePayload> {
  constructor() {
    super('/usuarios');
  }

  asignarRoles(id: string, rolIds: string[]): Observable<Usuario> {
    return this.api.post<Usuario>(`${this.base}/${id}/roles`, { rol_ids: rolIds });
  }

  bloquear(id: string): Observable<Usuario> {
    return this.api.post<Usuario>(`${this.base}/${id}/bloquear`);
  }

  desbloquear(id: string): Observable<Usuario> {
    return this.api.post<Usuario>(`${this.base}/${id}/desbloquear`);
  }

  restablecerPassword(id: string, password: string): Observable<Usuario> {
    return this.api.post<Usuario>(`${this.base}/${id}/restablecer-password`, { password });
  }
}
