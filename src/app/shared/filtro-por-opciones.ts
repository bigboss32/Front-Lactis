import { Component, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { map, startWith, switchMap } from 'rxjs';

/** Una opción del filtro: `valor` es lo que queda en el control y lo que pide la consulta. */
export interface OpcionDeFiltro {
  valor: string;
  etiqueta: string;
  /** Lo que dice al pasar el mouse, al enfocar con el teclado o al dejar el dedo apretado. */
  ayuda?: string;
}

/** Vacío y sin valor son lo mismo: sin filtro. */
const comoValor = (v: string | null | undefined): string | null => (v === undefined || v === '' ? null : v);

/**
 * UN FILTRO DE BOTONES, EN VEZ DE UN DESPLEGABLE: "Estado: [Todos] [Borrador] [Aprobada] …".
 *
 * Es el mismo estilo del filtro por quincena (`selector-quincena.ts`): las opciones a la
 * vista, la elegida marcada, y un clic para cambiar. Con un desplegable había que abrirlo
 * para saber qué filtro estaba puesto; con botones se lee de un vistazo.
 *
 * Uso: <app-filtro-por-opciones etiqueta="Estado" [opciones]="estados" [control]="estado" />,
 * con el mismo FormControl<string | null> que ya usaba la pantalla (null = sin filtro).
 *
 *   · "Todos" va siempre de primero y es el filtro vacío: se ve marcado cuando no hay nada
 *     puesto, así que el dueño sabe cómo quitar el filtro sin adivinar.
 *   · Tocar la opción ya marcada también lo quita, igual que las tarjetas del listado.
 *   · LO MARCADO SE LEE SIEMPRE DEL CONTROL, no se copia: si lo cambia otro —una tarjeta, el
 *     filtro restaurado de la sesión, un padre que le pasa otro control— el botón lo sigue.
 *     Un valor que no es ninguna opción no marca nada (ni siquiera "Todos"): no se inventa
 *     un filtro vacío donde hay uno puesto.
 */
@Component({
  selector: 'app-filtro-por-opciones',
  imports: [MatButtonModule, MatTooltipModule],
  template: `
    <span class="etiqueta">{{ etiqueta() }}:</span>
    <div class="opciones" role="group" [attr.aria-label]="etiqueta()">
      <button
        mat-stroked-button
        type="button"
        class="opcion"
        [class.activa]="valor() === null"
        [attr.aria-pressed]="valor() === null"
        (click)="elegir(null)"
      >
        Todos
      </button>
      @for (opcion of opciones(); track opcion.valor) {
        <button
          mat-stroked-button
          type="button"
          class="opcion"
          [class.activa]="valor() === opcion.valor"
          [attr.aria-pressed]="valor() === opcion.valor"
          [matTooltip]="opcion.ayuda ?? ''"
          [matTooltipDisabled]="!opcion.ayuda"
          (click)="elegir(opcion.valor)"
        >
          {{ opcion.etiqueta }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 10px;
    }
    .etiqueta {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8rem;
    }
    .opciones {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .opcion {
      --mat-button-outlined-container-height: 34px;
      min-width: 0;
      padding: 0 14px;
    }
    /* Marcado = borde, tinte y anillo; sin negrita: el ancho del botón no cambia al marcarlo. */
    .opcion.activa {
      border-color: var(--mat-sys-primary);
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      box-shadow: inset 0 0 0 1px var(--mat-sys-primary);
    }
    /* El foco del teclado se distingue del marcado: el marcado es un tinte, el foco es un anillo. */
    .opcion:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }

    /* En celular el nombre del filtro va solo en su renglón, igual en todos los grupos. */
    @media (max-width: 560px) {
      .etiqueta {
        flex: 0 0 100%;
      }
    }
  `,
})
export class FiltroPorOpciones {
  readonly etiqueta = input.required<string>();
  readonly opciones = input.required<readonly OpcionDeFiltro[]>();
  readonly control = input.required<FormControl<string | null>>();

  /** Lo que vale el control ahora (siempre el del control que llegó, aunque cambie). */
  readonly valor = toSignal(
    toObservable(this.control).pipe(
      switchMap((control) => control.valueChanges.pipe(startWith(control.value))),
      map(comoValor),
    ),
    { initialValue: null },
  );

  /** Marca la opción; si ya estaba marcada, o es "Todos", deja el filtro vacío. */
  elegir(valor: string | null): void {
    // Se compara contra el control y no contra lo pintado: si algo lo cambió sin avisar, el
    // clic se decide por lo que de verdad hay puesto.
    const actual = comoValor(this.control().value);
    const nuevo = valor !== null && actual === valor ? null : valor;
    // "Todos" con nada puesto no cambia nada: no se recarga la lista para quedar igual.
    if (nuevo === actual) return;
    this.control().setValue(nuevo);
  }
}
