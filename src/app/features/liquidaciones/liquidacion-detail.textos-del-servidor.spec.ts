import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion } from '../../core/models';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * LOS CANDADOS DICEN EL "NO" DEL SERVIDOR CON SUS PALABRAS, Y LA NOTA DEL CERO NO INVENTA
 * UNA RAZÓN.
 *
 *  · LA DEUDA BORRADA: el servidor manda en `avisos_deuda_borrada` el 422 que da cada acción
 *    sobre la fila. Los candados de Corregir, Pagar y Anular lo pintan tal cual; antes
 *    armaban su propia frase, que en la de Arriba v2 decía "le pagaría esos $ 120.000 de
 *    más" mientras el 422 decía "lo que de verdad falta entregarle es $80.000".
 *  · EL CERO QUE HIZO LA DEUDA VIEJA: `aviso_sin_un_peso_por_la_deuda` es el 422 de Pagar
 *    (o null cuando ese guardia no salta). Con él se esconde "Marcar pagada" y el candado
 *    dice el porqué del servidor. La nota del cero decía "marcarla pagada trabaría sus días
 *    con un aviso que no es cierto", y con las cifras del dueño ese aviso sí sería cierto.
 */

type Fixture = ComponentFixture<LiquidacionDetailDialog>;

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/\s+/g, ' ').trim();
const leido = (elemento: Element | null | undefined): string => comoSeLee(elemento?.textContent);

const quincena = (cifras: Partial<Liquidacion> = {}): Liquidacion => ({
  id: 'l-1',
  empresa_id: 'e-1',
  estado: 'aprobada',
  estado_visible: 'aprobada',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Henri Castaño',
  transportador_id: null,
  transportador_nombre: null,
  periodo_inicio: '2026-06-16',
  periodo_fin: '2026-06-30',
  total_litros: '90',
  precio_promedio: '2000',
  valor_bruto: '180000',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '0',
  anticipos: '0',
  saldo_anterior: '0',
  valor_total: '180000',
  neto_a_pagar: '180000',
  pagado: '0',
  saldo: '180000',
  le_queda_debiendo: '0',
  observaciones: null,
  detalles: [
    { id: 'd-1', fecha: '2026-06-17', litros: '90', precio_litro: '2000', valor: '180000' },
  ],
  pagos: [],
  ...cifras,
});

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

const botonesDe = (fixture: Fixture): string[] =>
  Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button'))
    .map((boton) => leido(boton as Element))
    .filter((texto) => texto !== '');

/** El tooltip del candado cuyo rótulo es `rotulo` ("No se puede pagar", …). */
const tooltipDelCandado = (fixture: Fixture, rotulo: string): string | null => {
  const candado = fixture.debugElement
    .queryAll(By.css('mat-dialog-actions .nota-recalcular'))
    .find((c) => leido(c.nativeElement).endsWith(rotulo));
  return candado ? candado.injector.get(MatTooltip).message : null;
};

// ============================================================ la deuda borrada
/** Lo que arma `_aviso_deuda_borrada` con cada verbo (backend, service.py). */
const delServidor = (verbo: string, posicion: string, remate: string): string =>
  `No se puede ${verbo} esta quincena: viene de antes de que existieran los abonos, y el ` +
  'sistema de esa época le borró lo que el tercero quedaba debiendo ($120.000). ' +
  `${posicion}${remate}`;
const DEBE = 'Hoy el tercero todavía le debe $120.000 a la quesera';
const REMATE_DEBE =
  '. Hay que repararla antes de tocarla: tal como está, el sistema le sumaría esos $120.000 ' +
  'a lo que falta por entregarle y mandaría a pagarle a alguien que todavía debe';
const FALTA =
  'El saldo dice $200.000, pero lo que de verdad falta entregarle es $80.000: los otros ' +
  '$120.000 son la deuda que borró la migración';
const REMATE_FALTA =
  ', así que pagarle el saldo le entregaría $120.000 de más. Hay que repararla antes de tocarla';

const avisos = (posicion: string, remate: string) => ({
  corregir: delServidor('corregir', posicion, remate),
  pagar: delServidor('pagar', posicion, remate),
  registrar_pago: delServidor('registrarle un pago a', posicion, remate),
  anular: delServidor('anular', posicion, remate),
});

