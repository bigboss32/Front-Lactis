import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NEVER, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Anticipo, Liquidacion, LiquidacionDetalle, Recepcion } from '../../core/models';
import { avisoDelGuardado } from '../recepciones/aviso-del-guardado';
import { RecepcionListPage } from '../recepciones/recepcion-list.page';
import { AnticipoListPage } from './anticipo-list.page';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * zz REVISIÓN 2 — reproducciones de la segunda ronda (front). Cada `it` afirma LA VERDAD:
 * falla mientras el defecto exista y pasa cuando se arregle.
 *
 * Las cifras de las filas migradas son las que el backend del árbol de trabajo devuelve
 * HOY (tests/test_liquidacion_deuda_borrada_con_pagos.py): `deuda_borrada_por_la_migracion`
 * = Σ(pagos) − pagado, que da $120.000 con y sin pagos encima.
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
};

const fila = (c: Partial<Liquidacion>): Liquidacion => ({ ...HENRI, ...c }) as Liquidacion;

/** Mas-Cincuenta: día olvidado de $50.000 y Pagar antes del guardia. Vuelve a 'aprobada'. */
const MAS_CINCUENTA = fila({
  estado: 'aprobada', estado_visible: 'aprobada', version: 2,
  valor_bruto: '230000', valor_total: '230000', neto_a_pagar: '-70000',
  pagado: '-70000', saldo: '0', deuda_borrada_por_la_migracion: '120000.00',
  pagos: [{ id: 'pg-1', fecha: '2026-08-10', valor: '50000.00', observaciones: null }],
});

/** Paso-De-Cero: día olvidado de $200.000 y Pagar: 'pagada', pagado $80.000, pagos $200.000. */
const PASO_DE_CERO = fila({
  estado: 'pagada', estado_visible: 'pagada', version: 2,
  valor_bruto: '380000', valor_total: '380000', neto_a_pagar: '80000',
  pagado: '80000', saldo: '0', deuda_borrada_por_la_migracion: '120000.00',
  pagos: [{ id: 'pg-2', fecha: '2026-08-10', valor: '200000.00', observaciones: null }],
});

/** Dos-Abonos, tras borrar el de $150.000: parcial, pagado 0, pagos $50.000, borrada $50.000. */
const DOS_ABONOS = fila({
  estado: 'parcial', estado_visible: 'parcial', version: 2,
  valor_bruto: '380000', valor_total: '380000', neto_a_pagar: '80000',
  pagado: '0', saldo: '80000', deuda_borrada_por_la_migracion: '50000.00',
  pagos: [{ id: 'pg-3', fecha: '2026-08-11', valor: '50000.00', observaciones: null }],
});

/**
 * Corregida HACIA ABAJO antes del guardia (precio 2000 → 1500): valor $135.000, neto
 * −$165.000, saldo −$45.000, 'pagada' v2, y esos $45.000 ya se los cobró la siguiente.
 * Borrada = 0 − (−120.000) = $120.000. Tiene LAS DOS marcas.
 */
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

type Fixture = ComponentFixture<LiquidacionDetailDialog>;

