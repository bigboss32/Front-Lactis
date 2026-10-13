import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NEVER, Observable, of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion, Page } from '../../core/models';
import { LiquidacionListPage } from './liquidacion-list.page';
import { LiquidacionesService, ResumenLiquidaciones } from './liquidaciones.service';

/**
 * EL FILTRO POR QUINCENA DEL LISTADO ES EL DE "GENERAR LIQUIDACIONES".
 *
 * El dueño liquida por quincenas: el mes con sus flechas y "1.ª quincena (días 1 al 15)" /
 * "2.ª quincena (días 16 al 30)", y no los botones sueltos de "Hoy / Este mes / Mes pasado".
 * Lo que se mide acá es que el botón llegue hasta las DOS consultas de la pantalla —la lista
 * y las tarjetas— con las fechas de esa quincena, y que cada una se pida UNA vez (con las
 * fechas puestas de a una salían dos pedidos, el primero con un Hasta viejo).
 */

const RESUMEN_EN_CERO: ResumenLiquidaciones = {
  borradores: 0,
  aprobadas: 0,
  saldo_aprobadas: '0.00',
  parciales: 0,
  saldo_parciales: '0.00',
  pagadas: 0,
  le_quedaron_debiendo: '0.00',
  liquidaciones_que_deben: 0,
};

interface Filtros {
  desde?: string | null;
  hasta?: string | null;
  tipo?: string | null;
}

class ServicioFalso {
  pedidosDeLista: Filtros[] = [];
  pedidosDeResumen: Filtros[] = [];

  list(params?: Filtros): Observable<Page<Liquidacion>> {
    this.pedidosDeLista.push({ desde: params?.desde, hasta: params?.hasta, tipo: params?.tipo });
    return of({ items: [], total: 0, page: 1, page_size: 20, pages: 1 });
  }

  resumen(filtros: Filtros): Observable<ResumenLiquidaciones> {
    this.pedidosDeResumen.push({ desde: filtros.desde, hasta: filtros.hasta, tipo: filtros.tipo });
    return of(RESUMEN_EN_CERO);
  }
}

const texto = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Una fila completa (la plantilla lee su estado, su tipo y sus cifras). */
const unaFila = (id: string): Liquidacion =>
  ({
    id,
    empresa_id: 'e-1',
    estado: 'borrador',
    estado_visible: 'borrador',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    tipo: 'proveedor',
    proveedor_id: 'p-1',
    proveedor_nombre: id,
    transportador_id: null,
    transportador_nombre: null,
    periodo_inicio: '2026-10-01',
    periodo_fin: '2026-10-15',
    total_litros: '100',
    precio_promedio: '1800',
    valor_bruto: '180000',
    bonificaciones: '0',
    descuentos: '0',
    valor_transporte: '0',
    anticipos: '0',
    valor_total: '180000',
    neto_a_pagar: '180000',
    pagado: '0',
    saldo: '180000',
    le_queda_debiendo: '0',
    observaciones: null,
    detalles: [],
    pagos: [],
  }) as Liquidacion;

