import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion } from '../../core/models';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * LA DEUDA DE ESTA QUINCENA YA SE COBRÓ EN OTRA: lo que la pantalla ofrece y lo que dice.
 *
 * Tres cosas, con las cifras del dueño:
 *
 *  · BORRAR EL PAGO. Henri, Q1 01–15/06: 250 L × $2.000 = $500.000, pagada con un pago de
 *    $500.000 y corregida a $1.600 ($400.000, debe $100.000). La Q2 16–30/06 ya le cobró
 *    esos $100.000. La papelera del pago salía, y borrarlo dejaba la Q1 en "parcial ·
 *    $400.000 por pagar" con la Q2 todavía descontando: pagadas las dos, la leche sumaba
 *    $700.000 y la plata $600.000. El servidor ya no lo deja; la pantalla no lo ofrece.
 *  · EL PORQUÉ LO ESCRIBE EL SERVIDOR (`avisos_deuda_cobrada`), uno por acción: "Anule
 *    primero esa liquidación" no siempre es la salida, y esa pregunta mira la OTRA
 *    quincena, que esta pantalla no tiene. Se pinta tal cual.
 *  · EL LÁPIZ DEL PRECIO en el borrador cuya deuda ya se cobró: el PUT rebotaba siempre.
 */

type Fixture = ComponentFixture<LiquidacionDetailDialog>;

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const leido = (elemento: Element | null | undefined): string => comoSeLee(elemento?.textContent);

/** La Q2 que se cobró la deuda, como la manda el servidor. */
const COBRADA_EN_LA_Q2: Partial<Liquidacion> = {
  deuda_trasladada_a_id: 'l-q2',
  deuda_trasladada_a: {
    id: 'l-q2',
    periodo_inicio: '2026-06-16',
    periodo_fin: '2026-06-30',
    periodo_texto: '16/06/2026 al 30/06/2026',
  },
};

const henri = (cifras: Partial<Liquidacion> = {}): Liquidacion => ({
  id: 'l-q1',
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
  total_litros: '250',
  precio_promedio: '2000',
  valor_bruto: '500000',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '0',
  anticipos: '0',
  valor_total: '500000',
  neto_a_pagar: '500000',
  pagado: '0',
  saldo: '500000',
  le_queda_debiendo: '0',
  observaciones: null,
  detalles: [
    { id: 'd-1', fecha: '2026-06-03', litros: '250', precio_litro: '2000', valor: '500000' },
  ],
  pagos: [],
  ...cifras,
});

/** La Q1 de Henri corregida a $1.600 después de pagada: se le pagó de más $100.000. */
const Q1_CORREGIDA_A_LA_BAJA: Partial<Liquidacion> = {
  estado: 'pagada',
  estado_visible: 'pagada · quedó debiendo',
  version: 2,
  precio_promedio: '1600',
  valor_bruto: '400000',
  valor_total: '400000',
  neto_a_pagar: '400000',
  pagado: '500000',
  saldo: '-100000',
  le_queda_debiendo: '100000',
  pagos: [{ id: 'p-1', fecha: '2026-06-16', valor: '500000', observaciones: null }],
};

/** Henri, borrador: 100 L × $1.800 = $180.000 contra $300.000 de adelanto, debe $120.000. */
const Q1_BORRADOR_QUE_DEBE: Partial<Liquidacion> = {
  estado: 'borrador',
  estado_visible: 'borrador',
  total_litros: '100',
  precio_promedio: '1800',
  valor_bruto: '180000',
  valor_total: '180000',
  anticipos: '300000',
  neto_a_pagar: '-120000',
  saldo: '-120000',
  le_queda_debiendo: '120000',
  detalles: [
    { id: 'd-1', fecha: '2026-06-02', litros: '100', precio_litro: '1800', valor: '180000' },
  ],
};

const ADMINISTRADOR = [
  'liquidaciones:consultar',
  'liquidaciones:crear',
  'liquidaciones:editar',
  'liquidaciones:administrar',
  'liquidaciones:eliminar',
  'liquidaciones:imprimir',
  'liquidaciones:exportar',
];

class ServidorFalso {
  readonly porId = new Subject<Liquidacion>();
  readonly preciosPedidos: number[] = [];

  getById(): Observable<Liquidacion> {
    return this.porId;
  }

  correcciones(): Observable<[]> {
    return of([]);
  }

