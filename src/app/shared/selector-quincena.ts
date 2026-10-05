import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { merge } from 'rxjs';

import { isoToDate } from './date-utils';
import {
  diasDeLaQuincena,
  etiquetaDelMes,
  MesDelAnio,
  mesVecino,
  NumeroDeQuincena,
  quincenaExacta,
  rangoQuincena,
} from './quincena';

/**
 * EL FILTRO POR QUINCENA, IGUAL AL DE "GENERAR LIQUIDACIONES": el mes con sus flechas y los
 * dos botones, "1.ª quincena (días 1 al 15)" y "2.ª quincena (días 16 al 28, 29, 30 o 31)".
 *
 * Uso: <app-selector-quincena [desde]="desde" [hasta]="hasta" />, con los dos
 * FormControl<Date | null> que mandan el período de la consulta. El botón fija las dos
 * fechas; no hay casillas para escribirlas.
 *
 * Qué hace:
 *   · Un botón queda marcado cuando las fechas son, justo, esa quincena —también si vienen
 *     restauradas de la sesión— y el mes sigue a las fechas. Un rango que NO es una quincena
 *     no marca nada: quien use este selector tiene que descartarlo al restaurarlo (la lista
 *     de liquidaciones lo hace), o filtraría sin que la barra lo diga.
 *   · Tocar el botón ya marcado quita el filtro (deja las dos fechas vacías).
 *   · Las flechas mueven el mes; si hay una quincena marcada, la filtran en el mes de al
 *     lado (la 2.ª de septiembre pasa a la 2.ª de agosto) en vez de dejar el filtro en un
 *     mes y la etiqueta en otro. SIN quincena marcada solo cambian el mes sobre el que
 *     actúan los botones, igual que en Generar: las fechas no se tocan hasta que se toque
 *     un botón. Por eso, sin quincena marcada el mes se ve atenuado: no es un filtro.
 *
 * LAS DOS FECHAS SE FIJAN DE UNA VEZ: Desde sin avisar y Hasta avisando. La pantalla recarga
 * al oír cualquiera de las dos, y con dos avisos pedía la lista dos veces —la primera con
 * un Hasta que todavía era el viejo— y la respuesta que llegara de última se quedaba con la
 * pantalla. Así hay UNA consulta, ya con el rango entero. Por eso una pantalla que quiera
 * enterarse del cambio tiene que oír a Hasta (o a las dos, como hacen las listas).
 */
@Component({
  selector: 'app-selector-quincena',
  imports: [MatButtonModule, MatIconModule],
  template: `
    <span class="etiqueta">Quincena:</span>
    <div class="selector-mes">
      <button mat-icon-button type="button" (click)="mover(-1)" aria-label="Mes anterior">
        <mat-icon>chevron_left</mat-icon>
      </button>
      <span
        class="mes"
        [class.sin-marcar]="quincenaActiva() === null"
        [attr.title]="quincenaActiva() === null ? 'Sin filtro de fechas: elija una quincena' : null"
        aria-live="polite"
        >{{ etiquetaMes() }}</span
      >
      <button mat-icon-button type="button" (click)="mover(1)" aria-label="Mes siguiente">
        <mat-icon>chevron_right</mat-icon>
      </button>
    </div>

    <div class="quincena-botones">
      <button
        mat-stroked-button
        type="button"
        class="q-btn"
        [class.activa]="quincenaActiva() === 1"
        [attr.aria-pressed]="quincenaActiva() === 1"
        (click)="elegir(1)"
      >
        <mat-icon>event</mat-icon>
        <span>1.ª quincena<small>días {{ diasQ1() }}</small></span>
      </button>
      <button
        mat-stroked-button
        type="button"
        class="q-btn"
        [class.activa]="quincenaActiva() === 2"
        [attr.aria-pressed]="quincenaActiva() === 2"
        (click)="elegir(2)"
      >
        <mat-icon>event</mat-icon>
        <span>2.ª quincena<small>días {{ diasQ2() }}</small></span>
      </button>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
    }
    .etiqueta {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8rem;
    }
    .selector-mes {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .selector-mes .mes {
      min-width: 130px;
      text-align: center;
      font-weight: 600;
      text-transform: capitalize;
    }
    /* Sin quincena marcada el mes solo dice sobre cuál actúan los botones: no es un filtro. */
    .selector-mes .mes.sin-marcar {
      font-weight: 400;
      color: var(--mat-sys-on-surface-variant);
    }
    .quincena-botones {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .q-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      height: auto;
      padding: 8px 12px;
      text-align: left;

      span {
        display: flex;
        flex-direction: column;
        line-height: 1.2;
      }
      small {
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.72rem;
      }
    }
    .q-btn.activa {
      border-color: var(--mat-sys-primary);
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      box-shadow: inset 0 0 0 1px var(--mat-sys-primary);
    }
    /* El foco del teclado se distingue del marcado: el marcado es un tinte, el foco es un anillo. */
    .q-btn:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }

    @media (max-width: 560px) {
      :host {
        justify-content: space-between;
      }
      .etiqueta {
        flex: 0 0 100%;
      }
      .quincena-botones {
        flex: 1 1 100%;
      }
      .q-btn {
        flex: 1 1 140px;
      }
    }
  `,
})
export class SelectorQuincena implements OnInit {
  readonly desde = input.required<FormControl<Date | null>>();
  readonly hasta = input.required<FormControl<Date | null>>();

