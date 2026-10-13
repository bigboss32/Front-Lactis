import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { merge } from 'rxjs';

import { rangoInvertido } from './quincena';

/**
 * Material marca con este error al campo de fecha cuando lo escrito no se entiende como fecha
 * (`31/02/2026`, `hoy`, una letra O donde iba un 0). OJO: en ese caso el CONTROL queda en null
 * —como si estuviera vacío— pero el texto sigue a la vista en la casilla.
 */
const ERROR_DE_LECTURA = 'matDatepickerParse';

/**
 * Los años que una fecha de estas pantallas puede tener. El adaptador de fechas del navegador da
 * por buena cualquier cosa que `Date.parse` trague: mientras se teclea "5/10/2026", al llegar a
 * "5/10/202" ya es una fecha válida del año 202, y con un dígito de más ("5/10/20266") la del año
 * 20266. La consulta salía con `desde=202-10-05`, el servidor la rechazaba con un 422 y la
 * pantalla decía que "la consulta no alcanzó a llegar" en medio del tecleo. Fuera de esta
 * ventana la fecha se trata igual que un texto que no se entiende.
 */
const ANIO_MINIMO = 1900;
const ANIO_MAXIMO = 2100;

/**
 * ¿Hay en esta casilla algo que no sirve como fecha? Dos casos:
 *   · un texto que no se entiende (`matDatepickerParse`, el control queda en null), o
 *   · una fecha que no existe (Date inválida, p. ej. de una sesión guardada dañada) o de un año
 *     absurdo (ver ANIO_MINIMO): se vería como fecha pero la consulta no se puede armar con ella.
 */
export function fechaIlegible(control: AbstractControl): boolean {
  if (control.hasError(ERROR_DE_LECTURA)) return true;
  const valor = control.value;
  if (!(valor instanceof Date)) return false;
  if (isNaN(valor.getTime())) return true;
  const anio = valor.getFullYear();
  return anio < ANIO_MINIMO || anio > ANIO_MAXIMO;
}

/**
 * Qué le pasa al rango que muestran las casillas, o null si está bien (incluidos los rangos
 * abiertos de un lado y la ausencia de fechas):
 *   · 'ilegible': alguna casilla trae un texto que no se entiende. SIN esto la pantalla
 *     consultaba con ese extremo abierto —el control está en null— y pintaba de más: la
 *     lista y las tarjetas de plata de todo el historial, bajo una casilla que decía otra cosa;
 *   · 'al-reves': «Desde» cae después de «Hasta».
 * La pantalla que lo use NO consulta mientras haya un problema (ver las listas).
 */
export type ProblemaDelRango = 'ilegible' | 'al-reves';

export function problemaDelRango(
  desde: FormControl<Date | null>,
  hasta: FormControl<Date | null>,
): ProblemaDelRango | null {
  if (fechaIlegible(desde) || fechaIlegible(hasta)) return 'ilegible';
  return rangoInvertido(desde.value, hasta.value) ? 'al-reves' : null;
}

/**
 * LAS CASILLAS «DESDE» Y «HASTA», AL LADO DE LA QUINCENA.
 *
 * Los botones de quincena sirven para lo de siempre (liquidar de a quincenas), pero a veces
 * hace falta otro período: un mes entero, desde el 5 hasta hoy, la última semana. Estas dos
 * casillas son ESOS MISMOS controles `desde` y `hasta` que usa el selector de quincena
 * (`selector-quincena.ts`): tocar un botón las llena, y escribir o elegir una fecha aquí
 * mueve el filtro (y desmarca la quincena, porque ya no son justo una).
 *
 * Uso: <app-rango-de-fechas [desde]="desde" [hasta]="hasta" />, con los mismos dos
 * FormControl<Date | null> que mandan la consulta.
 *
 *   · Cada una se puede QUITAR (la X): con una sola punta el rango queda abierto, "desde el
 *     5 en adelante" o "hasta el 20".
 *   · Si «Desde» cae después de «Hasta», o si lo escrito en una casilla no se entiende como
 *     fecha, se dice en palabras, en rojo, al lado de las casillas, y la X sale también para
 *     poder borrar ese texto con un toque. La pantalla que lo use tiene que NO consultar
 *     con un rango así (`problemaDelRango`): daría "no hay nada" —o, peor, datos de más—
 *     cuando lo que pasa es que las fechas están mal.
 *   · El calendario NO le impide a cada una pasarse de la otra: si quiere un período que empieza
 *     después del «Hasta» de hoy, elige «Desde» primero y arregla «Hasta» enseguida; mientras
 *     tanto el aviso lo dice.
 */