describe('LiquidacionListPage: filtrar por quincena como en Generar', () => {
  let fixture: ComponentFixture<LiquidacionListPage>;
  let servicio: ServicioFalso;

  const armar = async (): Promise<void> => {
    sessionStorage.clear();
    servicio = new ServicioFalso();
    await TestBed.configureTestingModule({
      imports: [LiquidacionListPage, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: LiquidacionesService, useValue: servicio },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LiquidacionListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const el = (): HTMLElement => fixture.nativeElement;
  const botones = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('app-selector-quincena .q-btn'));
  const flechas = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('app-selector-quincena .selector-mes button'));
  /** Las fechas esperan 300 ms antes de recargar (una sola consulta con el rango entero). */
  const respiro = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 350));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const tocar = async (boton: HTMLButtonElement): Promise<void> => {
    boton.click();
    fixture.detectChanges();
    await respiro();
  };
  const casilla = (clase: 'fecha-desde' | 'fecha-hasta'): HTMLInputElement =>
    el().querySelector<HTMLInputElement>(`app-rango-de-fechas input.${clase}`)!;
  /** Teclea en la casilla y espera el respiro de las fechas. */
  const teclear = async (clase: 'fecha-desde' | 'fecha-hasta', escrito: string): Promise<void> => {
    casilla(clase).value = escrito;
    casilla(clase).dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await respiro();
  };

  afterEach(() => sessionStorage.clear());

  it('las fechas se filtran por quincena Y con Desde / Hasta; ya no están los botones de Hoy / Este mes ni los desplegables', async () => {
    await armar();

    expect(el().querySelector('app-selector-quincena')).not.toBeNull();
    expect(el().querySelector('app-rango-fechas-rapido')).toBeNull();
    expect(texto(botones()[0])).toContain('1.ª quincena');
    expect(texto(botones()[1])).toContain('2.ª quincena');
    // Las casillas Desde y Hasta están (para cualquier otro período); los desplegables no.
    expect(casilla('fecha-desde')).not.toBeNull();
    expect(casilla('fecha-hasta')).not.toBeNull();
    expect(texto(el().querySelector('app-rango-de-fechas'))).toContain('Desde');
    expect(texto(el().querySelector('app-rango-de-fechas'))).toContain('Hasta');
    expect(el().querySelector('.page-toolbar mat-select')).toBeNull();
  });

  it('la 2.ª quincena de septiembre filtra la lista y las tarjetas del 16 al 30, cada una una sola vez', async () => {
    await armar();
    const pagina = fixture.componentInstance;
    pagina.desde.setValue(new Date(2026, 8, 5));
    pagina.hasta.setValue(new Date(2026, 8, 20));
    fixture.detectChanges();
    await respiro();
    expect(texto(el().querySelector('app-selector-quincena .mes'))).toBe('septiembre 2026');
    const listasAntes = servicio.pedidosDeLista.length;
    const resumenesAntes = servicio.pedidosDeResumen.length;

    await tocar(botones()[1]);

    expect(servicio.pedidosDeLista.length - listasAntes).toBe(1);
    expect(servicio.pedidosDeResumen.length - resumenesAntes).toBe(1);
    expect(servicio.pedidosDeLista.at(-1)).toEqual({ desde: '2026-09-16', hasta: '2026-09-30', tipo: null });
    expect(servicio.pedidosDeResumen.at(-1)).toEqual({ desde: '2026-09-16', hasta: '2026-09-30', tipo: null });
    expect(botones()[1].classList).toContain('activa');
  });

  it('con la quincena puesta, la flecha pide la del mes anterior', async () => {
    await armar();
    const pagina = fixture.componentInstance;
    pagina.desde.setValue(new Date(2026, 8, 16));
    pagina.hasta.setValue(new Date(2026, 8, 30));
    fixture.detectChanges();
    await respiro();
    const listasAntes = servicio.pedidosDeLista.length;

    await tocar(flechas()[0]);

    expect(servicio.pedidosDeLista.length - listasAntes).toBe(1);
    expect(servicio.pedidosDeLista.at(-1)).toEqual({ desde: '2026-08-16', hasta: '2026-08-31', tipo: null });
    expect(texto(el().querySelector('app-selector-quincena .mes'))).toBe('agosto 2026');
  });

  it('tocar la quincena marcada quita el filtro y la lista vuelve a pedirse sin fechas', async () => {
    await armar();
    const pagina = fixture.componentInstance;
    pagina.desde.setValue(new Date(2026, 8, 1));
    pagina.hasta.setValue(new Date(2026, 8, 15));
    fixture.detectChanges();
    await respiro();

    await tocar(botones()[0]);

    expect(servicio.pedidosDeLista.at(-1)).toEqual({ desde: null, hasta: null, tipo: null });
    expect(pagina.desde.value).toBeNull();
    expect(pagina.hasta.value).toBeNull();
  });

  /** Arma la pantalla con lo que la sesión tenía guardado. */
  const armarConGuardado = async (guardado: Record<string, unknown>): Promise<void> => {
    sessionStorage.setItem('qe.filtros.liquidaciones', JSON.stringify(guardado));
    servicio = new ServicioFalso();
    await TestBed.configureTestingModule({
      imports: [LiquidacionListPage, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: LiquidacionesService, useValue: servicio },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LiquidacionListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('un rango propio guardado (los primeros 4 de octubre) se CONSERVA y se ve en Desde y Hasta: ya no hay un filtro escondido', async () => {
    await armarConGuardado({
      tipo: null,
      estado: null,
      desde: { __fecha: new Date(2026, 9, 1).toISOString() },
      hasta: { __fecha: new Date(2026, 9, 4).toISOString() },
    });

    expect(servicio.pedidosDeLista[0]).toEqual({ desde: '2026-10-01', hasta: '2026-10-04', tipo: null });
    expect(servicio.pedidosDeResumen[0]).toEqual({ desde: '2026-10-01', hasta: '2026-10-04', tipo: null });
    // Y se ve: las dos casillas traen las fechas, y ninguna quincena queda marcada.
    expect(casilla('fecha-desde').value).toContain('2026');
    expect(casilla('fecha-hasta').value).toContain('2026');
    expect(botones().some((b) => b.classList.contains('activa'))).toBeFalse();
    // El mes no dice "sin filtro": hay un rango propio.
    expect(el().querySelector('app-selector-quincena .mes')!.getAttribute('title')).toContain('rango propio');
  });

  it('con una sola fecha guardada (a medias) el rango queda abierto: "desde el 1 de septiembre en adelante"', async () => {
    await armarConGuardado({ desde: { __fecha: new Date(2026, 8, 1).toISOString() }, hasta: null });

    expect(servicio.pedidosDeLista[0]).toEqual({ desde: '2026-09-01', hasta: null, tipo: null });
    expect(casilla('fecha-hasta').value).toBe('');
  });

  // ------------------------------------------------------------------ Desde y Hasta, a mano
  it('elegir Desde y Hasta filtra la lista y las tarjetas con ESE rango, una sola vez, y no marca ninguna quincena', async () => {
    await armar();
    const pagina = fixture.componentInstance;
    const listasAntes = servicio.pedidosDeLista.length;
    const resumenesAntes = servicio.pedidosDeResumen.length;

    pagina.desde.setValue(new Date(2026, 8, 5));
    pagina.hasta.setValue(new Date(2026, 9, 12)); // cruza de mes: ninguna quincena
    fixture.detectChanges();
    await respiro();

    expect(servicio.pedidosDeLista.length - listasAntes).toBe(1);
    expect(servicio.pedidosDeResumen.length - resumenesAntes).toBe(1);
    expect(servicio.pedidosDeLista.at(-1)).toEqual({ desde: '2026-09-05', hasta: '2026-10-12', tipo: null });
    expect(servicio.pedidosDeResumen.at(-1)).toEqual({ desde: '2026-09-05', hasta: '2026-10-12', tipo: null });
    expect(botones().some((b) => b.classList.contains('activa'))).toBeFalse();
    expect(casilla('fecha-desde').value).toContain('2026');
  });

  it('escribir las fechas a pedazos no dispara una consulta por pedazo: espera y pide una', async () => {
    await armar();
    const pagina = fixture.componentInstance;
    const listasAntes = servicio.pedidosDeLista.length;

    pagina.desde.setValue(new Date(2002, 0, 10)); // "1/10/2" ya es una fecha para el navegador
    pagina.desde.setValue(new Date(2020, 0, 10));
    pagina.desde.setValue(new Date(2026, 0, 10));
    pagina.hasta.setValue(new Date(2026, 0, 31));
    fixture.detectChanges();
    await respiro();

    expect(servicio.pedidosDeLista.length - listasAntes).toBe(1);
    expect(servicio.pedidosDeLista.at(-1)).toEqual({ desde: '2026-01-10', hasta: '2026-01-31', tipo: null });
  });

  it('un rango propio que resulta ser justo una quincena la marca (y al revés, un botón llena las casillas)', async () => {
    await armar();
    const pagina = fixture.componentInstance;

    pagina.desde.setValue(new Date(2026, 8, 16));
    pagina.hasta.setValue(new Date(2026, 8, 30));
    fixture.detectChanges();
    await respiro();
    expect(botones()[1].classList).toContain('activa');

    await tocar(botones()[0]);
    expect(casilla('fecha-desde').value).toContain('2026');
    expect(pagina.desde.value).toEqual(new Date(2026, 8, 1));
    expect(pagina.hasta.value).toEqual(new Date(2026, 8, 15));
  });

  it('la X de cada casilla la quita y el rango queda abierto de ese lado', async () => {
    await armar();
    const pagina = fixture.componentInstance;
    pagina.desde.setValue(new Date(2026, 8, 5));
    pagina.hasta.setValue(new Date(2026, 8, 20));
    fixture.detectChanges();
    await respiro();
    expect(el().querySelector('.quitar-desde')).not.toBeNull();

    (el().querySelector('.quitar-hasta') as HTMLButtonElement).click();
    fixture.detectChanges();
    await respiro();

    expect(pagina.hasta.value).toBeNull();
    expect(servicio.pedidosDeLista.at(-1)).toEqual({ desde: '2026-09-05', hasta: null, tipo: null });
    expect(el().querySelector('.quitar-hasta')).toBeNull();
    expect(el().querySelector('.quitar-desde')).not.toBeNull();
  });

  describe('«Desde» posterior a «Hasta»', () => {
    const ponerAlReves = async (): Promise<void> => {
      const pagina = fixture.componentInstance;
      pagina.desde.setValue(new Date(2026, 8, 20));
      pagina.hasta.setValue(new Date(2026, 8, 5));
      fixture.detectChanges();
      await respiro();
    };

    it('NO se consulta, se dice con palabras (al lado de las casillas y en la tabla) y no dice "no hay liquidaciones"', async () => {
      await armar();
      const listasAntes = servicio.pedidosDeLista.length;
      const resumenesAntes = servicio.pedidosDeResumen.length;

      await ponerAlReves();

      expect(servicio.pedidosDeLista.length).toBe(listasAntes);
      expect(servicio.pedidosDeResumen.length).toBe(resumenesAntes);
      expect(texto(el().querySelector('app-rango-de-fechas .aviso-al-reves'))).toContain('«Desde» es posterior a «Hasta»');
      expect(texto(el().querySelector('.empty-state'))).toContain('Las fechas están al revés');
      expect(texto(el().querySelector('.empty-state'))).not.toContain('No hay liquidaciones');
    });

    it('es UN solo mensaje en la tabla, el de las fechas al revés: no se le suma el de "no se entiende una de las fechas"', async () => {
      await armar();

      await ponerAlReves();

      const pagina = fixture.componentInstance;
      expect(pagina.fechasAlReves()).toBeTrue();
      // Las dos fechas están bien escritas, solo que en el orden contrario: nada que no se entienda.
      expect(pagina.fechasIlegibles()).toBeFalse();
      expect(el().querySelectorAll('.empty-state').length).toBe(1);
      const vacio = texto(el().querySelector('.empty-state'));
      expect(vacio).toContain('Las fechas están al revés');
      expect(vacio).not.toContain('No se entiende');
      expect(el().querySelector('app-rango-de-fechas .aviso-ilegible')).toBeNull();
    });

    it('las filas y las tarjetas de antes se vacían: no quedan bajo unas fechas que no son las suyas', async () => {
      await armar();
      const pagina = fixture.componentInstance;
      pagina.filas.set([unaFila('vieja')]);
      pagina.total.set(1);

      await ponerAlReves();

      expect(pagina.filas()).toEqual([]);
      expect(pagina.total()).toBe(0);
      expect(pagina.resumen()).toBeNull();
      expect(pagina.fechasAlReves()).toBeTrue();
    });

    it('al corregirlas vuelve a consultar y el aviso se va', async () => {
      await armar();
      await ponerAlReves();
      const listasAntes = servicio.pedidosDeLista.length;

      fixture.componentInstance.hasta.setValue(new Date(2026, 8, 25));
      fixture.detectChanges();
      await respiro();

      expect(servicio.pedidosDeLista.length - listasAntes).toBe(1);
      expect(servicio.pedidosDeLista.at(-1)).toEqual({ desde: '2026-09-20', hasta: '2026-09-25', tipo: null });
      expect(el().querySelector('app-rango-de-fechas .aviso-al-reves')).toBeNull();
      expect(fixture.componentInstance.fechasAlReves()).toBeFalse();
    });

    it('con una sola punta no hay nada al revés', async () => {
      await armar();
      fixture.componentInstance.desde.setValue(new Date(2026, 8, 20));
      fixture.detectChanges();
      await respiro();

      expect(fixture.componentInstance.fechasAlReves()).toBeFalse();
      expect(servicio.pedidosDeLista.at(-1)).toEqual({ desde: '2026-09-20', hasta: null, tipo: null });
    });
  });

  it('un rango propio guardado que NO empieza en 1 ni en 16 (5 al 12 de octubre) vuelve tal cual', async () => {
    await armarConGuardado({
      desde: { __fecha: new Date(2026, 9, 5).toISOString() },
      hasta: { __fecha: new Date(2026, 9, 12).toISOString() },
    });

    expect(servicio.pedidosDeLista[0]).toEqual({ desde: '2026-10-05', hasta: '2026-10-12', tipo: null });
    expect(servicio.pedidosDeResumen[0]).toEqual({ desde: '2026-10-05', hasta: '2026-10-12', tipo: null });
    expect(casilla('fecha-desde').value).toBe('5/10/2026');
    expect(casilla('fecha-hasta').value).toBe('12/10/2026');
    expect(botones().some((b) => b.classList.contains('activa'))).toBeFalse();
  });

  it('las fechas esperan el respiro de 300 ms: a los ~120 ms todavía NO se pidió nada, a los 350 se pide UNA vez', async () => {
    await armar();
    const pagina = fixture.componentInstance;
    const listasAntes = servicio.pedidosDeLista.length;
    const resumenesAntes = servicio.pedidosDeResumen.length;

    pagina.desde.setValue(new Date(2026, 8, 5));
    pagina.hasta.setValue(new Date(2026, 8, 20));
    await new Promise((r) => setTimeout(r, 120));
    expect(servicio.pedidosDeLista.length).toBe(listasAntes);
    expect(servicio.pedidosDeResumen.length).toBe(resumenesAntes);

    await new Promise((r) => setTimeout(r, 230));
    expect(servicio.pedidosDeLista.length - listasAntes).toBe(1);
    expect(servicio.pedidosDeResumen.length - resumenesAntes).toBe(1);
  });

  it('el respiro no es menor de 300 ms: a los 250 ms todavía NO se pidió nada, a los 350 se pide UNA vez', async () => {
    await armar();
    const pagina = fixture.componentInstance;
    const listasAntes = servicio.pedidosDeLista.length;
    const resumenesAntes = servicio.pedidosDeResumen.length;

    pagina.desde.setValue(new Date(2026, 8, 5));
    pagina.hasta.setValue(new Date(2026, 8, 20));
    await new Promise((r) => setTimeout(r, 250));
    expect(servicio.pedidosDeLista.length).toBe(listasAntes);
    expect(servicio.pedidosDeResumen.length).toBe(resumenesAntes);

    await new Promise((r) => setTimeout(r, 100));
    expect(servicio.pedidosDeLista.length - listasAntes).toBe(1);
    expect(servicio.pedidosDeResumen.length - resumenesAntes).toBe(1);
  });

  // ------------------------------------------------------------------ un texto que no se entiende
  describe('una fecha escrita que no se entiende', () => {
    /** Escribe a mano en la casilla, como quien teclea: el control se entera por el evento `input`. */
    const escribir = async (clase: 'fecha-desde' | 'fecha-hasta', escrito: string): Promise<void> => {
      casilla(clase).value = escrito;
      casilla(clase).dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await respiro();
    };

    it('NO se consulta con ese extremo abierto (traería TODO el historial): ni la lista ni las tarjetas', async () => {
      await armar();
      const listasAntes = servicio.pedidosDeLista.length;
      const resumenesAntes = servicio.pedidosDeResumen.length;

      await escribir('fecha-desde', 'hola');

      expect(servicio.pedidosDeLista.length).toBe(listasAntes);
      expect(servicio.pedidosDeResumen.length).toBe(resumenesAntes);
      const pagina = fixture.componentInstance;
      expect(pagina.fechasIlegibles()).toBeTrue();
      expect(pagina.fechasAlReves()).toBeFalse();
      expect(pagina.filas()).toEqual([]);
      expect(pagina.total()).toBe(0);
      expect(pagina.resumen()).toBeNull();
    });

    it('dice cuál fecha, con UN solo mensaje en la tabla, y no dice "no hay liquidaciones" ni "al revés"', async () => {
      await armar();

      await escribir('fecha-hasta', '31/02/2026');

      expect(texto(el().querySelector('app-rango-de-fechas .aviso-ilegible'))).toBe(
        'No se entiende la fecha «Hasta»: corríjala o elíjala del calendario.',
      );
      expect(el().querySelectorAll('.empty-state').length).toBe(1);
      const vacio = texto(el().querySelector('.empty-state'));
      expect(vacio).toContain('No se entiende una de las fechas');
      expect(vacio).not.toContain('No hay liquidaciones');
      expect(vacio).not.toContain('al revés');
    });

    it('la X la borra: vuelve a consultar UNA vez con lo que quede (sin esa fecha) y el mensaje se va', async () => {
      await armar();
      await escribir('fecha-desde', 'hola');
      const listasAntes = servicio.pedidosDeLista.length;
      const resumenesAntes = servicio.pedidosDeResumen.length;

      (el().querySelector('.quitar-desde') as HTMLButtonElement).click();
      fixture.detectChanges();
      await respiro();

      expect(servicio.pedidosDeLista.length - listasAntes).toBe(1);
      expect(servicio.pedidosDeResumen.length - resumenesAntes).toBe(1);
      expect(servicio.pedidosDeLista.at(-1)).toEqual({ desde: null, hasta: null, tipo: null });
      expect(fixture.componentInstance.fechasIlegibles()).toBeFalse();
      expect(el().querySelector('app-rango-de-fechas .aviso-ilegible')).toBeNull();
      expect(texto(el().querySelector('.empty-state'))).toContain('No hay liquidaciones');
    });

    it('una fecha elegida del calendario sobre el texto malo consulta con ella', async () => {
      await armar();
      await escribir('fecha-desde', 'hola');
      const listasAntes = servicio.pedidosDeLista.length;

      fixture.componentInstance.desde.setValue(new Date(2026, 8, 5));
      fixture.detectChanges();
      await respiro();

      expect(servicio.pedidosDeLista.length - listasAntes).toBe(1);
      expect(servicio.pedidosDeLista.at(-1)).toEqual({ desde: '2026-09-05', hasta: null, tipo: null });
      expect(fixture.componentInstance.fechasIlegibles()).toBeFalse();
    });
  });

  describe('con fechas que no sirven no se pinta la tabla vacía ni el paginador "0 de 0"', () => {
    const hayTablaYPaginador = (): boolean =>
      el().querySelector('table[mat-table]') !== null && el().querySelector('mat-paginator') !== null;
    const noHayNiTablaNiPaginador = (): boolean =>
      el().querySelector('table[mat-table]') === null && el().querySelector('mat-paginator') === null;

    it('al revés: se esconden; al corregirlas vuelven', async () => {
      await armar();
      expect(hayTablaYPaginador()).toBeTrue();
      const pagina = fixture.componentInstance;

      pagina.desde.setValue(new Date(2026, 8, 20));
      pagina.hasta.setValue(new Date(2026, 8, 5));
      fixture.detectChanges();
      await respiro();
      expect(noHayNiTablaNiPaginador()).toBeTrue();

      pagina.hasta.setValue(new Date(2026, 8, 25));
      fixture.detectChanges();
      await respiro();
      expect(hayTablaYPaginador()).toBeTrue();
    });

    it('con un texto que no se entiende: se esconden; al borrarlo vuelven', async () => {
      await armar();

      await teclear('fecha-desde', 'hola');
      expect(noHayNiTablaNiPaginador()).toBeTrue();

      (el().querySelector('.quitar-desde') as HTMLButtonElement).click();
      fixture.detectChanges();
      await respiro();
      expect(hayTablaYPaginador()).toBeTrue();
    });
  });

  describe('un año a medio escribir ("5/10/202") no sale a consultar como "202-10-05"', () => {
    it('no se consulta mientras el año está a medias, y al completarlo se consulta con la fecha entera', async () => {
      await armar();
      const pagina = fixture.componentInstance;
      const listasAntes = servicio.pedidosDeLista.length;
      const resumenesAntes = servicio.pedidosDeResumen.length;

      await teclear('fecha-desde', '5/10/202');

      expect(pagina.desde.value!.getFullYear()).toBe(202); // Material la leyó como fecha buena
      expect(pagina.fechasIlegibles()).toBeTrue();
      expect(servicio.pedidosDeLista.length).toBe(listasAntes);
      expect(servicio.pedidosDeResumen.length).toBe(resumenesAntes);
      expect(texto(el().querySelector('app-rango-de-fechas .aviso-ilegible'))).toContain('«Desde»');

      await teclear('fecha-desde', '5/10/2026');

      expect(pagina.fechasIlegibles()).toBeFalse();
      expect(servicio.pedidosDeLista.length - listasAntes).toBe(1);
      expect(servicio.pedidosDeLista.at(-1)!.desde).toMatch(/^2026-\d\d-\d\d$/);
      expect(servicio.pedidosDeLista.at(-1)!.hasta).toBeNull();
    });
  });

  describe('fechas que no sirven mientras hay una consulta en camino', () => {
    it('al ponerlas al revés se apaga el "cargando" y se borra el aviso de tarjetas que no llegaron', async () => {
      await armar();
      const pagina = fixture.componentInstance;
      servicio.list = () => NEVER; // una consulta que nunca contesta
      servicio.resumen = () => NEVER;
      pagina.desde.setValue(new Date(2026, 8, 5));
      fixture.detectChanges();
      await respiro();
      expect(pagina.cargando()).toBeTrue();
      pagina.resumenFallo.set({ detalle: 'una falla de antes' });

      pagina.desde.setValue(new Date(2026, 8, 20));
      pagina.hasta.setValue(new Date(2026, 8, 5));
      fixture.detectChanges();
      await respiro();

      expect(pagina.cargando()).toBeFalse();
      expect(pagina.resumenFallo()).toBeNull();
      expect(pagina.resumen()).toBeNull();
      expect(pagina.filas()).toEqual([]);
    });

    it('lo mismo con un texto que no se entiende', async () => {
      await armar();
      const pagina = fixture.componentInstance;
      servicio.list = () => NEVER;
      servicio.resumen = () => NEVER;
      pagina.desde.setValue(new Date(2026, 8, 5));
      fixture.detectChanges();
      await respiro();
      expect(pagina.cargando()).toBeTrue();

      casilla('fecha-hasta').value = 'hola';
      casilla('fecha-hasta').dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await respiro();

      expect(pagina.cargando()).toBeFalse();
      expect(pagina.fechasIlegibles()).toBeTrue();
    });
  });

  describe('fechas que no sirven después de una consulta que falló', () => {
    it('el aviso de "no alcanzó a llegar" se va: queda UN solo mensaje, el de las fechas, y la tabla no vuelve a decir que falló', async () => {
      await armar();
      const pagina = fixture.componentInstance;
      servicio.list = () => throwError(() => new Error('se cortó'));
      pagina.desde.setValue(new Date(2026, 8, 5));
      fixture.detectChanges();
      await respiro();
      expect(pagina.errorCarga()).not.toBeNull();
      expect(el().querySelector('.error-state')).not.toBeNull();

      pagina.desde.setValue(new Date(2026, 8, 20));
      pagina.hasta.setValue(new Date(2026, 8, 5));
      fixture.detectChanges();
      await respiro();

      // La lista de antes falló, pero esta vez ni siquiera se intentó: no hay ningún fallo que contar.
      expect(pagina.errorCarga()).toBeNull();
      expect(el().querySelector('.error-state')).toBeNull();
      expect(el().querySelectorAll('.empty-state').length).toBe(1);
      expect(texto(el().querySelector('.empty-state'))).toContain('Las fechas están al revés');
    });
  });

  it('la X de «Hasta» con las fechas al revés quita el aviso y la lista vuelve a pedirse', async () => {
    await armar();
    const pagina = fixture.componentInstance;
    pagina.desde.setValue(new Date(2026, 8, 20));
    pagina.hasta.setValue(new Date(2026, 8, 5));
    fixture.detectChanges();
    await respiro();
    expect(pagina.fechasAlReves()).toBeTrue();
    const listasAntes = servicio.pedidosDeLista.length;

    (el().querySelector('.quitar-hasta') as HTMLButtonElement).click();
    fixture.detectChanges();
    await respiro();

    expect(pagina.fechasAlReves()).toBeFalse();
    expect(el().querySelector('app-rango-de-fechas .aviso-al-reves')).toBeNull();
    expect(servicio.pedidosDeLista.length - listasAntes).toBe(1);
    expect(servicio.pedidosDeLista.at(-1)).toEqual({ desde: '2026-09-20', hasta: null, tipo: null });
  });

  it('el filtro de quincena queda guardado en la sesión y vuelve marcado', async () => {
    await armar();
    const pagina = fixture.componentInstance;
    pagina.desde.setValue(new Date(2026, 8, 5));
    pagina.hasta.setValue(new Date(2026, 8, 20));
    fixture.detectChanges();
    await respiro();
    await tocar(botones()[0]);
    await new Promise((r) => setTimeout(r, 400)); // el guardado espera 250 ms

    const guardado = sessionStorage.getItem('qe.filtros.liquidaciones');
    expect(guardado).not.toBeNull();

    TestBed.resetTestingModule();
    const antes = sessionStorage.getItem('qe.filtros.liquidaciones');
    servicio = new ServicioFalso();
    await TestBed.configureTestingModule({
      imports: [LiquidacionListPage, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: LiquidacionesService, useValue: servicio },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    sessionStorage.setItem('qe.filtros.liquidaciones', antes!);
    fixture = TestBed.createComponent(LiquidacionListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(botones()[0].classList).toContain('activa');
    expect(texto(el().querySelector('app-selector-quincena .mes'))).toBe('septiembre 2026');
    expect(servicio.pedidosDeLista[0]).toEqual({ desde: '2026-09-01', hasta: '2026-09-15', tipo: null });
  });
});
