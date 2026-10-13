import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabGroup } from '@angular/material/tabs';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { Page, Recepcion, ResumenPeriodo } from '../../core/models';
import { dateToIso } from '../../shared/date-utils';
import { quincenaDeLaFecha, rangoQuincena } from '../../shared/quincena';
import { RecepcionListPage } from './recepcion-list.page';
import { GrillaQuincena, RecepcionesService } from './recepciones.service';

/**
 * EL LISTADO DE RECEPCIONES SE FILTRA COMO EL DE LIQUIDACIONES.
 *
 * Antes: las casillas Desde y Hasta con el calendario, más los chips "Hoy / Esta quincena / Este
 * mes / Mes pasado" y un desplegable de Ruta. Ahora el período es la quincena (el mes con sus
 * flechas y los dos botones) y la ruta son botones. Lo que se mide es que el botón llegue hasta
 * las DOS consultas de la pantalla (la lista y el resumen) con las fechas de esa quincena y UNA
 * vez cada una, que la ruta llegue a la lista, que la pantalla arranque en la quincena de hoy
 * ENTERA (con "hasta hoy" la barra no habría marcado ninguna) y que lo guardado de la sesión
 * anterior no filtre en silencio con un rango suelto.
 */

const GRILLA_VACIA = {
  desde: '2026-10-01',
  hasta: '2026-10-15',
  fechas: [],
  filas: [],
  totales_dia: {},
  total_litros: '0',
  total_valor_neto: '0',
  total_transporte: '0',
} as unknown as GrillaQuincena;

const RESUMEN = (litros: string): ResumenPeriodo =>
  ({
    desde: '2026-10-01',
    hasta: '2026-10-15',
    total_litros: litros,
    valor_bruto: '0',
    valor_transporte: '0',
    valor_neto: '0',
    precio_promedio: '0',
    dias: [],
  }) as unknown as ResumenPeriodo;

const RUTAS = [
  { id: 'r-norte', nombre: 'Ruta Norte' },
  { id: 'r-sur', nombre: 'Ruta Sur' },
];

const pagina = (ids: string[]): Page<Recepcion> =>
  ({
    items: ids.map((id) => ({ id }) as unknown as Recepcion),
    total: ids.length,
    page: 1,
    page_size: 20,
    pages: 1,
  }) as Page<Recepcion>;

interface Pedido {
  desde?: string | null;
  hasta?: string | null;
  ruta_id?: string | null;
  page?: number;
}

/** Contesta de una vez, o deja cada respuesta en un Subject para contestarlas en el orden que se quiera. */
class ServicioFalso {
  listas: { pedido: Pedido; salida: Subject<Page<Recepcion>> | null }[] = [];
  resumenes: { pedido: Pedido; salida: Subject<ResumenPeriodo> | null }[] = [];

  /** Si no es null, la lista falla con este error. */
  errorLista: HttpErrorResponse | null = null;
  /** Si no es null, arma la respuesta de la lista a partir del pedido (páginas, totales). */
  respuestaDeLista: ((p: Pedido) => Page<Recepcion>) | null = null;

  constructor(private readonly diferido = false) {}

  grilla(): Observable<GrillaQuincena> {
    return of(GRILLA_VACIA);
  }

  filtrar(p: Pedido): Observable<Page<Recepcion>> {
    const pedido = { desde: p.desde, hasta: p.hasta, ruta_id: p.ruta_id };
    if (!this.diferido) {
      this.listas.push({ pedido: { ...pedido, page: p.page }, salida: null });
      if (this.errorLista) return throwError(() => this.errorLista);
      return of(this.respuestaDeLista ? this.respuestaDeLista(p) : pagina([]));
    }
    const salida = new Subject<Page<Recepcion>>();
    this.listas.push({ pedido, salida });
    return salida;
  }

  resumenPeriodo(desde: string, hasta: string): Observable<ResumenPeriodo> {
    const pedido = { desde, hasta };
    if (!this.diferido) {
      this.resumenes.push({ pedido, salida: null });
      return of(RESUMEN('100'));
    }
    const salida = new Subject<ResumenPeriodo>();
    this.resumenes.push({ pedido, salida });
    return salida;
  }
}