@Component({
  selector: 'app-rango-de-fechas',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatDatepickerModule, MatButtonModule, MatIconModule],
  template: `
    <div class="campos">
    <mat-form-field subscriptSizing="dynamic" class="campo-fecha">
      <mat-label>Desde</mat-label>
      <input
        matInput
        class="fecha-desde"
        autocomplete="off"
        [matDatepicker]="pDesde"
        [formControl]="desde()"
        (click)="pDesde.open()"
      />
      @if (desde().value || ilegibleDesde()) {
        <button
          matSuffix
          mat-icon-button
          type="button"
          class="quitar quitar-desde"
          aria-label="Quitar la fecha «Desde»"
          (click)="quitar(desde())"
        >
          <mat-icon>close</mat-icon>
        </button>
      }
      <mat-datepicker-toggle matSuffix [for]="pDesde" aria-label="Abrir el calendario de «Desde»" />
      <mat-datepicker #pDesde />
    </mat-form-field>
    <mat-form-field subscriptSizing="dynamic" class="campo-fecha">
      <mat-label>Hasta</mat-label>
      <input
        matInput
        class="fecha-hasta"
        autocomplete="off"
        [matDatepicker]="pHasta"
        [formControl]="hasta()"
        (click)="pHasta.open()"
      />
      @if (hasta().value || ilegibleHasta()) {
        <button
          matSuffix
          mat-icon-button
          type="button"
          class="quitar quitar-hasta"
          aria-label="Quitar la fecha «Hasta»"
          (click)="quitar(hasta())"
        >
          <mat-icon>close</mat-icon>
        </button>
      }
      <mat-datepicker-toggle matSuffix [for]="pHasta" aria-label="Abrir el calendario de «Hasta»" />
      <mat-datepicker #pHasta />
    </mat-form-field>
    </div>
    @if (ilegibleDesde()) {
      <p class="aviso-al-reves aviso-ilegible" role="alert">
        No se entiende la fecha «Desde»: corríjala o elíjala del calendario.
      </p>
    }
    @if (ilegibleHasta()) {
      <p class="aviso-al-reves aviso-ilegible" role="alert">
        No se entiende la fecha «Hasta»: corríjala o elíjala del calendario.
      </p>
    }
    @if (alReves()) {
      <p class="aviso-al-reves" role="alert">
        «Desde» es posterior a «Hasta»: corrija las fechas.
      </p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 12px;
    }
    .campos {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
    }
    /* El selector va con tanta especificidad como haga falta: la barra de las pantallas le pone a
       TODO mat-form-field de adentro flex: 0 1 260px, y con eso cada casilla medía 260 y las dos
       ya no cabían en una fila. */
    :host .campos .campo-fecha {
      flex: 0 0 236px;
      width: 236px;
      /* Los dos íconos de la casilla (la X y el calendario) se apilaban a 48 px cada uno y
         la casilla medía 80 de alto. Más chicos caben en una sola fila. */
      --mat-icon-button-state-layer-size: 32px;
      --mat-icon-button-icon-size: 18px;
    }
    .campo-fecha ::ng-deep .mat-mdc-icon-button.mat-mdc-button-base {
      --mdc-icon-button-state-layer-size: 32px;
      width: 32px;
      height: 32px;
      padding: 7px;
    }
    .campo-fecha ::ng-deep .mat-mdc-form-field-icon-suffix {
      display: flex;
      align-items: center;
      padding-right: 4px;
    }
    /* El aviso NO cuenta para el ancho natural del bloque (width: 0 + min-width: 100%): con su
       texto largo, al salir el aviso el bloque pasaba de 484 a 864 px de ancho, ya no cabía junto
       a la quincena y la casilla que se estaba tecleando saltaba de renglón en pleno tecleo.
       Ocupa el ancho de las casillas y baja a su propio renglón. */
    .aviso-al-reves {
      flex: 1 1 100%;
      width: 0;
      min-width: 100%;
      margin: 0;
      font-size: 0.8rem;
      color: var(--mat-sys-error);
    }
    /* En el celular una casilla por fila: con la X y el calendario dentro, a 360 px de pantalla
       cada una de a dos dejaba unos 74 px para el texto y "15/10/2026" salía cortado. */
    @media (max-width: 560px) {
      .campos {
        flex: 1 1 100%;
      }
      :host .campos .campo-fecha {
        flex: 1 1 100%;
        width: auto;
      }
    }
  `,
})
export class RangoDeFechas implements OnInit {
  readonly desde = input.required<FormControl<Date | null>>();
  readonly hasta = input.required<FormControl<Date | null>>();

  private readonly destroyRef = inject(DestroyRef);

  /** Lo que valen hoy las dos casillas (los controles no son reactivos para los signals). */
  private readonly fechas = signal<{ desde: Date | null; hasta: Date | null }>({ desde: null, hasta: null });

  readonly alReves = computed(() => rangoInvertido(this.fechas().desde, this.fechas().hasta));
  /** Hay texto escrito en la casilla que no se entiende como fecha (el control está en null). */
  readonly ilegibleDesde = signal(false);
  readonly ilegibleHasta = signal(false);

  ngOnInit(): void {
    this.leer();
    merge(this.desde().valueChanges, this.hasta().valueChanges)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.leer());
  }

  /** La X de una casilla: la deja vacía y la pantalla se entera como con cualquier otro cambio. */
  quitar(control: FormControl<Date | null>): void {
    control.setValue(null);
    control.markAsDirty();
  }

  private leer(): void {
    this.fechas.set({ desde: this.desde().value, hasta: this.hasta().value });
    this.ilegibleDesde.set(fechaIlegible(this.desde()));
    this.ilegibleHasta.set(fechaIlegible(this.hasta()));
  }
}
