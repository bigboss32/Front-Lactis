import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CrudService, ListOpts } from '../../core/api.service';
import { Kardex, MovimientoInventario, Page, Producto, ProductoStock } from '../../core/models';

/** Etiquetas legibles de las categorías de producto del backend. */
export const CATEGORIAS_PRODUCTO: { valor: string; etiqueta: string }[] = [
  { valor: 'leche', etiqueta: 'Leche' },
  { valor: 'insumo', etiqueta: 'Insumo' },
  { valor: 'empaque', etiqueta: 'Empaque' },
  { valor: 'producto_terminado', etiqueta: 'Producto terminado' },
];

export const CATEGORIA_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORIAS_PRODUCTO.map((c) => [c.valor, c.etiqueta]),
);

/** Tipos de movimiento de inventario del backend. */
export const TIPOS_MOVIMIENTO: { valor: string; etiqueta: string }[] = [
  { valor: 'entrada', etiqueta: 'Entrada' },
  { valor: 'salida', etiqueta: 'Salida' },
  { valor: 'ajuste', etiqueta: 'Ajuste' },
];

export const TIPO_MOVIMIENTO_LABELS: Record<string, string> = Object.fromEntries(
  TIPOS_MOVIMIENTO.map((t) => [t.valor, t.etiqueta]),
);

export interface ProductoPayload {
  nombre: string;
  categoria: string;
  unidad: string;
  stock_minimo: number | string;
  costo_unitario: number | string;
  estado?: string;
}

export interface MovimientoPayload {
  producto_id: string;
  fecha: string; // ISO YYYY-MM-DD
  tipo: string;
  cantidad: number | string;
  costo_unitario: number | string;
  referencia?: string | null;
  observaciones?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ProductosService extends CrudService<Producto, ProductoPayload> {
  constructor() {
    super('/inventario/productos');
  }

  /** Stock actual por producto (solo acepta paginación y el toggle bajo mínimo). */
  stockActual(opts: ListOpts & { solo_bajo_minimo?: boolean } = {}): Observable<Page<ProductoStock>> {
    return this.api.get<Page<ProductoStock>>(`${this.base}/stock/actual`, opts);
  }

  kardex(productoId: string): Observable<Kardex> {
    return this.api.get<Kardex>(`${this.base}/${productoId}/kardex`);
  }
}

@Injectable({ providedIn: 'root' })
export class MovimientosInventarioService extends CrudService<MovimientoInventario, MovimientoPayload> {
  constructor() {
    super('/inventario/movimientos');
  }
}
