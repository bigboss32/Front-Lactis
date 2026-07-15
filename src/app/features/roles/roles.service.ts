import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService } from '../../core/api.service';
import { Rol } from '../../core/models';

/** Campos aceptados por POST /roles (schema RolCreate). */
export interface RolCreatePayload {
  nombre: string;
  descripcion?: string | null;
  permiso_ids: string[];
}

/** Campos aceptados por PUT /roles/{id} (schema RolUpdate, sin permisos). */
export interface RolUpdatePayload {
  nombre?: string;
  descripcion?: string | null;
  estado?: string;
}

@Injectable({ providedIn: 'root' })
export class RolesService extends CrudService<Rol, RolCreatePayload, RolUpdatePayload> {
  constructor() {
    super('/roles');
  }

  asignarPermisos(id: string, permisoIds: string[]): Observable<Rol> {
    return this.api.put<Rol>(`${this.base}/${id}/permisos`, { permiso_ids: permisoIds });
  }
}
