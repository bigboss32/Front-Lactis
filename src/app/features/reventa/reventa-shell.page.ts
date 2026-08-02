import { Component, OnInit, computed, inject, linkedSignal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterOutlet } from '@angular/router';

import { dateToIso } from '../../shared/date-utils';
import { PageHeader } from '../../shared/page-header';
import { RangoFechasRapido } from '../../shared/rango-fechas-rapido';
import { ReventaFiltroService } from './reventa-filtro.service';
import { LoteResumen, ReventaService } from './reventa.service';
import { SelectorTemporada } from './selector-temporada';

/**
 * Contenedor del módulo de reventa: encabezado + filtro de fechas compartido y
 * un router-outlet para las sub-páginas (Resumen, Compras, Ventas, Ajustes).
 *
 * El filtro es UNO solo para todas las pestañas: lo que se marque aquí es lo que
 * ven Resumen, Compras, Ventas y Ajustes. Por eso el rango se le entrega al
 * servicio compartido solo cuando está completo (ver `aplicarRango`).
 */
@Component({
  selector: 'app-reventa-shell',
  imports: [
    ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatDatepickerModule,
    RouterOutlet, PageHeader, RangoFechasRapido, SelectorTemporada,
  ],
  template: `
    <div class="page">
      <app-page-header
        titulo="Compra y venta de queso"
        subtitulo="Queso comprado a productores para revender; contabilidad separada del libro de la quesera"
      />

      <div class="page-toolbar">
        <!-- UN solo calendario para las dos fechas: se abre, se marca el primer
             día y el último, y ya. Con dos campos separados había que abrir dos
             veces y acordarse de cuál era cuál, que es de lo que se quejó el
             dueño. Las pestañas se recargan solas al marcar el segundo día. -->
        <mat-form-field class="campo-rango" subscriptSizing="dynamic">
          <mat-label>Días</mat-label>
          <mat-date-range-input [rangePicker]="calendario">
            <input matStartDate placeholder="Desde" [value]="desdeVista()"
                   (dateChange)="desdeVista.set($event.value)" />
            <input matEndDate placeholder="Hasta" [value]="hastaVista()"
                   (dateChange)="hastaVista.set($event.value); aplicarRango()" />
          </mat-date-range-input>
          <mat-datepicker-toggle matIconSuffix [for]="calendario" />
          <mat-date-range-picker #calendario [dateClass]="claseDia" />
        </mat-form-field>

        <!-- Los atajos y Temporada van en un MISMO grupo porque hacen lo mismo:
             fijar el rango sin abrir el calendario. Juntos envuelven como un
             bloque, y cuando la barra se apila en celular/tablet Temporada ya no
             queda sola en un renglón estirada a todo el ancho con un hueco al
             lado. La diferencia entre los dos es que el rango de Temporada lo
             puso el usuario, tiene nombre, y en el menú se ve de una la ganancia
             de cada temporada. -->
        <div class="atajos">
          <app-rango-fechas-rapido [desde]="filtro.desde" [hasta]="filtro.hasta" />
          <app-selector-temporada />
        </div>
      </div>

      <!-- Solo si de verdad hay días marcados: si no cargaron los lotes, o
           todavía no hay ninguno, la nota explicaría un punto que no se ve. En
           celular eso era un renglón gastado para nada antes de los datos.

           El texto se acortó (antes: "los días con punto son en los que entró
           queso") porque en 375px se pasaba por 6px y se partía en DOS
           renglones. Así entra en uno solo y sigue diciendo lo mismo: dónde
           mirar (el calendario) y qué significa el punto. -->
      @if (hayDiasConEntrada()) {
        <p class="pista-punto">
          <span class="punto"></span>
          En el calendario, el punto marca cuándo entró queso.
        </p>
      }

      <router-outlet />
    </div>
  `,
  styles: `
    /* Un poco más ancho que un campo normal de la barra: aquí caben DOS fechas
       más el guion, y con los 260px de la barra el texto quedaba recortado.

       OJO con la forma de pedirlo. Antes decía "flex: 0 1 320px", y ese 320 es
       el flex-BASIS, o sea la medida sobre el EJE PRINCIPAL de la barra. En
       pantalla angosta la regla global de styles.scss vuelve la barra
       "flex-direction: column", el eje principal pasa a ser el VERTICAL y ese
       mismo 320 se aplicaba como ALTO: de ahí el recuadro enorme y vacío que se
       comía la pantalla en el celular. Pidiéndolo como "width" la medida es
       siempre horizontal, y dejando la base en "auto" el alto lo decide el
       contenido, que es el alto normal de un campo de Material. */
    .campo-rango {
      flex: 0 1 auto;
      width: 320px;
      max-width: 100%;
    }

    /* Apilada la barra, el campo ocupa el ancho disponible. Mismo corte (900px)
       que la regla global que la apila, para que no queden estados intermedios
       donde el campo se estira pero la barra sigue en fila, o al revés. */
    @media (max-width: 900px) {
      .campo-rango { width: 100%; }
    }

    /* El grupo envuelve por su cuenta: en tablet los atajos y Temporada caben en
       un renglón, y en celular bajan ordenados y pegados a la izquierda, cada
       botón con su ancho natural. */
    .atajos {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    .pista-punto {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: -8px 0 16px;
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .punto {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--mat-sys-primary);
      flex-shrink: 0;
    }

    /* El -8px de arriba es para pegar la nota a la barra cuando la barra es UNA
       fila. Apilada ya no hay nada que pegar y ese tirón deja la nota montada
       sobre el último botón, así que se quita. Va en 900px, el mismo corte en
       que la barra se apila: antes decía 720 y entre 721 y 900 la barra ya
       estaba apilada pero la nota seguía subiéndose. */
    @media (max-width: 900px) {
      .pista-punto { margin-top: 0; }
    }
  `,
})
export class ReventaShellPage implements OnInit {
  readonly filtro = inject(ReventaFiltroService);
  private readonly servicio = inject(ReventaService);

