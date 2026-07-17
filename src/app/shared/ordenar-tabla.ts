import { Sort } from '@angular/material/sort';

/**
 * Ordena (client-side) una copia de las filas cargadas según el Sort de Material.
 * Nota: ordena las filas de la página actual; para ordenar todo el período
 * conviene subir el tamaño de página.
 *
 * @param accesores mapa columna→función, para columnas cuyo campo difiere del
 *   nombre de la columna (p.ej. 'tercero' → f.proveedor_nombre).
 */
export function ordenarFilas<T>(
  filas: T[],
  orden: Sort,
  accesores: Record<string, (fila: T) => unknown> = {},
): T[] {
  if (!orden.active || !orden.direction) return filas;
  const dir = orden.direction === 'asc' ? 1 : -1;
  const valorDe =
    accesores[orden.active] ?? ((f: T) => (f as Record<string, unknown>)[orden.active]);
  return [...filas].sort((a, b) => {
    const va = valorDe(a);
    const vb = valorDe(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb), 'es', { numeric: true }) * dir;
  });
}
