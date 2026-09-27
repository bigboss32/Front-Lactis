import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabGroup } from '@angular/material/tabs';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { Anticipo, Recepcion } from '../../core/models';
import { AnticipoListPage } from '../liquidaciones/anticipo-list.page';
import { AnticiposService } from '../liquidaciones/anticipos.service';
import { RecepcionGrillaTab } from './recepcion-grilla.tab';
import { RecepcionListPage } from './recepcion-list.page';
import { CeldaGrilla, GrillaQuincena, RecepcionesService } from './recepciones.service';

/**
 * LAS OTRAS PANTALLAS FRENTE A LAS QUINCENAS QUE YA EXISTEN Y DICEN
 * "pagada · quedó debiendo" EN LA LISTA DE LIQUIDACIONES.
 *
 * Los datos son LA RESPUESTA REAL del backend para la forma B (quincena 'aprobada' con
 * saldo -$120.000 cuya deuda YA SE COBRÓ en la quincena siguiente), copiada de lo que
 * imprime Back-Lactis/tests/test_zz_existentes_superficies.py::test_4 y ::test_5:
 *
 *   celda grilla : liquidada=true, pagada=false, leche_pagada=true, liquidacion_estado='aprobada'
 *   recepción    : liquidacion_estado='aprobada', leche_pagada=true, campos_bloqueados=[...]
 *   anticipo     : liquidacion_estado='aprobada', bloqueado=false  (el PUT/DELETE da 422)
 *
 * Y la forma A (misma quincena, deuda SIN cobrar): los mismos campos con
 * leche_pagada=false y sin candado_aviso.
 */

const AVISO_B =
  'Lo que Beto Cobrada quedó debiendo en la quincena de la leche de este día ya se le ' +
  'cobró en la del 16/06/2026 al 30/06/2026: no se puede cambiar la fecha, el proveedor, ' +
  'los litros, el precio por litro, las bonificaciones, los descuentos y el estado del día. ' +
  'Sí se puede corregir el transportador, la ruta, la sucursal y las observaciones, porque ' +
  'su flete todavía no se ha liquidado.';

const CELDA_B: CeldaGrilla = {
  recepcion_id: 'r-b',
  litros: '100.00',
  liquidada: true,
  pagada: false,
  leche_pagada: true,
  flete_pagado: false,
  liquidacion_estado: 'aprobada',
  con_transporte: false,
};

const GRILLA: GrillaQuincena = {
  desde: '2026-06-01',
  hasta: '2026-06-15',
  fechas: ['2026-06-02'],
  filas: [
    {
      proveedor_id: 'p-b',
      proveedor_nombre: 'Beto Cobrada',
      vereda: 'El Roble',
      precio_litro: '1800',
      proveedor_activo: true,
      celdas: { '2026-06-02': CELDA_B },
      total_litros: '100',
      valor_bruto: '180000',
      descuentos: '0',
      bonificaciones: '0',
      valor_neto: '180000',
      valor_transporte: '0',
    },
  ],
  totales_dia: { '2026-06-02': '100' },
  total_litros: '100',
  total_valor_neto: '180000',
  total_transporte: '0',
} as unknown as GrillaQuincena;

const RECEPCION_B = {
  id: 'r-b',
  empresa_id: 'e-1',
  estado: 'activo',
  created_at: '2026-06-02T00:00:00Z',
  updated_at: '2026-06-02T00:00:00Z',
  fecha: '2026-06-02',
  proveedor_id: 'p-b',
  proveedor_nombre: 'Beto Cobrada',
  transportador_id: null,
  ruta_id: null,
  sucursal_id: null,
  cantidad_litros: '100.00',
  precio_litro: '1800.00',
  bonificaciones: '0',
  descuentos: '0',
  valor_bruto: '180000.00',
  valor_transporte: '0',
  valor_neto: '180000.00',
  observaciones: null,
  liquidacion_id: 'l-b',
  liquidacion_transporte_id: null,
  liquidacion_estado: 'aprobada',
  liquidacion_estado_leche: 'aprobada',
  liquidacion_estado_flete: null,
  leche_pagada: true,
  flete_pagado: false,
  campos_bloqueados: ['fecha', 'proveedor_id', 'cantidad_litros', 'precio_litro', 'bonificaciones', 'descuentos', 'estado'],
  campos_editables: ['transportador_id', 'ruta_id', 'sucursal_id', 'observaciones'],
  candado_aviso: AVISO_B,
} as unknown as Recepcion;

const ANTICIPO_B = {
  id: 'a-b',
  empresa_id: 'e-1',
  estado: 'activo',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-b',
  transportador_id: null,
  empleado_id: null,
  proveedor_nombre: 'Beto Cobrada',
  tercero_nombre: 'Beto Cobrada',
  fecha: '2026-06-01',
  valor: '300000.00',
  observaciones: null,
  liquidacion_id: 'l-b',
  pago_empleado_id: null,
  aplicado: true,
  liquidacion_estado: 'aprobada',
  bloqueado: false,
} as unknown as Anticipo;

