import { Component, computed, input } from '@angular/core';

const COLORES: Record<string, string> = {
  activo: 'verde',
  pagada: 'verde',
  cerrada: 'neutro',
  inactivo: 'neutro',
  borrador: 'ambar',
  pendiente: 'ambar',
  parcial: 'azul',
  aprobada: 'azul',
  abierta: 'azul',
  anulada: 'rojo',
};

/** Chip de color según el estado del registro o del flujo de trabajo. */
@Component({
  selector: 'app-estado-chip',
  template: `<span class="chip {{ color() }}">{{ estado() }}</span>`,
  styles: `
    .chip {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
      text-transform: capitalize;
      white-space: nowrap;
    }
    .verde  { background: color-mix(in srgb, #2e7d32 18%, transparent); color: #2e7d32; }
    .azul   { background: color-mix(in srgb, #1565c0 18%, transparent); color: #1565c0; }
    .ambar  { background: color-mix(in srgb, #b26a00 18%, transparent); color: #b26a00; }
    .rojo   { background: color-mix(in srgb, #c62828 18%, transparent); color: #c62828; }
    .neutro { background: color-mix(in srgb, currentColor 12%, transparent); color: var(--mat-sys-on-surface-variant); }
    :host-context(html.dark) {
      .verde { color: #81c784; }
      .azul  { color: #64b5f6; }
      .ambar { color: #ffb74d; }
      .rojo  { color: #e57373; }
    }
  `,
})
export class EstadoChip {
  readonly estado = input.required<string>();
  readonly color = computed(() => COLORES[this.estado()] ?? 'neutro');
}
