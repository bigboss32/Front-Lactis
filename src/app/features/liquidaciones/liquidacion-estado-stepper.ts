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
  // El estado COMO SE LEE (ver `estadoComoSeLee`): la quincena en firme en la que el
  // tercero quedó debiendo. Está en el último paso porque no hay nada que entregarle;
  // dejarla en "Aprobada" decía "falta pagarla", que es justo lo que el dueño reclamó.
  'pagada · quedó debiendo': 2,
};

/**
 * Texto de ayuda de una línea según el estado actual.
 *
 * Las de 'borrador', 'aprobada' y 'parcial' nombran botones ("apruébala", "usa Pagar")
 * que solo tiene el permiso 'administrar'. Por eso salen únicamente cuando quien arma la
 * línea no manda otra: el detalle manda la suya a quien no tiene ese botón (ver
 * `ayudaEnLugarDeLaDelEstado`).
 */
const AYUDAS: Record<string, string> = {
  borrador: 'Revisa los valores y apruébala para poder pagarla.',
  aprobada: 'Los valores quedaron en firme: usa "Pagar" cuando entregues el dinero.',
  // Las dos que siguen afirman una plata entregada: el detalle las cambia cuando no la hubo
  // (la parcial corregida sin un solo pago, la pagada que se cerró sin ninguno).
  parcial: 'Se le abonó una parte y todavía queda debiendo: usa "Pagar" para el resto.',
  pagada: 'El pago quedó registrado; esta liquidación está completa.',
  // Sin "usa Pagar": ese botón no está (el servidor lo rebota). Y sin decir de dónde salió
  // la deuda ni si ya se cobró: pueden ser anticipos o un pago de más por una corrección,
  // y eso lo dice con cifras el resumen de abajo.
  'pagada · quedó debiendo':
    'No hay nada que entregarle: el tercero quedó debiendo. El resumen dice cuánto y si ya se le cobró.',
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
      margin-bottom: 12px;
    }

    // Los tres pasos en UNA línea: círculo y nombre juntos, unidos por una raya que se
    // estira. Antes eran círculos de 40 px con el nombre debajo: casi 100 px de alto para
    // decir en qué estado está.
    .pasos {
      display: flex;
      align-items: center;
      gap: 8px;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .paso {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .paso + .paso { flex: 1 1 auto; }

    // Línea conectora entre el paso anterior y este. NO se encoge a nada: en un celular de 375 px
    // los tres pasos no cabían con la raya a 12 px y ella era la que cedía hasta quedar en 0
    // (tres círculos sueltos). Lo que sobra se recorta de los círculos y las letras, abajo.
    .paso + .paso::before {
      content: '';
      flex: 1 0 14px;
      min-width: 14px;
      height: 3px;
      margin-right: 2px;
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
      flex: none;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .completado .circulo,
    .actual .circulo {
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }

    // Anillo que resalta el paso actual.
    .actual .circulo {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--mat-sys-primary) 25%, transparent);
    }

    .etiqueta {
      font-size: 0.8rem;
      white-space: nowrap;
      color: var(--mat-sys-on-surface-variant);
    }

    .completado .etiqueta { color: var(--mat-sys-on-surface); }

    // Celular: círculos y letras más chicos y menos aire, para que entren los tres pasos con sus rayas.
    @media (max-width: 420px) {
      .pasos { gap: 4px; }
      .paso { gap: 4px; }
      .circulo {
        width: 24px;
        height: 24px;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }
      }
      .etiqueta { font-size: 0.72rem; }
    }

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
      margin: 8px 0 0;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class LiquidacionEstadoStepper {
  readonly estado = input.required<string>();
  /**
   * LA AYUDA QUE MANDA QUIEN SABE QUÉ BOTONES HAY, en lugar de la del estado.
   *
   * La de 'aprobada' dice "usa Pagar", y hay aprobadas sin ese botón: la que la deuda
   * vieja dejó en cero, la que se cierra con "Marcar pagada", la que trae una deuda
   * borrada. Y las de 'parcial' y 'pagada' afirman una plata ("Se le abonó una parte",
   * "El pago quedó registrado") que en la parcial corregida sin pagos, o en la pagada que
   * se cerró sin ninguno, no salió. Y "apruébala" o "usa Pagar" a quien no tiene el permiso
   * 'administrar' (Compras, Consulta) lo manda a un botón que no le sale y que el servidor
   * le rebota con 403. Esta línea no ve los botones, los pagos ni los permisos; el detalle
   * sí, y la arma con las mismas señales que ponen cada botón (ver `ayudaDelEstado` en el
   * diálogo). Null = la del estado, y el detalle solo la deja pasar cuando el botón que
   * nombra está.
   */
  readonly ayudaEnLugarDeLaDelEstado = input<string | null>(null);

  readonly anulada = computed(() => this.estado() === 'anulada');
  readonly indiceActual = computed(() => PASO_DE_ESTADO[this.estado()] ?? -1);
  readonly ayuda = computed(
    () => this.ayudaEnLugarDeLaDelEstado() ?? AYUDAS[this.estado()] ?? '',
  );

  /** El último paso se llama "Parcial" mientras la liquidación siga debiendo. */
  readonly pasos = computed<Paso[]>(() =>
    this.estado() === 'parcial'
      ? PASOS.map((paso) =>
          paso.clave === 'pagada' ? { ...paso, etiqueta: 'Parcial' } : paso,
        )
      : PASOS,
  );
}
