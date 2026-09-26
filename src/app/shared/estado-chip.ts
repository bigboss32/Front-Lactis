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
  // Liquidaciones: la quincena en firme en la que el TERCERO quedó debiendo (el backend
  // manda este texto en `estado_visible`). VERDE, como una pagada, porque el color del
  // chip responde "¿tengo algo que hacer con esta?" y la respuesta es NO: no hay nada
  // que entregarle, y la deuda se le cobra sola en su próxima quincena. Cualquier otro
  // tono mentía: el azul es justo el de "aprobada, falta pagarla" —la queja del dueño—,
  // el ámbar es el de "revísela" (borrador) y el rojo es el de anulada.
  // Lo que la separa de una pagada limpia NO lo carga el color, lo cargan las palabras:
  // el chip dice "quedó debiendo" en la misma línea, y la columna Saldo de la lista ya
  // pinta la cifra en rojo con su marca ("quedó debiendo · cobrada"). Un segundo rojo
  // aquí solo repetiría esa alarma en la columna que responde otra pregunta.
  'pagada · quedó debiendo': 'verde',
  // Transporte: viajes (el backend manda 'en_curso'; la vista pasa la etiqueta
  // legible de ETIQUETAS_ESTADO_VIAJE) y vigencia de documentos del vehículo.
  'en curso': 'azul',
  finalizado: 'verde',
  anulado: 'rojo',
  vigente: 'verde',
  'por vencer': 'ambar',
  vencido: 'rojo',
  // Suscripción: estado de la empresa (el backend manda 'por_vencer'; la vista
  // pasa la etiqueta legible de ETIQUETAS_ESTADO_SUSCRIPCION) y estado de los
  // pagos de la pasarela ('por vencer' y 'vencida' reutilizan las de arriba).
  exenta: 'azul',
  activa: 'verde',
  gracia: 'rojo',
  bloqueada: 'rojo',
  prueba: 'azul',
  vencida: 'rojo',
  aprobado: 'verde',
  rechazado: 'rojo',
  error: 'rojo',
};

/** Chip de color según el estado del registro o del flujo de trabajo. */
@Component({
  selector: 'app-estado-chip',
  template: `<span class="chip {{ color() }}" [class.frase]="esFrase()">{{ estado() }}</span>`,
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
    // UN ESTADO QUE ES UNA FRASE se escribe como frase: mayúscula solo al arrancar.
    // 'capitalize' sube la inicial de CADA palabra, y "pagada · quedó debiendo" salía
    // "Pagada · Quedó Debiendo". Los de siempre ('por vencer' → "Por Vencer") no se tocan.
    .chip.frase { text-transform: none; }
    .chip.frase::first-letter { text-transform: uppercase; }
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
  /** Dos hechos unidos por el punto medio, como "pagada · quedó debiendo". */
  readonly esFrase = computed(() => this.estado().includes(' · '));
}
