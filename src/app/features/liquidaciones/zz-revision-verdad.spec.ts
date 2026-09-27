import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Anticipo, Liquidacion, LiquidacionDetalle, Recepcion } from '../../core/models';
import { RecepcionGrillaTab } from '../recepciones/recepcion-grilla.tab';
import { RecepcionListPage } from '../recepciones/recepcion-list.page';
import { CeldaGrilla } from '../recepciones/recepciones.service';
import { AnticipoListPage } from './anticipo-list.page';
import { laDeudaViejaSeLlevoElNeto } from './cifras-de-la-quincena';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * REVISIÓN ADVERSARIA (verdad en pantalla). Cada `it` DEFECTO afirma lo que la pantalla
 * dice HOY, para dejar la reproducción medida; cuando se arregle, esa prueba falla.
 */

const comoSeLee = (t: string | null | undefined): string =>
  (t ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const leido = (e: Element | null | undefined): string => comoSeLee(e?.textContent);

const det = (id: string, fecha: string, litros: string, precio: string, valor: string): LiquidacionDetalle => ({
  id, fecha, litros, precio_litro: precio, valor, ruta_id: null, ruta_nombre: null, ruta_borrada: false,
});

const base = (c: Partial<Liquidacion>): Liquidacion => ({
  id: 'l-q2',
  empresa_id: 'e-1',
  estado: 'aprobada',
  estado_visible: 'aprobada',
  created_at: '2026-07-16T00:00:00Z',
  updated_at: '2026-07-16T00:00:00Z',
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
  saldo_anterior: '120000',
  neto_a_pagar: '0',
  pagado: '0',
  saldo: '0',
  le_queda_debiendo: '0',
  observaciones: null,
  detalles: [det('d-2', '2026-07-20', '100', '1200', '120000')],
  pagos: [],
  ...c,
});

class ServicioFalso {
  readonly porId = new Subject<Liquidacion>();
  pagos = 0;
  getById(): Observable<Liquidacion> {
    return this.porId as unknown as Observable<Liquidacion>;
  }
  pagar(): Observable<Liquidacion> {
    this.pagos += 1;
    return of(null as unknown as Liquidacion);
  }
}

const abrir = async (item: Liquidacion): Promise<ComponentFixture<LiquidacionDetailDialog>> => {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [LiquidacionDetailDialog, NoopAnimationsModule],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { item } },
      { provide: LiquidacionesService, useValue: new ServicioFalso() },
      { provide: MatSnackBar, useValue: { open: () => {} } },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
      {
        provide: AuthService,
        useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
      },
    ],
  }).compileComponents();
  const f = TestBed.createComponent(LiquidacionDetailDialog);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  return f;
};

const botones = (f: ComponentFixture<LiquidacionDetailDialog>): string[] =>
  Array.from(f.nativeElement.querySelectorAll('mat-dialog-actions button')).map((b) => leido(b as Element));

describe('zz revisión verdad: F4, la quincena en cero por la deuda vieja', () => {
  it('DEFECTO: la ayuda del stepper manda a usar "Pagar", y ese botón no existe', async () => {
    const f = await abrir(base({}));
    const ayuda = leido(f.nativeElement.querySelector('app-liquidacion-estado-stepper .ayuda'));
    const nota = leido(f.nativeElement.querySelector('.nota-saldo-cero'));
    console.log('[zz-rv] ayuda:', ayuda, '| botones:', JSON.stringify(botones(f)), '| nota:', nota);

    expect(f.componentInstance.puedePagar()).toBeFalse();
    expect(f.componentInstance.puedeCerrarSinPago()).toBeFalse();
    expect(botones(f).some((b) => b.endsWith('Pagar') || b.includes('Marcar pagada'))).toBeFalse();
    // Arriba, en el mismo diálogo, la instrucción contraria:
    expect(ayuda).toBe('Los valores quedaron en firme: usa "Pagar" cuando entregues el dinero.');
    // ...y abajo "No hay nada que entregarle ... Se queda aprobada".
    expect(nota).toContain('Se queda aprobada');
  });

  it('DEFECTO (leve): el candado de Recalcular dice "todavía no se le ha pagado nada" junto a "No hay nada que pagar"', async () => {
    const f = await abrir(base({}));
    const motivo = comoSeLee(f.componentInstance.motivoNoRecalcular());
    console.log('[zz-rv] motivoNoRecalcular Q2:', motivo);
    expect(motivo).toContain('todavía no se le ha pagado nada');
    expect(comoSeLee(f.componentInstance.motivoNoPagar())).toContain('No hay nada que entregarle');
  });

  it('BIEN: la pregunta del guardia con cifras como las manda el backend (texto con centavos)', () => {
    const q = (saldo: string, saldo_anterior: string | undefined, pagado: string) =>
      laDeudaViejaSeLlevoElNeto({ saldo, saldo_anterior, pagado });
    // _no_sale_un_peso_por_la_deuda: saldo<=0 Y arrastrada>0 Y sin pagos.
    expect(q('0.00', '120000.00', '0.00')).toBeTrue();
    expect(q('-0.00', '120000.00', '0.00')).toBeTrue();
    expect(q('0.00', '0.00', '0.00')).toBeFalse();
    expect(q('0.00', undefined, '0.00')).toBeFalse();
    expect(q('0.00', '120000.00', '0.01')).toBeFalse();
    expect(q('0.01', '120000.00', '0.00')).toBeFalse();
  });

  it('BIEN: con el cero hecho por sus propios anticipos, "Marcar pagada" sale y llama POST /pagar', async () => {
    const f = await abrir(base({ anticipos: '120000', saldo_anterior: '0' }));
    expect(botones(f).some((b) => b.includes('Marcar pagada'))).toBeTrue();
  });
});

