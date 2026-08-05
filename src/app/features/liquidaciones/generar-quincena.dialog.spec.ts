import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';

import { GenerarQuincenaDialog } from './generar-quincena.dialog';
import { LiquidacionesService, resultadoGenerarDeCrudo } from './liquidaciones.service';

/**
 * GENERAR LA QUINCENA CUANDO LA CORRIDA SE SALTA A ALGUIEN.
 *
 * El caso real, con las cifras medidas en el backend: Henri ya tiene una liquidación del
 * 01 al 15 y se corre otra vez ese mismo período. Antes eso TUMBABA la corrida entera y
 * Marleny y Aleida —que no tenían nada que ver— se quedaban sin comprobante por $720.000
 * de leche. Ahora el servidor salta a Henri y sigue con las demás.
 *
 * Y AHÍ APARECE EL PELIGRO NUEVO: si la pantalla solo dice "se generaron 2
 * liquidaciones", el dueño cierra la quincena creyendo que liquidó a todos, y la leche de
 * Henri queda sin comprobante hasta que él venga a reclamar. Estas pruebas miden que el
 * dueño no pueda salir de ahí sin saber a quién le falta y por qué.
 */

/** Una liquidación como la manda el servidor, con lo mínimo que la pantalla mira. */
const liquidacionCruda = (nombre: string) => ({
  id: `liq-${nombre}`,
  proveedor_nombre: nombre,
  valor_total: '360000',
});

/** El motivo del cruce, palabra por palabra como lo escribe el backend. */
const MOTIVO_CRUCE =
  'Henri C ya tiene una liquidación de leche del 01/06/2026 al 15/06/2026, que se cruza ' +
  'con estas fechas (01/06/2026 al 15/06/2026). Dos liquidaciones montadas una sobre la ' +
  'otra dejan sin cobrar lo que el tercero quedó debiendo en la primera, y se le vuelve a ' +
  'pagar una plata que ya se le adelantó. Ajuste las fechas para que no se monten, o anule ' +
  'esa liquidación primero si hay que rehacerla';

/** Y el otro motivo que hay hoy: el transportador sin tarifa de flete. */
const MOTIVO_SIN_TARIFA =
  'Alex Agudelo no tiene tarifa de flete —o quedó en cero—, así que el comprobante le ' +
  'saldría en $0 y no se generó. Sus 175 L de este período quedan pendientes y no se ' +
  'perdió nada: póngale la tarifa por litro (o vuélvale a asignar la ruta) y genere otra vez';

/** Un omitido como lo manda el servidor (`LiquidacionOmitida`). */
const omitidoCrudo = (
  nombre: string,
  cuenta: 'leche' | 'flete',
  motivo: string,
  codigo = 'periodo_cruzado',
) => ({
  tipo: cuenta === 'leche' ? 'proveedor' : 'transportador',
  cuenta,
  tercero_id: `t-${nombre}`,
  tercero_nombre: nombre,
  motivo,
  motivo_codigo: codigo,
});

class ServicioFalso {
  /** El JSON CRUDO del servidor: pasa por el normalizador de verdad. */
  respuesta: unknown = [];
  fallar: unknown = null;

  generar(): Observable<ReturnType<typeof resultadoGenerarDeCrudo>> {
    if (this.fallar) return throwError(() => this.fallar);
    return of(resultadoGenerarDeCrudo(this.respuesta));
  }
}