  private readonly destroyRef = inject(DestroyRef);

  /** Lo que valen hoy las dos casillas: el filtro puede cambiarlo cualquiera, no solo estos botones. */
  private readonly fechas = signal<{ desde: Date | null; hasta: Date | null }>({
    desde: null,
    hasta: null,
  });

  /**
   * El mes al que llegaron las flechas cuando NO hay una quincena marcada. Con una marcada
   * manda ella (el mes es el de las fechas), y sin fechas es lo que deja el botón al
   * quitar el filtro: así la etiqueta no salta a "hoy" justo al apagarlo.
   */
  private readonly mesDeLasFlechas = signal<MesDelAnio | null>(null);

  /** Cambia solo mientras este mismo componente fija las fechas, para no tomarlo por un cambio ajeno. */
  private fijandoLasFechas = false;

  private readonly exacta = computed(() => quincenaExacta(this.fechas().desde, this.fechas().hasta));

  /** Cuál de las dos quincenas es el filtro, o null si es otro rango o no hay. */
  readonly quincenaActiva = computed<NumeroDeQuincena | null>(() => this.exacta()?.quincena ?? null);

  /** El mes que se ve: el de la quincena marcada; si no, el de las flechas; si no, el de Desde; si no, hoy. */
  readonly mesSel = computed<MesDelAnio>(() => {
    const exacta = this.exacta();
    if (exacta) return { anio: exacta.anio, mes: exacta.mes };
    const deLasFlechas = this.mesDeLasFlechas();
    if (deLasFlechas) return deLasFlechas;
    // Una fecha ilegible (de la sesión, o puesta a mano) no puede dejar la etiqueta en
    // "undefined NaN": se cae a hoy.
    const desde = this.fechas().desde;
    const base = desde && !isNaN(desde.getTime()) ? desde : new Date();
    return { anio: base.getFullYear(), mes: base.getMonth() };
  });

  readonly etiquetaMes = computed(() => etiquetaDelMes(this.mesSel()));
  readonly diasQ1 = computed(() => diasDeLaQuincena(this.mesSel().anio, this.mesSel().mes, 1));
  readonly diasQ2 = computed(() => diasDeLaQuincena(this.mesSel().anio, this.mesSel().mes, 2));

  ngOnInit(): void {
    // Las casillas llegan con lo que la pantalla haya restaurado de la sesión: se leen ya.
    this.leerLasFechas();
    merge(this.desde().valueChanges, this.hasta().valueChanges)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        // Un cambio de afuera (el calendario, escribir una fecha) desecha las flechas
        // viejas: el mes vuelve a seguir a las fechas.
        if (!this.fijandoLasFechas) this.mesDeLasFlechas.set(null);
        this.leerLasFechas();
      });
  }

  /** Marca la quincena del mes que se ve; si ya estaba marcada, quita el filtro. */
  elegir(quincena: NumeroDeQuincena): void {
    const { anio, mes } = this.mesSel();
    if (this.quincenaActiva() === quincena) {
      this.mesDeLasFlechas.set({ anio, mes });
      this.fijar(null, null);
      return;
    }
    this.fijarQuincena(anio, mes, quincena);
  }

  /** Las flechas: `pasos` = −1 el mes anterior, +1 el siguiente. */
  mover(pasos: number): void {
    const vecino = mesVecino(this.mesSel(), pasos);
    const marcada = this.quincenaActiva();
    if (marcada) {
      this.fijarQuincena(vecino.anio, vecino.mes, marcada);
    } else {
      this.mesDeLasFlechas.set(vecino);
    }
  }

  private fijarQuincena(anio: number, mes: number, quincena: NumeroDeQuincena): void {
    const rango = rangoQuincena(anio, mes, quincena);
    this.fijar(isoToDate(rango.inicio), isoToDate(rango.fin));
  }

  private fijar(desde: Date | null, hasta: Date | null): void {
    this.fijandoLasFechas = true;
    try {
      this.desde().setValue(desde, { emitEvent: false });
      this.hasta().setValue(hasta);
    } finally {
      this.fijandoLasFechas = false;
    }
  }

  private leerLasFechas(): void {
    this.fechas.set({ desde: this.desde().value, hasta: this.hasta().value });
  }
}