/** Plain v1: $180.000 contra $300.000, como la dejó la migración (borró $120.000). */
const PLAIN_V1: Partial<Liquidacion> = {
  proveedor_nombre: 'Plain',
  estado: 'pagada',
  estado_visible: 'pagada',
  anticipos: '300000',
  neto_a_pagar: '-120000',
  pagado: '-120000',
  saldo: '0',
  deuda_borrada_por_la_migracion: '120000.00',
  aviso_deuda_borrada: DEBE,
  avisos_deuda_borrada: avisos(DEBE, REMATE_DEBE),
};

/** Arriba v2: la misma, corregida hacia arriba sin pagar: valor $380.000, saldo $200.000. */
const ARRIBA_V2: Partial<Liquidacion> = {
  ...PLAIN_V1,
  proveedor_nombre: 'Arriba',
  estado: 'parcial',
  estado_visible: 'parcial',
  version: 2,
  total_litros: '190',
  valor_bruto: '380000',
  valor_total: '380000',
  neto_a_pagar: '80000',
  saldo: '200000',
  aviso_deuda_borrada: FALTA,
  avisos_deuda_borrada: avisos(FALTA, REMATE_FALTA),
};

/** Con un abono de $50.000 encima: 'aprobada', saldo en cero, borrada $120.000. */
const ABONADA_ENCIMA: Partial<Liquidacion> = {
  ...PLAIN_V1,
  proveedor_nombre: 'Encima',
  estado: 'aprobada',
  estado_visible: 'aprobada',
  version: 2,
  total_litros: '115',
  valor_bruto: '230000',
  valor_total: '230000',
  neto_a_pagar: '-70000',
  pagado: '-70000',
  saldo: '0',
  pagos: [{ id: 'p-1', fecha: '2026-08-10', valor: '50000', observaciones: null }],
};

describe('LiquidacionDetailDialog: los candados de la deuda borrada con el 422 del servidor', () => {
  it('Plain v1: "No se puede corregir" dice el 422 de Corregir, tal cual', async () => {
    const fixture = await abrir(quincena(PLAIN_V1));
    const c = fixture.componentInstance;

    expect(c.motivoNoCorregir()).toBe(PLAIN_V1.avisos_deuda_borrada!.corregir!);
    expect(tooltipDelCandado(fixture, 'No se puede corregir')).toBe(
      PLAIN_V1.avisos_deuda_borrada!.corregir!,
    );
    // Ni la frase de acá, con el nombre y el otro formato de pesos.
    expect(c.motivoNoCorregir()).not.toContain('Plain quedaba debiendo ($ 120.000)');
  });

  it('Arriba v2: "No se puede pagar" y "No se puede corregir" son sus 422, no "le pagaría esos $ 120.000 de más"', async () => {
    const fixture = await abrir(quincena(ARRIBA_V2));
    const c = fixture.componentInstance;

    expect(c.puedePagar()).toBeFalse();
    expect(tooltipDelCandado(fixture, 'No se puede pagar')).toBe(
      ARRIBA_V2.avisos_deuda_borrada!.pagar!,
    );
    expect(c.motivoNoPagar()).toContain('lo que de verdad falta entregarle es $80.000');
    expect(c.motivoNoPagar()).not.toContain('le pagaría esos');
    expect(c.motivoNoCorregir()).toBe(ARRIBA_V2.avisos_deuda_borrada!.corregir!);
  });

  it('con un abono encima: "No se puede anular" es el 422 de Anular', async () => {
    const fixture = await abrir(quincena(ABONADA_ENCIMA));
    const c = fixture.componentInstance;

    expect(c.puedeAnular()).toBeFalse();
    expect(c.motivoNoAnular()).toBe(ABONADA_ENCIMA.avisos_deuda_borrada!.anular!);
    expect(tooltipDelCandado(fixture, 'No se puede anular')).toBe(
      ABONADA_ENCIMA.avisos_deuda_borrada!.anular!,
    );
  });

  it('una respuesta vieja sin `avisos_deuda_borrada` sigue con la frase de acá', async () => {
    const vieja: Partial<Liquidacion> = { ...ARRIBA_V2 };
    delete vieja.avisos_deuda_borrada;
    const fixture = await abrir(quincena(vieja));

    expect(comoSeLee(fixture.componentInstance.motivoNoPagar())).toContain(
      'No se puede pagar esta quincena: viene de antes de que existieran los abonos, y el ' +
        'sistema de esa época le borró lo que Arriba quedaba debiendo ($ 120.000).',
    );
  });
});

// ========================================================= el cero por la deuda vieja
/**
 * El 422 de Pagar sobre la fila (`_no_sale_un_peso_por_la_deuda`), letra por letra como lo
 * manda hoy el servidor en `aviso_sin_un_peso_por_la_deuda` (sacado del GET real de la pura).
 */
