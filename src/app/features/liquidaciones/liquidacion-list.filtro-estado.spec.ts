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
 * EL ESTADO Y EL TIPO SE FILTRAN CON BOTONES, COMO LA QUINCENA.
 *
 * Antes eran dos desplegables (más las casillas Desde y Hasta) y para saber qué filtro estaba
 * puesto había que abrirlos. Lo que se mide es que el botón llegue hasta las consultas de la
 * pantalla, que las tarjetas de arriba —que también filtran por estado— y los botones sean
 * el MISMO filtro (tocar uno mueve al otro), y que el filtro guardado en la sesión vuelva
 * puesto.
 */

const RESUMEN: ResumenLiquidaciones = {
  borradores: 2,
  aprobadas: 1,
  saldo_aprobadas: '120000.00',
  parciales: 0,
  saldo_parciales: '0.00',
  pagadas: 3,
  le_quedaron_debiendo: '0.00',
  liquidaciones_que_deben: 0,
};

interface Pedido {
  estado?: string | null;
  tipo?: string | null;
  desde?: string | null;
  hasta?: string | null;
}

class ServicioFalso {
  listas: Pedido[] = [];
  resumenes: Pedido[] = [];

  list(p?: Pedido): Observable<Page<Liquidacion>> {
    this.listas.push({ estado: p?.estado, tipo: p?.tipo, desde: p?.desde, hasta: p?.hasta });
    return of({ items: [], total: 0, page: 1, page_size: 20, pages: 1 });
  }

  resumen(f: Pedido): Observable<ResumenLiquidaciones> {
    this.resumenes.push({ tipo: f.tipo, desde: f.desde, hasta: f.hasta });
    return of(RESUMEN);
  }
}