  // ——— Lo que se ve en el campo ———
  // El filtro compartido lo mueven también los rangos rápidos y el selector de
  // temporada, así que el campo tiene que seguirlos. Pero mientras el usuario
  // está marcando un rango a medias el campo va por su cuenta, y por eso son
  // `linkedSignal` y no `computed`: se pueden fijar a mano y se vuelven a atar
  // al filtro en cuanto este cambie desde fuera.
  private readonly desdeDelFiltro = toSignal(this.filtro.desde.valueChanges, {
    initialValue: this.filtro.desde.value,
  });
  private readonly hastaDelFiltro = toSignal(this.filtro.hasta.valueChanges, {
    initialValue: this.filtro.hasta.value,
  });

  protected readonly desdeVista = linkedSignal(() => this.desdeDelFiltro());
  protected readonly hastaVista = linkedSignal(() => this.hastaDelFiltro());

  /** Los lotes de compra, solo para saber qué días marcar en el calendario. */
  private readonly lotes = signal<readonly LoteResumen[]>([]);

  /**
   * Los días en que ENTRÓ queso, o sea las fechas de lote. Se marcan con un
   * punto en el calendario: así se ve de un vistazo qué días hay algo que mirar
   * en vez de ir probando fechas a ciegas.
   */
  private readonly diasConEntrada = computed(
    () => new Set(this.lotes().map((l) => l.fecha)),
  );

  /** Si no hay ni un día marcado, la nota del punto sobra: no hay punto que ver. */
  protected readonly hayDiasConEntrada = computed(() => this.diasConEntrada().size > 0);

  /**
   * Campo y no método: el calendario guarda la referencia, y un método suelto
   * perdería el `this` al llamarlo desde dentro del componente de Material.
   *
   * `dateToIso` arma la fecha con los componentes LOCALES del `Date`. No se usa
   * `toISOString()` porque ese pasa a UTC y en Colombia (UTC-5) devuelve el día
   * ANTERIOR antes de las 7 p.m.: el punto del 25 aparecería sobre el 24.
   */
  protected readonly claseDia = (d: Date): string =>
    this.diasConEntrada().has(dateToIso(d)) ? 'dia-con-entrada' : '';

  ngOnInit(): void {
    // Sin rango y una sola vez: los puntos no dependen del filtro (justamente
    // sirven para encontrar días que el filtro todavía no incluye) y volver a
    // pedirlos en cada cambio de fechas sería un viaje al servidor por clic.
    this.servicio.lotes().subscribe({
      next: (p) => this.lotes.set(p.lotes),
      // Si falla, el calendario se queda sin puntos y ya: es una ayuda visual,
      // el filtro funciona igual sin ella y no vale la pena alarmar por eso.
      error: () => this.lotes.set([]),
    });
  }

  /**
   * Le pasa el rango al filtro compartido, y solo cuando está COMPLETO.
   *
   * Al marcar el primer día, el calendario deja el otro extremo en nulo hasta
   * que se marque el segundo. Si ese nulo llegara al filtro, todas las pestañas
   * hijas recargarían con el rango a medias: un viaje al servidor de más y, por
   * un instante, cifras que no son las que el usuario está pidiendo.
   */
  protected aplicarRango(): void {
    const desde = this.desdeVista();
    const hasta = this.hastaVista();
    if (!desde || !hasta) return;
    this.filtro.desde.setValue(desde);
    this.filtro.hasta.setValue(hasta);
  }
}