describe('GenerarQuincenaDialog: a quién NO se le generó', () => {
  let fixture: ComponentFixture<GenerarQuincenaDialog>;
  let dialogo: GenerarQuincenaDialog;
  let servicio: ServicioFalso;
  let cerradoCon: unknown[];
  let backdrop: Subject<MouseEvent>;
  let teclas: Subject<KeyboardEvent>;
  let avisos: string[];

  beforeEach(async () => {
    servicio = new ServicioFalso();
    cerradoCon = [];
    avisos = [];
    backdrop = new Subject<MouseEvent>();
    teclas = new Subject<KeyboardEvent>();

    await TestBed.configureTestingModule({
      imports: [GenerarQuincenaDialog, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: LiquidacionesService, useValue: servicio },
        {
          provide: MatDialogRef,
          useValue: {
            disableClose: false,
            close: (valor?: unknown) => cerradoCon.push(valor),
            backdropClick: () => backdrop.asObservable(),
            keydownEvents: () => teclas.asObservable(),
          },
        },
        { provide: MatSnackBar, useValue: { open: (m: string) => avisos.push(m) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(GenerarQuincenaDialog);
    dialogo = fixture.componentInstance;
    fixture.detectChanges();
  });

  const generar = async (respuesta: unknown): Promise<void> => {
    servicio.respuesta = respuesta;
    await dialogo.generar();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const texto = (selector: string): string =>
    ((fixture.nativeElement.querySelector(selector) as HTMLElement | null)?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  // El nombre va en el <span> de `.quien`, no en el párrafo entero: el <mat-icon> hermano
  // mete su ligadura ("person_off") en el textContent.
  const omitidosEnPantalla = (): { quien: string; motivo: string }[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.omitidos li')).map((li) => ({
      quien: ((li as HTMLElement).querySelector('.quien span')?.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
      motivo: ((li as HTMLElement).querySelector('.motivo')?.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    }));

  it('el caso feliz cierra solo y no muestra ninguna pantalla de resultado', async () => {
    await generar({
      generadas: [liquidacionCruda('Marleny'), liquidacionCruda('Aleida')],
      omitidos: [],
    });

    expect(cerradoCon).toEqual([{ generadas: 2, omitidos: 0 }]);
    expect(fixture.nativeElement.querySelector('.resultado')).toBeNull();
  });

  it('con omitidas NO se cierra: se queda mostrando a quién le falta y por qué', async () => {
    // El hallazgo tal como pasó: Henri tenía su quincena en borrador, y ahora Marleny y
    // Aleida sí salen con comprobante mientras él queda nombrado en la lista.
    await generar({
      generadas: [liquidacionCruda('Marleny'), liquidacionCruda('Aleida')],
      omitidas: [omitidoCrudo('Henri C', 'leche', MOTIVO_CRUCE)],
    });

    // Lo primero: NO se cerró. Un aviso de plata sin liquidar no se va solo.
    expect(cerradoCon).toEqual([]);
    // Y se distingue del caso feliz desde el título.
    expect(dialogo.titulo()).toBe('Quedó plata sin liquidar');
    expect(texto('.resultado .titular')).toContain('Se generaron 2 liquidaciones');
    expect(texto('.resultado .titular')).toContain('A un tercero NO se le generó');

    const [omitido] = omitidosEnPantalla();
    expect(omitido.quien).toContain('Henri C');
    // 'leche', la palabra que manda el servidor: el dueño no dice "tipo proveedor".
    expect(omitido.quien).toContain('liquidación de leche');
    // EL MOTIVO TAL CUAL, con la otra liquidación nombrada y las dos salidas que hay.
    expect(omitido.motivo).toBe(MOTIVO_CRUCE);
    expect(omitido.motivo).toContain('del 01/06/2026 al 15/06/2026');
    expect(omitido.motivo).toContain('Ajuste las fechas');
  });

  it('el aviso no se va con un clic afuera ni con Escape: se cierra con Entendido', async () => {
    await generar({
      generadas: [liquidacionCruda('Marleny')],
      omitidas: [omitidoCrudo('Henri C', 'leche', MOTIVO_CRUCE)],
    });

    backdrop.next(new MouseEvent('click'));
    teclas.next(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cerradoCon).toEqual([]);

    dialogo.cerrar();
    // Las DOS cifras, o el aviso de la lista de atrás no puede nombrar el faltante.
    expect(cerradoCon).toEqual([{ generadas: 1, omitidos: 1 }]);
  });

  it('cuando no se generó NADA y se saltó a todos, la frase lo dice así', async () => {
    // Los DOS motivos que hay hoy, juntos: el período cruzado y el flete sin tarifa.
    await generar({
      generadas: [],
      omitidas: [
        omitidoCrudo('Henri C', 'leche', MOTIVO_CRUCE),
        omitidoCrudo('Alex Agudelo', 'flete', MOTIVO_SIN_TARIFA, 'flete_sin_tarifa'),
      ],
    });

    expect(texto('.resultado .titular')).toContain('No se generó ninguna liquidación');
    expect(texto('.resultado .titular')).toContain('A 2 terceros NO se les generó');
    // El flete se nombra flete, y la leche leche.
    expect(omitidosEnPantalla().map((o) => o.quien)).toEqual([
      jasmine.stringContaining('liquidación de leche'),
      jasmine.stringContaining('liquidación de flete'),
    ]);
    // Cada uno con SU motivo: el del flete dice los litros que quedaron esperando.
    expect(omitidosEnPantalla()[1].motivo).toBe(MOTIVO_SIN_TARIFA);
    expect(omitidosEnPantalla()[1].motivo).toContain('Sus 175 L de este período quedan pendientes');
  });

  it('nombra el período de la corrida y no el que quede en el formulario después', async () => {
    dialogo.mesSel.set({ anio: 2026, mes: 5 }); // junio de 2026
    dialogo.aplicarQuincena(1);
    await generar({
      generadas: [],
      omitidas: [omitidoCrudo('Henri C', 'leche', MOTIVO_CRUCE)],
    });

    expect(dialogo.periodoDeLaCorrida()).toBe('del 1 al 15 de junio de 2026');
    expect(texto('.resultado .explicacion')).toContain('del 1 al 15 de junio de 2026');
    expect(texto('.resultado .explicacion')).toContain('sin liquidar');
  });

  it('si el servidor no manda el motivo, el respaldo nombra el caso conocido', async () => {
    await generar({ generadas: [], omitidas: [{ tercero_nombre: 'Henri C' }] });

    const [omitido] = omitidosEnPantalla();
    // Sin cuenta ni tipo no se inventa "de leche": el renglón simplemente no lo dice.
    expect(omitido.quien).toBe('Henri C');
    expect(omitido.motivo).toContain('un período que se cruce con estas fechas');
  });

  it('si la respuesta trae el sobre sin la lista, no promete que no quedó nadie', async () => {
    // El servidor cambió el nombre del campo y esta pantalla no lo reconoce. Callar y
    // cerrar con "se generaron 2" es exactamente el defecto que se está arreglando.
    await generar({ generadas: [liquidacionCruda('Marleny'), liquidacionCruda('Aleida')] });

    expect(cerradoCon).toEqual([]);
    expect(texto('.resultado .titular')).toContain('Se generaron 2 liquidaciones');
    expect(texto('.resultado .titular')).toContain('No se pudo saber a quién NO se le generó');
    expect(texto('.resultado .explicacion')).toContain(
      'no se puede afirmar que no quedó nadie sin liquidar',
    );
    expect(fixture.nativeElement.querySelector('.omitidos')).toBeNull();
  });

  it('un error del servidor sigue siendo un error, no una corrida con omitidos', async () => {
    servicio.fallar = new Error('boom');
    await dialogo.generar();
    fixture.detectChanges();

    expect(cerradoCon).toEqual([]);
    expect(fixture.nativeElement.querySelector('.resultado')).toBeNull();
    expect(avisos).toEqual(['No fue posible generar las liquidaciones']);
  });
});

describe('resultadoGenerarDeCrudo: la respuesta de Generar, venga como venga', () => {
  it('la forma VIEJA (el arreglo pelado) no deja nada por leer', () => {
    const r = resultadoGenerarDeCrudo([liquidacionCruda('Marleny')]);

    expect(r.generadas.length).toBe(1);
    expect(r.omitidos).toEqual([]);
    // En esa forma no había lista que buscar: un cruce venía como error, no como omitido.
    expect(r.omitidosSinLeer).toBeFalse();
  });

  it('el contrato de hoy —generadas y omitidas— se lee tal cual', () => {
    const r = resultadoGenerarDeCrudo({
      generadas: [liquidacionCruda('Marleny')],
      omitidas: [omitidoCrudo('Henri C', 'leche', MOTIVO_CRUCE)],
    });

    expect(r.generadas.length).toBe(1);
    expect(r.omitidosSinLeer).toBeFalse();
    expect(r.omitidos).toEqual([
      {
        tipo: 'proveedor',
        cuenta: 'leche',
        tercero_id: 't-Henri C',
        tercero_nombre: 'Henri C',
        motivo: MOTIVO_CRUCE,
      },
    ]);
  });

  it('una lista de omitidas VACÍA es una respuesta completa: no quedó nadie afuera', () => {
    const r = resultadoGenerarDeCrudo({ generadas: [], omitidas: [] });

    expect(r.omitidosSinLeer).toBeFalse();
  });

  it('un sobre SIN lista de omitidas no se lee como "no quedó nadie"', () => {
    // El peligro: si el campo se llamara distinto, la lista saldría vacía y la pantalla
    // diría "se generaron 2" en silencio. Acá queda marcado que no se pudo leer.
    const r = resultadoGenerarDeCrudo({ generadas: [liquidacionCruda('Marleny')] });

    expect(r.generadas.length).toBe(1);
    expect(r.omitidosSinLeer).toBeTrue();
  });

  /**
   * Los nombres hermanos son TOLERANCIA, no el contrato: el de hoy es 'omitidas'. Están
   * porque el precio de equivocarse no es una pantalla fea, es una lista vacía sobre plata
   * sin liquidar que nadie ve.
   */
  it('aguanta los nombres hermanos del campo y del motivo', () => {
    const r = resultadoGenerarDeCrudo({
      liquidaciones: [liquidacionCruda('Marleny')],
      omitidos: [{ tipo: 'transportador', transportador_nombre: 'Alex', razon: 'período cruzado' }],
    });

    expect(r.generadas.length).toBe(1);
    expect(r.omitidos).toEqual([
      {
        tipo: 'transportador',
        cuenta: null,
        tercero_id: null,
        tercero_nombre: 'Alex',
        motivo: 'período cruzado',
      },
    ]);
  });

  it('una respuesta que no se entiende no revienta la pantalla', () => {
    expect(resultadoGenerarDeCrudo(null)).toEqual({
      generadas: [],
      omitidos: [],
      omitidosSinLeer: false,
    });
  });
});
