import { Injectable } from '@angular/core';

import { CrudService } from '../../core/api.service';
import { Sucursal } from '../../core/models';

export interface SucursalPayload {
  nombre: string;
  tipo: string;
  direccion?: string | null;
  telefono?: string | null;
  responsable?: string | null;
  estado?: string;
}

/** Tipos de sucursal del backend con su etiqueta legible en la interfaz. */
export const TIPOS_SUCURSAL: ReadonlyArray<{ valor: string; etiqueta: string }> = [
  { valor: 'planta', etiqueta: 'Planta' },
  { valor: 'centro_acopio', etiqueta: 'Centro de acopio' },
  { valor: 'punto_venta', etiqueta: 'Punto de venta' },
];

export function etiquetaTipoSucursal(tipo: string): string {
  return TIPOS_SUCURSAL.find((t) => t.valor === tipo)?.etiqueta ?? tipo;
}

@Injectable({ providedIn: 'root' })
export class SucursalesService extends CrudService<Sucursal, SucursalPayload> {
  constructor() {
    super('/sucursales');
  }
}