const texto = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('LiquidacionListPage: estado y tipo en botones', () => {
  let fixture: ComponentFixture<LiquidacionListPage>;
  let servicio: ServicioFalso;

  const armar = async (guardado?: Record<string, unknown>): Promise<void> => {
    sessionStorage.clear();
    if (guardado) sessionStorage.setItem('qe.filtros.liquidaciones', JSON.stringify(guardado));
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

  afterEach(() => sessionStorage.clear());

  const el = (): HTMLElement => fixture.nativeElement;
  const grupo = (nombre: string): HTMLElement =>
    Array.from(el().querySelectorAll<HTMLElement>('app-filtro-por-opciones')).find(
      (g) => texto(g.querySelector('.etiqueta')) === `${nombre}:`,
    )!;
  const botonesDe = (nombre: string): HTMLButtonElement[] =>
    Array.from(grupo(nombre).querySelectorAll<HTMLButtonElement>('.opcion'));
  const marcadoDe = (nombre: string): string[] =>
    botonesDe(nombre)
      .filter((b) => b.classList.contains('activa'))
      .map((b) => texto(b));
  const tocar = async (nombreGrupo: string, boton: string): Promise<void> => {
    botonesDe(nombreGrupo)
      .find((b) => texto(b) === boton)!
      .click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const tarjeta = (titulo: string): HTMLButtonElement =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('button.tarjeta')).find((t) =>
      texto(t).includes(titulo),
    )!;
  const clicTarjeta = async (titulo: string): Promise<void> => {
    tarjeta(titulo).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const ultimaLista = (): Pedido => servicio.listas.at(-1)!;
  const ultimoResumen = (): Pedido => servicio.resumenes.at(-1)!;

  it('la barra trae la quincena, el estado y el tipo; ninguna casilla ni desplegable', async () => {
    await armar();

    expect(el().querySelector('.page-toolbar app-selector-quincena')).not.toBeNull();
    expect(botonesDe('Estado').map((b) => texto(b))).toEqual([
      'Todos',
      'Borrador',
      'Aprobada',
      'Parcial',
      'Pagada',
      'Anulada',
    ]);
    expect(botonesDe('Tipo').map((b) => texto(b))).toEqual(['Todos', 'Proveedor', 'Transportador']);
    expect(el().querySelector('.page-toolbar mat-form-field')).toBeNull();
    expect(el().querySelector('.page-toolbar mat-select')).toBeNull();
    expect(el().querySelector('.page-toolbar input')).toBeNull();
    // Sin nada puesto, "Todos" está marcado en los dos grupos.
    expect(marcadoDe('Estado')).toEqual(['Todos']);
    expect(marcadoDe('Tipo')).toEqual(['Todos']);
  });

  it('el botón de estado filtra la lista, una sola vez, y recarga las tarjetas con los demás filtros', async () => {
    await armar();
    const listasAntes = servicio.listas.length;
    const resumenesAntes = servicio.resumenes.length;

    await tocar('Estado', 'Pagada');

    expect(servicio.listas.length - listasAntes).toBe(1);
    expect(servicio.resumenes.length - resumenesAntes).toBe(1);
    expect(ultimaLista().estado).toBe('pagada');
    // Las tarjetas no se filtran por el estado: son las que cuentan CADA estado.
    expect(ultimoResumen()).toEqual({ tipo: null, desde: null, hasta: null });
    expect(marcadoDe('Estado')).toEqual(['Pagada']);
  });

  it('las tarjetas y los botones son el mismo filtro: tocar una tarjeta marca el botón', async () => {
    await armar();

    await clicTarjeta('Borradores por revisar');

    expect(ultimaLista().estado).toBe('borrador');
    expect(marcadoDe('Estado')).toEqual(['Borrador']);
    expect(tarjeta('Borradores por revisar').getAttribute('aria-pressed')).toBe('true');
  });

  it('y al revés: tocar el botón marca su tarjeta, y tocarlo de nuevo quita el filtro de las dos', async () => {
    await armar();

    await tocar('Estado', 'Pagada');
    expect(tarjeta('Pagadas en el período').getAttribute('aria-pressed')).toBe('true');
    expect(tarjeta('Borradores por revisar').getAttribute('aria-pressed')).toBe('false');

    await tocar('Estado', 'Pagada');
    expect(ultimaLista().estado).toBeNull();
    expect(marcadoDe('Estado')).toEqual(['Todos']);
    expect(tarjeta('Pagadas en el período').getAttribute('aria-pressed')).toBe('false');
  });

  it('"Todos" quita solo el estado, no el tipo ni la quincena', async () => {
    await armar();
    await tocar('Tipo', 'Transportador');
    await tocar('Estado', 'Aprobada');

    await tocar('Estado', 'Todos');

    expect(ultimaLista().estado).toBeNull();
    expect(ultimaLista().tipo).toBe('transportador');
    expect(marcadoDe('Tipo')).toEqual(['Transportador']);
  });

  it('el botón de tipo filtra la lista y las tarjetas', async () => {
    await armar();

    await tocar('Tipo', 'Proveedor');

    expect(ultimaLista().tipo).toBe('proveedor');
    expect(ultimoResumen().tipo).toBe('proveedor');
    expect(marcadoDe('Tipo')).toEqual(['Proveedor']);
  });

  it('la quincena, el estado y el tipo se combinan en la misma consulta', async () => {
    await armar();
    const pagina = fixture.componentInstance;
    pagina.desde.setValue(new Date(2026, 8, 5));
    pagina.hasta.setValue(new Date(2026, 8, 20));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    el().querySelectorAll<HTMLButtonElement>('app-selector-quincena .q-btn')[1].click(); // 2.ª
    fixture.detectChanges();
    await fixture.whenStable();
    await tocar('Estado', 'Aprobada');
    await tocar('Tipo', 'Proveedor');

    expect(ultimaLista()).toEqual({
      estado: 'aprobada',
      tipo: 'proveedor',
      desde: '2026-09-16',
      hasta: '2026-09-30',
    });
    expect(ultimoResumen()).toEqual({ tipo: 'proveedor', desde: '2026-09-16', hasta: '2026-09-30' });
  });

  it('el filtro guardado en la sesión vuelve puesto: se pide así y los botones lo muestran', async () => {
    await armar({
      tipo: 'transportador',
      estado: 'parcial',
      desde: { __fecha: new Date(2026, 8, 1).toISOString() },
      hasta: { __fecha: new Date(2026, 8, 15).toISOString() },
    });

    expect(servicio.listas[0]).toEqual({
      estado: 'parcial',
      tipo: 'transportador',
      desde: '2026-09-01',
      hasta: '2026-09-15',
    });
    expect(marcadoDe('Estado')).toEqual(['Parcial']);
    expect(marcadoDe('Tipo')).toEqual(['Transportador']);
    expect(
      el().querySelector('app-selector-quincena .q-btn.activa')?.textContent?.includes('1.ª quincena'),
    ).toBeTrue();
  });
});
