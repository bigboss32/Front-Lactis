import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion, LiquidacionDetalle } from '../../core/models';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * zz REVISIÓN (lente: plata y regla de oro). Reproducciones de la revisión adversarial
 * de F1–F5; no es código de la aplicación.
 */

const det = (id: string, fecha: string, litros: string, precio: string, valor: string): LiquidacionDetalle => ({
  id,
  fecha,
  litros,
  precio_litro: precio,
  valor,
  ruta_id: null,
  ruta_nombre: null,
  ruta_borrada: false,
});

const base = (c: Partial<Liquidacion>): Liquidacion => ({
  id: 'l-1',
  empresa_id: 'e-1',
  estado: 'aprobada',
  estado_visible: 'aprobada',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Henri Castaño',
  transportador_id: null,
  transportador_nombre: null,
  periodo_inicio: '2026-07-16',
  periodo_fin: '2026-07-31',
  total_litros: '100',
  precio_promedio: '1200',
  valor_bruto: '120000',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '0',
  anticipos: '0',
  valor_total: '120000',
  neto_a_pagar: '120000',
  pagado: '0',
  saldo: '120000',
  le_queda_debiendo: '0',
  observaciones: null,
  detalles: [det('d-1', '2026-07-20', '100', '1200', '120000')],
  pagos: [],
  ...c,
});

class ServicioFalso {
  readonly porId = new Subject<Liquidacion>();
  getById(): Observable<Liquidacion> {
    return this.porId as unknown as Observable<Liquidacion>;
  }
  pagar(): Observable<Liquidacion> {
    return of(null as unknown as Liquidacion);
  }
}

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
      { provide: LiquidacionesService, useValue: new ServicioFalso() },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
      { provide: MatSnackBar, useValue: { open: () => {} } },
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

const botones = (f: Fixture): string[] =>
  Array.from(f.nativeElement.querySelectorAll('mat-dialog-actions button'))
    .map((b) => leido(b as Element))
    .filter((t) => t !== '');

const ayudaDelStepper = (f: Fixture): string =>
  leido(f.nativeElement.querySelector('app-liquidacion-estado-stepper .ayuda'));

/** "$ 19.906,32" → centavos enteros, con el signo de resta impreso (U+2212). */
const centavos = (texto: string): number => {
  const n = Number(texto.replace(/[^\d,]/g, '').replace(',', '.'));
  return Math.round(n * 100) * (texto.trim().startsWith('−') ? -1 : 1);
};

/** Suma de arriba abajo, desde VALOR TOTAL, lo que la pantalla PINTA; devuelve [cuenta, cierre]. */
const cuadre = (f: Fixture): [number, number] => {
  const celdas = Array.from(f.nativeElement.querySelectorAll('.resumen .num[data-cuenta]')) as HTMLElement[];
  let cuenta = 0;
  let cierre = NaN;
  let paso = false;
  for (const c of celdas) {
    const clave = c.getAttribute('data-clave');
    const v = centavos(leido(c));
    if (clave === 'valor_total') {
      cuenta = v;
      paso = true;
    } else if (clave === 'saldo') {
      cierre = v;
    } else if (clave === 'le_queda_debiendo') {
      cierre = -Math.abs(v);
    } else if (paso) {
      cuenta += v;
    }
  }
  return [cuenta, cierre];
};

/** La Q2 de Henri: vale justo los $120.000 que dejó debiendo la Q1. El backend rebota /pagar. */
const Q2_EN_CERO_POR_LA_DEUDA: Partial<Liquidacion> = {
  saldo_anterior: '120000',
  deudas_cobradas: [
    {
      id: 'l-q1',
      periodo_inicio: '2026-07-01',
      periodo_fin: '2026-07-15',
      periodo_texto: '01/07/2026 al 15/07/2026',
      le_queda_debiendo: '120000',
    },
  ],
  neto_a_pagar: '0',
  saldo: '0',
};

