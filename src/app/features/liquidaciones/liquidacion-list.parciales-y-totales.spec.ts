import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
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
 * EL LISTADO NO AFIRMA UN ABONO QUE NO EXISTE, Y DICE CUANDO LOS TOTALES NO LLEGARON.
 *
 *  · 'parcial' no es siempre "con abonos": la quincena que sus anticipos cubrían exacto
 *    ($180.000 contra $180.000), corregida con un día olvidado de 20 L, queda 'parcial'
 *    con pagado $0 y $36.000 por entregar. La tarjeta decía "Con abonos, debiendo", el
 *    filtro "Parcial (con abonos)" y la marca "Ya se le abonó una parte".
 *  · Si `/resumen` falla (el front publicado antes que el servidor responde 422), la fila
 *    de tarjetas desaparecía callada: "Le quedaron debiendo $120.000" se dejaba de ver sin
 *    ningún aviso. Sin tarjetas en $0 y sin esconder la tabla, ahora se dice.
 */

const liq = (c: Partial<Liquidacion>): Liquidacion => ({
  id: 'x',
  empresa_id: 'e-1',
  estado: 'aprobada',
  created_at: '2026-06-16T00:00:00Z',
  updated_at: '2026-06-16T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Henri Castaño',
  transportador_id: null,
  transportador_nombre: null,
  periodo_inicio: '2026-06-01',
  periodo_fin: '2026-06-15',
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
  ...c,
});

/** La v2 del anticipo exacto con el día olvidado: 'parcial', $36.000, ningún pago. */
const PARCIAL_SIN_ABONO = liq({
  id: 'sin-abono',
  estado: 'parcial',
  estado_visible: 'parcial',
  version: 2,
  valor_total: '216000',
  anticipos: '180000',
  neto_a_pagar: '36000',
  saldo: '36000',
});

/** $180.000 con un abono de $30.000 de verdad. */
const PARCIAL_CON_ABONO = liq({
  id: 'con-abono',
  estado: 'parcial',
  estado_visible: 'parcial',
  pagado: '30000',
  saldo: '150000',
  pagos: [{ id: 'p-1', fecha: '2026-06-20', valor: '30000', observaciones: null }],
});

const APROBADA = liq({ id: 'aprobada', estado_visible: 'aprobada' });

const RESUMEN: ResumenLiquidaciones = {
  borradores: 0,
  aprobadas: 1,
  saldo_aprobadas: '180000.00',
  parciales: 2,
  saldo_parciales: '186000.00',
  pagadas: 0,
  le_quedaron_debiendo: '120000.00',
  liquidaciones_que_deben: 1,
};

class ServidorFalso {
  filas: Liquidacion[] = [PARCIAL_SIN_ABONO, PARCIAL_CON_ABONO, APROBADA];
  respuesta: () => Observable<ResumenLiquidaciones> = () => of(RESUMEN);
  listaFalla = false;
  readonly pedidosResumen: FiltrosResumen[] = [];

  list(): Observable<Page<Liquidacion>> {
    if (this.listaFalla) return throwError(() => new Error('sin señal'));
    return of({ items: this.filas, total: this.filas.length, page: 1, page_size: 20, pages: 1 });
  }

  resumen(filtros: FiltrosResumen): Observable<ResumenLiquidaciones> {
    this.pedidosResumen.push(filtros);
    return this.respuesta();
  }
}

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