const texto = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('RecepcionListPage: los filtros del listado, como en liquidaciones', () => {
  let fixture: ComponentFixture<RecepcionListPage>;
  let servicio: ServicioFalso;

  const hoy = new Date();
  const laDeHoy = quincenaDeLaFecha(hoy);
  const rangoDeHoy = rangoQuincena(laDeHoy.anio, laDeHoy.mes, laDeHoy.quincena);
  const laOtra = rangoQuincena(laDeHoy.anio, laDeHoy.mes, laDeHoy.quincena === 1 ? 2 : 1);

  const armar = async (
    opciones: { guardado?: Record<string, unknown>; diferido?: boolean; proveedores?: { id: string; nombre: string }[] } = {},
  ): Promise<void> => {
    sessionStorage.clear();
    if (opciones.guardado) {
      sessionStorage.setItem('qe.filtros.recepciones', JSON.stringify(opciones.guardado));
    }
    servicio = new ServicioFalso(opciones.diferido ?? false);
    await TestBed.configureTestingModule({
      imports: [RecepcionListPage, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
        {
          provide: ApiService,
          useValue: {
            get: (url: string) =>
              of({ items: url.includes('rutas') ? RUTAS : (opciones.proveedores ?? []), total: 0, page: 1, page_size: 100, pages: 1 }),
          },
        },
        { provide: RecepcionesService, useValue: servicio },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RecepcionListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    // La barra vive en la segunda pestaña (la primera es la grilla).
    const tabs = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabs.selectedIndex = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  afterEach(() => sessionStorage.clear());

  const el = (): HTMLElement => fixture.nativeElement;
  const pantalla = () => fixture.componentInstance;
  const botonesDeQuincena = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll('app-selector-quincena .q-btn'));
  const casilla = (clase: 'fecha-desde' | 'fecha-hasta'): HTMLInputElement =>
    el().querySelector<HTMLInputElement>(`app-rango-de-fechas input.${clase}`)!;
  const botonesDeRuta = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll('app-filtro-por-opciones .opcion'));
  const botonDeRuta = (nombre: string): HTMLButtonElement =>
    botonesDeRuta().find((b) => texto(b) === nombre)!;
  const asentar = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  /** Las fechas de la pantalla escuchan con un respiro de 300 ms: se espera a que pase. */
  const esperarElRespiro = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 350));
    await asentar();
  };

  // ------------------------------------------------------------------ la barra
  it('trae el selector de quincena, Desde y Hasta, y la ruta en botones; ya no hay chips "Rápido" ni desplegable de Ruta', async () => {
    await armar();

    expect(el().querySelector('app-selector-quincena')).not.toBeNull();
    expect(el().querySelector('app-rango-de-fechas')).not.toBeNull();
    expect(el().querySelector('app-rango-de-fechas input.fecha-desde')).not.toBeNull();
    expect(el().querySelector('app-rango-de-fechas input.fecha-hasta')).not.toBeNull();
    expect(botonesDeRuta().map(texto)).toEqual(['Todos', 'Ruta Norte', 'Ruta Sur']);
    expect(el().querySelector('app-rango-fechas-rapido')).toBeNull();
    expect(texto(el().querySelector('.page-toolbar'))).not.toContain('Rápido');
    // "Buscar proveedor" y el desplegable de Proveedor siguen; el desplegable de Ruta ya no.
    expect(texto(el().querySelector('.page-toolbar'))).toContain('Buscar proveedor');
    expect(texto(el().querySelector('.page-toolbar'))).toContain('Proveedor');
    expect(texto(el().querySelector('.page-toolbar'))).toContain('Desde');
    expect(texto(el().querySelector('.page-toolbar'))).toContain('Hasta');
  });

  it('arranca en la quincena de hoy, ENTERA, y la barra la marca', async () => {
    await armar();

    expect(servicio.listas[0].pedido).toEqual({ desde: rangoDeHoy.inicio, hasta: rangoDeHoy.fin, ruta_id: null, page: 1 });
    expect(servicio.resumenes[0].pedido).toEqual({ desde: rangoDeHoy.inicio, hasta: rangoDeHoy.fin });
    const marcados = botonesDeQuincena().filter((b) => b.classList.contains('activa'));
    expect(marcados.length).toBe(1);
    expect(botonesDeQuincena()[laDeHoy.quincena - 1]).toBe(marcados[0]);
  });

  // ------------------------------------------------------------------ la quincena
  it('tocar la otra quincena pide la lista y el resumen UNA vez, con el rango entero', async () => {
    await armar();
    const listasAntes = servicio.listas.length;
    const resumenesAntes = servicio.resumenes.length;

    botonesDeQuincena()[laDeHoy.quincena === 1 ? 1 : 0].click();
    fixture.detectChanges();
    await esperarElRespiro();

    expect(servicio.listas.length).toBe(listasAntes + 1);
    expect(servicio.resumenes.length).toBe(resumenesAntes + 1);
    expect(servicio.listas.at(-1)!.pedido).toEqual({ desde: laOtra.inicio, hasta: laOtra.fin, ruta_id: null, page: 1 });
    expect(servicio.resumenes.at(-1)!.pedido).toEqual({ desde: laOtra.inicio, hasta: laOtra.fin });
  });

  it('tocar la quincena marcada quita el filtro de fechas: la lista se pide sin fechas y el resumen se esconde', async () => {
    await armar();

    botonesDeQuincena()[laDeHoy.quincena - 1].click();
    fixture.detectChanges();
    await esperarElRespiro();

    expect(servicio.listas.at(-1)!.pedido).toEqual({ desde: null, hasta: null, ruta_id: null, page: 1 });
    expect(pantalla().resumen()).toBeNull();
  });

  // ------------------------------------------------------------------ la ruta
  it('tocar una ruta filtra la lista por ella; tocarla otra vez, o "Todos", la quita', async () => {
    await armar();

    botonDeRuta('Ruta Sur').click();
    fixture.detectChanges();
    expect(servicio.listas.at(-1)!.pedido.ruta_id).toBe('r-sur');
    expect(botonDeRuta('Ruta Sur').classList).toContain('activa');
    expect(botonDeRuta('Todos').classList).not.toContain('activa');

    botonDeRuta('Ruta Sur').click();
    fixture.detectChanges();
    expect(servicio.listas.at(-1)!.pedido.ruta_id).toBeNull();
    expect(botonDeRuta('Todos').classList).toContain('activa');

    botonDeRuta('Ruta Norte').click();
    fixture.detectChanges();
    botonDeRuta('Todos').click();
    fixture.detectChanges();
    expect(servicio.listas.at(-1)!.pedido.ruta_id).toBeNull();
  });

  it('la ruta y la quincena se combinan: cambiar de quincena conserva la ruta', async () => {
    await armar();

    botonDeRuta('Ruta Norte').click();
    fixture.detectChanges();
    botonesDeQuincena()[laDeHoy.quincena === 1 ? 1 : 0].click();
    fixture.detectChanges();
    await esperarElRespiro();

    expect(servicio.listas.at(-1)!.pedido).toEqual({ desde: laOtra.inicio, hasta: laOtra.fin, ruta_id: 'r-norte', page: 1 });
  });

  // ------------------------------------------------------------------ lo guardado de la sesión
  const guardadoCon = (desde: string | null, hasta: string | null, extra: Record<string, unknown> = {}) => ({
    buscar: '',
    rutaId: null,
    proveedorId: null,
    desde: desde === null ? null : { __fecha: new Date(`${desde}T12:00:00`).toISOString() },
    hasta: hasta === null ? null : { __fecha: new Date(`${hasta}T12:00:00`).toISOString() },
    ...extra,
  });

  it('un rango propio guardado (los primeros 4 días) se CONSERVA y se ve en Desde y Hasta: no hay filtro escondido', async () => {
    await armar({ guardado: guardadoCon('2026-10-01', '2026-10-04') });

    expect(servicio.listas[0].pedido).toEqual({ desde: '2026-10-01', hasta: '2026-10-04', ruta_id: null, page: 1 });
    expect(servicio.resumenes[0].pedido).toEqual({ desde: '2026-10-01', hasta: '2026-10-04' });
    expect(botonesDeQuincena().some((b) => b.classList.contains('activa'))).toBeFalse();
    expect(casilla('fecha-desde').value).toContain('2026');
    expect(casilla('fecha-hasta').value).toContain('2026');
    expect(el().querySelector('app-selector-quincena .mes')!.getAttribute('title')).toContain('rango propio');
  });

  it('una quincena guardada se conserva, y la barra la marca', async () => {
    await armar({ guardado: guardadoCon('2026-08-16', '2026-08-31') });

    expect(servicio.listas[0].pedido).toEqual({ desde: '2026-08-16', hasta: '2026-08-31', ruta_id: null, page: 1 });
    expect(botonesDeQuincena()[1].classList).toContain('activa');
    expect(texto(el().querySelector('app-selector-quincena .mes'))).toBe('agosto 2026');
  });

  it('"sin fechas" guardado a propósito se conserva: no se le inventa una quincena', async () => {
    await armar({ guardado: guardadoCon(null, null) });

    expect(servicio.listas[0].pedido).toEqual({ desde: null, hasta: null, ruta_id: null, page: 1 });
    expect(botonesDeQuincena().some((b) => b.classList.contains('activa'))).toBeFalse();
  });

  it('la ruta guardada vuelve marcada y filtrando', async () => {
    await armar({ guardado: guardadoCon('2026-08-01', '2026-08-15', { rutaId: 'r-norte' }) });

    expect(servicio.listas[0].pedido.ruta_id).toBe('r-norte');
    expect(botonDeRuta('Ruta Norte').classList).toContain('activa');
  });

  // ------------------------------------------------------------------ la última consulta manda

  // ------------------------------------------------------------------ la quincena en que cae HOY
  it('arranca en la quincena en que cae HOY: el 20 de octubre pide del 16 al 31 y marca la 2.ª', async () => {
    jasmine.clock().mockDate(new Date(2026, 9, 20, 10, 0));
    try {
      await armar();
    } finally {
      jasmine.clock().uninstall();
    }

    expect(servicio.listas[0].pedido).toEqual({ desde: '2026-10-16', hasta: '2026-10-31', ruta_id: null, page: 1 });
    expect(servicio.resumenes[0].pedido).toEqual({ desde: '2026-10-16', hasta: '2026-10-31' });
    expect(botonesDeQuincena()[1].classList).toContain('activa');
  });

  it('el 15 todavía es la 1.ª quincena', async () => {
    jasmine.clock().mockDate(new Date(2026, 9, 15, 23, 0));
    try {
      await armar();
    } finally {
      jasmine.clock().uninstall();
    }

    expect(servicio.listas[0].pedido.desde).toBe('2026-10-01');
    expect(servicio.listas[0].pedido.hasta).toBe('2026-10-15');
  });

  // ------------------------------------------------------------------ lo guardado, a medias
  it('una sola fecha guardada (la otra vacía) deja el rango abierto: la lista se pide así y el resumen no (necesita las dos)', async () => {
    await armar({ guardado: guardadoCon('2026-08-16', null) });

    expect(servicio.listas[0].pedido).toEqual({ desde: '2026-08-16', hasta: null, ruta_id: null, page: 1 });
    expect(servicio.resumenes.length).toBe(0);
    expect(casilla('fecha-hasta').value).toBe('');
  });

  it('lo mismo con solo la fecha Hasta guardada', async () => {
    await armar({ guardado: guardadoCon(null, '2026-08-31') });

    expect(servicio.listas[0].pedido).toEqual({ desde: null, hasta: '2026-08-31', ruta_id: null, page: 1 });
  });

  it('restaurar lo guardado pide la lista y el resumen UNA vez, sin una segunda consulta a los 300 ms', async () => {
    await armar({ guardado: guardadoCon('2026-10-01', '2026-10-04') });
    await esperarElRespiro();

    expect(servicio.listas.length).toBe(1);
    expect(servicio.resumenes.length).toBe(1);
  });

  // ------------------------------------------------------------------ Desde y Hasta, a mano
  it('elegir Desde y Hasta filtra la lista y el resumen con ESE rango, una vez, y no marca ninguna quincena', async () => {
    await armar();
    const listasAntes = servicio.listas.length;
    const resumenesAntes = servicio.resumenes.length;

    pantalla().desde.setValue(new Date(2026, 8, 5));
    pantalla().hasta.setValue(new Date(2026, 9, 12)); // cruza de mes: ninguna quincena
    fixture.detectChanges();
    await esperarElRespiro();

    expect(servicio.listas.length - listasAntes).toBe(1);
    expect(servicio.resumenes.length - resumenesAntes).toBe(1);
    expect(servicio.listas.at(-1)!.pedido).toEqual({ desde: '2026-09-05', hasta: '2026-10-12', ruta_id: null, page: 1 });
    expect(servicio.resumenes.at(-1)!.pedido).toEqual({ desde: '2026-09-05', hasta: '2026-10-12' });
    expect(botonesDeQuincena().some((b) => b.classList.contains('activa'))).toBeFalse();
  });

  it('la X de «Hasta» lo quita: la lista queda abierta de ese lado y el resumen se esconde (no tiene las dos fechas)', async () => {
    await armar();
    expect(el().querySelector('.quitar-hasta')).not.toBeNull();

    (el().querySelector('.quitar-hasta') as HTMLButtonElement).click();
    fixture.detectChanges();
    await esperarElRespiro();

    expect(pantalla().hasta.value).toBeNull();
    expect(servicio.listas.at(-1)!.pedido).toEqual({ desde: rangoDeHoy.inicio, hasta: null, ruta_id: null, page: 1 });
    expect(pantalla().resumen()).toBeNull();
  });

  describe('«Desde» posterior a «Hasta»', () => {
    const alReves = async (): Promise<void> => {
      pantalla().desde.setValue(new Date(2026, 8, 20));
      pantalla().hasta.setValue(new Date(2026, 8, 5));
      fixture.detectChanges();
      await esperarElRespiro();
    };

    it('NO se consulta, se dice en palabras y no dice "no hay recepciones"', async () => {
      await armar();
      const listasAntes = servicio.listas.length;
      const resumenesAntes = servicio.resumenes.length;

      await alReves();

      expect(servicio.listas.length).toBe(listasAntes);
      expect(servicio.resumenes.length).toBe(resumenesAntes);
      expect(texto(el().querySelector('app-rango-de-fechas .aviso-al-reves'))).toContain('«Desde» es posterior a «Hasta»');
      expect(texto(el().querySelector('.empty-state'))).toContain('Las fechas están al revés');
      expect(texto(el().querySelector('.empty-state'))).not.toContain('No hay recepciones');
    });

    it('es UN solo mensaje en la tabla, el de las fechas al revés: no se le suma el de "no se entiende una de las fechas"', async () => {
      await armar();

      await alReves();

      expect(pantalla().fechasAlReves()).toBeTrue();
      // Las dos fechas están bien escritas, solo que en el orden contrario: nada que no se entienda.
      expect(pantalla().fechasIlegibles()).toBeFalse();
      expect(el().querySelectorAll('.empty-state').length).toBe(1);
      const vacio = texto(el().querySelector('.empty-state'));
      expect(vacio).toContain('Las fechas están al revés');
      expect(vacio).not.toContain('No se entiende');
      expect(el().querySelector('app-rango-de-fechas .aviso-ilegible')).toBeNull();
    });

    it('el aviso de la consulta fallida de antes se va: queda UN solo mensaje, el de las fechas, y la tabla no vuelve a decir que falló', async () => {
      await armar();
      servicio.errorLista = new HttpErrorResponse({ status: 500, error: { error: { detail: 'El servidor no respondió' } } });
      botonDeRuta('Ruta Sur').click();
      fixture.detectChanges();
      await asentar();
      expect(pantalla().errorCarga()).toBe('El servidor no respondió');
      expect(el().querySelector('.error-state')).not.toBeNull();

      await alReves();

      // La lista de antes falló, pero esta vez ni siquiera se intentó: no hay ningún fallo que contar.
      expect(pantalla().errorCarga()).toBeNull();
      expect(el().querySelector('.error-state')).toBeNull();
      expect(el().querySelectorAll('.empty-state').length).toBe(1);
      expect(texto(el().querySelector('.empty-state'))).toContain('Las fechas están al revés');
    });

    it('las filas, el total y el resumen de antes se vacían', async () => {
      await armar();
      pantalla().filas.set([{ id: 'vieja' } as unknown as Recepcion]);
      pantalla().total.set(1);

      await alReves();

      expect(pantalla().filas()).toEqual([]);
      expect(pantalla().total()).toBe(0);
      expect(pantalla().resumen()).toBeNull();
      expect(pantalla().fechasAlReves()).toBeTrue();
    });

    it('al corregirlas vuelve a consultar y el aviso se va', async () => {
      await armar();
      await alReves();
      const listasAntes = servicio.listas.length;

      pantalla().hasta.setValue(new Date(2026, 8, 25));
      fixture.detectChanges();
      await esperarElRespiro();

      expect(servicio.listas.length - listasAntes).toBe(1);
      expect(servicio.listas.at(-1)!.pedido).toEqual({ desde: '2026-09-20', hasta: '2026-09-25', ruta_id: null, page: 1 });
      expect(el().querySelector('app-rango-de-fechas .aviso-al-reves')).toBeNull();
      expect(pantalla().fechasAlReves()).toBeFalse();
    });
  });

  it('un rango propio guardado que NO empieza en 1 ni en 16 (5 al 12 de octubre) vuelve tal cual', async () => {
    await armar({ guardado: guardadoCon('2026-10-05', '2026-10-12') });

    expect(servicio.listas[0].pedido).toEqual({ desde: '2026-10-05', hasta: '2026-10-12', ruta_id: null, page: 1 });
    expect(servicio.resumenes[0].pedido).toEqual({ desde: '2026-10-05', hasta: '2026-10-12' });
    expect(casilla('fecha-desde').value).toBe('5/10/2026');
    expect(casilla('fecha-hasta').value).toBe('12/10/2026');
    expect(botonesDeQuincena().some((b) => b.classList.contains('activa'))).toBeFalse();
  });

  it('las fechas esperan el respiro de 300 ms: a los ~120 ms todavía NO se pidió nada, a los 350 se pide UNA vez', async () => {
    await armar();
    const listasAntes = servicio.listas.length;
    const resumenesAntes = servicio.resumenes.length;

    pantalla().desde.setValue(new Date(2026, 8, 5));
    pantalla().hasta.setValue(new Date(2026, 8, 20));
    await new Promise((r) => setTimeout(r, 120));
    expect(servicio.listas.length).toBe(listasAntes);
    expect(servicio.resumenes.length).toBe(resumenesAntes);

    await new Promise((r) => setTimeout(r, 230));
    expect(servicio.listas.length - listasAntes).toBe(1);
    expect(servicio.resumenes.length - resumenesAntes).toBe(1);
  });

  it('el respiro no es menor de 300 ms: a los 250 ms todavía NO se pidió nada, a los 350 se pide UNA vez', async () => {
    await armar();
    const listasAntes = servicio.listas.length;
    const resumenesAntes = servicio.resumenes.length;

    pantalla().desde.setValue(new Date(2026, 8, 5));
    pantalla().hasta.setValue(new Date(2026, 8, 20));
    await new Promise((r) => setTimeout(r, 250));
    expect(servicio.listas.length).toBe(listasAntes);
    expect(servicio.resumenes.length).toBe(resumenesAntes);

    await new Promise((r) => setTimeout(r, 100));
    expect(servicio.listas.length - listasAntes).toBe(1);
    expect(servicio.resumenes.length - resumenesAntes).toBe(1);
  });

  // ------------------------------------------------------------------ un texto que no se entiende
  describe('una fecha escrita que no se entiende', () => {
    /** Escribe a mano en la casilla, como quien teclea: el control se entera por el evento `input`. */
    const escribir = async (clase: 'fecha-desde' | 'fecha-hasta', escrito: string): Promise<void> => {
      casilla(clase).value = escrito;
      casilla(clase).dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await esperarElRespiro();
    };

    it('NO se consulta con ese extremo abierto (traería TODA la historia): ni la lista ni el resumen', async () => {
      await armar();
      const listasAntes = servicio.listas.length;
      const resumenesAntes = servicio.resumenes.length;
      pantalla().filas.set([{ id: 'vieja' } as unknown as Recepcion]);
      pantalla().total.set(1);

      await escribir('fecha-desde', 'hola');

      expect(servicio.listas.length).toBe(listasAntes);
      expect(servicio.resumenes.length).toBe(resumenesAntes);
      expect(pantalla().fechasIlegibles()).toBeTrue();
      expect(pantalla().fechasAlReves()).toBeFalse();
      expect(pantalla().filas()).toEqual([]);
      expect(pantalla().total()).toBe(0);
      expect(pantalla().resumen()).toBeNull();
    });

    it('dice cuál fecha, con UN solo mensaje en la tabla, y no dice "no hay recepciones" ni "al revés"', async () => {
      await armar();

      await escribir('fecha-hasta', '31/02/2026');

      expect(texto(el().querySelector('app-rango-de-fechas .aviso-ilegible'))).toBe(
        'No se entiende la fecha «Hasta»: corríjala o elíjala del calendario.',
      );
      expect(el().querySelectorAll('.empty-state').length).toBe(1);
      const vacio = texto(el().querySelector('.empty-state'));
      expect(vacio).toContain('No se entiende una de las fechas');
      expect(vacio).not.toContain('No hay recepciones');
      expect(vacio).not.toContain('al revés');
    });

    it('la X la borra: vuelve a consultar UNA vez con lo que quede y el mensaje se va', async () => {
      await armar();
      await escribir('fecha-desde', 'hola');
      const listasAntes = servicio.listas.length;

      (el().querySelector('.quitar-desde') as HTMLButtonElement).click();
      fixture.detectChanges();
      await esperarElRespiro();

      expect(servicio.listas.length - listasAntes).toBe(1);
      expect(servicio.listas.at(-1)!.pedido).toEqual({ desde: null, hasta: rangoDeHoy.fin, ruta_id: null, page: 1 });
      expect(pantalla().fechasIlegibles()).toBeFalse();
      expect(el().querySelector('app-rango-de-fechas .aviso-ilegible')).toBeNull();
    });

    it('una fecha elegida del calendario sobre el texto malo consulta con ella', async () => {
      await armar();
      await escribir('fecha-desde', 'hola');
      const listasAntes = servicio.listas.length;

      pantalla().desde.setValue(new Date(2026, 8, 5));
      fixture.detectChanges();
      await esperarElRespiro();

      expect(servicio.listas.length - listasAntes).toBe(1);
      expect(servicio.listas.at(-1)!.pedido.desde).toBe('2026-09-05');
      expect(pantalla().fechasIlegibles()).toBeFalse();
    });
  });

  describe('con fechas que no sirven no se pinta la tabla vacía ni el paginador "0 de 0"', () => {
    const hayTablaYPaginador = (): boolean =>
      el().querySelector('table[mat-table]') !== null && el().querySelector('mat-paginator') !== null;
    const noHayNiTablaNiPaginador = (): boolean =>
      el().querySelector('table[mat-table]') === null && el().querySelector('mat-paginator') === null;
    const teclear = async (clase: 'fecha-desde' | 'fecha-hasta', escrito: string): Promise<void> => {
      casilla(clase).value = escrito;
      casilla(clase).dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await esperarElRespiro();
    };

    it('al revés: se esconden; al corregirlas vuelven', async () => {
      await armar();
      expect(hayTablaYPaginador()).toBeTrue();

      pantalla().desde.setValue(new Date(2026, 8, 20));
      pantalla().hasta.setValue(new Date(2026, 8, 5));
      fixture.detectChanges();
      await esperarElRespiro();
      expect(noHayNiTablaNiPaginador()).toBeTrue();

      pantalla().hasta.setValue(new Date(2026, 8, 25));
      fixture.detectChanges();
      await esperarElRespiro();
      expect(hayTablaYPaginador()).toBeTrue();
    });

    it('con un texto que no se entiende: se esconden; al borrarlo vuelven', async () => {
      await armar();

      await teclear('fecha-desde', 'hola');
      expect(noHayNiTablaNiPaginador()).toBeTrue();

      (el().querySelector('.quitar-desde') as HTMLButtonElement).click();
      fixture.detectChanges();
      await esperarElRespiro();
      expect(hayTablaYPaginador()).toBeTrue();
    });

    it('un año a medio escribir ("5/10/202") no sale a consultar como "202-10-05"; al completarlo se consulta entero', async () => {
      await armar();
      const listasAntes = servicio.listas.length;
      const resumenesAntes = servicio.resumenes.length;

      await teclear('fecha-desde', '5/10/202');

      expect(pantalla().desde.value!.getFullYear()).toBe(202);
      expect(pantalla().fechasIlegibles()).toBeTrue();
      expect(servicio.listas.length).toBe(listasAntes);
      expect(servicio.resumenes.length).toBe(resumenesAntes);

      await teclear('fecha-desde', '5/10/2026');

      expect(pantalla().fechasIlegibles()).toBeFalse();
      expect(servicio.listas.length - listasAntes).toBe(1);
      expect(servicio.listas.at(-1)!.pedido.desde).toMatch(/^2026-\d\d-\d\d$/);
    });
  });

  describe('fechas que no sirven mientras hay una consulta en camino', () => {
    it('al ponerlas al revés se apaga el "cargando" (la consulta de antes ya no cuenta)', async () => {
      await armar({ diferido: true }); // nada contesta: la consulta inicial queda en el aire
      expect(pantalla().cargando()).toBeTrue();

      pantalla().desde.setValue(new Date(2026, 8, 20));
      pantalla().hasta.setValue(new Date(2026, 8, 5));
      fixture.detectChanges();
      await esperarElRespiro();

      expect(pantalla().cargando()).toBeFalse();
      expect(pantalla().fechasAlReves()).toBeTrue();
      expect(pantalla().filas()).toEqual([]);
    });

    it('lo mismo con un texto que no se entiende', async () => {
      await armar({ diferido: true });
      expect(pantalla().cargando()).toBeTrue();

      casilla('fecha-desde').value = 'hola';
      casilla('fecha-desde').dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await esperarElRespiro();

      expect(pantalla().cargando()).toBeFalse();
      expect(pantalla().fechasIlegibles()).toBeTrue();
    });
  });

  it('la X de «Hasta» con las fechas al revés quita el aviso y la lista vuelve a pedirse', async () => {
    await armar();
    pantalla().desde.setValue(new Date(2026, 8, 20));
    pantalla().hasta.setValue(new Date(2026, 8, 5));
    fixture.detectChanges();
    await esperarElRespiro();
    expect(pantalla().fechasAlReves()).toBeTrue();
    const listasAntes = servicio.listas.length;

    (el().querySelector('.quitar-hasta') as HTMLButtonElement).click();
    fixture.detectChanges();
    await esperarElRespiro();

    expect(pantalla().fechasAlReves()).toBeFalse();
    expect(el().querySelector('app-rango-de-fechas .aviso-al-reves')).toBeNull();
    expect(servicio.listas.length - listasAntes).toBe(1);
    expect(servicio.listas.at(-1)!.pedido).toEqual({ desde: '2026-09-20', hasta: null, ruta_id: null, page: 1 });
  });

  // ------------------------------------------------------------------ la ruta guardada que ya no existe
  it('una ruta guardada que ya no es ninguna opción se descarta: no filtra a escondidas', async () => {
    await armar({ guardado: guardadoCon('2026-08-01', '2026-08-15', { rutaId: 'r-vieja' }) });
    await esperarElRespiro();

    expect(pantalla().rutaId.value).toBeNull();
    expect(servicio.listas.at(-1)!.pedido.ruta_id).toBeNull();
    expect(botonDeRuta('Todos').classList).toContain('activa');
  });

  // ------------------------------------------------------------------ una consulta que falla
  describe('una consulta que falla', () => {
    it('no deja la lista vieja bajo el filtro nuevo ni dice "no hay recepciones": dice que no llegó, y se puede reintentar', async () => {
      await armar();
      servicio.listas.length = 0;
      pantalla().filas.set([{ id: 'vieja' } as unknown as Recepcion]);
      servicio.errorLista = new HttpErrorResponse({ status: 500, error: { error: { detail: 'El servidor no respondió' } } });

      botonDeRuta('Ruta Sur').click();
      fixture.detectChanges();
      await asentar();

      expect(pantalla().errorCarga()).toBe('El servidor no respondió');
      expect(pantalla().filas()).toEqual([]);
      const aviso = el().querySelector('.error-state');
      expect(texto(aviso)).toContain('El servidor no respondió');
      expect(texto(aviso)).toContain('no quiere decir que no haya recepciones');
      expect(el().querySelector('.empty-state')).toBeNull();
      expect(el().querySelector('table[mat-table]')).toBeNull();
      expect(el().querySelector('mat-paginator')).toBeNull();

      servicio.errorLista = null;
      (aviso!.querySelector('button') as HTMLButtonElement).click();
      await asentar();
      expect(pantalla().errorCarga()).toBeNull();
      expect(el().querySelector('.error-state')).toBeNull();
      expect(el().querySelector('mat-paginator')).not.toBeNull();
    });

    it('sin detalle del servidor dice el texto de siempre', async () => {
      await armar();
      servicio.errorLista = new HttpErrorResponse({ status: 0 });

      await pantalla().cargar();

      expect(pantalla().errorCarga()).toBe('No se pudieron cargar las recepciones. Revise la conexión e intente de nuevo.');
    });
  });

  // ------------------------------------------------------------------ la página que quedó fuera de rango
  it('si la página en que se estaba quedó vacía (se borraron días) se va a la última, no dice "no hay recepciones"', async () => {
    await armar();
    servicio.respuestaDeLista = (p) =>
      p.page === 3
        ? ({ items: [], total: 25, page: 3, page_size: 20, pages: 2 } as Page<Recepcion>)
        : ({ items: [{ id: 'x' } as unknown as Recepcion], total: 25, page: p.page ?? 1, page_size: 20, pages: 2 } as Page<Recepcion>);
    servicio.listas.length = 0;
    pantalla().page.set(3);

    await pantalla().cargar();
    await asentar();

    expect(servicio.listas.map((l) => l.pedido.page)).toEqual([3, 2]);
    expect(pantalla().page()).toBe(2);
    expect(pantalla().filas().length).toBe(1);
    expect(el().querySelector('.empty-state')).toBeNull();
  });

  // ------------------------------------------------------------------ el resumen no recibe los filtros
  it('con proveedor, ruta o búsqueda puestos el resumen dice que es de todo el período', async () => {
    await armar();
    await asentar();
    expect(el().querySelector('.resumen-nota')).toBeNull();

    botonDeRuta('Ruta Norte').click();
    fixture.detectChanges();
    await asentar();

    expect(texto(el().querySelector('.resumen-nota'))).toContain('cifras de todo el período');
    botonDeRuta('Todos').click();
    fixture.detectChanges();
    await asentar();
    expect(el().querySelector('.resumen-nota')).toBeNull();
  });

  // ------------------------------------------------------------------ el proveedor guardado y la nota del resumen
  const unProveedor = (id: string) => ({ id, nombre: `Proveedor ${id}` });

  it('con 100 proveedores en la primera página la lista puede venir cortada: el guardado que no aparece NO se descarta', async () => {
    const cien = Array.from({ length: 100 }, (_, i) => unProveedor(`p-${i}`));
    await armar({
      guardado: guardadoCon('2026-08-01', '2026-08-15', { proveedorId: 'p-150' }),
      proveedores: cien,
    });
    await esperarElRespiro();

    expect(pantalla().proveedorId.value).toBe('p-150');
  });

  it('un proveedor guardado que ya no está entre los de la lista se descarta, y la ruta guardada se queda', async () => {
    await armar({
      guardado: guardadoCon('2026-08-01', '2026-08-15', { proveedorId: 'p-viejo', rutaId: 'r-norte' }),
      proveedores: [unProveedor('p-1'), unProveedor('p-2')],
    });
    await esperarElRespiro();

    expect(pantalla().proveedorId.value).toBeNull();
    expect(pantalla().rutaId.value).toBe('r-norte');
  });

  it('un proveedor guardado que SÍ está entre los de la lista se conserva', async () => {
    await armar({
      guardado: guardadoCon('2026-08-01', '2026-08-15', { proveedorId: 'p-2' }),
      proveedores: [unProveedor('p-1'), unProveedor('p-2')],
    });
    await esperarElRespiro();

    expect(pantalla().proveedorId.value).toBe('p-2');
  });

  it('la nota del resumen sale con solo la búsqueda o con solo el proveedor, y se va al quitar la búsqueda', async () => {
    await armar();
    expect(pantalla().conFiltros()).toBeFalse();

    pantalla().buscar.setValue('Beto');
    await esperarElRespiro();
    expect(pantalla().conFiltros()).toBeTrue();
    expect(texto(el().querySelector('.resumen-nota'))).toContain('cifras de todo el período');

    pantalla().buscar.setValue('');
    await esperarElRespiro();
    expect(pantalla().conFiltros()).toBeFalse();
    expect(el().querySelector('.resumen-nota')).toBeNull();

    pantalla().proveedorId.setValue('p-1');
    await asentar();
    expect(pantalla().conFiltros()).toBeTrue();
    expect(texto(el().querySelector('.resumen-nota'))).toContain('cifras de todo el período');
  });

  // ------------------------------------------------------------------ más de la consulta que falla
  it('si la consulta falla el total también vuelve a 0: no queda el conteo de la lista anterior', async () => {
    await armar();
    servicio.respuestaDeLista = () => pagina(['a', 'b']);
    await pantalla().cargar();
    expect(pantalla().total()).toBe(2);

    servicio.errorLista = new HttpErrorResponse({ status: 500 });
    await pantalla().cargar();

    expect(pantalla().filas()).toEqual([]);
    expect(pantalla().total()).toBe(0);
  });

  it('Reintentar vuelve a pedir la lista Y el resumen', async () => {
    await armar();
    servicio.errorLista = new HttpErrorResponse({ status: 0 });
    await pantalla().cargar();
    fixture.detectChanges();
    const aviso = el().querySelector('.error-state')!;
    const listasAntes = servicio.listas.length;
    const resumenesAntes = servicio.resumenes.length;

    servicio.errorLista = null;
    (aviso.querySelector('button') as HTMLButtonElement).click();
    await asentar();

    expect(servicio.listas.length).toBe(listasAntes + 1);
    expect(servicio.resumenes.length).toBe(resumenesAntes + 1);
    expect(pantalla().errorCarga()).toBeNull();
  });

  it('mientras la lista carga NO dice "no hay recepciones": el estado vacío sale cuando la consulta ya contestó vacía', async () => {
    await armar({ diferido: true });
    expect(pantalla().cargando()).toBeTrue();
    expect(el().querySelector('.empty-state')).toBeNull();

    servicio.listas[0].salida!.next(pagina([]));
    await asentar();

    expect(pantalla().cargando()).toBeFalse();
    expect(el().querySelector('.empty-state')).not.toBeNull();
  });

  describe('la última consulta manda', () => {
    it('si la respuesta de la quincena anterior llega DESPUÉS, la lista y el resumen son los de la nueva', async () => {
      await armar({ diferido: true });
      servicio.listas[0].salida!.next(pagina(['de-entrada']));
      servicio.resumenes[0].salida!.next(RESUMEN('100'));
      await asentar();

      // Dos clics seguidos: se marca la otra quincena y se vuelve a la de hoy.
      botonesDeQuincena()[laDeHoy.quincena === 1 ? 1 : 0].click();
      fixture.detectChanges();
      await esperarElRespiro();
      botonesDeQuincena()[laDeHoy.quincena - 1].click();
      fixture.detectChanges();
      await esperarElRespiro();
      const vieja = servicio.listas.at(-2)!;
      const nueva = servicio.listas.at(-1)!;
      const viejaR = servicio.resumenes.at(-2)!;
      const nuevaR = servicio.resumenes.at(-1)!;
      expect(vieja.pedido.desde).toBe(laOtra.inicio);
      expect(nueva.pedido.desde).toBe(rangoDeHoy.inicio);

      nueva.salida!.next(pagina(['n-1', 'n-2']));
      nuevaR.salida!.next(RESUMEN('555'));
      await asentar();
      vieja.salida!.next(pagina(['v-1']));
      viejaR.salida!.next(RESUMEN('999'));
      await asentar();

      expect(pantalla().filas().map((f) => f.id)).toEqual(['n-1', 'n-2']);
      expect(pantalla().total()).toBe(2);
      expect(pantalla().resumen()?.total_litros).toBe('555');
      expect(pantalla().cargando()).toBeFalse();
    });


    it('si la consulta vieja del resumen FALLA cuando ya llegó la nueva, el resumen sigue siendo el de la nueva', async () => {
      await armar({ diferido: true });
      servicio.listas[0].salida!.next(pagina(['de-entrada']));
      servicio.resumenes[0].salida!.next(RESUMEN('100'));
      await asentar();
      botonesDeQuincena()[laDeHoy.quincena === 1 ? 1 : 0].click();
      fixture.detectChanges();
      await esperarElRespiro();
      botonesDeQuincena()[laDeHoy.quincena - 1].click();
      fixture.detectChanges();
      await esperarElRespiro();
      const viejaR = servicio.resumenes.at(-2)!;
      const nuevaR = servicio.resumenes.at(-1)!;

      nuevaR.salida!.next(RESUMEN('555'));
      await asentar();
      viejaR.salida!.error(new Error('se cayó la consulta'));
      await asentar();

      expect(pantalla().resumen()?.total_litros).toBe('555');
    });

    it('quitar el filtro de fechas con el resumen aún en camino: la respuesta que llega tarde NO lo vuelve a pintar', async () => {
      await armar({ diferido: true });
      servicio.listas[0].salida!.next(pagina(['de-entrada']));
      await asentar();
      // el resumen de la quincena de hoy (resumenes[0]) sigue sin contestar
      botonesDeQuincena()[laDeHoy.quincena - 1].click(); // la marcada: quita las fechas
      fixture.detectChanges();
      await esperarElRespiro();
      expect(servicio.resumenes.length).toBe(1); // sin fechas no se pide resumen
      expect(pantalla().resumen()).toBeNull();

      servicio.resumenes[0].salida!.next(RESUMEN('999'));
      await asentar();

      expect(pantalla().resumen()).toBeNull();
    });

    it('si la consulta vieja de la lista FALLA cuando ya llegó la nueva, la lista sigue siendo la de la nueva y no sale el aviso de error', async () => {
      await armar({ diferido: true });
      servicio.listas[0].salida!.next(pagina(['de-entrada']));
      servicio.resumenes[0].salida!.next(RESUMEN('100'));
      await asentar();
      botonesDeQuincena()[laDeHoy.quincena === 1 ? 1 : 0].click();
      fixture.detectChanges();
      await esperarElRespiro();
      botonesDeQuincena()[laDeHoy.quincena - 1].click();
      fixture.detectChanges();
      await esperarElRespiro();
      const vieja = servicio.listas.at(-2)!;
      const nueva = servicio.listas.at(-1)!;

      nueva.salida!.next(pagina(['n-1']));
      await asentar();
      vieja.salida!.error(new HttpErrorResponse({ status: 500 }));
      await asentar();

      expect(pantalla().filas().map((f) => f.id)).toEqual(['n-1']);
      expect(pantalla().total()).toBe(1);
      expect(pantalla().errorCarga()).toBeNull();
      expect(el().querySelector('.error-state')).toBeNull();
    });

    it('la respuesta vieja que llega ANTES no apaga el "cargando" de la nueva', async () => {
      await armar({ diferido: true });
      servicio.listas[0].salida!.next(pagina(['de-entrada']));
      servicio.resumenes[0].salida!.next(RESUMEN('100'));
      await asentar();

      botonesDeQuincena()[laDeHoy.quincena === 1 ? 1 : 0].click();
      fixture.detectChanges();
      await esperarElRespiro();
      botonesDeQuincena()[laDeHoy.quincena - 1].click();
      fixture.detectChanges();
      await esperarElRespiro();
      const vieja = servicio.listas.at(-2)!;
      const nueva = servicio.listas.at(-1)!;

      vieja.salida!.next(pagina(['v-1']));
      await asentar();

      expect(pantalla().filas().map((f) => f.id)).toEqual(['de-entrada']);
      expect(pantalla().cargando()).toBeTrue();

      nueva.salida!.next(pagina(['n-1']));
      await asentar();
      expect(pantalla().filas().map((f) => f.id)).toEqual(['n-1']);
      expect(pantalla().cargando()).toBeFalse();
    });
  });

  it('unas fechas al revés cuentan como la última consulta: la lista que iba en camino y llega tarde NO llena la tabla', async () => {
    await armar({ diferido: true }); // la consulta de entrada queda en el aire
    const enCamino = servicio.listas[0];
    expect(pantalla().cargando()).toBeTrue();

    pantalla().desde.setValue(new Date(2026, 8, 20));
    pantalla().hasta.setValue(new Date(2026, 8, 5)); // «Desde» después de «Hasta»: no se consulta nada
    fixture.detectChanges();
    await esperarElRespiro();
    expect(pantalla().fechasAlReves()).toBeTrue();
    expect(servicio.listas.length).toBe(1);

    enCamino.salida!.next(pagina(['de-la-quincena-vieja']));
    await asentar();

    expect(pantalla().filas()).toEqual([]);
    expect(pantalla().total()).toBe(0);
    expect(pantalla().cargando()).toBeFalse();
  });

  it('las fechas que usa la pantalla son las que ven los botones (no hay otra cuenta de "esta quincena")', async () => {
    await armar();

    expect(dateToIso(pantalla().desde.value)).toBe(rangoDeHoy.inicio);
    expect(dateToIso(pantalla().hasta.value)).toBe(rangoDeHoy.fin);
  });
});
