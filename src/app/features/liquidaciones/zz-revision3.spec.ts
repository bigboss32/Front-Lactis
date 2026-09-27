import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NEVER, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Anticipo, Liquidacion, LiquidacionDetalle } from '../../core/models';
import { AnticipoListPage } from './anticipo-list.page';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * zz REVISIÓN 3 — reproducciones de la tercera ronda (front). Cada `it` afirma LA VERDAD:
 * falla mientras el defecto exista y pasa cuando se arregle.
 */

const det = (id: string, fecha: string, litros: string, precio: string, valor: string): LiquidacionDetalle => ({
  id, fecha, litros, precio_litro: precio, valor, ruta_id: null, ruta_nombre: null, ruta_borrada: false,
});

const HENRI: Partial<Liquidacion> = {
  id: 'l-h', empresa_id: 'e-1', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
  tipo: 'proveedor', proveedor_id: 'p-1', proveedor_nombre: 'Henri Castaño',
  transportador_id: null, transportador_nombre: null,
  periodo_inicio: '2026-07-01', periodo_fin: '2026-07-15',
  total_litros: '90', precio_promedio: '2000', bonificaciones: '0', descuentos: '0',
  valor_transporte: '0', anticipos: '300000', saldo_anterior: '0', le_queda_debiendo: '0',
  observaciones: null, detalles: [det('d-1', '2026-07-03', '90', '2000', '180000')], pagos: [],
  deuda_borrada_por_la_migracion: '0.00',
};
const fila = (c: Partial<Liquidacion>): Liquidacion => ({ ...HENRI, ...c }) as Liquidacion;

/**
 * La v2 de una 'pagada' que sus anticipos cubrieron exacto ($180.000 contra $180.000),
 * corregida con un día de $50.000: 'parcial' con pagado $0 (`_estado_tras_corregir`).
 */
const PARCIAL_V2_SIN_PAGOS = fila({
  estado: 'parcial', estado_visible: 'parcial', version: 2, anticipos: '180000',
  valor_bruto: '230000', valor_total: '230000', neto_a_pagar: '50000',
  pagado: '0', saldo: '50000', pagos: [],
});

/**
 * La misma, a la que se le pagaron los $50.000 y se borró ese pago: `_estado_pago` la
 * devuelve a 'aprobada' (pagado $0) y sigue en su versión 2. `anular` la rebota por la
 * versión.
 */
const APROBADA_V2 = fila({ ...PARCIAL_V2_SIN_PAGOS, estado: 'aprobada', estado_visible: 'aprobada' });

/** Las dos marcas (la de zz-revision2): pagada v2, saldo −45.000 ya cobrado, borrada 120.000. */
const CON_LAS_DOS = fila({
  estado: 'pagada', estado_visible: 'pagada · quedó debiendo', version: 2,
  valor_bruto: '135000', valor_total: '135000', neto_a_pagar: '-165000',
  pagado: '-120000', saldo: '-45000', le_queda_debiendo: '45000',
  deuda_borrada_por_la_migracion: '120000.00',
  deuda_trasladada_a_id: 'l-sig',
  deuda_trasladada_a: {
    id: 'l-sig', periodo_inicio: '2026-07-16', periodo_fin: '2026-07-31',
    periodo_texto: '16/07/2026 al 31/07/2026',
  },
} as Partial<Liquidacion>);

/** La 'pagada' del Pagar de antes: $180.000 contra $300.000 de adelanto, y esa deuda ya se cobró. */
const PAGADA_COBRADA = fila({
  estado: 'pagada', estado_visible: 'pagada · quedó debiendo', version: 1,
  valor_bruto: '180000', valor_total: '180000', neto_a_pagar: '-120000',
  pagado: '0', saldo: '-120000', le_queda_debiendo: '120000',
  deuda_trasladada_a_id: 'l-sig',
  deuda_trasladada_a: {
    id: 'l-sig', periodo_inicio: '2026-07-16', periodo_fin: '2026-07-31',
    periodo_texto: '16/07/2026 al 31/07/2026',
  },
} as Partial<Liquidacion>);

/** PLAIN: la migrada tal cual. */
const PLAIN = fila({
  estado: 'pagada', estado_visible: 'pagada', version: 1,
  valor_bruto: '180000', valor_total: '180000', neto_a_pagar: '-120000',
  pagado: '-120000', saldo: '0', deuda_borrada_por_la_migracion: '120000.00',
});

/** UPWARD-UNPAID: corregida +200.000 antes del guardia, sin pagar: saldo 200.000, de verdad 80.000. */
const UPWARD_UNPAID = fila({
  estado: 'parcial', estado_visible: 'parcial', version: 2,
  valor_bruto: '380000', valor_total: '380000', neto_a_pagar: '80000',
  pagado: '-120000', saldo: '200000', deuda_borrada_por_la_migracion: '120000.00',
});

