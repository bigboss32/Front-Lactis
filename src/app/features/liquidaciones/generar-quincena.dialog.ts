import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { dateToIso, hoyDate, isoToDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { LiquidacionesService, OmitidoAlGenerar, ResultadoGenerar } from './liquidaciones.service';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function toIso(fecha: Date): string {
  const mes = `${fecha.getMonth() + 1}`.padStart(2, '0');
  const dia = `${fecha.getDate()}`.padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/** Rango ISO de una quincena: 1.ª = día 1 al 15; 2.ª = día 16 a fin de mes. */
function rangoQuincena(anio: number, mes: number, quincena: 1 | 2): { inicio: string; fin: string } {
  if (quincena === 1) {
    return { inicio: toIso(new Date(anio, mes, 1)), fin: toIso(new Date(anio, mes, 15)) };
  }
  return {
    inicio: toIso(new Date(anio, mes, 16)),
    fin: toIso(new Date(anio, mes + 1, 0)), // día 0 del mes siguiente = último día del mes
  };
}

/** Quincena anterior completa: 1–15 o 16–fin de mes, según la fecha actual. */
function quincenaAnterior(): { inicio: string; fin: string } {
  const hoy = new Date();
  if (hoy.getDate() <= 15) {
    return rangoQuincena(hoy.getFullYear(), hoy.getMonth() - 1, 2);
  }
  return rangoQuincena(hoy.getFullYear(), hoy.getMonth(), 1);
}

/** Descompone una fecha ISO 'YYYY-MM-DD' sin pasar por Date (evita zonas horarias). */
function partesFecha(iso: string | null | undefined): { dia: number; mes: string; anio: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return null;
  const indiceMes = Number(m[2]) - 1;
  if (indiceMes < 0 || indiceMes > 11) return null;
  return { anio: Number(m[1]), mes: MESES[indiceMes], dia: Number(m[3]) };
}

/**
 * Lo que este diálogo le cuenta a la lista de atrás cuando se cierra.
 *
 * Salen las DOS cifras y no solo las generadas: el aviso de la lista tiene que poder
 * nombrar el faltante. Un "Se generaron 5 liquidaciones" a secas, cuando la corrida se
 * saltó a dos terceros, es lo que hace que el dueño cierre la quincena creyendo que
 * liquidó a todos.
 */
export interface CierreGenerar {
  generadas: number;
  omitidos: number;
}

@Component({
  selector: 'app-generar-quincena',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatTooltipModule,
    MatDatepickerModule, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ titulo() }}</h2>
    <mat-dialog-content>
      @if (resultado(); as r) {
        <!--
          LA PANTALLA DE RESULTADO, y sale SOLO cuando alguien quedó sin liquidar.
          No es un snackbar de tres segundos a propósito: lo que dice esta lista es que la
          leche (o el flete) de esos terceros NO tiene comprobante y nadie se la va a
          cobrar solo. Si el dueño no lo lee, cierra la quincena creyendo que liquidó a
          todos y el proveedor le reclama después, con razón.

          El caso feliz no pasa por acá: se cierra solo y avisa por la lista de atrás,
          como siempre.
        -->
        <div class="resultado">
          <p class="titular">
            <mat-icon aria-hidden="true">report_problem</mat-icon>
            <span>{{ textoGeneradas() }}. <strong>{{ textoOmitidos() }}.</strong></span>
          </p>

          @if (r.omitidos.length) {
            <p class="explicacion">
              Lo que estos entregaron en {{ periodoDeLaCorrida() }} quedó
              <strong>sin liquidar</strong>: no tienen comprobante y nadie se lo va a cobrar
              solo. Corrija lo que dice cada motivo y vuelva a generar.
            </p>

            <ul class="omitidos">
              @for (o of r.omitidos; track $index) {
                <li>
                  <div class="quien">
                    <mat-icon aria-hidden="true">person_off</mat-icon>
                    <span>
                      <strong>{{ o.tercero_nombre || 'Un tercero (el servidor no mandó el nombre)' }}</strong>
                      @if (queLiquidacion(o)) {
                        <small>liquidación de {{ queLiquidacion(o) }}</small>
                      }
                    </span>
                  </div>
                  <!-- El motivo TAL COMO LO MANDA EL SERVIDOR: el del cruce ya nombra la
                       otra liquidación, su período y las dos salidas que hay. -->
                  <p class="motivo">{{ motivoDe(o) }}</p>
                </li>
              }
            </ul>
          } @else {
            <!--
              LA RESPUESTA TRAE EL SOBRE PERO NO LA LISTA. Antes de callar y dejar que el
              dueño crea que liquidó a todos, se lo dice: esta pantalla no puede afirmar
              que no quedó nadie afuera si no pudo leer la lista.
            -->
            <p class="explicacion">
              El servidor respondió de una forma que esta pantalla no reconoce: no pudo leer
              a quién se saltó, así que <strong>no se puede afirmar que no quedó nadie sin
              liquidar</strong> en {{ periodoDeLaCorrida() }}. Revise en la lista que cada
              tercero que entregó en el período tenga su liquidación, y avise para que se
              corrija la pantalla.
            </p>
          }
        </div>
      } @else {
        <!--
          Se nombra lo que el GENERAR hace con las deudas viejas, porque es acá donde
          viajan: al generar, lo que un tercero quedó debiendo en una quincena pasada
          —cuando sus anticipos sumaron más que su liquidación— se le cobra en esta. Sin
          decirlo, el dueño ve un descuento en un comprobante nuevo y no sabe de dónde
          salió; el detalle de cada liquidación dice de cuál quincena vino.
        -->
        <p class="ayuda">
          1) Elige el mes y la quincena. 2) Revisa las fechas. 3) Genera. Se agrupan las
          recepciones sin liquidar del período, se descuentan los anticipos pendientes y se
          cobra lo que haya quedado debiendo de quincenas pasadas.
        </p>

        <!-- Paso 1: mes -->
        <div class="paso">
          <span class="paso-num">1</span>
          <div class="selector-mes">
            <button mat-icon-button type="button" (click)="mesAnterior()" aria-label="Mes anterior">
              <mat-icon>chevron_left</mat-icon>
            </button>
            <span class="mes">{{ etiquetaMes() }}</span>
            <button mat-icon-button type="button" (click)="mesSiguiente()" aria-label="Mes siguiente">
              <mat-icon>chevron_right</mat-icon>
            </button>
          </div>
        </div>

        <!-- Paso 2: quincena -->
        <div class="quincena-botones">
          <button
            mat-stroked-button
            type="button"
            class="q-btn"
            [class.activa]="quincenaActiva() === 1"
            (click)="aplicarQuincena(1)"
          >
            <mat-icon>event</mat-icon>
            <span>1.ª quincena<small>días {{ diasQ1() }}</small></span>
          </button>
          <button
            mat-stroked-button
            type="button"
            class="q-btn"
            [class.activa]="quincenaActiva() === 2"
            (click)="aplicarQuincena(2)"
          >
            <mat-icon>event</mat-icon>
            <span>2.ª quincena<small>días {{ diasQ2() }}</small></span>
          </button>
        </div>

        <!-- Paso 3: revisar/ajustar fechas -->
        <form [formGroup]="form" class="form-grid" id="form-generar" (ngSubmit)="generar()">
          <mat-form-field>
            <mat-label>Inicio del período</mat-label>
            <input matInput [matDatepicker]="pInicio" (click)="pInicio.open()" formControlName="periodo_inicio" required />
            <mat-datepicker-toggle matSuffix [for]="pInicio" />
            <mat-datepicker #pInicio />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Fin del período</mat-label>
            <input matInput [matDatepicker]="pFin" (click)="pFin.open()" formControlName="periodo_fin" required />
            <mat-datepicker-toggle matSuffix [for]="pFin" />
            <mat-datepicker #pFin />
          </mat-form-field>
          <mat-form-field class="full">
            <mat-label>Tipo</mat-label>
            <mat-select formControlName="tipo">
              <mat-option value="ambos">Ambos (proveedores y transportadores)</mat-option>
              <mat-option value="proveedor">Solo proveedores</mat-option>
              <mat-option value="transportador">Solo transportadores</mat-option>
            </mat-select>
          </mat-form-field>
        </form>

        @if (resumenPeriodo()) {
          <p class="resumen-periodo">
            <mat-icon aria-hidden="true">date_range</mat-icon>
            <span>Se liquidará: <strong>{{ resumenPeriodo() }}</strong></span>
          </p>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (resultado()) {
        <!-- Un solo botón, y no "Cancelar": la corrida ya ocurrió y esto es un acuse de
             recibo. Cerrar por acá es lo que recarga la lista de atrás. -->
        <button mat-flat-button type="button" (click)="cerrar()">Entendido</button>
      } @else {
        <button mat-button mat-dialog-close type="button">Cancelar</button>
        <button
          mat-flat-button
          type="submit"
          form="form-generar"
          [disabled]="form.invalid || generando()"
        >
          @if (generando()) {
            <app-spinner-boton /> Generando…
          } @else {
            Generar
          }
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .ayuda {
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.85rem;
    }

    .paso { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .paso-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      font-size: 0.75rem;
      font-weight: 700;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
    .selector-mes { display: flex; align-items: center; gap: 4px; }
    .selector-mes .mes {
      min-width: 130px;
      text-align: center;
      font-weight: 600;
      text-transform: capitalize;
    }

    .quincena-botones {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin: 4px 0 18px 32px;
    }
    .q-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      height: auto;
      padding: 10px 12px;
      text-align: left;

      span { display: flex; flex-direction: column; line-height: 1.2; }
      small { color: var(--mat-sys-on-surface-variant); font-size: 0.72rem; }
    }
    .q-btn.activa {
      border-color: var(--mat-sys-primary);
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
    }

    .resumen-periodo {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 4px 0 0;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.9rem;
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent);
      color: var(--mat-sys-on-surface);

      mat-icon { color: var(--mat-sys-primary); flex-shrink: 0; }
      strong { text-transform: capitalize; }
    }

    /* LA PANTALLA DE RESULTADO. Se distingue del caso feliz de un vistazo —el caso feliz
       ni siquiera abre esta pantalla, cierra y avisa por la lista— y usa el color de
       error del tema, el mismo con que la aplicación marca lo que salió mal. */
    .resultado .titular {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 0 0 12px;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid var(--mat-sys-error);
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font-size: 0.95rem;
      line-height: 1.35;

      mat-icon { color: var(--mat-sys-error); flex-shrink: 0; }
    }
    .resultado .explicacion {
      margin: 0 0 12px;
      font-size: 0.85rem;
      line-height: 1.4;
      color: var(--mat-sys-on-surface-variant);
    }
    .resultado .omitidos { margin: 0; padding: 0; list-style: none; }
    .resultado .omitidos li {
      padding: 10px 12px;
      border-radius: 8px;
      border-left: 3px solid var(--mat-sys-error);
      background: var(--mat-sys-surface-container-high);

      & + li { margin-top: 8px; }
    }
    .resultado .quien {
      display: flex;
      align-items: center;
      gap: 8px;

      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--mat-sys-error); }
      small { color: var(--mat-sys-on-surface-variant); margin-left: 6px; font-size: 0.75rem; }
    }
    .resultado .motivo {
      margin: 4px 0 0 26px;
      font-size: 0.8125rem;
      line-height: 1.4;
      color: var(--mat-sys-on-surface-variant);
    }

    @media (max-width: 560px) {
      .quincena-botones { grid-template-columns: 1fr; margin-left: 0; }
      .resultado .motivo { margin-left: 0; }
    }
  `,
})
export class GenerarQuincenaDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(LiquidacionesService);
  private readonly dialogRef = inject(MatDialogRef<GenerarQuincenaDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly generando = signal(false);

  /**
   * La corrida que hay que MOSTRAR, o null.
   *
   * Solo se llena cuando quedó alguien sin liquidar: el caso feliz cierra el diálogo al
   * instante, como siempre. O sea que "hay resultado en pantalla" y "hay omitidos" son
   * la misma cosa, y por eso el guardia de cierre y los botones se guían por esto.
   */
  readonly resultado = signal<ResultadoGenerar | null>(null);

  /** El período con el que se corrió, congelado: el formulario ya no se puede tocar. */
  private readonly periodoCorrido = signal('');

  private readonly quincena = quincenaAnterior();

  readonly form = this.fb.group({
    periodo_inicio: [isoToDate(this.quincena.inicio) ?? hoyDate(), Validators.required],
    periodo_fin: [isoToDate(this.quincena.fin) ?? hoyDate(), Validators.required],
    tipo: ['ambos' as 'ambos' | 'proveedor' | 'transportador', Validators.required],
  });

  /** Mes sobre el que actúan los botones de quincena (por defecto, el del período). */
  readonly mesSel = signal<{ anio: number; mes: number }>({
    anio: Number(this.quincena.inicio.slice(0, 4)),
    mes: Number(this.quincena.inicio.slice(5, 7)) - 1,
  });

  readonly etiquetaMes = computed(() => `${MESES[this.mesSel().mes]} ${this.mesSel().anio}`);
  readonly diasQ1 = computed(() => this.rangoDias(1));
  readonly diasQ2 = computed(() => this.rangoDias(2));

  private readonly valores = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /** Qué quincena del mes seleccionado coincide con las fechas actuales (1, 2 o null). */
  readonly quincenaActiva = computed(() => {
    const v = this.valores();
    const ini = dateToIso(v.periodo_inicio);
    const fin = dateToIso(v.periodo_fin);
    const { anio, mes } = this.mesSel();
    for (const q of [1, 2] as const) {
      const r = rangoQuincena(anio, mes, q);
      if (r.inicio === ini && r.fin === fin) return q;
    }
    return null;
  });

  /** Resumen legible del período elegido, ej. "Del 16 al 31 de julio de 2026". */
  readonly resumenPeriodo = computed(() => {
    const valores = this.valores();
    const inicio = partesFecha(dateToIso(valores.periodo_inicio));
    const fin = partesFecha(dateToIso(valores.periodo_fin));
    if (!inicio || !fin) return '';
    if (inicio.anio === fin.anio && inicio.mes === fin.mes) {
      return `Del ${inicio.dia} al ${fin.dia} de ${inicio.mes} de ${inicio.anio}`;
    }
    if (inicio.anio === fin.anio) {
      return `Del ${inicio.dia} de ${inicio.mes} al ${fin.dia} de ${fin.mes} de ${inicio.anio}`;
    }
    return `Del ${inicio.dia} de ${inicio.mes} de ${inicio.anio} al ${fin.dia} de ${fin.mes} de ${fin.anio}`;
  });

  /** El título dice de una qué pantalla se está mirando. */
  readonly titulo = computed(() =>
    this.resultado() ? 'Quedó plata sin liquidar' : 'Generar liquidaciones de la quincena',
  );

  /**
   * Lo que SÍ se generó, en una frase entera.
   *
   * Va entera y no solo el número porque con cero la frase cambia de forma ("No se generó
   * ninguna liquidación"), y ese caso existe: la corrida puede saltarse a todo el mundo.
   */
  readonly textoGeneradas = computed(() => {
    const cuantas = this.resultado()?.generadas.length ?? 0;
    if (cuantas === 0) return 'No se generó ninguna liquidación';
    return cuantas === 1 ? 'Se generó una liquidación' : `Se generaron ${cuantas} liquidaciones`;
  });

  /** Y a quién NO. Es lo que el dueño vino a saber, así que va en la misma frase. */
  readonly textoOmitidos = computed(() => {
    const cuantos = this.resultado()?.omitidos.length ?? 0;
    // Sin lista que leer no se puede contar, y menos poner un cero que sonaría a "no
    // quedó nadie afuera" cuando es justo lo que no se sabe.
    if (!cuantos) return 'No se pudo saber a quién NO se le generó';
    return cuantos === 1
      ? 'A un tercero NO se le generó'
      : `A ${cuantos} terceros NO se les generó`;
  });

  /**
   * El período con el que se corrió, para nombrarlo en el resultado.
   *
   * Se congela al momento de generar y no se lee del formulario: si el dueño moviera el
   * mes con el resultado en pantalla, el aviso terminaría hablando de otra quincena.
   */
  readonly periodoDeLaCorrida = computed(() => this.periodoCorrido() || 'el período');

  /**
   * 'leche' o 'flete': cuál de las dos cuentas del tercero se quedó sin comprobante.
   *
   * Se usa la palabra que MANDA EL SERVIDOR (`cuenta`) y no una traducción del `tipo`: es
   * la misma con que el motivo la nombra dos líneas más abajo ("ya tiene una liquidación
   * de leche del…") y con que el candado de Recepción diaria la nombra, y así no hay dos
   * pantallas diciéndole cosas distintas a la misma cuenta. El `tipo` queda de respaldo
   * para una respuesta que no la traiga; y si no hay ninguno, el renglón no lo dice.
   */
  queLiquidacion(omitido: OmitidoAlGenerar): string {
    if (omitido.cuenta) return omitido.cuenta;
    if (omitido.tipo === 'proveedor') return 'leche';
    if (omitido.tipo === 'transportador') return 'flete';
    return '';
  }

  /**
   * El motivo del servidor, o el respaldo si no vino ninguno.
   *
   * El respaldo nombra el caso conocido —el período cruzado— para que el dueño tenga por
   * dónde empezar aunque la respuesta llegue sin explicación: quedarse en "no se pudo" es
   * lo que lo dejaba atascado.
   */
  motivoDe(omitido: OmitidoAlGenerar): string {
    return (
      omitido.motivo ??
      'El servidor no mandó el motivo. Revise si este tercero ya tiene una liquidación de ' +
        'un período que se cruce con estas fechas: dos liquidaciones montadas una sobre la ' +
        'otra no se pueden generar.'
    );
  }

  constructor() {
    // EL GUARDIA DE CIERRE, y este diálogo pasó a tener DOS pantallas, así que ya no es
    // el compartido (`protegerCambios`):
    //
    // · en el FORMULARIO hace lo mismo de siempre: un clic afuera o Escape con las fechas
    //   tecleadas pide confirmación antes de descartarlas;
    // · en la PANTALLA DE RESULTADO no hay nada que descartar —la corrida ya ocurrió— y lo
    //   que hay es una lista de plata que quedó sin liquidar. No se puede ir con un clic
    //   afuera ni con un Escape: se cierra con "Entendido", que es también el único
    //   camino que le devuelve a la lista de atrás lo que pasó (si se fuera por el
    //   backdrop, `close()` saldría sin números y la lista no se recargaría, dejando en
    //   pantalla una quincena vieja).
    this.dialogRef.disableClose = true;
    const intentarCerrar = (): void => {
      if (this.resultado()) return;
      if (!this.form.dirty || confirm('Tienes cambios sin guardar. ¿Deseas descartarlos?')) {
        this.dialogRef.close();
      }
    };
    this.dialogRef.backdropClick().subscribe(() => intentarCerrar());
    this.dialogRef.keydownEvents().subscribe((evento) => {
      if (evento.key === 'Escape') intentarCerrar();
    });
  }

  /** Cierra llevándole a la lista de atrás las dos cifras de la corrida. */
  cerrar(): void {
    const r = this.resultado();
    this.dialogRef.close({
      generadas: r?.generadas.length ?? 0,
      omitidos: r?.omitidos.length ?? 0,
    } satisfies CierreGenerar);
  }

  mesAnterior(): void {
    const { anio, mes } = this.mesSel();
    this.mesSel.set(mes === 0 ? { anio: anio - 1, mes: 11 } : { anio, mes: mes - 1 });
  }

  mesSiguiente(): void {
    const { anio, mes } = this.mesSel();
    this.mesSel.set(mes === 11 ? { anio: anio + 1, mes: 0 } : { anio, mes: mes + 1 });
  }

  aplicarQuincena(quincena: 1 | 2): void {
    const { anio, mes } = this.mesSel();
    const rango = rangoQuincena(anio, mes, quincena);
    this.form.patchValue({
      periodo_inicio: isoToDate(rango.inicio)!,
      periodo_fin: isoToDate(rango.fin)!,
    });
  }

  /** Días de la quincena del mes seleccionado, ej. "16 al 31". */
  private rangoDias(quincena: 1 | 2): string {
    const { anio, mes } = this.mesSel();
    const r = rangoQuincena(anio, mes, quincena);
    return `${Number(r.inicio.slice(8, 10))} al ${Number(r.fin.slice(8, 10))}`;
  }

  /**
   * Corre la quincena y decide qué se le muestra al dueño.
   *
   * DOS SALIDAS, y la diferencia se ve de una:
   *
   * · sin omitidos (el 99% de las corridas) el diálogo se cierra solo y la lista de atrás
   *   avisa cuántas se generaron, igual que siempre;
   * · con omitidos se QUEDA ABIERTO mostrando a quién le falta y por qué. Eso no cabe en
   *   un snackbar de tres segundos: si se va solo mientras el dueño mira otra cosa, él
   *   cierra la quincena creyendo que liquidó a todos y esa leche queda sin comprobante.
   *
   * Y un error del servidor sigue siendo un error (el período al revés, por ejemplo): eso
   * no es una corrida con omitidos, es una corrida que no ocurrió.
   */
  async generar(): Promise<void> {
    if (this.form.invalid) return;
    this.generando.set(true);
    try {
      const { periodo_inicio, periodo_fin, tipo } = this.form.getRawValue();
      const resultado = await firstValueFrom(
        this.servicio.generar({
          periodo_inicio: dateToIso(periodo_inicio)!,
          periodo_fin: dateToIso(periodo_fin)!,
          tipo,
        }),
      );
      // Se cierra solo cuando SE SABE que no quedó nadie afuera. Si la respuesta trajo el
      // sobre y no se le pudo leer la lista, la pantalla se queda diciéndolo: callar es
      // lo que le hace creer al dueño que ya liquidó a todos.
      if (!resultado.omitidos.length && !resultado.omitidosSinLeer) {
        this.dialogRef.close({
          generadas: resultado.generadas.length,
          omitidos: 0,
        } satisfies CierreGenerar);
        return;
      }
      this.periodoCorrido.set(this.resumenPeriodo().replace(/^Del/, 'del'));
      this.resultado.set(resultado);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible generar las liquidaciones');
    } finally {
      this.generando.set(false);
    }
  }
}