const SIN_UN_PESO =
  'Esta liquidación no hay que pagarla: no queda un peso por entregar —lo que el tercero ' +
  'quedó debiendo de la quincena pasada ($120.000) se llevó lo que faltaba del neto—. ' +
  "Déjela en 'aprobada': marcarla pagada no le entrega un peso a nadie y le trabaría los " +
  "días, que en 'aprobada' todavía se pueden corregir";

/** El mismo 422 sobre la mixta: con anticipos propios nombra también los anticipos. */
const SIN_UN_PESO_MIXTA = SIN_UN_PESO.replace('los días,', 'los días y los anticipos,');

/** Pura: 60 L × $2.000 = $120.000 contra los $120.000 que dejó debiendo la Q1. */
const PURA: Partial<Liquidacion> = {
  proveedor_nombre: 'Rep5 Pura',
  total_litros: '60',
  valor_bruto: '120000',
  valor_total: '120000',
  saldo_anterior: '120000',
  neto_a_pagar: '0',
  saldo: '0',
};

/** Mixta: 85 L × $2.000 = $170.000 − $50.000 de adelanto − $120.000 de deuda = $0. */
const MIXTA: Partial<Liquidacion> = {
  proveedor_nombre: 'Rep5 Mixta',
  total_litros: '85',
  valor_bruto: '170000',
  valor_total: '170000',
  anticipos: '50000',
  saldo_anterior: '120000',
  neto_a_pagar: '0',
  saldo: '0',
};

const notaDelCero = (fixture: Fixture): string =>
  leido(fixture.nativeElement.querySelector('.nota-saldo-cero'));

describe('LiquidacionDetailDialog: el cero que hizo la deuda vieja, con el 422 de Pagar', () => {
  it('pura ($120.000 − $120.000): sin "Marcar pagada", el candado dice el 422 y la nota no inventa una razón', async () => {
    const fixture = await abrir(quincena({ ...PURA, aviso_sin_un_peso_por_la_deuda: SIN_UN_PESO }));
    const c = fixture.componentInstance;

    expect(c.laDeudaViejaCubrioLaQuincena()).toBeTrue();
    expect(c.puedeCerrarSinPago()).toBeFalse();
    expect(botonesDe(fixture).some((b) => b.includes('Marcar pagada'))).toBeFalse();
    expect(c.motivoNoPagar()).toBe(SIN_UN_PESO);
    expect(tooltipDelCandado(fixture, 'No hay nada que pagar')).toBe(SIN_UN_PESO);
    expect(notaDelCero(fixture)).toBe(
      'No hay nada que entregarle a Rep5 Pura: lo que ya venía debiendo de antes ($ 120.000) ' +
        'cubre EXACTO el valor total de la quincena ($ 120.000), así que el saldo quedó en ' +
        '$ 0. Se queda aprobada.',
    );
    expect(notaDelCero(fixture)).not.toContain('aviso que no es cierto');
  });

  it('mixta ($170.000 − $50.000 − $120.000): la nota cuadra con la calculadora y tampoco dice "aviso que no es cierto"', async () => {
    const fixture = await abrir(
      quincena({ ...MIXTA, aviso_sin_un_peso_por_la_deuda: SIN_UN_PESO_MIXTA }),
    );
    const c = fixture.componentInstance;

    expect(botonesDe(fixture).some((b) => b.includes('Marcar pagada'))).toBeFalse();
    expect(c.motivoNoPagar()).toBe(SIN_UN_PESO_MIXTA);
    expect(notaDelCero(fixture)).toBe(
      'No hay nada que entregarle a Rep5 Mixta: los anticipos aplicados ($ 50.000) y lo que ' +
        'ya venía debiendo de antes ($ 120.000) cubren EXACTO el valor total de la quincena ' +
        '($ 170.000), así que el saldo quedó en $ 0. Se queda aprobada.',
    );
    expect(50000 + 120000).toBe(170000);
  });

  it('con el campo en null manda el servidor: ese guardia no salta, y "Marcar pagada" sí está', async () => {
    const fixture = await abrir(quincena({ ...PURA, aviso_sin_un_peso_por_la_deuda: null }));
    const c = fixture.componentInstance;

    expect(c.laDeudaViejaCubrioLaQuincena()).toBeFalse();
    expect(c.puedeCerrarSinPago()).toBeTrue();
    expect(botonesDe(fixture).some((b) => b.includes('Marcar pagada'))).toBeTrue();
    expect(c.motivoNoPagar()).toBeNull();
    expect(notaDelCero(fixture)).not.toContain('Se queda aprobada');
  });

  it('control: la exacta de sus propios anticipos ($180.000 contra $180.000) sigue con "Marcar pagada"', async () => {
    const fixture = await abrir(
      quincena({
        anticipos: '180000',
        neto_a_pagar: '0',
        saldo: '0',
        aviso_sin_un_peso_por_la_deuda: null,
      }),
    );

    expect(botonesDe(fixture).some((b) => b.includes('Marcar pagada'))).toBeTrue();
    expect(notaDelCero(fixture)).toContain('los anticipos aplicados ($ 180.000) cubren EXACTO');
  });

  it('una respuesta vieja sin el campo deduce como antes, con una razón cierta', async () => {
    const fixture = await abrir(quincena(MIXTA));
    const c = fixture.componentInstance;

    expect(c.laDeudaViejaCubrioLaQuincena()).toBeTrue();
    expect(botonesDe(fixture).some((b) => b.includes('Marcar pagada'))).toBeFalse();
    expect(notaDelCero(fixture)).toContain(
      'Se queda aprobada: no queda un peso por entregarle, y cuando lo que venía debiendo de ' +
        'antes se lleva lo que faltaba del neto, el sistema no la marca pagada.',
    );
    expect(notaDelCero(fixture)).not.toContain('aviso que no es cierto');
    expect(comoSeLee(c.motivoNoPagar())).toBe(notaDelCero(fixture));
  });
});