describe('zz revisión plata: F4, la ayuda de arriba contra la nota de abajo', () => {
  it('Q2 en cero por la deuda vieja: sin botón Pagar, la ayuda NO puede mandar a usar "Pagar"', async () => {
    const f = await abrir(base(Q2_EN_CERO_POR_LA_DEUDA));
    const c = f.componentInstance;

    // El arreglo F4 sí quitó el botón y puso la nota.
    expect(c.puedeCerrarSinPago()).toBeFalse();
    expect(botones(f).some((b) => b.includes('Marcar pagada') || b.endsWith('Pagar'))).toBeFalse();
    const nota = leido(f.nativeElement.querySelector('.nota-saldo-cero'));
    expect(nota).toContain('no queda un peso por entregarle');

    // Pero el stepper, arriba en el MISMO diálogo, sigue diciendo lo contrario.
    const ayuda = ayudaDelStepper(f);
    console.log('[zz revisión] ayuda del stepper en Q2:', ayuda);
    expect(ayuda).not.toContain('usa "Pagar" cuando entregues el dinero');
  });

  it('cero por sus propios anticipos: el botón se llama "Marcar pagada", la ayuda dice "Pagar" y "entregues el dinero"', async () => {
    const f = await abrir(
      base({ anticipos: '120000', neto_a_pagar: '0', saldo: '0', saldo_anterior: '0' }),
    );
    expect(botones(f).some((b) => b.includes('Marcar pagada'))).toBeTrue();
    const ayuda = ayudaDelStepper(f);
    console.log('[zz revisión] ayuda del stepper con anticipos exactos:', ayuda);
    expect(ayuda).not.toContain('usa "Pagar" cuando entregues el dinero');
  });
});

describe('zz revisión plata: F3/F4, la columna cuadra en cada forma que existe', () => {
  const formas: Array<[string, Partial<Liquidacion>]> = [
    ['Q2 en cero por la deuda vieja', Q2_EN_CERO_POR_LA_DEUDA],
    [
      'anticipos + deuda vieja justas',
      { anticipos: '20000', saldo_anterior: '100000', neto_a_pagar: '0', saldo: '0' },
    ],
    [
      'pagada vieja (migrada): pagado sin pagos',
      {
        estado: 'pagada',
        estado_visible: 'pagada',
        valor_bruto: '400000',
        valor_total: '400000',
        anticipos: '100000',
        neto_a_pagar: '300000',
        pagado: '300000',
        saldo: '0',
      },
    ],
    [
      'pagada vieja del TRANSPORTADOR: pagado sin pagos',
      {
        estado: 'pagada',
        estado_visible: 'pagada',
        tipo: 'transportador',
        proveedor_id: null,
        proveedor_nombre: null,
        transportador_id: 't-1',
        transportador_nombre: 'Transportes RES',
        valor_bruto: '0',
        valor_transporte: '85300.50',
        valor_total: '85300.50',
        anticipos: '20000',
        neto_a_pagar: '65300.50',
        pagado: '65300.50',
        saldo: '0',
      },
    ],
    [
      'parcial con abono y deuda vieja',
      {
        estado: 'parcial',
        estado_visible: 'parcial',
        valor_bruto: '500000',
        valor_total: '500000',
        anticipos: '100000',
        saldo_anterior: '120000',
        neto_a_pagar: '280000',
        pagado: '80000',
        saldo: '200000',
        pagos: [{ id: 'p-1', fecha: '2026-08-01', valor: '80000', observaciones: null }],
      },
    ],
    [
      'aprobada que quedó debiendo',
      {
        estado_visible: 'pagada · quedó debiendo',
        valor_bruto: '180000',
        valor_total: '180000',
        anticipos: '300000',
        neto_a_pagar: '-120000',
        saldo: '-120000',
        le_queda_debiendo: '120000',
      },
    ],
  ];

  for (const [nombre, cifras] of formas) {
    it(`${nombre}: valor total − descuentos pintados = renglón de cierre`, async () => {
      const f = await abrir(base(cifras));
      const [cuenta, cierre] = cuadre(f);
      expect(cuenta).toBe(cierre);
    });
  }
});

