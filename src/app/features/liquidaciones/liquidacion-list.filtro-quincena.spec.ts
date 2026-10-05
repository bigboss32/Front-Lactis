import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, of } from 'rxjs';

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
  const tocar = async (boton: HTMLButtonElement): Promise<void> => {
    boton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  afterEach(() => sessionStorage.clear());

  it('las fechas se filtran por quincena, no con los botones de Hoy / Este mes', async () => {
    await armar();

    expect(el().querySelector('app-selector-quincena')).not.toBeNull();
    expect(el().querySelector('app-rango-fechas-rapido')).toBeNull();
    expect(texto(botones()[0])).toContain('1.ª quincena');
    expect(texto(botones()[1])).toContain('2.ª quincena');
    // Y las casillas de antes ya no están: ni Desde y Hasta, ni los desplegables.
    expect(el().querySelector('.page-toolbar mat-form-field')).toBeNull();
    expect(el().querySelector('.page-toolbar mat-select')).toBeNull();
    expect(el().querySelector('.page-toolbar input')).toBeNull();
  });

  it('la 2.ª quincena de septiembre filtra la lista y las tarjetas del 16 al 30, cada una una sola vez', async () => {
    await armar();
    const pagina = fixture.componentInstance;
    pagina.desde.setValue(new Date(2026, 8, 5));
    pagina.hasta.setValue(new Date(2026, 8, 20));
    fixture.detectChanges();
    await fixture.whenStable();
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
    await fixture.whenStable();
    fixture.detectChanges();
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
    await fixture.whenStable();
    fixture.detectChanges();

    await tocar(botones()[0]);

    expect(servicio.pedidosDeLista.at(-1)).toEqual({ desde: null, hasta: null, tipo: null });
    expect(pagina.desde.value).toBeNull();
    expect(pagina.hasta.value).toBeNull();
  });

  it('un rango SUELTO guardado por la pantalla de antes ("Este mes", fechas escritas) se descarta: no filtra a escondidas', async () => {
    sessionStorage.setItem(
      'qe.filtros.liquidaciones',
      JSON.stringify({
        tipo: null,
        estado: null,
        desde: { __fecha: new Date(2026, 9, 1).toISOString() },
        hasta: { __fecha: new Date(2026, 9, 4).toISOString() },
      }),
    );
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

    // Se pide sin fechas, las dos consultas, y las casillas de la pantalla quedan vacías.
    expect(servicio.pedidosDeLista[0]).toEqual({ desde: null, hasta: null, tipo: null });
    expect(servicio.pedidosDeResumen[0]).toEqual({ desde: null, hasta: null, tipo: null });
    expect(fixture.componentInstance.desde.value).toBeNull();
    expect(fixture.componentInstance.hasta.value).toBeNull();
    expect(botones().some((b) => b.classList.contains('activa'))).toBeFalse();
  });

  it('con una sola fecha guardada (a medias) tampoco se filtra: se descarta', async () => {
    sessionStorage.setItem(
      'qe.filtros.liquidaciones',
      JSON.stringify({ desde: { __fecha: new Date(2026, 8, 1).toISOString() }, hasta: null }),
    );
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

    expect(servicio.pedidosDeLista[0]).toEqual({ desde: null, hasta: null, tipo: null });
  });

  it('el filtro de quincena queda guardado en la sesión y vuelve marcado', async () => {
    await armar();
    const pagina = fixture.componentInstance;
    pagina.desde.setValue(new Date(2026, 8, 5));
    pagina.hasta.setValue(new Date(2026, 8, 20));
    fixture.detectChanges();
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
