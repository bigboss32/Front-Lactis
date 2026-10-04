import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion, PagoLiquidacion } from '../../core/models';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * EL CANDADO DE RECALCULAR SOBRE UNA QUINCENA CON ABONOS DICE LO MISMO QUE EL SERVIDOR.
 *
 * El caso medido: 100 L × $1.800 = $180.000, adelanto de $30.000 (neto $150.000) y dos
 * abonos, de $50.000 y de $20.000: pagado $70.000, saldo 150.000 − 70.000 = $80.000, en
 * 'parcial' v1. Al Administrador, el candado de Recalcular le decía "Si de verdad hay que
 * rehacerlas, primero elimine el abono." —en singular con dos abonos, sin nombrar Corregir
 * aunque el botón estaba al lado, y sin decir que los soportes se pierden— mientras el
 * candado del anticipo de esa MISMA quincena (texto del servidor, abajo) mandaba primero a
 * Corregir, que conserva los pagos y sus soportes. Borrar uno de los dos no destraba nada:
 * con el otro sigue 'parcial' y con el mismo candado; era un pago y sus fotos perdidos.
 *
 * Y siguiendo el consejo de Corregir (adelanto 30.000 → 20.000) el servidor devuelve la v2
 * con 180.000 − 20.000 − 70.000 = $90.000 por entregar y los dos pagos vivos.
 */

type Fixture = ComponentFixture<LiquidacionDetailDialog>;

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const leido = (elemento: Element | null | undefined): string => comoSeLee(elemento?.textContent);

const COMPRAS = [
  'liquidaciones:consultar',
  'liquidaciones:crear',
  'liquidaciones:editar',
  'liquidaciones:exportar',
  'liquidaciones:imprimir',
];
const ADMINISTRADOR = [...COMPRAS, 'liquidaciones:administrar', 'liquidaciones:eliminar'];

/**
 * El candado del anticipo de esta misma quincena, como lo escribe el servidor para el
 * Administrador (`_consejo_del_candado`, verificado contra el backend en la ronda 3).
 */
const ANTICIPO_DEL_SERVIDOR_ADMIN =
  'No se puede modificar ni eliminar este anticipo: la liquidación en la que se descontó ' +
  "ya tiene un pago registrado. Si la cifra está mala, use 'Corregir esta quincena', que " +
  'conserva los pagos y sus soportes, o registre el ajuste en la quincena siguiente. Elimine ' +
  'primero esos 2 pagos solo si de verdad hay que cambiarlo desde aquí: con ellos se van sus ' +
  'soportes, que no se recuperan';

/** Y para Compras, sin 'administrar' ni 'eliminar'. */
const ANTICIPO_DEL_SERVIDOR_COMPRAS =
  'No se puede modificar ni eliminar este anticipo: la liquidación en la que se descontó ' +
  'ya tiene un pago registrado. Si la cifra está mala, pídale a un Administrador de la ' +
  "empresa que use 'Corregir esta quincena', que conserva los pagos y sus soportes, o " +
  'registre el ajuste en la quincena siguiente. Si de verdad hay que cambiarlo desde aquí, ' +
  'pídale a un Administrador de la empresa que elimine primero esos 2 pagos: con ellos se ' +
  'van sus soportes, que no se recuperan';

const ABONO_DE_50: PagoLiquidacion = {
  id: 'p-1',
  fecha: '2026-07-18',
  valor: '50000',
  observaciones: null,
};
const ABONO_DE_20: PagoLiquidacion = {
  id: 'p-2',
  fecha: '2026-07-22',
  valor: '20000',
  observaciones: null,
};

/** 100 L × $1.800 = $180.000 − $30.000 de adelanto − $70.000 en dos abonos = $80.000. */
const quincena = (cifras: Partial<Liquidacion> = {}): Liquidacion => ({
  id: 'l-1',
  empresa_id: 'e-1',
  estado: 'parcial',
  estado_visible: 'parcial',
  created_at: '2026-07-16T00:00:00Z',
  updated_at: '2026-07-22T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Pedro Osorio',
  transportador_id: null,
  transportador_nombre: null,
  periodo_inicio: '2026-07-01',
  periodo_fin: '2026-07-15',
  total_litros: '100',
  precio_promedio: '1800',
  valor_bruto: '180000',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '0',
  anticipos: '30000',
  valor_total: '180000',
  neto_a_pagar: '150000',
  pagado: '70000',
  saldo: '80000',
  le_queda_debiendo: '0',
  version: 1,
  observaciones: null,
  detalles: [
    { id: 'd-1', fecha: '2026-07-03', litros: '100', precio_litro: '1800', valor: '180000' },
  ],
  pagos: [ABONO_DE_50, ABONO_DE_20],
  ...cifras,
});