describe('zz revisión plata: F4, el botón sale exactamente cuando el servidor acepta /pagar', () => {
  /**
   * `LiquidacionService.pagar` transcrito (service.py:4413-4468): estado en firme, sin
   * deuda borrada, sin deuda del tercero, y no `_no_sale_un_peso_por_la_deuda`.
   */
  const servidorAcepta = (l: Liquidacion): boolean => {
    const saldo = Number(l.saldo);
    const pagado = Number(l.pagado ?? 0);
    if (pagado < 0) return false;
    if (l.estado !== 'aprobada' && l.estado !== 'parcial') return false;
    if (saldo < 0) return false;
    if (saldo <= 0 && Number(l.saldo_anterior ?? 0) > 0 && !(pagado > 0)) return false;
    return true;
  };

  const formas: Array<Partial<Liquidacion>> = [
    Q2_EN_CERO_POR_LA_DEUDA,
    { anticipos: '120000', neto_a_pagar: '0', saldo: '0' },
    { anticipos: '20000', saldo_anterior: '100000', neto_a_pagar: '0', saldo: '0' },
    { saldo_anterior: '100000', neto_a_pagar: '20000', saldo: '20000' },
    {
      estado: 'parcial',
      saldo_anterior: '100000',
      pagado: '20000',
      neto_a_pagar: '20000',
      saldo: '0',
      pagos: [{ id: 'p-1', fecha: '2026-08-01', valor: '20000', observaciones: null }],
    },
    { saldo: '0.00', neto_a_pagar: '0.00', saldo_anterior: '120000.00' },
    { saldo: '-0.00', neto_a_pagar: '-0.00', saldo_anterior: '120000.00' },
  ];

  formas.forEach((cifras, i) => {
    it(`forma ${i}: ofrecer un botón de cierre/pago ⇔ el servidor lo acepta`, async () => {
      const item = base(cifras);
      const f = await abrir(item);
      const c = f.componentInstance;
      const ofrece = c.puedePagar() || c.puedeCerrarSinPago();
      expect(ofrece).toBe(servidorAcepta(item));
    });
  });
});

// -----------------------------------------------------------------------------
// F5 (solo revisión): los candados de anticipos y de la grilla, con la deuda ya
// cobrada (B2/B3). Se llaman los métodos puros sobre el prototipo: no usan `this`.
// -----------------------------------------------------------------------------
import { AnticipoListPage } from './anticipo-list.page';
import { RecepcionGrillaTab } from '../recepciones/recepcion-grilla.tab';

describe('zz revisión plata: F5, el porqué del candado cuando no salió un peso', () => {
  it('anticipo trabado en una quincena APROBADA (deuda ya cobrada, B2): no puede mandar a borrar un pago que no existe', () => {
    // Con B2, `bloqueado` = cifras_congeladas(liq). Una 'aprobada' nunca tiene pagado > 0
    // (`_estado_pago` la sube a parcial/pagada), así que bloqueado + 'aprobada' ES la deuda
    // ya cobrada: los campos que ya existen sí distinguen el caso.
    const fila = {
      bloqueado: true,
      liquidacion_estado: 'aprobada',
      liquidacion_id: 'l-q1',
      pago_empleado_id: null,
    } as unknown as Parameters<AnticipoListPage['motivoDelCandado']>[0];
    const motivo = AnticipoListPage.prototype.motivoDelCandado.call({}, fila);
    console.log('[zz revisión] candado del anticipo:', motivo);
    expect(motivo).not.toContain('ya tiene un pago registrado');
    expect(motivo).not.toContain('Elimine primero ese pago');
  });

  it('celda de la grilla trabada por deuda ya cobrada (B3): no puede decir "ya se pagó"', () => {
    const celda = {
      recepcion_id: 'r-1',
      litros: '100',
      liquidada: true,
      pagada: true,
      leche_pagada: true,
      flete_pagado: false,
      liquidacion_estado: 'aprobada',
      con_transporte: false,
      // El backend (working tree) ya manda el porqué real en `CeldaGrilla.candado_aviso`.
      candado_aviso:
        'lo que Henri quedó debiendo en la quincena de la leche de este día ya se le cobró en la del 16/07/2026 al 31/07/2026',
    } as unknown as Parameters<RecepcionGrillaTab['tooltipTrabada']>[0];
    const texto = RecepcionGrillaTab.prototype.tooltipTrabada.call({}, celda);
    console.log('[zz revisión] tooltip de la celda:', texto);
    expect(texto).not.toContain('ya se pagó');
  });
});
