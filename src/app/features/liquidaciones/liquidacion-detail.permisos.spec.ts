import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion } from '../../core/models';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * LOS CONSEJOS QUE NOMBRAN ANULAR O ELIMINAR EL ABONO, CON EL PERMISO DE QUIEN MIRA.
 *
 * Compras tiene 'editar' y no 'administrar' ni 'eliminar' (seed: consultar, crear,
 * editar, exportar, imprimir). Ve el candado de Recalcular, y ahí le decían "anúlela y
 * vuelva a generarla" o "primero elimine el abono": el botón Anular no le sale, la
 * papelera tampoco, y el servidor le contesta 403. El consejo tiene que decirle a quién
 * pedírselo. Lo que ve el Administrador no cambia.
 */

type Fixture = ComponentFixture<LiquidacionDetailDialog>;

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const leido = (elemento: Element | null | undefined): string => comoSeLee(elemento?.textContent);

const COMPRAS = [
  'liquidaciones:consultar',
  'liquidaciones:crear',
  'liquidaciones:editar',
  'liquidaciones:exportar',
  'liquidaciones:imprimir',
];
const ADMINISTRADOR = [...COMPRAS, 'liquidaciones:administrar', 'liquidaciones:eliminar'];

const quincena = (cifras: Partial<Liquidacion> = {}): Liquidacion => ({
  id: 'l-1',
  empresa_id: 'e-1',
  estado: 'aprobada',
  estado_visible: 'aprobada',
  created_at: '2026-07-16T00:00:00Z',
  updated_at: '2026-07-16T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Pedro Osorio',
  transportador_id: null,
  transportador_nombre: null,
  periodo_inicio: '2026-07-01',
  periodo_fin: '2026-07-15',
  total_litros: '90',
  precio_promedio: '2000',
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
  detalles: [
    { id: 'd-1', fecha: '2026-07-03', litros: '90', precio_litro: '2000', valor: '180000' },
  ],
  pagos: [],
  ...cifras,
});

/** $500.000 de leche contra $700.000 de adelanto: debe $200.000 y el chip dice pagada. */
const PAGADA_QUEDO_DEBIENDO: Partial<Liquidacion> = {
  estado_visible: 'pagada · quedó debiendo',
  total_litros: '250',
  valor_bruto: '500000',
  valor_total: '500000',
  anticipos: '700000',
  neto_a_pagar: '-200000',
  saldo: '-200000',
  le_queda_debiendo: '200000',
};

/** La Q2 de Henri: $120.000 de leche contra los $120.000 que dejó debiendo la Q1. */
const EN_CERO_POR_LA_DEUDA_VIEJA: Partial<Liquidacion> = {
  proveedor_nombre: 'Henri Castaño',
  total_litros: '60',
  valor_bruto: '120000',
  valor_total: '120000',
  saldo_anterior: '120000',
  neto_a_pagar: '0',
  saldo: '0',
};

/** $180.000 con un abono de $30.000: quedan $150.000. */
const PARCIAL_CON_UN_ABONO: Partial<Liquidacion> = {
  estado: 'parcial',
  estado_visible: 'parcial',
  pagado: '30000',
  saldo: '150000',
  pagos: [{ id: 'p-1', fecha: '2026-07-20', valor: '30000', observaciones: null }],
};

/** Henri, borrador: $180.000 contra $300.000, y la del 16/07 ya le cobró los $120.000. */
const BORRADOR_CON_LA_DEUDA_COBRADA: Partial<Liquidacion> = {
  estado: 'borrador',
  estado_visible: 'borrador',
  proveedor_nombre: 'Henri Castaño',
  anticipos: '300000',
  neto_a_pagar: '-120000',
  saldo: '-120000',
  le_queda_debiendo: '120000',
  deuda_trasladada_a_id: 'l-q2',
  deuda_trasladada_a: {
    id: 'l-q2',
    periodo_inicio: '2026-07-16',
    periodo_fin: '2026-07-31',
    periodo_texto: '16/07/2026 al 31/07/2026',
  },
};

class ServidorFalso {
  readonly porId = new Subject<Liquidacion>();
  getById(): Observable<Liquidacion> {
    return this.porId;
  }
}

