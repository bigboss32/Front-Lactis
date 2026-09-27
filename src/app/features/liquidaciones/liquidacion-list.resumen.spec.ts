import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion, Page } from '../../core/models';
import { LiquidacionListPage } from './liquidacion-list.page';
import {
  FiltrosResumen,
  LiquidacionesService,
  ResumenLiquidaciones,
} from './liquidaciones.service';

/**
 * LAS TARJETAS DEL LISTADO SALEN DEL SERVIDOR, EN UNA SOLA CONSULTA.
 *
 * Antes la pantalla pedía cuatro listas de hasta 200 filas y contaba ella. El total venía
 * completo pero las filas no, y con más de 200 pagadas la deuda vieja se quedaba en la
 * página 2: la tarjeta "Le quedaron debiendo" desaparecía con $120.000 sin cobrar (lo
 * reprodujo la auditoría en zz-existentes-filtro.spec.ts). Ahora cuenta el backend, que
 * ve todas las filas, y la pantalla solo pinta lo que él manda.
 */

const liq = (c: Partial<Liquidacion>): Liquidacion => ({
  id: 'x',
  empresa_id: 'e-1',
  estado: 'pagada',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Rosa',
  transportador_id: null,
  transportador_nombre: null,
  periodo_inicio: '2026-07-01',
  periodo_fin: '2026-07-15',
  total_litros: '100',
  precio_promedio: '2000',
  valor_bruto: '200000',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '0',
  anticipos: '0',
  valor_total: '200000',
  neto_a_pagar: '200000',
  pagado: '200000',
  saldo: '0',
  le_queda_debiendo: '0',
  observaciones: null,
  detalles: [],
  pagos: [],
  ...c,
});

/**
 * Lo que responde el servidor: 201 pagadas en el período y, además, la deuda de enero de
 * Henri —$120.000— que nadie ha cobrado. Montos en texto, como los Decimal de verdad.
 */
const CON_201_PAGADAS: ResumenLiquidaciones = {
  borradores: 2,
  aprobadas: 1,
  saldo_aprobadas: '130000.00',
  parciales: 1,
  saldo_parciales: '44506.32',
  pagadas: 201,
  le_quedaron_debiendo: '120000.00',
  liquidaciones_que_deben: 1,
};

class ServidorFalso {
  /** La primera página de la tabla: 20 pagadas limpias, ninguna debe nada. */
  filas: Liquidacion[] = Array.from({ length: 20 }, (_, i) => liq({ id: `p${i}` }));
  respuesta: () => Observable<ResumenLiquidaciones> = () => of(CON_201_PAGADAS);
  readonly pedidosResumen: FiltrosResumen[] = [];
  readonly pedidosLista: Record<string, unknown>[] = [];

  list(params: Record<string, unknown> = {}): Observable<Page<Liquidacion>> {
    this.pedidosLista.push(params);
    return of({ items: this.filas, total: 201, page: 1, page_size: 20, pages: 11 });
  }

  resumen(filtros: FiltrosResumen): Observable<ResumenLiquidaciones> {
    this.pedidosResumen.push(filtros);
    return this.respuesta();
  }
}

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