const PAGINA = <T>(items: T[]) => ({ items, total: items.length, page: 1, page_size: 20, pages: 1 });

function proveedores(extra: unknown[] = []) {
  return [
    provideNativeDateAdapter(),
    { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
    { provide: MatSnackBar, useValue: { open: () => {} } },
    { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
    {
      provide: AuthService,
      useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
    },
    { provide: ApiService, useValue: { get: () => of(PAGINA([])) } },
    ...extra,
  ];
}

describe('zz existentes · otras superficies con la forma B (deuda ya cobrada)', () => {
  beforeEach(() => sessionStorage.clear());

  it('GRILLA: la celda de B se pinta como "liquidación sin pagar", sin candado, y el tooltip promete volver a borrador', async () => {
    const servicio = { grilla: () => of(GRILLA), getById: () => of(RECEPCION_B) };
    await TestBed.configureTestingModule({
      imports: [RecepcionGrillaTab, NoopAnimationsModule],
      providers: proveedores([{ provide: RecepcionesService, useValue: servicio }]),
    }).compileComponents();
    const fixture: ComponentFixture<RecepcionGrillaTab> = TestBed.createComponent(RecepcionGrillaTab);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const td: HTMLElement = fixture.nativeElement.querySelector('td.celda');
    expect(td).withContext('la grilla no pintó la celda del 02/06').not.toBeNull();
    const boton = td.querySelector('button') as HTMLButtonElement;
    console.log('[zz grilla B] clases del botón:', boton.className,
      '| aria-label:', boton.getAttribute('aria-label'),
      '| candado:', !!td.querySelector('mat-icon.candado'));
    expect(td.querySelector('mat-icon.candado')).withContext('B no lleva candado en la grilla').toBeNull();
    expect(boton.classList).toContain('en-liquidacion');
    expect(boton.getAttribute('aria-label')).toContain('ya está en una liquidación sin pagar');

    const tooltip = fixture.componentInstance.tooltipCelda(CELDA_B, '2026-06-02');
    console.log('[zz grilla B] tooltip:', tooltip);
    expect(tooltip).toContain('liquidación APROBADA');
    expect(tooltip).toContain('vuelve a borrador');
  });

  it('LISTA DE RECEPCIONES: el chip de B dice "Aprobada" y su tooltip dice que al corregir vuelve a borrador', async () => {
    const servicio = {
      grilla: () => of(GRILLA),
      getById: () => of(RECEPCION_B),
      filtrar: () => of(PAGINA([RECEPCION_B])),
      resumenPeriodo: () =>
        of({ desde: '2026-06-01', hasta: '2026-06-15', total_litros: '100', valor_bruto: '180000', valor_transporte: '0', valor_neto: '180000', precio_promedio: '1800', dias: [] }),
    };
    await TestBed.configureTestingModule({
      imports: [RecepcionListPage, NoopAnimationsModule],
      providers: proveedores([{ provide: RecepcionesService, useValue: servicio }]),
    }).compileComponents();
    const fixture = TestBed.createComponent(RecepcionListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const tabs = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabs.selectedIndex = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const chip: HTMLElement | null = fixture.nativeElement.querySelector('span.liq');
    expect(chip).withContext('no se pintó la columna Liquidación').not.toBeNull();
    const texto = (chip!.textContent ?? '').replace(/\s+/g, ' ').trim();
    console.log('[zz lista B] chip:', texto, '| clases:', chip!.className);
    expect(texto).toContain('Aprobada');
    expect(chip!.classList).toContain('en-liquidacion');
    expect(chip!.querySelector('mat-icon')?.textContent?.trim()).toBe('check_circle');
    const tooltip = fixture.componentInstance.tooltipEditar(RECEPCION_B);
    console.log('[zz lista B] tooltip del botón editar:', tooltip);
  });

  it('ANTICIPOS: al de B le ofrece Editar/Eliminar con el aviso "liquidación APROBADA… vuelve a borrador" (el servidor da 422)', async () => {
    const servicio = { list: () => of(PAGINA([ANTICIPO_B])), sumaTotales: () => of(300000) };
    await TestBed.configureTestingModule({
      imports: [AnticipoListPage, NoopAnimationsModule],
      providers: proveedores([{ provide: AnticiposService, useValue: servicio }]),
    }).compileComponents();
    const fixture = TestBed.createComponent(AnticipoListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const iconos = Array.from(fixture.nativeElement.querySelectorAll('td.col-acciones mat-icon')).map(
      (i) => (i as HTMLElement).textContent?.trim(),
    );
    const aviso = fixture.componentInstance.avisoAlTocar(ANTICIPO_B);
    console.log('[zz anticipos B] íconos de acciones:', iconos, '| aviso:', aviso);
    expect(iconos).toContain('edit');
    expect(iconos).toContain('delete');
    expect(iconos).not.toContain('lock');
    expect(aviso).toContain('liquidación APROBADA');
    expect(aviso).toContain('vuelve a borrador');
  });
});