const abrir = async (item: Liquidacion, permisos: string[]): Promise<Fixture> => {
  TestBed.resetTestingModule();
  const tiene = new Set(permisos);
  await TestBed.configureTestingModule({
    imports: [LiquidacionDetailDialog, NoopAnimationsModule],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { item } },
      { provide: LiquidacionesService, useValue: new ServidorFalso() },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
      {
        provide: AuthService,
        useValue: {
          hasPermission: (modulo: string, accion = 'consultar') => tiene.has(`${modulo}:${accion}`),
          perfil: () => null,
          esSuperadmin: () => false,
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(LiquidacionDetailDialog);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
};

const botonesDe = (fixture: Fixture): string[] =>
  Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button'))
    .map((boton) => leido(boton as Element))
    .filter((texto) => texto !== '');

const candadoEnElCuerpo = (fixture: Fixture): string =>
  leido(fixture.nativeElement.querySelector('.ayuda-precio.con-candado span'));

const papeleras = (fixture: Fixture): number =>
  Array.from(fixture.nativeElement.querySelectorAll('.tabla-pagos mat-icon')).filter(
    (icono) => leido(icono as Element) === 'delete',
  ).length;

describe('LiquidacionDetailDialog: a Compras no se le manda a un botón que no tiene', () => {
  it('aprobada de $180.000: "pídale a un Administrador…", no "anúlela"', async () => {
    const fixture = await abrir(quincena(), COMPRAS);

    expect(fixture.componentInstance.puedeAnular()).toBeFalse();
    expect(botonesDe(fixture).some((b) => b.endsWith('Anular'))).toBeFalse();
    expect(candadoEnElCuerpo(fixture)).toBe(
      'Está aprobada y Recalcular solo trabaja sobre borradores. Si sus cifras quedaron mal ' +
        '—por ejemplo una tarifa que se corrigió después—, pídale a un Administrador de la ' +
        'empresa que la anule y la vuelva a generar: todavía no se le ha pagado nada.',
    );
    expect(candadoEnElCuerpo(fixture)).not.toContain('anúlela');
  });

  it('"pagada · quedó debiendo" ($500.000 contra $700.000): tampoco "anúlela"', async () => {
    const fixture = await abrir(quincena(PAGADA_QUEDO_DEBIENDO), COMPRAS);

    expect(candadoEnElCuerpo(fixture)).toBe(
      'No hay nada que entregarle: Pedro Osorio quedó debiendo $ 200.000. Sus cifras están en ' +
        'firme y Recalcular solo trabaja sobre borradores. Si quedaron mal —por ejemplo una ' +
        'tarifa que se corrigió después—, pídale a un Administrador de la empresa que la anule ' +
        'y la vuelva a generar: esa deuda todavía no se le ha cobrado en otra quincena.',
    );
  });

  it('en cero por la deuda vieja ($120.000 contra $120.000): tampoco "anúlela"', async () => {
    const fixture = await abrir(quincena(EN_CERO_POR_LA_DEUDA_VIEJA), COMPRAS);

    expect(candadoEnElCuerpo(fixture)).toBe(
      'No hay nada que entregarle a Henri Castaño: con lo que venía debiendo de antes, el ' +
        'saldo quedó en $ 0. Sus cifras están en firme y Recalcular solo trabaja sobre ' +
        'borradores. Si quedaron mal —por ejemplo una tarifa que se corrigió después—, pídale ' +
        'a un Administrador de la empresa que la anule y la vuelva a generar: al anularla, lo ' +
        'que venía debiendo vuelve a quedar pendiente.',
    );
  });

  it('parcial con un abono de $30.000: "pídale… que elimine primero ese pago", y no hay papelera', async () => {
    const fixture = await abrir(quincena(PARCIAL_CON_UN_ABONO), COMPRAS);

    expect(papeleras(fixture)).toBe(0);
    expect(candadoEnElCuerpo(fixture)).toBe(
      'Ya se le abonó $ 30.000 contra estas cifras: quedan en firme y no se pueden ' +
        'recalcular. Si sus cifras quedaron mal, pídale a un Administrador de la empresa que ' +
        "use 'Corregir esta quincena', que conserva el pago y sus soportes, o registre el " +
        'ajuste en la quincena siguiente. Si de verdad hay que rehacerlas, pídale a un ' +
        'Administrador de la empresa que elimine primero ese pago: con él se van sus ' +
        'soportes, que no se recuperan.',
    );
  });

  it('borrador con la deuda ya cobrada (respuesta vieja): "pídale… que anule primero esa liquidación"', async () => {
    const fixture = await abrir(quincena(BORRADOR_CON_LA_DEUDA_COBRADA), COMPRAS);

    expect(candadoEnElCuerpo(fixture)).toBe(
      'No se puede recalcular esta liquidación: lo que Henri Castaño quedó debiendo ' +
        '($ 120.000) ya se le cobró en la liquidación del 16/07/2026 al 31/07/2026. Pídale a ' +
        'un Administrador de la empresa que anule primero esa liquidación —así esta deuda ' +
        'vuelve a quedar libre— y vuelva a intentarlo.',
    );
  });
});

describe('LiquidacionDetailDialog: al Administrador se le sigue nombrando el botón', () => {
  it('aprobada de $180.000: "anúlela", y el botón Anular está', async () => {
    const fixture = await abrir(quincena(), ADMINISTRADOR);

    expect(candadoEnElCuerpo(fixture)).toBe(
      'Está aprobada y Recalcular solo trabaja sobre borradores. Si sus cifras quedaron mal ' +
        '—por ejemplo una tarifa que se corrigió después—, anúlela y vuelva a generarla: ' +
        'todavía no se le ha pagado nada.',
    );
    expect(botonesDe(fixture).some((b) => b.endsWith('Anular'))).toBeTrue();
  });

  it('parcial con un abono: "Elimine primero ese pago", y la papelera está', async () => {
    const fixture = await abrir(quincena(PARCIAL_CON_UN_ABONO), ADMINISTRADOR);

    expect(papeleras(fixture)).toBe(1);
    expect(candadoEnElCuerpo(fixture)).toBe(
      'Ya se le abonó $ 30.000 contra estas cifras: quedan en firme y no se pueden ' +
        "recalcular. Si sus cifras quedaron mal, use 'Corregir esta quincena', que conserva " +
        'el pago y sus soportes, o registre el ajuste en la quincena siguiente. Elimine ' +
        'primero ese pago solo si de verdad hay que rehacerlas: con él se van sus soportes, ' +
        'que no se recuperan.',
    );
  });

  it('borrador con la deuda ya cobrada: "Anule primero esa liquidación"', async () => {
    const fixture = await abrir(quincena(BORRADOR_CON_LA_DEUDA_COBRADA), ADMINISTRADOR);

    expect(candadoEnElCuerpo(fixture)).toContain(
      'Anule primero esa liquidación —así esta deuda vuelve a quedar libre— y vuelva a intentarlo.',
    );
  });
});