  actualizarPrecioDetalle(_id: string, _detalle: string, precio: number): Observable<Liquidacion> {
    this.preciosPedidos.push(precio);
    return of(henri(Q1_BORRADOR_QUE_DEBE));
  }
}

let servidor: ServidorFalso;

const abrir = async (item: Liquidacion, permisos: string[] = ADMINISTRADOR): Promise<Fixture> => {
  TestBed.resetTestingModule();
  servidor = new ServidorFalso();
  const tiene = new Set(permisos);
  await TestBed.configureTestingModule({
    imports: [LiquidacionDetailDialog, NoopAnimationsModule],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { item } },
      { provide: LiquidacionesService, useValue: servidor },
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

/** Los iconos de la columna de acciones de la tabla de pagos: 'delete' o 'lock'. */
const accionesDelPago = (fixture: Fixture): string[] =>
  Array.from(
    fixture.nativeElement.querySelectorAll('.tabla-pagos td.col-acciones mat-icon'),
  ).map((icono) => leido(icono as Element));

const clipsDelPago = (fixture: Fixture): number =>
  fixture.nativeElement.querySelectorAll('.tabla-pagos td.col-soportes button').length;

const candadoDeLosPagos = (fixture: Fixture): string =>
  leido(fixture.nativeElement.querySelector('.candado-de-los-pagos span'));

const candadoEnElCuerpo = (fixture: Fixture): string =>
  leido(
    fixture.nativeElement.querySelector(
      '.ayuda-precio.con-candado:not(.candado-de-los-pagos) span',
    ),
  );

describe('LiquidacionDetailDialog: el pago de una quincena cuya deuda ya se cobró en otra', () => {
  it('no ofrece la papelera: queda el candado con el porqué que manda el servidor, tal cual', async () => {
    const delServidor =
      'No se puede eliminarle un pago a esta liquidación: lo que el tercero quedó debiendo ' +
      '($100.000) ya se le cobró en la liquidación del 16/06/2026 al 30/06/2026';
    const fixture = await abrir(
      henri({
        ...Q1_CORREGIDA_A_LA_BAJA,
        ...COBRADA_EN_LA_Q2,
        avisos_deuda_cobrada: { eliminar_pago: delServidor },
      }),
    );

    expect(accionesDelPago(fixture)).toEqual(['lock']);
    expect(fixture.componentInstance.motivoNoEliminarPago()).toBe(delServidor);
    // Escrito y no solo en el tooltip: en la tablet no hay mouse que pase por encima.
    expect(candadoDeLosPagos(fixture)).toBe(delServidor);
    const candado = fixture.nativeElement.querySelector('.tabla-pagos mat-icon.candado-pago');
    expect(candado.getAttribute('aria-label')).toBe(delServidor);
    // El clip se queda: mirar el soporte del pago no mueve plata.
    expect(clipsDelPago(fixture)).toBe(1);
  });

  it('sin el texto del servidor (respuesta vieja) dice lo que es cierto, sin nombrar una salida', async () => {
    const fixture = await abrir(henri({ ...Q1_CORREGIDA_A_LA_BAJA, ...COBRADA_EN_LA_Q2 }));

    expect(accionesDelPago(fixture)).toEqual(['lock']);
    expect(comoSeLee(fixture.componentInstance.motivoNoEliminarPago())).toBe(
      'No se puede eliminar un pago de esta liquidación: lo que Henri Castaño quedó debiendo ' +
        '($ 100.000) ya se le cobró en la liquidación del 16/06/2026 al 30/06/2026. Borrar el ' +
        'pago le cambiaría el saldo a esta quincena sin cambiar el descuento que ya se hizo en ' +
        'esa otra, y las dos dejarían de cuadrar.',
    );
  });

  it('con la deuda todavía sin cobrar, la papelera sigue: ahí borrar el pago es legítimo', async () => {
    const fixture = await abrir(henri(Q1_CORREGIDA_A_LA_BAJA));

    expect(accionesDelPago(fixture)).toEqual(['delete']);
    expect(fixture.componentInstance.motivoNoEliminarPago()).toBeNull();
    expect(fixture.nativeElement.querySelector('.candado-de-los-pagos')).toBeNull();
  });

  it('quien no tiene el permiso de borrar pagos no ve ni la papelera ni el candado', async () => {
    const fixture = await abrir(
      henri({ ...Q1_CORREGIDA_A_LA_BAJA, ...COBRADA_EN_LA_Q2 }),
      ADMINISTRADOR.filter((p) => p !== 'liquidaciones:eliminar'),
    );

    expect(accionesDelPago(fixture)).toEqual([]);
    expect(fixture.nativeElement.querySelector('.candado-de-los-pagos')).toBeNull();
    expect(clipsDelPago(fixture)).toBe(1);
  });

  it('la fila que main ya dejó así (pago borrado, saldo $400.000) no dice "quedó debiendo ($ 0)"', async () => {
    // Q1 después del borrado: 'parcial', pagado $0, saldo $400.000, debe $0, y la marca
    // de la deuda cobrada todavía puesta. Corregir rebota por la deuda ya cobrada.
    const fixture = await abrir(
      henri({
        ...Q1_CORREGIDA_A_LA_BAJA,
        ...COBRADA_EN_LA_Q2,
        estado: 'parcial',
        estado_visible: 'parcial',
        pagado: '0',
        saldo: '400000',
        le_queda_debiendo: '0',
        pagos: [],
      }),
    );

    const motivo = comoSeLee(fixture.componentInstance.motivoNoCorregir());
    expect(motivo).not.toContain('($ 0)');
    expect(motivo).toBe(
      'No se puede corregir esta liquidación: la deuda que dejó esta quincena ya se le cobró ' +
        'en la liquidación del 16/06/2026 al 30/06/2026. Anule primero esa liquidación —así ' +
        'esta deuda vuelve a quedar libre— y vuelva a intentarlo.',
    );
  });
});

describe('LiquidacionDetailDialog: el porqué de la deuda cobrada lo escribe el servidor', () => {
  // S1 del dueño: la Q2 que cobró los $120.000 ya es una v2 corregida, que no se anula
  // nunca. "Anule primero esa liquidación" mandaba a un botón que el servidor rebota.
  const NO_SE_ANULA_LA_OTRA =
    'No se puede anular esta liquidación: lo que el tercero quedó debiendo ($120.000) ya se ' +
    'le cobró en la liquidación del 16/06/2026 al 30/06/2026. Esa liquidación ya tiene 2 ' +
    'comprobantes y no se puede anular: si una cifra está mala, regístrela en la quincena ' +
    'siguiente';

  it('Anular: el candado dice el texto del servidor, no el "Anule primero" de la pantalla', async () => {
    const fixture = await abrir(
      henri({
        ...Q1_BORRADOR_QUE_DEBE,
        estado: 'aprobada',
        estado_visible: 'pagada · quedó debiendo',
        ...COBRADA_EN_LA_Q2,
        avisos_deuda_cobrada: { anular: NO_SE_ANULA_LA_OTRA },
      }),
    );
    const c = fixture.componentInstance;

    expect(c.puedeAnular()).toBeFalse();
    expect(c.motivoNoAnular()).toBe(NO_SE_ANULA_LA_OTRA);
    const candado = Array.from(
      fixture.nativeElement.querySelectorAll('mat-dialog-actions .nota-recalcular'),
    ).find((nota) => leido(nota as Element).endsWith('No se puede anular'));
    expect(candado).toBeDefined();
  });

  it('Recalcular en el borrador: el candado del cuerpo es el del servidor, tal cual', async () => {
    const delServidor =
      'No se puede recalcular esta liquidación: lo que el tercero quedó debiendo ($120.000) ' +
      'ya se le cobró en la liquidación del 16/06/2026 al 30/06/2026. Esa liquidación ya ' +
      'tiene 2 comprobantes y no se puede anular, así que esta se queda como está';
    const fixture = await abrir(
      henri({
        ...Q1_BORRADOR_QUE_DEBE,
        ...COBRADA_EN_LA_Q2,
        avisos_deuda_cobrada: { recalcular: delServidor, anular: NO_SE_ANULA_LA_OTRA },
      }),
    );

    expect(fixture.componentInstance.motivoNoRecalcular()).toBe(delServidor);
    expect(candadoEnElCuerpo(fixture)).toBe(delServidor);
    expect(candadoEnElCuerpo(fixture)).not.toContain('Anule primero');
  });

  it('Recalcular en la aprobada: si el servidor manda su porqué, es ese el que sale', async () => {
    // Su `recalcular` pregunta la deuda cobrada ANTES que el estado: este es el 422 que
    // daría el botón.
    const delServidor =
      'No se puede recalcular esta liquidación: lo que el tercero quedó debiendo ($120.000) ' +
      'ya se le cobró en la liquidación del 16/06/2026 al 30/06/2026';
    const fixture = await abrir(
      henri({
        ...Q1_BORRADOR_QUE_DEBE,
        estado: 'aprobada',
        estado_visible: 'pagada · quedó debiendo',
        ...COBRADA_EN_LA_Q2,
        avisos_deuda_cobrada: { recalcular: delServidor },
      }),
    );

    expect(fixture.componentInstance.motivoNoRecalcular()).toBe(delServidor);
  });

  it('Corregir en la pagada: el candado es el del servidor, tal cual', async () => {
    const delServidor =
      'No se puede corregir esta liquidación: lo que el tercero quedó debiendo ($100.000) ya ' +
      'se le cobró en la liquidación del 16/06/2026 al 30/06/2026. Anule primero esa ' +
      'liquidación —así esta deuda vuelve a quedar libre— y vuelva a intentarlo';
    const fixture = await abrir(
      henri({
        ...Q1_CORREGIDA_A_LA_BAJA,
        ...COBRADA_EN_LA_Q2,
        avisos_deuda_cobrada: { corregir: delServidor },
      }),
    );

    expect(fixture.componentInstance.puedeCorregir()).toBeFalse();
    expect(fixture.componentInstance.motivoNoCorregir()).toBe(delServidor);
  });

  it('sin el campo (respuesta vieja) sale el texto de siempre, para el Administrador', async () => {
    const fixture = await abrir(
      henri({
        ...Q1_BORRADOR_QUE_DEBE,
        estado: 'aprobada',
        estado_visible: 'pagada · quedó debiendo',
        ...COBRADA_EN_LA_Q2,
      }),
    );

    expect(comoSeLee(fixture.componentInstance.motivoNoAnular())).toBe(
      'No se puede anular esta liquidación: lo que Henri Castaño quedó debiendo ($ 120.000) ' +
        'ya se le cobró en la liquidación del 16/06/2026 al 30/06/2026. Anule primero esa ' +
        'liquidación —así esta deuda vuelve a quedar libre— y vuelva a intentarlo.',
    );
  });
});

describe('LiquidacionDetailDialog: el lápiz del precio en el borrador cuya deuda ya se cobró', () => {
  it('no sale el lápiz ni "Toque el precio": el PUT rebotaba siempre; queda el candado de Recalcular', async () => {
    const fixture = await abrir(henri({ ...Q1_BORRADOR_QUE_DEBE, ...COBRADA_EN_LA_Q2 }));
    const c = fixture.componentInstance;

    expect(c.deudaYaCobrada()).toBeTrue();
    expect(c.puedeEditarPrecio()).toBeFalse();
    // La misma pregunta que Recalcular.
    expect(c.puedeEditarPrecio()).toBe(c.puedeRecalcular());
    expect(fixture.nativeElement.querySelector('.precio-editable')).toBeNull();
    expect(leido(fixture.nativeElement)).not.toContain('Toque el precio');
    expect(candadoEnElCuerpo(fixture)).toContain(
      'ya se le cobró en la liquidación del 16/06/2026',
    );
  });

  it('el mismo borrador ANTES de que se cobre la deuda sí ofrece el lápiz: ahí el PUT pasa', async () => {
    const fixture = await abrir(henri(Q1_BORRADOR_QUE_DEBE));

    expect(fixture.componentInstance.puedeEditarPrecio()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.precio-editable')).not.toBeNull();
    expect(leido(fixture.nativeElement)).toContain('Toque el precio');
  });

  it('si con el campo abierto llega la recarga con la deuda ya cobrada, no manda el PUT', async () => {
    const fixture = await abrir(henri(Q1_BORRADOR_QUE_DEBE));
    const c = fixture.componentInstance;
    const dia = c.liq().detalles[0];

    c.editarPrecio(dia);
    c.alEscribirPrecio('2000');
    servidor.porId.next(henri({ ...Q1_BORRADOR_QUE_DEBE, ...COBRADA_EN_LA_Q2 }));
    await fixture.whenStable();
    await c.guardarPrecio(dia);

    expect(servidor.preciosPedidos).toEqual([]);
    expect(c.editandoId()).toBeNull();
  });
});
