import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion } from '../../core/models';
import { conAbonos } from './cifras-de-la-quincena';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * LO QUE LA PANTALLA DICE DE UNA PLATA QUE NO SALIÓ.
 *
 * Tres familias de quincenas en las que el estado guardado afirma algo que las cifras no:
 *
 *  · la 'parcial' SIN UN SOLO ABONO: la que sus anticipos cubrían exacto ($180.000 contra
 *    $180.000), corregida con un día olvidado de 20 L, queda 'parcial' v2 con pagado $0 y
 *    $36.000 por entregar. "Se le abonó una parte" y "Registrar otro pago" mandaban a
 *    buscar un abono que no existe;
 *  · la 'aprobada' que SUS PROPIOS ANTICIPOS dejaron en cero: "todavía no se le ha pagado
 *    nada" al lado de "los anticipos cubren EXACTO" y de "Marcar pagada";
 *  · la 'pagada' que se cerró SIN NINGÚN PAGO porque la deuda vieja se llevó el neto: "El
 *    pago quedó registrado" sobre una tabla de pagos vacía, mientras el día de esa
 *    quincena en Recepción dice que quedó pagada sin que saliera un peso.
 */

type Fixture = ComponentFixture<LiquidacionDetailDialog>;

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const leido = (elemento: Element | null | undefined): string => comoSeLee(elemento?.textContent);

const henri = (cifras: Partial<Liquidacion> = {}): Liquidacion => ({
  id: 'l-1',
  empresa_id: 'e-1',
  estado: 'aprobada',
  estado_visible: 'aprobada',
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
  detalles: [
    { id: 'd-1', fecha: '2026-06-02', litros: '100', precio_litro: '1800', valor: '180000' },
  ],
  pagos: [],
  ...cifras,
});

/** Camino A: $180.000 cubiertos por un adelanto de $180.000, más un día olvidado de 20 L. */
const PARCIAL_V2_DEL_ANTICIPO_EXACTO: Partial<Liquidacion> = {
  estado: 'parcial',
  estado_visible: 'parcial',
  version: 2,
  total_litros: '120',
  valor_bruto: '216000',
  valor_total: '216000',
  anticipos: '180000',
  neto_a_pagar: '36000',
  pagado: '0',
  saldo: '36000',
  pagos: [],
};

/** Camino C: sin anticipos, se pagó, se corrigió con el día de 20 L y se borró el pago. */
const PARCIAL_V2_CON_EL_PAGO_BORRADO: Partial<Liquidacion> = {
  ...PARCIAL_V2_DEL_ANTICIPO_EXACTO,
  anticipos: '0',
  neto_a_pagar: '216000',
  saldo: '216000',
};

const TODOS_LOS_PERMISOS = () => true;

class ServidorFalso {
  readonly porId = new Subject<Liquidacion>();
  getById(): Observable<Liquidacion> {
    return this.porId;
  }
  correcciones(): Observable<[]> {
    return of([]);
  }
}

