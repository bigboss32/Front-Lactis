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
  it('trae el selector de quincena y la ruta en botones; ya no hay Desde, Hasta ni "Rápido"', async () => {
    await armar();

    expect(el().querySelector('app-selector-quincena')).not.toBeNull();
    expect(botonesDeRuta().map(texto)).toEqual(['Todos', 'Ruta Norte', 'Ruta Sur']);
    expect(el().querySelector('mat-datepicker-toggle')).toBeNull();
    expect(el().querySelector('app-rango-fechas-rapido')).toBeNull();
    expect(texto(el().querySelector('.page-toolbar'))).not.toContain('Rápido');
    // "Buscar proveedor" y el desplegable de Proveedor siguen: lo que se quitó fue Desde, Hasta y el desplegable de Ruta.
    expect(texto(el().querySelector('.page-toolbar'))).toContain('Buscar proveedor');
    expect(texto(el().querySelector('.page-toolbar'))).toContain('Proveedor');
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

  it('un rango suelto guardado por la pantalla anterior (los primeros 4 días) NO filtra: vuelve la quincena de hoy', async () => {
    await armar({ guardado: guardadoCon('2026-10-01', '2026-10-04') });

    expect(servicio.listas[0].pedido).toEqual({ desde: rangoDeHoy.inicio, hasta: rangoDeHoy.fin, ruta_id: null, page: 1 });
    expect(servicio.resumenes[0].pedido).toEqual({ desde: rangoDeHoy.inicio, hasta: rangoDeHoy.fin });
    expect(botonesDeQuincena().filter((b) => b.classList.contains('activa')).length).toBe(1);
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
  it('una sola fecha guardada (la otra vacía) tampoco filtra: vuelve la quincena de hoy', async () => {
    await armar({ guardado: guardadoCon('2026-08-16', null) });
    expect(servicio.listas[0].pedido).toEqual({ desde: rangoDeHoy.inicio, hasta: rangoDeHoy.fin, ruta_id: null, page: 1 });
    expect(servicio.resumenes[0].pedido).toEqual({ desde: rangoDeHoy.inicio, hasta: rangoDeHoy.fin });
  });

  it('lo mismo con solo la fecha Hasta guardada', async () => {
    await armar({ guardado: guardadoCon(null, '2026-08-31') });
    expect(servicio.listas[0].pedido).toEqual({ desde: rangoDeHoy.inicio, hasta: rangoDeHoy.fin, ruta_id: null, page: 1 });
  });

  it('descartar el rango suelto guardado NO dispara otra consulta: la lista y el resumen se piden UNA vez', async () => {
    await armar({ guardado: guardadoCon('2026-10-01', '2026-10-04') });
    await esperarElRespiro();

    expect(servicio.listas.length).toBe(1);
    expect(servicio.resumenes.length).toBe(1);
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

  it('las fechas que usa la pantalla son las que ven los botones (no hay otra cuenta de "esta quincena")', async () => {
    await armar();

    expect(dateToIso(pantalla().desde.value)).toBe(rangoDeHoy.inicio);
    expect(dateToIso(pantalla().hasta.value)).toBe(rangoDeHoy.fin);
  });
});