type Fixture = ComponentFixture<LiquidacionDetailDialog>;
const comoSeLee = (t: string | null | undefined): string =>
  (t ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const leido = (e: Element | null | undefined): string => comoSeLee(e?.textContent);

const abrir = async (item: Liquidacion): Promise<Fixture> => {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [LiquidacionDetailDialog, NoopAnimationsModule],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { item } },
      { provide: LiquidacionesService, useValue: { getById: () => NEVER, correcciones: () => of([]) } },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
      {
        provide: AuthService,
        useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(LiquidacionDetailDialog);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
};

const botones = (fixture: Fixture): HTMLButtonElement[] =>
  Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button')) as HTMLButtonElement[];

// -----------------------------------------------------------------------------------
describe('zz revisión 3 · A: el candado de Recalcular manda a anular la que Anular dice que no', () => {
  it('aprobada v2 sin deuda borrada: "anúlela y vuelva a generarla" junto a "no se puede anular"', async () => {
    const fixture = await abrir(APROBADA_V2);
    const c = fixture.componentInstance;
    const recalcular = comoSeLee(c.motivoNoRecalcular());
    const anular = comoSeLee(c.motivoNoAnular());
    console.log('[zz r3 A]', JSON.stringify({ recalcular, anular }));
    // Anular está bien trabado (el `anular` del backend rebota version > 1)...
    expect(c.puedeAnular()).toBeFalse();
    expect(anular).toContain('no se puede anular');
    // ...y el candado de Recalcular, visible en el cuerpo del diálogo, no puede mandar ahí.
    expect(recalcular).not.toContain('anúlela');
  });
});

// -----------------------------------------------------------------------------------
describe('zz revisión 3 · B: el candado de Recalcular afirma un abono que no existe', () => {
  it('parcial v2 con pagado $0 y sin pagos: "Ya se le abonó $ 0 … primero elimine el abono"', async () => {
    const fixture = await abrir(PARCIAL_V2_SIN_PAGOS);
    const texto = leido(fixture.nativeElement.querySelector('.ayuda-precio.con-candado span'));
    console.log('[zz r3 B]', texto);
    expect(fixture.nativeElement.querySelectorAll('.tabla-pagos').length).toBe(0);
    expect(texto).not.toContain('Ya se le abonó');
    expect(texto).not.toContain('elimine el abono');
  });

  it('la "pagada" del Pagar de antes, sin un peso entregado y con la deuda pendiente: "ya está pagado ($ 0)"', async () => {
    // `pagada_sin_que_saliera_un_peso` del backend: decir "ya se pagó" es falso (K4).
    const fixture = await abrir(
      fila({ ...PAGADA_COBRADA, deuda_trasladada_a_id: null, deuda_trasladada_a: null } as Partial<Liquidacion>),
    );
    const texto = leido(fixture.nativeElement.querySelector('.ayuda-precio.con-candado span'));
    console.log('[zz r3 B2]', texto);
    expect(texto).not.toContain('ya está pagado');
  });
});

// -----------------------------------------------------------------------------------
describe('zz revisión 3 · C: Recalcular manda a anular la otra liquidación, y después sigue sin poder', () => {
  for (const [nombre, liq] of [
    ['con las dos marcas (borrada + cobrada), el gemelo de G3', CON_LAS_DOS],
    ['pagada v1 cuya deuda ya se cobró', PAGADA_COBRADA],
  ] as const) {
    it(`${nombre}: "Anule primero esa liquidación … y vuelva a intentarlo" sobre una pagada`, async () => {
      const fixture = await abrir(liq);
      const texto = leido(fixture.nativeElement.querySelector('.ayuda-precio.con-candado span'));
      console.log('[zz r3 C]', nombre, texto);
      // Anulada la otra, esta sigue 'pagada': Recalcular solo trabaja sobre borradores.
      expect(texto).not.toContain('vuelva a intentarlo');
    });
  }
});

// -----------------------------------------------------------------------------------
describe('zz revisión 3 · D: el WhatsApp de la quincena por reparar le manda al tercero un saldo que no es', () => {
  const mensajeDe = async (liq: Liquidacion): Promise<string | null> => {
    const fixture = await abrir(liq);
    const boton = botones(fixture).find((b) => leido(b).includes('WhatsApp'));
    if (!boton) return null; // no ofrecerlo también es un arreglo
    const abierto = spyOn(window, 'open').and.returnValue(null);
    boton.click();
    const url = String(abierto.calls.mostRecent()?.args[0] ?? '');
    return decodeURIComponent(url.split('?text=')[1] ?? '');
  };

  it('UPWARD-UNPAID: "Saldo a pagar: $ 200.000" cuando lo que de verdad falta son $ 80.000', async () => {
    const texto = await mensajeDe(UPWARD_UNPAID);
    console.log('[zz r3 D upward]', texto);
    if (texto === null) return;
    // "$ 80.000" como cifra propia, no el final de "$ 380.000".
    expect(texto).toMatch(/\$\s80\.000/);
  });

  it('PLAIN: "Deuda borrada por la migración: + $ 120.000 / Saldo a pagar: $ 0" — Henri debe $ 120.000', async () => {
    const texto = await mensajeDe(PLAIN);
    console.log('[zz r3 D plain]', texto);
    if (texto === null) return;
    expect(texto).toMatch(/debe[^\n]*\$\s120\.000/);
  });
});

// -----------------------------------------------------------------------------------
describe('zz revisión 3 · E: el candado del anticipo sin aviso afirma que no hay pagos', () => {
  it('aprobada con la deuda borrada y un pago de $50.000 encima (Mas-Cincuenta), respuesta vieja', () => {
    const anticipo = {
      id: 'a-1', empresa_id: 'e-1', estado: 'activo',
      created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
      tipo: 'proveedor', proveedor_id: 'p-1', transportador_id: null, empleado_id: null,
      proveedor_nombre: 'Henri', tercero_nombre: 'Henri', fecha: '2026-07-02', valor: '300000',
      observaciones: null, liquidacion_id: 'l-h', pago_empleado_id: null, aplicado: true,
      liquidacion_estado: 'aprobada', bloqueado: true,
    } as unknown as Anticipo;
    const texto = AnticipoListPage.prototype.motivoDelCandado(anticipo);
    console.log('[zz r3 E]', texto);
    // Una 'aprobada' SÍ puede tener pagos: es justo la de la deuda borrada con un abono.
    expect(texto).not.toContain('no tiene ningún pago');
  });
});
