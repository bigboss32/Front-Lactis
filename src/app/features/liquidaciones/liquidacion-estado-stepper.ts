import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

interface Paso {
  clave: string;
  etiqueta: string;
  icono: string;
}

/** Pasos del ciclo de vida normal de una liquidación, en orden. */
const PASOS: Paso[] = [
  { clave: 'borrador', etiqueta: 'Borrador', icono: 'edit_note' },
  { clave: 'aprobada', etiqueta: 'Aprobada', icono: 'task_alt' },
  { clave: 'pagada', etiqueta: 'Pagada', icono: 'payments' },
];

/**
 * En qué paso se para cada estado. 'parcial' comparte el último con 'pagada':
 * es el mismo momento del ciclo (ya se está pagando) y no un cuarto paso —una
 * liquidación puede recibir cinco abonos y la línea no puede crecer con ellos—.
 * Lo que cambia es la etiqueta, para no decir "Pagada" sobre algo que todavía
 * debe.
 */
const PASO_DE_ESTADO: Record<string, number> = {
  borrador: 0,
  aprobada: 1,
  parcial: 2,
  pagada: 2,
};

/** Texto de ayuda de una línea según el estado actual. */
const AYUDAS: Record<string, string> = {
  borrador: 'Revisa los valores y apruébala para poder pagarla.',
  aprobada: 'Los valores quedaron en firme: usa "Pagar" cuando entregues el dinero.',
  parcial: 'Se le abonó una parte y todavía queda debiendo: usa "Pagar" para el resto.',
  pagada: 'El pago quedó registrado; esta liquidación está completa.',
  anulada: 'Las recepciones y anticipos del período quedaron libres para volver a liquidar.',
};

/**
 * Línea de estados horizontal "Borrador → Aprobada → Pagada" para que el ciclo
 * de la liquidación se entienda de un vistazo. Si la liquidación está anulada,
 * muestra un banner rojo suave en su lugar.
 */
@Component({
  selector: 'app-liquidacion-estado-stepper',
  imports: [MatIconModule],
  template: `
    @if (anulada()) {
      <div class="banner-anulada" role="status">
        <mat-icon aria-hidden="true">block</mat-icon>
        <span>Liquidación anulada</span>
      </div>
    } @else {
      <ol class="pasos">
        @for (paso of pasos(); track paso.clave; let i = $index) {
          <li
            class="paso"
            [class.completado]="i < indiceActual()"
            [class.actual]="i === indiceActual()"
            [attr.aria-current]="i === indiceActual() ? 'step' : null"
          >
            <span class="circulo">
              <mat-icon aria-hidden="true">{{ i < indiceActual() ? 'check' : paso.icono }}</mat-icon>
            </span>
            <span class="etiqueta">{{ paso.etiqueta }}</span>
          </li>
        }
      </ol>
    }
    @if (ayuda()) {
      <p class="ayuda">{{ ayuda() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: 20px;
    }

    .pasos {
      display: flex;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .paso {
      position: relative;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    // Línea conectora entre el paso anterior y este.
    .paso + .paso::before {
      content: '';
      position: absolute;
      top: 19px;
      left: calc(-50% + 28px);
      right: calc(50% + 28px);
      height: 3px;
      border-radius: 2px;
      background: var(--mat-sys-outline-variant);
    }

    // La línea se pinta de primario cuando el paso anterior ya se completó.
    .paso.completado::before,
    .paso.actual::before {
      background: var(--mat-sys-primary);
    }

    .circulo {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      z-index: 1;
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant);

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .completado .circulo,
    .actual .circulo {
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }

    // Anillo que resalta el paso actual.
    .actual .circulo {
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--mat-sys-primary) 25%, transparent);
    }

    .etiqueta {
      font-size: 0.8rem;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
    }

    .completado .etiqueta { color: var(--mat-sys-on-surface); }

    .actual .etiqueta {
      color: var(--mat-sys-primary);
      font-weight: 600;
    }

    .banner-anulada {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: 10px;
      font-weight: 500;
      background: color-mix(in srgb, #c62828 12%, transparent);
      color: #c62828;

      mat-icon { flex-shrink: 0; }
    }

    :host-context(html.dark) .banner-anulada { color: #e57373; }

    .ayuda {
      margin: 10px 0 0;
      text-align: center;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class LiquidacionEstadoStepper {
  readonly estado = input.required<string>();

  readonly anulada = computed(() => this.estado() === 'anulada');
  readonly indiceActual = computed(() => PASO_DE_ESTADO[this.estado()] ?? -1);
  readonly ayuda = computed(() => AYUDAS[this.estado()] ?? '');

  /** El último paso se llama "Parcial" mientras la liquidación siga debiendo. */
  readonly pasos = computed<Paso[]>(() =>
    this.estado() === 'parcial'
      ? PASOS.map((paso) =>
          paso.clave === 'pagada' ? { ...paso, etiqueta: 'Parcial' } : paso,
        )
      : PASOS,
  );
}