const abrir = async (item: Liquidacion): Promise<Fixture> => {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [LiquidacionDetailDialog, NoopAnimationsModule],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { item } },
      { provide: LiquidacionesService, useValue: new ServidorFalso() },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
      {
        provide: AuthService,
        useValue: {
          hasPermission: TODOS_LOS_PERMISOS,
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

/** La ayuda de la línea de estados, como se lee arriba del detalle. */
const ayudaDeArriba = (fixture: Fixture): string =>
  leido(fixture.nativeElement.querySelector('app-liquidacion-estado-stepper .ayuda'));

const botonesDe = (fixture: Fixture): string[] =>
  Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button'))
    .map((boton) => leido(boton as Element))
    .filter((texto) => texto !== '');

describe('conAbonos: ¿salió plata por pagos contra esta quincena?', () => {
  const base = { pagos: [], pagado: '0', deuda_borrada_por_la_migracion: '0' };
  const unPago = [{ id: 'p-1', fecha: '2026-06-20', valor: '30000', observaciones: null }];

  it('manda el servidor cuando trae la respuesta', () => {
    expect(conAbonos({ ...base, con_abonos: false, pagos: unPago, pagado: '30000' })).toBeFalse();
    expect(conAbonos({ ...base, con_abonos: true })).toBeTrue();
  });

  it('respuesta vieja: con pagos en la lista sí; la parcial v2 sin pagos ni pagado, no', () => {
    expect(conAbonos({ ...base, pagos: unPago, pagado: '30000' })).toBeTrue();
    expect(conAbonos(base)).toBeFalse();
  });

  it('respuesta vieja: la pagada de antes de los pagos parciales ($300.000 sin registros) sí salió', () => {
    expect(conAbonos({ ...base, pagado: '300000' })).toBeTrue();
  });

  it('respuesta vieja: con la deuda borrada, `pagado` lleva esa deuda y no dice nada de lo entregado', () => {
    const borrada = { ...base, deuda_borrada_por_la_migracion: '120000' };
    expect(conAbonos({ ...borrada, pagado: '-120000' })).toBeFalse();
    expect(conAbonos({ ...borrada, pagado: '50000' })).toBeFalse();
  });
});

describe('LiquidacionDetailDialog: la parcial sin un solo abono no dice "abonó"', () => {
  it('camino A ($36.000 por entregar): la ayuda no afirma un abono, y Pagar sigue', async () => {
    const fixture = await abrir(henri(PARCIAL_V2_DEL_ANTICIPO_EXACTO));
    const c = fixture.componentInstance;

    expect(ayudaDeArriba(fixture)).toBe(
      'Se corrigió y quedó un saldo por entregar, sin ningún abono registrado: usa "Pagar" ' +
        'cuando entregues el dinero.',
    );
    expect(ayudaDeArriba(fixture)).not.toContain('abonó');
    // El servidor acepta ese pago: esconder el botón sería un defecto nuevo.
    expect(c.puedePagar()).toBeTrue();
    expect(botonesDe(fixture).some((b) => b.endsWith('Pagar'))).toBeTrue();
    expect(comoSeLee(c.tooltipPagar())).toBe('Registrar un pago: queda debiendo $ 36.000');
  });

  it('camino C ($216.000 por entregar, el pago se borró): lo mismo', async () => {
    const fixture = await abrir(henri(PARCIAL_V2_CON_EL_PAGO_BORRADO));

    expect(ayudaDeArriba(fixture)).not.toContain('abonó');
    expect(comoSeLee(fixture.componentInstance.tooltipPagar())).toBe(
      'Registrar un pago: queda debiendo $ 216.000',
    );
    expect(fixture.componentInstance.tooltipPagar()).not.toContain('otro pago');
  });

  it('con `con_abonos` del servidor en falso, tampoco: aunque llegue un pagado viejo', async () => {
    const fixture = await abrir(
      henri({ ...PARCIAL_V2_DEL_ANTICIPO_EXACTO, con_abonos: false }),
    );

    expect(ayudaDeArriba(fixture)).not.toContain('abonó');
  });

  it('la parcial con un abono de verdad ($30.000 de $180.000) sí lo dice', async () => {
    const fixture = await abrir(
      henri({
        estado: 'parcial',
        estado_visible: 'parcial',
        pagado: '30000',
        saldo: '150000',
        pagos: [{ id: 'p-1', fecha: '2026-06-20', valor: '30000', observaciones: null }],
      }),
    );

    expect(ayudaDeArriba(fixture)).toBe(
      'Se le abonó una parte y todavía queda debiendo: usa "Pagar" para el resto.',
    );
    expect(comoSeLee(fixture.componentInstance.tooltipPagar())).toBe(
      'Registrar otro pago: queda debiendo $ 150.000',
    );
  });

  it('la pagada de antes de los pagos parciales, corregida hacia arriba: ahí la plata sí salió', async () => {
    // $400.000 − $100.000 de anticipo, con $300.000 entregados sin registros de pago, y
    // un día olvidado de $50.000: queda 'parcial' con $50.000 por entregar.
    const fixture = await abrir(
      henri({
        estado: 'parcial',
        estado_visible: 'parcial',
        version: 2,
        valor_bruto: '450000',
        valor_total: '450000',
        anticipos: '100000',
        neto_a_pagar: '350000',
        pagado: '300000',
        saldo: '50000',
        pagos: [],
      }),
    );

    expect(ayudaDeArriba(fixture)).toContain('Se le abonó una parte');
    expect(fixture.componentInstance.tooltipPagar()).toContain('Registrar otro pago');
  });
});

describe('LiquidacionDetailDialog: la aprobada que sus anticipos dejaron en cero', () => {
  it('$180.000 contra un adelanto de $180.000: no dice "todavía no se le ha pagado nada"', async () => {
    const fixture = await abrir(
      henri({ anticipos: '180000', neto_a_pagar: '0', saldo: '0' }),
    );
    const motivo = comoSeLee(fixture.componentInstance.motivoNoRecalcular());

    expect(motivo).toBe(
      'No hay nada que entregarle a Henri Castaño: los anticipos aplicados ($ 180.000) cubren ' +
        'EXACTO el valor total de la quincena ($ 180.000), así que el saldo quedó en $ 0. Sus ' +
        'cifras están en firme y Recalcular solo trabaja sobre borradores. Si quedaron mal ' +
        '—por ejemplo una tarifa que se corrigió después—, anúlela y vuelva a generarla: al ' +
        'anularla, sus anticipos vuelven a quedar pendientes.',
    );
    expect(motivo).not.toContain('no se le ha pagado nada');
    // La salida que nombra existe, y el botón que cierra la quincena también.
    expect(botonesDe(fixture).some((b) => b.endsWith('Anular'))).toBeTrue();
    expect(botonesDe(fixture).some((b) => b.endsWith('Marcar pagada'))).toBeTrue();
  });

  it('$300.000 adelantados de $500.000: "no tiene pagos registrados", no "no se le ha pagado nada"', async () => {
    const fixture = await abrir(
      henri({
        total_litros: '250',
        valor_bruto: '500000',
        valor_total: '500000',
        anticipos: '300000',
        neto_a_pagar: '200000',
        saldo: '200000',
      }),
    );

    expect(comoSeLee(fixture.componentInstance.motivoNoRecalcular())).toBe(
      'Está aprobada y Recalcular solo trabaja sobre borradores. Si sus cifras quedaron mal ' +
        '—por ejemplo una tarifa que se corrigió después—, anúlela y vuelva a generarla: ' +
        'todavía no tiene pagos registrados, y al anularla sus anticipos ($ 300.000) vuelven a ' +
        'quedar pendientes.',
    );
  });
});

describe('LiquidacionDetailDialog: la pagada que se cerró sin ningún pago', () => {
  /**
   * La Q2 de Henri: vale $200.000, cobra los $120.000 de la Q1 y se le pagan los $80.000
   * del neto; se corrige el precio a $1.200 (valor $120.000) y se borra el pago.
   */
  const Q2_EN_CERO_POR_LA_DEUDA: Partial<Liquidacion> = {
    estado: 'pagada',
    estado_visible: 'pagada',
    version: 2,
    precio_promedio: '1200',
    valor_bruto: '120000',
    valor_total: '120000',
    saldo_anterior: '120000',
    neto_a_pagar: '0',
    pagado: '0',
    saldo: '0',
    pagos: [],
  };
  /** El mixto: $200.000 − $80.000 de adelanto − $120.000 de la deuda vieja. */
  const Q2_MIXTA: Partial<Liquidacion> = {
    ...Q2_EN_CERO_POR_LA_DEUDA,
    precio_promedio: '2000',
    valor_bruto: '200000',
    valor_total: '200000',
    anticipos: '80000',
  };

  it('la línea de estados dice la frase del servidor, no "El pago quedó registrado"', async () => {
    const delServidor =
      'Esta quincena quedó cerrada como pagada sin que saliera un peso, porque lo que Henri ' +
      'Castaño quedó debiendo de la quincena pasada ($120.000) se llevó el neto';
    const fixture = await abrir(
      henri({ ...Q2_EN_CERO_POR_LA_DEUDA, cerrada_sin_pago: delServidor }),
    );

    expect(ayudaDeArriba(fixture)).toBe(`${delServidor}.`);
    expect(ayudaDeArriba(fixture)).not.toContain('El pago quedó registrado');
  });

  it('el mixto, con la frase que nombra el adelanto: tal cual', async () => {
    const delServidor =
      'Esta quincena quedó cerrada como pagada sin ningún pago: los adelantos de esta quincena ' +
      '($80.000) y lo que quedó debiendo de la pasada ($120.000) cubrieron el valor ($200.000).';
    const fixture = await abrir(henri({ ...Q2_MIXTA, cerrada_sin_pago: delServidor }));

    expect(ayudaDeArriba(fixture)).toBe(delServidor);
  });

  it('respuesta vieja: nombra los renglones que hicieron el cero, sin afirmar un pago', async () => {
    const fixture = await abrir(henri(Q2_EN_CERO_POR_LA_DEUDA));

    expect(ayudaDeArriba(fixture)).toBe(
      'Quedó cerrada como pagada sin ningún pago registrado: lo que ya venía debiendo de antes ' +
        '($ 120.000) cubre EXACTO el valor total de la quincena ($ 120.000).',
    );
  });

  it('respuesta vieja, el mixto: el adelanto también va, porque ese sí salió en la mano', async () => {
    const fixture = await abrir(henri(Q2_MIXTA));

    expect(ayudaDeArriba(fixture)).toBe(
      'Quedó cerrada como pagada sin ningún pago registrado: los anticipos aplicados ' +
        '($ 80.000) y lo que ya venía debiendo de antes ($ 120.000) cubren EXACTO el valor ' +
        'total de la quincena ($ 200.000).',
    );
  });

  it('la pagada que sus anticipos cubrieron exacto sigue diciendo "El pago quedó registrado"', async () => {
    const cubierta: Partial<Liquidacion> = {
      estado: 'pagada',
      estado_visible: 'pagada',
      anticipos: '180000',
      neto_a_pagar: '0',
      pagado: '0',
      saldo: '0',
    };
    const conElCampo = await abrir(henri({ ...cubierta, cerrada_sin_pago: null }));
    expect(ayudaDeArriba(conElCampo)).toBe(
      'El pago quedó registrado; esta liquidación está completa.',
    );

    const sinElCampo = await abrir(henri(cubierta));
    expect(ayudaDeArriba(sinElCampo)).toBe(
      'El pago quedó registrado; esta liquidación está completa.',
    );
  });

  it('la pagada con su pago de verdad también', async () => {
    const fixture = await abrir(
      henri({
        estado: 'pagada',
        estado_visible: 'pagada',
        pagado: '180000',
        saldo: '0',
        pagos: [{ id: 'p-1', fecha: '2026-06-20', valor: '180000', observaciones: null }],
        cerrada_sin_pago: null,
      }),
    );

    expect(ayudaDeArriba(fixture)).toBe(
      'El pago quedó registrado; esta liquidación está completa.',
    );
  });
});