const comoSeLee = (t: string | null | undefined): string =>
  (t ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const leido = (e: Element | null | undefined): string => comoSeLee(e?.textContent);
const centavos = (texto: string): number =>
  Math.round(Number(texto.replace(/[^\d,-]/g, '').replace(',', '.')) * 100);

const abrir = async (item: Liquidacion): Promise<Fixture> => {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [LiquidacionDetailDialog, NoopAnimationsModule],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { item } },
      // El getById no responde: la pantalla se queda con la fila que se le pasó.
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

/** La cuenta de calculadora del dueño sobre la columna pintada: total − descuentos vs cierre. */
const cuadre = (fixture: Fixture) => {
  const celdas = Array.from(
    fixture.nativeElement.querySelectorAll('.resumen .num[data-cuenta]'),
  ) as HTMLElement[];
  let despues = 0;
  let cierre = 0;
  let paso = false;
  const renglones: Record<string, string> = {};
  for (const celda of celdas) {
    const clave = celda.getAttribute('data-clave') ?? '';
    const texto = leido(celda);
    renglones[clave] = texto;
    const valor = centavos(texto);
    if (clave === 'valor_total') {
      despues = valor;
      paso = true;
    } else if (clave === 'saldo' || clave === 'le_queda_debiendo') {
      cierre = clave === 'le_queda_debiendo' ? -valor : valor;
    } else if (paso) {
      despues += texto.startsWith('−') ? -valor : valor;
    }
  }
  return { despues, cierre, hueco: cierre - despues, renglones };
};

const sumaDeLosPagos = (fixture: Fixture): number =>
  Array.from(fixture.nativeElement.querySelectorAll('.tabla-pagos td.mat-column-valor'))
    .map((td) => centavos(leido(td as Element)))
    .reduce((a, b) => a + b, 0);

const botones = (fixture: Fixture): string[] =>
  Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button'))
    .map((b) => leido(b as Element))
    .filter((t) => t !== '');

const aviso = (fixture: Fixture): string =>
  leido(fixture.nativeElement.querySelector('.aviso-deuda-borrada span'));

// -----------------------------------------------------------------------------------
describe('zz revisión 2 · R1: el aviso de la deuda borrada afirma un hueco que no es', () => {
  for (const [nombre, liq, pesos] of [
    ['Mas-Cincuenta (aprobada, pagado −70.000, pagos 50.000)', MAS_CINCUENTA, '$ 120.000'],
    ['Paso-De-Cero (pagada, pagado 80.000, pagos 200.000)', PASO_DE_CERO, '$ 120.000'],
    ['Dos-Abonos (parcial, pagado 0, pagos 50.000)', DOS_ABONOS, '$ 50.000'],
  ] as const) {
    it(`${nombre}: "la diferencia son esos ${pesos}" tiene que ser la resta que se ve`, async () => {
      const fixture = await abrir(liq);
      const c = cuadre(fixture);
      console.log('[zz r2 R1]', nombre, JSON.stringify({ aviso: aviso(fixture), ...c }));
      expect(aviso(fixture)).toContain(`la diferencia son esos ${pesos}`);
      // Lo que el dueño comprueba con calculadora: cierre − (total − descuentos pintados).
      expect(Math.abs(c.hueco)).toBe(centavos(pesos));
    });
  }

  it('Paso-De-Cero: el renglón "Pagado" no es lo que suman los pagos de la tabla', async () => {
    const fixture = await abrir(PASO_DE_CERO);
    const c = cuadre(fixture);
    // La tabla de pagos dice $200.000 entregados; el resumen, "Pagado − $ 80.000".
    expect(sumaDeLosPagos(fixture)).toBe(20000000);
    expect(centavos(c.renglones['pagado'] ?? '0')).toBe(sumaDeLosPagos(fixture));
  });

  it('Dos-Abonos: "Pagado − $ 0" al lado de un pago de $ 50.000', async () => {
    const fixture = await abrir(DOS_ABONOS);
    const c = cuadre(fixture);
    expect(sumaDeLosPagos(fixture)).toBe(5000000);
    expect(centavos(c.renglones['pagado'] ?? '0')).toBe(sumaDeLosPagos(fixture));
  });
});

// -----------------------------------------------------------------------------------
describe('zz revisión 2 · R2: Anular sobre la aprobada con deuda borrada (el servidor lo rebota)', () => {
  it('Mas-Cincuenta: no puede ofrecer "Anular"; anular() hace primero _exigir_sin_deuda_borrada', async () => {
    const fixture = await abrir(MAS_CINCUENTA);
    console.log('[zz r2 R2]', JSON.stringify(botones(fixture)));
    expect(fixture.componentInstance.puedeAnular()).toBeFalse();
    expect(botones(fixture).some((b) => b.endsWith('Anular'))).toBeFalse();
  });
});

// -----------------------------------------------------------------------------------
describe('zz revisión 2 · R3: el candado de Corregir no sigue el orden de _exigir_corregible', () => {
  it('con deuda borrada Y deuda ya cobrada, la razón es la borrada (la que no tiene salida)', async () => {
    const fixture = await abrir(CON_LAS_DOS);
    const motivo = comoSeLee(fixture.componentInstance.motivoNoCorregir());
    console.log('[zz r2 R3]', motivo);
    // El backend (`_exigir_corregible`) rebota PRIMERO con la deuda borrada. La pantalla
    // manda a "Anule primero esa liquidación", y anularla no destraba nada: Corregir
    // vuelve a rebotar por la deuda borrada.
    expect(motivo).toContain('viene de antes de que existieran los abonos');
    expect(motivo).not.toContain('Anule primero esa liquidación');
  });
});

// -----------------------------------------------------------------------------------
const dia = (c: Partial<Recepcion>): Recepcion =>
  ({
    id: 'r-1', empresa_id: 'e-1', estado: 'activo',
    created_at: '2026-07-03T00:00:00Z', updated_at: '2026-07-03T00:00:00Z',
    fecha: '2026-07-03', proveedor_id: 'p-b', proveedor_nombre: 'Beto Cobrada',
    transportador_id: null, ruta_id: null, sucursal_id: null,
    cantidad_litros: '90', precio_litro: '2000', bonificaciones: '0', descuentos: '0',
    valor_bruto: '180000', valor_transporte: '0', valor_neto: '180000', observaciones: null,
    liquidacion_id: 'l-b', liquidacion_transporte_id: null,
    liquidacion_estado: 'pagada', liquidacion_estado_leche: 'pagada', liquidacion_estado_flete: null,
    leche_pagada: true, flete_pagado: false,
    campos_bloqueados: ['cantidad_litros', 'precio_litro', 'fecha'],
    campos_editables: ['transportador_id', 'ruta_id', 'observaciones'],
    candado_aviso: null,
    ...c,
  }) as Recepcion;

describe('zz revisión 2 · R4: la lista de Recepción decide "¿fue plata?" por el estado, no por el servidor', () => {
  // La 'pagada' que dejó el botón Pagar de antes con el tercero debiendo (pagado $0) y
  // cuya deuda ya se cobró la siguiente. `_por_que_esta_trabada` nombra PRIMERO la deuda
  // cobrada porque "ya se le pagó" sería mentira (recepcion/service.py).
  const AVISO =
    'Lo que Beto Cobrada quedó debiendo en la quincena de la leche de este día ya se le ' +
    'cobró en la del 16/07/2026 al 31/07/2026: no se puede cambiar los litros, el precio ' +
    'por litro y la fecha. Sí se puede corregir el transportador, la ruta y las ' +
    'observaciones, porque su flete todavía no se ha liquidado.';
  const beto = dia({ candado_aviso: AVISO });

  it('Editar: con el aviso del servidor diciendo "ya se le cobró", no puede decir "ya se pagó"', () => {
    const texto = RecepcionListPage.prototype.tooltipEditar(beto);
    console.log('[zz r2 R4 editar]', texto);
    expect(texto).not.toContain('ya se pagó');
  });

  it('Eliminar: lo mismo', () => {
    const texto = RecepcionListPage.prototype.tooltipEliminar(beto);
    console.log('[zz r2 R4 eliminar]', texto);
    expect(texto).not.toContain('ya se pagó');
  });
});

// -----------------------------------------------------------------------------------
describe('zz revisión 2 · R5: el candado del anticipo sin aviso del servidor, en una parcial sin pagos', () => {
  it('parcial v2 con pagado $0 (la que sus anticipos cubrieron y se corrigió): no hay pago que eliminar', () => {
    const anticipo = {
      id: 'a-1', empresa_id: 'e-1', estado: 'activo',
      created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
      tipo: 'proveedor', proveedor_id: 'p-1', transportador_id: null, empleado_id: null,
      proveedor_nombre: 'Henri', tercero_nombre: 'Henri', fecha: '2026-07-02', valor: '180000',
      observaciones: null, liquidacion_id: 'l-1', pago_empleado_id: null, aplicado: true,
      liquidacion_estado: 'parcial', bloqueado: true,
      // respuesta vieja: sin `candado_aviso`
    } as unknown as Anticipo;
    const texto = AnticipoListPage.prototype.motivoDelCandado(anticipo);
    console.log('[zz r2 R5]', texto);
    // El backend (`_por_que_no_se_mueve`) nombra "ya emitió un comprobante corregido";
    // la pantalla afirma un pago y manda a borrarlo.
    expect(texto).not.toContain('Elimine primero ese pago');
  });
});

// -----------------------------------------------------------------------------------

describe('zz revisión 2 · R6: el aviso del guardado no ve la liquidación a la que el día ENTRA', () => {
  it('cambia el transportador a uno cuyo viaje de ese día ya está en un comprobante: se recuadra y no se dice', () => {
    // Antes: la leche pagada (no se toca) y el flete sin liquidar. El PUT le cambia el
    // transportador; `_volver_al_viaje_ya_cobrado` lo mete en el comprobante F2 de ese
    // viaje y `_recuadrar` lo recuadra (si estaba aprobada, vuelve a borrador).
    const antes = dia({
      liquidacion_estado: 'pagada', liquidacion_estado_leche: 'pagada', liquidacion_estado_flete: null,
      leche_pagada: true, flete_pagado: false, liquidacion_transporte_id: null,
    });
    const despues = dia({
      liquidacion_estado: 'pagada', liquidacion_estado_leche: 'pagada', liquidacion_estado_flete: 'borrador',
      leche_pagada: true, flete_pagado: false, liquidacion_transporte_id: 'l-f2',
    });
    const texto = avisoDelGuardado(antes, despues);
    console.log('[zz r2 R6]', texto);
    expect(texto).not.toBeNull();
  });
});