/** El flete del mismo período: 100 L × $100 = $10.000, dos abonos de $3.000 y $2.000. */
const FLETE_CON_DOS_ABONOS: Partial<Liquidacion> = {
  tipo: 'transportador',
  proveedor_id: null,
  proveedor_nombre: null,
  transportador_id: 't-1',
  transportador_nombre: 'Beto Flete',
  precio_promedio: '100',
  valor_bruto: '10000',
  anticipos: '0',
  valor_total: '10000',
  neto_a_pagar: '10000',
  pagado: '5000',
  saldo: '5000',
  detalles: [
    { id: 'd-1', fecha: '2026-07-03', litros: '100', precio_litro: '100', valor: '10000' },
  ],
  pagos: [
    { ...ABONO_DE_50, valor: '3000' },
    { ...ABONO_DE_20, valor: '2000' },
  ],
};

class ServidorFalso {
  readonly porId = new Subject<Liquidacion>();
  getById(): Observable<Liquidacion> {
    return this.porId;
  }
  correcciones(): Observable<never[]> {
    return of([]);
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
      { provide: MatSnackBar, useValue: { open: () => undefined } },
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

/**
 * Los pedazos del consejo del servidor que la pantalla tiene que decir IGUAL y EN EL MISMO
 * ORDEN: la salida de Corregir, la de borrar los pagos y la advertencia de los soportes.
 * Lo único que cambia es lo que se quiere tocar ("cambiarlo" el anticipo, "rehacerlas" las
 * cifras), que queda por fuera de los pedazos.
 */
const enElMismoOrden = (texto: string, pedazos: string[]): void => {
  let desde = 0;
  for (const pedazo of pedazos) {
    const donde = texto.indexOf(pedazo, desde);
    expect(donde).withContext(`"${pedazo}" en "${texto}"`).toBeGreaterThanOrEqual(desde);
    desde = donde + pedazo.length;
  }
};

describe('LiquidacionDetailDialog: el candado de Recalcular con dos abonos dice lo del servidor', () => {
  it('al Administrador: Corregir primero, "esos 2 pagos" y que los soportes se pierden', async () => {
    const fixture = await abrir(quincena(), ADMINISTRADOR);
    const liq = fixture.componentInstance.liq();

    // La cuenta de la pantalla es la del papel.
    expect(Number(liq.valor_total) - Number(liq.anticipos) - Number(liq.pagado)).toBe(80000);
    expect(liq.pagos.reduce((total, pago) => total + Number(pago.valor), 0)).toBe(70000);

    const candado = candadoEnElCuerpo(fixture);
    expect(candado).toBe(
      'Ya se le abonó $ 70.000 contra estas cifras: quedan en firme y no se pueden ' +
        "recalcular. Si sus cifras quedaron mal, use 'Corregir esta quincena', que conserva " +
        'los pagos y sus soportes, o registre el ajuste en la quincena siguiente. Elimine ' +
        'primero esos 2 pagos solo si de verdad hay que rehacerlas: con ellos se van sus ' +
        'soportes, que no se recuperan.',
    );
    expect(comoSeLee(fixture.componentInstance.motivoNoRecalcular())).toBe(candado);
    expect(candado).not.toContain('el abono');

    enElMismoOrden(candado, [
      "use 'Corregir esta quincena', que conserva los pagos y sus soportes, o registre el " +
        'ajuste en la quincena siguiente. Elimine primero esos 2 pagos solo si de verdad hay que',
      ': con ellos se van sus soportes, que no se recuperan',
    ]);
    enElMismoOrden(ANTICIPO_DEL_SERVIDOR_ADMIN, [
      "use 'Corregir esta quincena', que conserva los pagos y sus soportes, o registre el " +
        'ajuste en la quincena siguiente. Elimine primero esos 2 pagos solo si de verdad hay que',
      ': con ellos se van sus soportes, que no se recuperan',
    ]);

    // Las dos salidas que nombra existen para quien mira: el botón Corregir (la misma
    // pregunta del consejo) y una papelera por cada pago.
    expect(fixture.componentInstance.puedeCorregir()).toBeTrue();
    expect(botonesDe(fixture).some((b) => b.includes('Corregir esta quincena'))).toBeTrue();
    expect(papeleras(fixture)).toBe(2);
  });

  it('a Compras: "pídale a un Administrador…" para las dos salidas, y no tiene ninguno de los botones', async () => {
    const fixture = await abrir(quincena(), COMPRAS);

    const candado = candadoEnElCuerpo(fixture);
    expect(candado).toBe(
      'Ya se le abonó $ 70.000 contra estas cifras: quedan en firme y no se pueden ' +
        'recalcular. Si sus cifras quedaron mal, pídale a un Administrador de la empresa que ' +
        "use 'Corregir esta quincena', que conserva los pagos y sus soportes, o registre el " +
        'ajuste en la quincena siguiente. Si de verdad hay que rehacerlas, pídale a un ' +
        'Administrador de la empresa que elimine primero esos 2 pagos: con ellos se van sus ' +
        'soportes, que no se recuperan.',
    );
    const pedazos = [
      "pídale a un Administrador de la empresa que use 'Corregir esta quincena', que conserva " +
        'los pagos y sus soportes, o registre el ajuste en la quincena siguiente.',
      'pídale a un Administrador de la empresa que elimine primero esos 2 pagos: con ellos se ' +
        'van sus soportes, que no se recuperan',
    ];
    enElMismoOrden(candado, pedazos);
    enElMismoOrden(ANTICIPO_DEL_SERVIDOR_COMPRAS, pedazos);

    expect(candado).not.toContain('Elimine primero');
    expect(candado).not.toMatch(/, use 'Corregir/);
    expect(fixture.componentInstance.puedeCorregir()).toBeFalse();
    expect(botonesDe(fixture).some((b) => b.includes('Corregir esta quincena'))).toBeFalse();
    expect(papeleras(fixture)).toBe(0);
  });

  it('borrado el de $20.000 queda uno: "ese pago", "con él", y la quincena sigue trabada', async () => {
    // 150.000 − 50.000 = $100.000 por entregar, todavía 'parcial'.
    const fixture = await abrir(
      quincena({ pagado: '50000', saldo: '100000', pagos: [ABONO_DE_50] }),
      ADMINISTRADOR,
    );

    expect(candadoEnElCuerpo(fixture)).toBe(
      'Ya se le abonó $ 50.000 contra estas cifras: quedan en firme y no se pueden ' +
        "recalcular. Si sus cifras quedaron mal, use 'Corregir esta quincena', que conserva " +
        'el pago y sus soportes, o registre el ajuste en la quincena siguiente. Elimine ' +
        'primero ese pago solo si de verdad hay que rehacerlas: con él se van sus soportes, ' +
        'que no se recuperan.',
    );
    expect(candadoEnElCuerpo(fixture)).not.toContain('esos');
  });

  it('en el flete Corregir no se nombra: borrar los pagos es la única salida, con la advertencia', async () => {
    const fixture = await abrir(quincena(FLETE_CON_DOS_ABONOS), ADMINISTRADOR);

    expect(fixture.componentInstance.puedeCorregir()).toBeFalse();
    expect(candadoEnElCuerpo(fixture)).toBe(
      'Ya se le abonó $ 5.000 contra estas cifras: quedan en firme y no se pueden ' +
        'recalcular. Elimine primero esos 2 pagos si de verdad hay que rehacerlas —con ellos ' +
        'se van sus soportes, que no se recuperan—, o registre el ajuste en la quincena ' +
        'siguiente.',
    );
    expect(candadoEnElCuerpo(fixture)).not.toContain('Corregir');
  });

  it('con parte de lo pagado sin renglón no manda a borrar: borrados los dos seguiría con pagos', async () => {
    // $70.000 en `pagado` y solo el renglón de $50.000 en la tabla (`_pagos_que_se_pueden_borrar`).
    const fixture = await abrir(quincena({ pagos: [ABONO_DE_50] }), ADMINISTRADOR);

    expect(candadoEnElCuerpo(fixture)).toBe(
      'Ya se le abonó $ 70.000 contra estas cifras: quedan en firme y no se pueden ' +
        "recalcular. Si sus cifras quedaron mal, use 'Corregir esta quincena', que conserva " +
        'el pago y sus soportes, o registre el ajuste en la quincena siguiente.',
    );
    expect(candadoEnElCuerpo(fixture)).not.toMatch(/limine/);
  });

  it('siguiendo Corregir (adelanto 30.000 → 20.000): $90.000 por entregar, los dos pagos vivos y sin "Elimine"', async () => {
    const fixture = await abrir(quincena(), ADMINISTRADOR);
    // Lo que devuelve el servidor (verificado en la ronda 3): v2 'parcial', 180.000 − 20.000
    // − 70.000 = 90.000, con los dos pagos.
    const corregida = quincena({
      version: 2,
      anticipos: '20000',
      neto_a_pagar: '160000',
      saldo: '90000',
    });
    spyOn(fixture.debugElement.injector.get(MatDialog), 'open').and.returnValue({
      afterClosed: () => of(corregida),
    } as never);

    fixture.componentInstance.corregirQuincena();
    await fixture.whenStable();
    fixture.detectChanges();

    const liq = fixture.componentInstance.liq();
    expect(Number(liq.valor_total) - Number(liq.anticipos) - Number(liq.pagado)).toBe(90000);
    expect(Number(liq.saldo)).toBe(90000);
    expect(liq.pagos.length).toBe(2);
    expect(candadoEnElCuerpo(fixture)).toBe(
      'De esta quincena ya salieron 2 comprobantes (el original y sus correcciones): sus ' +
        'cifras están en firme y Recalcular solo trabaja sobre borradores.',
    );
    expect(candadoEnElCuerpo(fixture)).not.toMatch(/limine/);
  });
});