describe('zz revisión verdad: F5, el día cuya deuda ya se cobró en otra', () => {
  const AVISO =
    'Lo que Beto Cobrada quedó debiendo en la quincena de la leche de este día ya se le ' +
    'cobró en la del 16/06/2026 al 30/06/2026: no se puede cambiar la fecha, el proveedor, ' +
    'los litros y el precio por litro. Sí se puede corregir el transportador y las observaciones.';

  it('DEFECTO: la celda de la grilla (tras B3) dice "ya se pagó" e ignora candado_aviso', () => {
    // Forma de CeldaGrilla que manda el backend con B3 (recepcion/schemas.py: pagada =
    // leche_pagada or flete_pagado, y candado_aviso).
    const celda = {
      recepcion_id: 'r-1',
      litros: '100',
      liquidada: true,
      pagada: true,
      leche_pagada: true,
      flete_pagado: false,
      liquidacion_estado: 'aprobada',
      con_transporte: false,
      candado_aviso: AVISO,
    } as unknown as CeldaGrilla;
    const tooltip = RecepcionGrillaTab.prototype.tooltipTrabada.call(null, celda);
    console.log('[zz-rv] grilla tooltip:', tooltip);
    expect(tooltip).toContain('La leche de este día ya se pagó');
    expect(tooltip).not.toContain('ya se le cobró');
  });

  it('DEFECTO: en la misma fila de Recepción, el chip dice "ya se le cobró" y Editar/Eliminar dicen "ya se pagó"', () => {
    const fila = {
      liquidacion_estado: 'aprobada',
      leche_pagada: true,
      flete_pagado: false,
      candado_aviso: AVISO,
    } as unknown as Recepcion;
    const chip = RecepcionListPage.prototype.tooltipChipSinPagar.call(null, fila);
    const editar = RecepcionListPage.prototype.tooltipEditar.call(null, fila);
    const eliminar = RecepcionListPage.prototype.tooltipEliminar.call(null, fila);
    console.log('[zz-rv] chip:', chip, '| editar:', editar, '| eliminar:', eliminar);
    expect(chip).toBe(AVISO);
    expect(editar).toBe('Abrir: la leche ya se pagó, pero el transportador todavía se puede corregir');
    expect(eliminar).toBe('La leche de este día ya se pagó: no se puede eliminar');
  });

  it('DEFECTO: el candado del anticipo (tras B2) manda a eliminar un pago que no existe, y los campos SÍ alcanzan para saberlo', () => {
    // Una liquidación 'aprobada' no puede tener pagos (_estado_pago: pagado <= 0 -> aprobada),
    // así que bloqueado + aprobada solo puede ser la deuda ya cobrada (cifras_congeladas).
    const fila = {
      bloqueado: true,
      liquidacion_estado: 'aprobada',
      liquidacion_id: 'l-q1',
      pago_empleado_id: null,
    } as unknown as Anticipo;
    const motivo = AnticipoListPage.prototype.motivoDelCandado.call(null, fila);
    console.log('[zz-rv] anticipo motivo:', motivo);
    expect(motivo).toContain('ya tiene un pago registrado. Elimine primero ese pago');
  });
});
