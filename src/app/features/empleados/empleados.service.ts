import { Injectable } from '@angular/core';

import { CrudService } from '../../core/api.service';
import { Empleado } from '../../core/models';

export interface EmpleadoPayload {
  nombre: string;
  apellido: string;
  documento?: string | null;
  cargo?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  fecha_ingreso?: string | null;
  salario?: number | null;
  estado?: string;
}

@Injectable({ providedIn: 'root' })
export class EmpleadosService extends CrudService<Empleado, EmpleadoPayload> {
  constructor() {
    super('/empleados');
  }
}