// ================================================ la deuda cobrada que ya no cuadra
/**
 * LAS DOS PUNTAS DE HENRI, con los textos del GET real del servidor (la pareja que dejó el
 * borrado de pagos de antes del guardia). La del 01/06 dejó $100.000 de deuda que la del
 * 16/06 descontó: 300.000 − 100.000 = $200.000 de neto. Después se le borró el pago a la
 * primera, corregida a $400.000, y quedó "por entregar $400.000" sin deber nada, mientras la
 * segunda sigue descontando los $100.000. El servidor rebota Pagar y el abono en las dos.
 */
const Q1_TEXTO = '01/06/2026 al 15/06/2026';
const Q2_TEXTO = '16/06/2026 al 30/06/2026';
const NO_CUADRAN =
  'Los dos comprobantes ya no cuadran entre sí, y hay que revisarlos antes de entregarle plata.';
const HECHO_Q1 =
  'esta liquidación: lo que el tercero quedaba debiendo en ella ($100.000) ya se le cobró en ' +
  `la liquidación del ${Q2_TEXTO}, pero después sus cifras cambiaron: hoy ya no queda ` +
  `debiendo nada y su saldo dice $400.000 por entregar. ${NO_CUADRAN} Anule primero esa ` +
  'liquidación —así esta deuda vuelve a quedar libre— y vuelva a intentarlo.';
const HECHO_Q2 =
  `esta liquidación: descuenta $100.000 de lo que el tercero quedaba debiendo en la ` +
  `liquidación del ${Q1_TEXTO}, pero después de cobrárselo las cifras de esa quincena ` +
  `cambiaron y hoy ya no queda debiendo nada. ${NO_CUADRAN} Si hay que rehacerla, anúlela y ` +
  'vuelva a generarla: la nueva solo descontará lo que hoy se deba';

/**
 * `avisos_deuda_cobrada` como lo manda el servidor. Sus claves 'pagar' y 'registrar_pago'
 * todavía no están en `AccionTrabadaPorLaDeuda` de models.ts.
 */
const delServidorPorAccion = (avisos: Record<string, string>): Liquidacion['avisos_deuda_cobrada'] =>
  avisos as Liquidacion['avisos_deuda_cobrada'];

/** La del 01/06: 'parcial' v2, $400.000 por entregar, con la marca hacia la del 16/06. */
const HENRI_Q1: Partial<Liquidacion> = {
  estado: 'parcial',
  estado_visible: 'parcial',
  version: 2,
  periodo_inicio: '2026-06-01',
  periodo_fin: '2026-06-15',
  total_litros: '200',
  valor_bruto: '400000',
  valor_total: '400000',
  neto_a_pagar: '400000',
  saldo: '400000',
  detalles: [
    { id: 'd-1', fecha: '2026-06-02', litros: '200', precio_litro: '2000', valor: '400000' },
  ],
  deuda_trasladada_a_id: 'q-2',
  deuda_trasladada_a: {
    id: 'q-2',
    periodo_inicio: '2026-06-16',
    periodo_fin: '2026-06-30',
    periodo_texto: Q2_TEXTO,
  },
  avisos_deuda_cobrada: delServidorPorAccion({
    pagar: `No se puede pagar ${HECHO_Q1}`,
    registrar_pago: `No se puede registrarle un pago a ${HECHO_Q1}`,
  }),
};

