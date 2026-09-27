import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { Recepcion } from '../../core/models';
import { RecepcionGrillaTab } from './recepcion-grilla.tab';
import { CeldaGrilla, GrillaQuincena, RecepcionesService } from './recepciones.service';

/**
 * LA CELDA CON CANDADO NO PUEDE DECIR "YA SE PAGÓ" SI NO SE PAGÓ.
 *
 * El día 02/06 de Beto está en una quincena 'aprobada' cuya deuda de $120.000 ya se cobró
 * en la siguiente. El backend lo traba (`pagada` = `leche_pagada || flete_pagado`, el mismo
 * candado del PUT) y escribe el porqué en `candado_aviso`. La celda decía "La leche de
 * este día ya se pagó", la etiqueta para el lector de pantalla "ya salió plata por este
 * día", y la leyenda "Ya se pagó": las tres falsas.
 */

const AVISO =
  'Lo que Beto Cobrada quedó debiendo en la quincena de la leche de este día ya se le ' +
  'cobró en la del 16/06/2026 al 30/06/2026: no se puede cambiar la fecha, el proveedor, ' +
  'los litros, el precio por litro, las bonificaciones, los descuentos y el estado del día. ' +
  'Sí se puede corregir el transportador, la ruta, la sucursal y las observaciones, porque ' +
  'su flete todavía no se ha liquidado.';

const celda = (c: Partial<CeldaGrilla>): CeldaGrilla => ({
  recepcion_id: 'r-b',
  litros: '100.00',
  liquidada: true,
  pagada: true,
  candado_aviso: AVISO,
  leche_pagada: true,
  flete_pagado: false,
  liquidacion_estado: 'aprobada',
  con_transporte: false,
  ...c,
});

const grilla = (c: CeldaGrilla): GrillaQuincena =>
  ({
    desde: '2026-06-01',
    hasta: '2026-06-15',
    fechas: ['2026-06-02'],
    filas: [
      {
        proveedor_id: 'p-b',
        proveedor_nombre: 'Beto Cobrada',
        vereda: null,
        precio_litro: '1800',
        proveedor_activo: true,
        celdas: { '2026-06-02': c },
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
  }) as GrillaQuincena;

const recepcion = (c: Partial<Recepcion>): Recepcion =>
  ({
    id: 'r-b',
    fecha: '2026-06-02',
    proveedor_id: 'p-b',
    proveedor_nombre: 'Beto Cobrada',
    liquidacion_id: 'l-b',
    liquidacion_transporte_id: null,
    liquidacion_estado: 'aprobada',
    liquidacion_estado_leche: 'aprobada',
    liquidacion_estado_flete: null,
    leche_pagada: true,
    flete_pagado: false,
    campos_bloqueados: ['fecha', 'proveedor_id', 'cantidad_litros', 'precio_litro'],
    campos_editables: ['transportador_id', 'observaciones'],
    candado_aviso: AVISO,
    ...c,
  }) as Recepcion;

const PAGINA = <T>(items: T[]) => ({ items, total: items.length, page: 1, page_size: 20, pages: 1 });

const comoSeLee = (t: string | null | undefined): string =>
  (t ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

describe('RecepcionGrillaTab: la celda trabada por una deuda ya cobrada', () => {
  let fixture: ComponentFixture<RecepcionGrillaTab>;
  let mensajes: string[];
  let cierre: unknown;

  beforeEach(() => sessionStorage.clear());

  const armar = async (c: CeldaGrilla, item: Recepcion = recepcion({})): Promise<void> => {
    mensajes = [];
    const servicio = { grilla: () => of(grilla(c)), getById: () => of(item) };
    await TestBed.configureTestingModule({
      imports: [RecepcionGrillaTab, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: MatSnackBar, useValue: { open: (m: string) => mensajes.push(m) } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(cierre) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
        { provide: ApiService, useValue: { get: () => of(PAGINA([])) } },
        { provide: RecepcionesService, useValue: servicio },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RecepcionGrillaTab);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const boton = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('td.celda button') as HTMLButtonElement;

  it('el tooltip es el aviso del servidor, y la etiqueta no dice que salió plata', async () => {
    await armar(celda({}));

    expect(boton().classList).toContain('pagada');
    const tooltip = fixture.debugElement
      .query(By.css('td.celda button'))
      .injector.get(MatTooltip).message;
    expect(tooltip).toBe(AVISO);
    expect(boton().getAttribute('aria-label')).toBe(
      'Ver recepción de Beto Cobrada del 02/06/2026 (tiene campos trabados)',
    );
    expect(boton().getAttribute('aria-label')).not.toContain('plata');
  });

  it('la leyenda del candado no dice "Ya se pagó"', async () => {
    await armar(celda({}));

    const leyenda = comoSeLee(fixture.nativeElement.querySelector('.leyenda')?.textContent);
    expect(leyenda).toContain('Cifras en firme — la celda dice por qué; lo demás se corrige');
    expect(leyenda).not.toContain('Ya se pagó');
  });

  it('sin aviso del servidor: "ya se pagó" solo cuando hay una pagada o una parcial', () => {
    const tooltip = (c: Partial<CeldaGrilla>) =>
      RecepcionGrillaTab.prototype.tooltipTrabada(celda({ candado_aviso: null, ...c }));

    // Trabada sobre una aprobada: no hay pago que nombrar.
    expect(tooltip({})).toBe(
      'Las cifras de este día quedaron en firme: ábralo para ver qué se puede corregir',
    );
    // Sobre una pagada, los textos de siempre.
    expect(tooltip({ liquidacion_estado: 'pagada' })).toContain(
      'La leche de este día ya se pagó',
    );
    expect(tooltip({ liquidacion_estado: 'parcial' })).toContain(
      'hay que eliminar antes el pago en la liquidación',
    );
  });

  it('solo observaciones sobre ese día: "Recepción guardada", sin "volvió a borrador"', async () => {
    const item = recepcion({});
    cierre = recepcion({ observaciones: 'se anotó tarde' }); // la respuesta del PUT: sigue aprobada
    await armar(celda({}), item);

    await fixture.componentInstance.clickCelda(
      fixture.componentInstance.grilla()!.filas[0],
      '2026-06-02',
    );

    expect(mensajes).toEqual(['Recepción guardada']);
  });

  it('en un día sin candado de una aprobada, sí avisa que volvió a borrador', async () => {
    const libre = recepcion({ leche_pagada: false, campos_bloqueados: [], candado_aviso: null });
    cierre = recepcion({
      leche_pagada: false,
      candado_aviso: null,
      liquidacion_estado: 'borrador',
      liquidacion_estado_leche: 'borrador',
    });
    await armar(celda({ pagada: false, leche_pagada: false, candado_aviso: null }), libre);

    await fixture.componentInstance.clickCelda(
      fixture.componentInstance.grilla()!.filas[0],
      '2026-06-02',
    );

    expect(mensajes).toEqual([
      'Recepción guardada. La liquidación de la leche de este día volvió a borrador: ' +
        'revísela y apruébela otra vez.',
    ]);
  });
});