describe('LiquidacionListPage: las tarjetas salen de GET /liquidaciones/resumen', () => {
  let fixture: ComponentFixture<LiquidacionListPage>;
  let servidor: ServidorFalso;

  const limpiar = () => {
    try {
      sessionStorage.removeItem('qe.filtros.liquidaciones');
    } catch {
      /* sin sessionStorage no hay nada que limpiar */
    }
  };
  beforeEach(limpiar);
  afterEach(limpiar);

  const refrescar = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const armar = async (preparar: (s: ServidorFalso) => void = () => {}): Promise<void> => {
    servidor = new ServidorFalso();
    preparar(servidor);
    await TestBed.configureTestingModule({
      imports: [LiquidacionListPage, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: LiquidacionesService, useValue: servidor },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LiquidacionListPage);
    await refrescar();
  };

  const tarjetas = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.tarjeta')).map((t) =>
      comoSeLee((t as HTMLElement).textContent),
    );
  const tarjetaCon = (texto: string): string => tarjetas().find((t) => t.includes(texto)) ?? '';

  it('pide UNA consulta de resumen, y la lista ya no trae páginas de 200 para contar', async () => {
    await armar();

    expect(servidor.pedidosResumen.length).toBe(1);
    // Solo la tabla pide filas, y con su página de siempre.
    expect(servidor.pedidosLista.length).toBe(1);
    expect(servidor.pedidosLista[0]['page_size']).toBe(20);
    expect(servidor.pedidosLista.some((p) => p['page_size'] === 200)).toBeFalse();
  });

  it('con más de 200 pagadas, la deuda vieja SIGUE en su tarjeta', async () => {
    // El caso de la auditoría: la tabla muestra 20 pagadas limpias y la deuda de enero no
    // está en ninguna página cargada, pero el servidor la cuenta.
    await armar();

    const r = fixture.componentInstance.resumen()!;
    expect(r.pagadas).toBe(201);
    expect(r.leQuedaronDebiendo).toBe(120000);
    expect(r.liquidacionesQueDeben).toBe(1);
    const tarjeta = tarjetaCon('Le quedaron debiendo');
    expect(tarjeta).toContain('$ 120.000');
    expect(tarjeta).toContain('en 1 liquidación');
    expect(comoSeLee(tarjetaCon('Pagadas en el período'))).toContain('201');
  });

  it('las cifras de plata llegan como texto y se pintan en pesos, con la forma de siempre', async () => {
    await armar();

    expect(fixture.componentInstance.resumen()).toEqual({
      borradores: 2,
      aprobadas: 1,
      saldoAprobadas: 130000,
      parciales: 1,
      saldoParciales: 44506.32,
      pagadas: 201,
      leQuedaronDebiendo: 120000,
      liquidacionesQueDeben: 1,
      // Una respuesta sin las cifras de la deuda borrada las lee en cero.
      porReparar: 0,
      deudaBorrada: 0,
    });
    expect(tarjetaCon('Aprobadas por pagar')).toContain('$ 130.000 por pagar');
    expect(tarjetaCon('Con abonos, debiendo')).toContain('$ 44.506 sin pagar');
    expect(tarjetaCon('Borradores por revisar')).toContain('2');
  });

  it('manda los filtros de tipo y fechas con los mismos nombres de la lista, y nunca el de estado', async () => {
    await armar();
    const pagina = fixture.componentInstance;

    pagina.tipo.setValue('proveedor');
    pagina.desde.setValue(new Date(2026, 6, 1));
    pagina.hasta.setValue(new Date(2026, 6, 15));
    pagina.estado.setValue('pagada');
    await refrescar();

    const ultimo = servidor.pedidosResumen[servidor.pedidosResumen.length - 1];
    expect(ultimo).toEqual({ tipo: 'proveedor', desde: '2026-07-01', hasta: '2026-07-15' });
    // Y son los mismos valores que viajan en la lista.
    const lista = servidor.pedidosLista[servidor.pedidosLista.length - 1];
    expect(lista['tipo']).toBe(ultimo.tipo);
    expect(lista['desde']).toBe(ultimo.desde);
    expect(lista['hasta']).toBe(ultimo.hasta);
    expect(servidor.pedidosResumen.every((p) => !('estado' in p))).toBeTrue();
  });

  it('si el resumen falla no hay tarjetas, y la lista se carga igual', async () => {
    await armar((s) => (s.respuesta = () => throwError(() => new Error('sin señal'))));

    expect(fixture.componentInstance.resumen()).toBeNull();
    expect(tarjetas()).toEqual([]);
    expect(fixture.componentInstance.filas().length).toBe(20);
  });

  it('una respuesta sin una cifra no pinta tarjetas: un $0 afirmaría que nadie debe', async () => {
    const sinLaDeuda: Partial<ResumenLiquidaciones> = { ...CON_201_PAGADAS };
    delete sinLaDeuda.le_quedaron_debiendo;
    await armar((s) => (s.respuesta = () => of(sinLaDeuda as ResumenLiquidaciones)));

    expect(fixture.componentInstance.resumen()).toBeNull();
    expect(tarjetas()).toEqual([]);
  });

  it('"Reintentar" vuelve a pedir el resumen', async () => {
    let falla = true;
    await armar(
      (s) =>
        (s.respuesta = () =>
          falla ? throwError(() => new Error('sin señal')) : of(CON_201_PAGADAS)),
    );
    expect(fixture.componentInstance.resumen()).toBeNull();

    falla = false;
    fixture.componentInstance.reintentar();
    await refrescar();
    expect(fixture.componentInstance.resumen()?.leQuedaronDebiendo).toBe(120000);
  });

  // ---------------------------------------------------------------------------
  // LAS QUINCENAS CON LA DEUDA BORRADA POR LA MIGRACIÓN no entran en la plata por pagar
  // (el servidor las saca), y sin su propia tarjeta desaparecerían de las cifras sin que
  // nadie lo dijera. Las cuenta el servidor: `por_reparar` y `deuda_borrada`.
  // ---------------------------------------------------------------------------
  it('con quincenas por reparar sale su tarjeta, con la cifra exacta y cuántas son', async () => {
    await armar(
      (s) =>
        (s.respuesta = () =>
          of({ ...CON_201_PAGADAS, por_reparar: 2, deuda_borrada: '124955.77' })),
    );

    const tarjeta = tarjetaCon('Deuda borrada por reparar');
    // Con centavos: se cuadra contra el aviso del detalle de cada una.
    expect(tarjeta).toContain('$ 124.955,77');
    expect(tarjeta).toContain('Deuda borrada por reparar');
    expect(tarjeta).toContain('en 2 quincenas · no entra en lo que hay por pagar');
    expect(comoSeLee(fixture.componentInstance.tooltipPorReparar(2, 124955.77))).toBe(
      '2 quincenas de antes de los abonos a las que el sistema de esa época les borró lo que ' +
        'el tercero quedaba debiendo: $ 124.955,77 en total. Hay que repararlas antes de ' +
        'corregirlas o pagarlas, y mientras tanto no entran en la plata por pagar de las otras ' +
        'tarjetas. En la lista llevan la marca «deuda borrada · por reparar»',
    );
    // No es un botón: no hay filtro para ellas.
    const elemento = Array.from(
      fixture.nativeElement.querySelectorAll('.tarjeta') as NodeListOf<HTMLElement>,
    ).find((t) => comoSeLee(t.textContent).includes('Deuda borrada'))!;
    expect(elemento.tagName).toBe('DIV');
    // Las demás quedan como estaban.
    expect(tarjetaCon('Aprobadas por pagar')).toContain('$ 130.000 por pagar');
    expect(tarjetaCon('Le quedaron debiendo')).toContain('$ 120.000');
  });

  it('una sola se dice en singular', async () => {
    await armar(
      (s) =>
        (s.respuesta = () =>
          of({ ...CON_201_PAGADAS, por_reparar: 1, deuda_borrada: '120000.00' })),
    );

    expect(tarjetaCon('Deuda borrada por reparar')).toContain('$ 120.000');
    expect(tarjetaCon('Deuda borrada por reparar')).toContain('en 1 quincena ·');
  });

  it('sin quincenas por reparar —o si el servidor todavía no las cuenta— no sale', async () => {
    await armar(
      (s) => (s.respuesta = () => of({ ...CON_201_PAGADAS, por_reparar: 0, deuda_borrada: '0.00' })),
    );
    expect(tarjetaCon('Deuda borrada')).toBe('');
    expect(tarjetas().length).toBeGreaterThan(0);

    TestBed.resetTestingModule();
    await armar(); // CON_201_PAGADAS no trae los campos
    expect(tarjetaCon('Deuda borrada')).toBe('');
    expect(tarjetaCon('Aprobadas por pagar')).toContain('$ 130.000 por pagar');
  });

  it('si dice que hay alguna pero la cifra no se puede leer, no pinta tarjetas', async () => {
    // "2 quincenas por reparar · $ NaN" no se le puede mostrar al dueño.
    await armar((s) => (s.respuesta = () => of({ ...CON_201_PAGADAS, por_reparar: 2 })));

    expect(fixture.componentInstance.resumen()).toBeNull();
    expect(tarjetas()).toEqual([]);
  });
});