/** La del 16/06: 'aprobada', 150 L × $2.000 = $300.000 − $100.000 = $200.000. */
const HENRI_Q2: Partial<Liquidacion> = {
  total_litros: '150',
  valor_bruto: '300000',
  valor_total: '300000',
  saldo_anterior: '100000',
  neto_a_pagar: '200000',
  saldo: '200000',
  detalles: [
    { id: 'd-1', fecha: '2026-06-17', litros: '150', precio_litro: '2000', valor: '300000' },
  ],
  deudas_cobradas: [
    {
      id: 'q-1',
      periodo_inicio: '2026-06-01',
      periodo_fin: '2026-06-15',
      periodo_texto: Q1_TEXTO,
      le_queda_debiendo: '0',
    },
  ],
  avisos_deuda_cobrada: delServidorPorAccion({
    pagar: `No se puede pagar ${HECHO_Q2}`,
    registrar_pago: `No se puede registrarle un pago a ${HECHO_Q2}`,
  }),
};

const avisoDePagar = (cifras: Partial<Liquidacion>): string =>
  (cifras.avisos_deuda_cobrada as Record<string, string>)['pagar'];
const hayPagar = (fixture: Fixture): boolean =>
  botonesDe(fixture).some((b) => /\bPagar$/.test(b) || b.includes('Marcar pagada'));

describe('LiquidacionDetailDialog: la deuda cobrada que ya no cuadra, con el 422 del servidor', () => {
  it('la que dejó la deuda ($400.000 por entregar): sin Pagar, y el candado es el 422 de Pagar', async () => {
    const fixture = await abrir(quincena(HENRI_Q1));
    const c = fixture.componentInstance;

    expect(400000 - 0 - 0).toBe(400000);
    expect(c.puedePagar()).toBeFalse();
    expect(c.puedeCerrarSinPago()).toBeFalse();
    expect(hayPagar(fixture)).toBeFalse();
    expect(c.motivoNoPagar()).toBe(avisoDePagar(HENRI_Q1));
    expect(tooltipDelCandado(fixture, 'No se puede pagar')).toBe(avisoDePagar(HENRI_Q1));
    // La línea de estados no manda a un Pagar que rebota, ni a un Administrador.
    expect(c.ayudaDelEstado()).toBe(
      'Los comprobantes de esta deuda ya no cuadran entre sí: hay que revisarlos antes de ' +
        'entregarle plata.',
    );
  });

  it('la que la cobró ($300.000 − $100.000): sin Pagar, y el descuento no dice "se le cobran acá"', async () => {
    const fixture = await abrir(quincena(HENRI_Q2));
    const c = fixture.componentInstance;

    expect(300000 - 0 - 100000).toBe(200000);
    expect(hayPagar(fixture)).toBeFalse();
    expect(tooltipDelCandado(fixture, 'No se puede pagar')).toBe(avisoDePagar(HENRI_Q2));
    // "Son lo que Henri quedó debiendo … Se le cobran acá" sería falso: hoy no debe nada.
    const nota = leido(fixture.nativeElement.querySelector('.nota-saldo-anterior'));
    expect(nota).toBe(avisoDePagar(HENRI_Q2));
    expect(nota).not.toContain('una sola vez');
    expect(c.ayudaDelEstado()).not.toContain('Pagar');
  });

  it('control: la pareja sana ($100.000 que de verdad debe) sigue con Pagar y su explicación', async () => {
    const sana: Partial<Liquidacion> = {
      ...HENRI_Q2,
      proveedor_nombre: 'Henri',
      deudas_cobradas: [{ ...HENRI_Q2.deudas_cobradas![0], le_queda_debiendo: '100000' }],
      avisos_deuda_cobrada: {},
    };
    const fixture = await abrir(quincena(sana));
    const c = fixture.componentInstance;

    expect(c.puedePagar()).toBeTrue();
    expect(hayPagar(fixture)).toBeTrue();
    expect(c.motivoNoPagar()).toBeNull();
    expect(c.explicacionSaldoAnterior()).toContain('Se le cobran acá, una sola vez.');
  });
});