describe('LiquidacionListPage: las parciales y los totales', () => {
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
  const aviso = (): HTMLElement | null => fixture.nativeElement.querySelector('.aviso-totales');
  const tooltipDe = (selector: string, indice = 0): string =>
    fixture.debugElement.queryAll(By.css(selector))[indice].injector.get(MatTooltip).message;

  // --------------------------------------------------------------- las parciales
  it('la tarjeta de las parciales no dice "abonos": es verdad para las dos clases', async () => {
    await armar();

    const tarjeta = tarjetas().find((t) => t.includes('Parciales')) ?? '';
    expect(tarjeta).toContain('Parciales, con saldo pendiente');
    expect(tarjeta).toContain('$ 186.000 sin pagar');
    expect(tarjetas().join(' ')).not.toContain('abono');
    // El tooltip tampoco las da a todas por abonadas.
    const indice = fixture.debugElement
      .queryAll(By.css('.tarjeta'))
      .findIndex((t) => comoSeLee(t.nativeElement.textContent).includes('Parciales'));
    expect(tooltipDe('.tarjeta', indice)).toBe(
      'Mostrar solo las liquidaciones en parcial: ya tienen abonos o se corrigieron después ' +
        'de cerradas, y todavía tienen saldo pendiente',
    );
  });

  it('el filtro de estado dice "Parcial (con saldo pendiente)", no "(con abonos)"', async () => {
    await armar();

    const selects = fixture.nativeElement.querySelectorAll('mat-select');
    const estado = selects[1] as HTMLElement;
    (estado.querySelector('.mat-mdc-select-trigger') as HTMLElement).click();
    await refrescar();

    const opciones = Array.from(document.querySelectorAll('mat-option')).map((o) =>
      comoSeLee(o.textContent),
    );
    expect(opciones).toContain('Parcial (con saldo pendiente)');
    expect(opciones.join(' ')).not.toContain('abono');
  });

  it('la marca "por pagar" dice "Ya se le abonó" solo donde hubo abono', async () => {
    await armar();
    const pagina = fixture.componentInstance;

    expect(pagina.tooltipPorPagar(PARCIAL_SIN_ABONO)).toBe(
      'En firme y con saldo pendiente de pago, sin ningún abono registrado todavía',
    );
    expect(pagina.tooltipPorPagar(PARCIAL_CON_ABONO)).toBe(
      'Ya se le abonó una parte; esto es lo que todavía se le debe',
    );
    expect(pagina.tooltipPorPagar(APROBADA)).toBe(
      'Liquidación aprobada con saldo pendiente de pago',
    );
    // Y es lo que lleva cada marca de la tabla, en el orden de las filas.
    const marcas = fixture.debugElement.queryAll(By.css('.badge-por-pagar'));
    expect(marcas.length).toBe(3);
    expect(marcas.map((m) => m.injector.get(MatTooltip).message)).toEqual([
      'En firme y con saldo pendiente de pago, sin ningún abono registrado todavía',
      'Ya se le abonó una parte; esto es lo que todavía se le debe',
      'Liquidación aprobada con saldo pendiente de pago',
    ]);
  });

  it('con `con_abonos` del servidor manda él, aunque la lista de pagos venga vacía', async () => {
    await armar();

    expect(
      fixture.componentInstance.tooltipPorPagar({ ...PARCIAL_SIN_ABONO, con_abonos: true }),
    ).toBe('Ya se le abonó una parte; esto es lo que todavía se le debe');
  });

  // ---------------------------------------------------------- los totales que no llegan
  it('si el resumen falla: sin tarjetas, con el aviso, y la tabla se ve', async () => {
    await armar((s) => (s.respuesta = () => throwError(() => new Error('422'))));

    expect(tarjetas()).toEqual([]);
    expect(fixture.componentInstance.resumen()).toBeNull();
    expect(aviso()).not.toBeNull();
    // Un error que no es del servidor (aquí, uno suelto) no trae texto: el aviso dice que
    // no cargaron y lo que eso NO quiere decir, sin adivinar la causa.
    expect(comoSeLee(aviso()!.textContent)).toContain(
      'No se pudieron cargar los totales. Eso no quiere decir que no haya nada por pagar ni ' +
        'que nadie deba.',
    );
    expect(comoSeLee(aviso()!.textContent)).not.toContain('no alcanzó a llegar');
    // Ninguna cifra: ni un $0 que afirme que nadie debe.
    expect(comoSeLee(aviso()!.textContent)).not.toContain('$');
    expect(fixture.nativeElement.querySelectorAll('tr.mat-mdc-row').length).toBe(3);
  });

  it('el Reintentar del aviso vuelve a pedir los totales, y con ellos el aviso se va', async () => {
    let falla = true;
    await armar(
      (s) => (s.respuesta = () => (falla ? throwError(() => new Error('422')) : of(RESUMEN))),
    );
    const pedidosAntes = servidor.pedidosResumen.length;

    falla = false;
    (aviso()!.querySelector('button') as HTMLButtonElement).click();
    await refrescar();

    expect(servidor.pedidosResumen.length).toBe(pedidosAntes + 1);
    expect(aviso()).toBeNull();
    expect(tarjetas().some((t) => t.includes('Le quedaron debiendo'))).toBeTrue();
  });

  it('una cifra ilegible también lo avisa, sin pintar tarjetas', async () => {
    const sinLaDeuda: Partial<ResumenLiquidaciones> = { ...RESUMEN };
    delete sinLaDeuda.le_quedaron_debiendo;
    await armar((s) => (s.respuesta = () => of(sinLaDeuda as ResumenLiquidaciones)));

    expect(tarjetas()).toEqual([]);
    expect(aviso()).not.toBeNull();
  });

  it('si la lista también falló, queda solo su aviso: su Reintentar pide las dos cosas', async () => {
    await armar((s) => {
      s.listaFalla = true;
      s.respuesta = () => throwError(() => new Error('sin señal'));
    });

    expect(aviso()).toBeNull();
    expect(fixture.nativeElement.querySelector('.error-state')).not.toBeNull();
  });

  it('con los totales en su lugar no hay aviso', async () => {
    await armar();

    expect(aviso()).toBeNull();
    expect(tarjetas().length).toBeGreaterThan(0);
  });
});
