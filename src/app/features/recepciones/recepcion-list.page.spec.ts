import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabGroup } from '@angular/material/tabs';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { Recepcion } from '../../core/models';
import { RecepcionListPage } from './recepcion-list.page';
import { GrillaQuincena, RecepcionesService } from './recepciones.service';

/**
 * EL CHIP 'Aprobada' NO PUEDE PROMETER CORREGIR UN DÍA TRABADO.
 *
 * La quincena de Beto quedó debiendo $120.000 y esa deuda ya se le cobró en la del 16 al
 * 30 de junio. Sigue 'aprobada', pero sus días quedan en firme: el backend los marca con
 * `leche_pagada` y escribe el porqué en `candado_aviso`. El chip decía "si corrige el
 * día, vuelve a borrador" sobre un día que el servidor no deja corregir.
 */

const AVISO_DEUDA_COBRADA =
  'Lo que Beto Cobrada quedó debiendo en la quincena de la leche de este día ya se le ' +
  'cobró en la del 16/06/2026 al 30/06/2026: no se puede cambiar la fecha, el proveedor, ' +
  'los litros, el precio por litro, las bonificaciones, los descuentos y el estado del día. ' +
  'Sí se puede corregir el transportador, la ruta, la sucursal y las observaciones, porque ' +
  'su flete todavía no se ha liquidado.';

const recepcion = (c: Partial<Recepcion>): Recepcion =>
  ({
    id: 'r-1',
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
    leche_pagada: false,
    flete_pagado: false,
    campos_bloqueados: [],
    campos_editables: [],
    candado_aviso: null,
    ...c,
  }) as Recepcion;

/** La forma B: aprobada, su deuda ya cobrada en otra quincena, días en firme. */
const DEUDA_COBRADA: Partial<Recepcion> = {
  leche_pagada: true,
  campos_bloqueados: ['fecha', 'proveedor_id', 'cantidad_litros', 'precio_litro'],
  candado_aviso: AVISO_DEUDA_COBRADA,
};

const GRILLA_VACIA = {
  desde: '2026-06-01',
  hasta: '2026-06-15',
  fechas: [],
  filas: [],
  totales_dia: {},
  total_litros: '0',
  total_valor_neto: '0',
  total_transporte: '0',
} as unknown as GrillaQuincena;

const PAGINA = <T>(items: T[]) => ({
  items,
  total: items.length,
  page: 1,
  page_size: 20,
  pages: 1,
});

describe('RecepcionListPage: el chip de la liquidación sobre un día trabado', () => {
  let fixture: ComponentFixture<RecepcionListPage>;

  beforeEach(() => sessionStorage.clear());

  const armar = async (fila: Recepcion): Promise<void> => {
    const servicio = {
      grilla: () => of(GRILLA_VACIA),
      getById: () => of(fila),
      filtrar: () => of(PAGINA([fila])),
      resumenPeriodo: () =>
        of({
          desde: '2026-06-01',
          hasta: '2026-06-15',
          total_litros: '100',
          valor_bruto: '180000',
          valor_transporte: '0',
          valor_neto: '180000',
          precio_promedio: '1800',
          dias: [],
        }),
    };
    await TestBed.configureTestingModule({
      imports: [RecepcionListPage, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
        { provide: ApiService, useValue: { get: () => of(PAGINA([])) } },
        { provide: RecepcionesService, useValue: servicio },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RecepcionListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    // La tabla vive en la segunda pestaña (la primera es la grilla).
    const tabs = fixture.debugElement.query(By.directive(MatTabGroup))
      .componentInstance as MatTabGroup;
    tabs.selectedIndex = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** El chip de la columna Liquidación: su texto y lo que dice al pasar el mouse. */
  const chip = (): { texto: string; tooltip: string } => {
    const elemento = fixture.debugElement.query(By.css('span.liq'));
    return {
      texto: (elemento.nativeElement.textContent ?? '').replace(/\s+/g, ' ').trim(),
      tooltip: elemento.injector.get(MatTooltip).message,
    };
  };

  it('aprobada con la deuda ya cobrada: el tooltip es el aviso del servidor, no "vuelve a borrador"', async () => {
    await armar(recepcion(DEUDA_COBRADA));

    expect(chip().texto).toContain('Aprobada');
    expect(chip().tooltip).toBe(AVISO_DEUDA_COBRADA);
    expect(chip().tooltip).not.toContain('vuelve a borrador');
  });

  it('en borrador con la deuda ya cobrada: tampoco promete que "se recalcula"', async () => {
    // La deuda viaja aunque la quincena siga en borrador, y desde que se cobra sus días
    // quedan en firme igual.
    await armar(
      recepcion({
        ...DEUDA_COBRADA,
        liquidacion_estado: 'borrador',
        liquidacion_estado_leche: 'borrador',
      }),
    );

    expect(chip().texto).toContain('En borrador');
    expect(chip().tooltip).toBe(AVISO_DEUDA_COBRADA);
  });

  it('aprobada sin nada trabado: el tooltip de siempre, que ahí sí es cierto', async () => {
    await armar(recepcion({}));

    expect(chip().tooltip).toBe('Aprobada: si corrige el día, vuelve a borrador y se recalcula');
  });

  it('en borrador sin nada trabado: el tooltip de siempre', async () => {
    await armar(
      recepcion({ liquidacion_estado: 'borrador', liquidacion_estado_leche: 'borrador' }),
    );

    expect(chip().tooltip).toBe('En borrador: si corrige el día, la liquidación se recalcula');
  });

  it('trabado sin aviso del servidor: no inventa el porqué ni promete corregir', async () => {
    await armar(recepcion({ ...DEUDA_COBRADA, candado_aviso: null }));

    expect(chip().tooltip).toBe(
      'Las cifras de este día quedaron en firme: ábralo para ver qué se puede corregir',
    );
  });
});

/**
 * EDITAR Y ELIMINAR, AL LADO DEL CHIP, TAMPOCO PUEDEN DECIR "YA SE PAGÓ" SI NO SE PAGÓ.
 *
 * Sobre el día de Beto el chip ya daba la razón real y los dos botones de al lado decían
 * "la leche ya se pagó". "Ya se pagó" queda solo para la plata entregada de verdad (una
 * liquidación pagada o con abono); en los demás candados va el aviso del backend.
 */
describe('RecepcionListPage: Editar y Eliminar sobre un día trabado', () => {
  const pagina = RecepcionListPage.prototype;

  it('deuda ya cobrada: Editar dice el aviso del servidor y Eliminar lo explica', () => {
    const fila = recepcion(DEUDA_COBRADA);

    expect(pagina.tooltipEditar(fila)).toBe(AVISO_DEUDA_COBRADA);
    expect(pagina.tooltipEliminar(fila)).toBe(`No se puede eliminar. ${AVISO_DEUDA_COBRADA}`);
    expect(pagina.tooltipEditar(fila)).not.toContain('ya se pagó');
    expect(pagina.tooltipEliminar(fila)).not.toContain('ya se pagó');
  });

  it('sin aviso del servidor no inventa el porqué, ni dice que se pagó', () => {
    const fila = recepcion({ ...DEUDA_COBRADA, candado_aviso: null });

    expect(pagina.tooltipEditar(fila)).toBe(
      'Las cifras de este día quedaron en firme: ábralo para ver qué se puede corregir',
    );
    expect(pagina.tooltipEliminar(fila)).toBe(
      'Las cifras de este día quedaron en firme: no se puede eliminar',
    );
  });

  it('con la leche pagada de verdad, el aviso del servidor también manda', () => {
    const aviso = 'La leche de este día ya se le pagó a Beto Cobrada: …';
    const fila = recepcion({
      liquidacion_estado: 'pagada',
      liquidacion_estado_leche: 'pagada',
      leche_pagada: true,
      candado_aviso: aviso,
    });

    expect(pagina.tooltipEditar(fila)).toBe(aviso);
    expect(pagina.tooltipEliminar(fila)).toBe(`No se puede eliminar. ${aviso}`);
  });

  it('la "pagada" del Pagar de antes cuya deuda ya se cobró: el estado no dice si fue plata', () => {
    // Pagado $0 y la deuda cobrada en la siguiente: el servidor nombra PRIMERO la deuda
    // cobrada (`_por_que_esta_trabada`), porque "ya se le pagó" sería mentira.
    const fila = recepcion({
      ...DEUDA_COBRADA,
      liquidacion_estado: 'pagada',
      liquidacion_estado_leche: 'pagada',
    });

    expect(pagina.tooltipEditar(fila)).toBe(AVISO_DEUDA_COBRADA);
    expect(pagina.tooltipEliminar(fila)).toBe(`No se puede eliminar. ${AVISO_DEUDA_COBRADA}`);
    expect(pagina.tooltipEditar(fila)).not.toContain('ya se pagó');
    expect(pagina.tooltipEliminar(fila)).not.toContain('ya se pagó');
  });

  it('sin el aviso (respuesta vieja) y con la leche pagada, los textos cortos de siempre', () => {
    const fila = recepcion({
      liquidacion_estado: 'pagada',
      liquidacion_estado_leche: 'pagada',
      leche_pagada: true,
      candado_aviso: null,
    });

    expect(pagina.tooltipEditar(fila)).toBe(
      'Abrir: la leche ya se pagó, pero el transportador todavía se puede corregir',
    );
    expect(pagina.tooltipEliminar(fila)).toBe('La leche de este día ya se pagó: no se puede eliminar');
  });

  it('sin nada trabado, Eliminar es Eliminar', () => {
    expect(pagina.tooltipEliminar(recepcion({ candado_aviso: null }))).toBe('Eliminar');
  });

  it('la leche pagada y el flete trabado por una deuda cobrada: manda el aviso, que dice las dos', () => {
    const fila = recepcion({
      liquidacion_estado: 'pagada',
      liquidacion_estado_leche: 'pagada',
      liquidacion_estado_flete: 'aprobada',
      liquidacion_transporte_id: 'l-flete',
      leche_pagada: true,
      flete_pagado: true,
      candado_aviso: AVISO_DEUDA_COBRADA,
    });

    expect(pagina.tooltipEditar(fila)).toBe(AVISO_DEUDA_COBRADA);
  });
});

/**
 * EL AVISO DESPUÉS DE GUARDAR NO PUEDE DECIR QUE LA LIQUIDACIÓN VOLVIÓ A BORRADOR SI NO
 * VOLVIÓ. Al día de Beto se le corrigen las observaciones: el PUT da 200 y la quincena
 * sigue 'aprobada'. El aviso decía "Esta liquidación volvió a borrador porque cambiaron
 * sus litros". Ver `avisoDelGuardado`.
 */
describe('RecepcionListPage: lo que dice el aviso después de guardar un día', () => {
  let fixture: ComponentFixture<RecepcionListPage>;
  let mensajes: string[];
  let cierre: unknown;

  beforeEach(() => sessionStorage.clear());

  const armar = async (): Promise<void> => {
    mensajes = [];
    const servicio = {
      grilla: () => of(GRILLA_VACIA),
      getById: () => of(recepcion({})),
      filtrar: () => of(PAGINA([])),
      remove: () => of(undefined),
      resumenPeriodo: () =>
        of({
          desde: '2026-06-01',
          hasta: '2026-06-15',
          total_litros: '0',
          valor_bruto: '0',
          valor_transporte: '0',
          valor_neto: '0',
          precio_promedio: '0',
          dias: [],
        }),
    };
    await TestBed.configureTestingModule({
      imports: [RecepcionListPage, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: MatSnackBar, useValue: { open: (m: string) => mensajes.push(m) } },
        // El formulario se cierra con lo que ponga cada prueba (la respuesta del PUT).
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(cierre) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
        { provide: ApiService, useValue: { get: () => of(PAGINA([])) } },
        { provide: RecepcionesService, useValue: servicio },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RecepcionListPage);
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it('el día de Beto, solo observaciones: "Recepción guardada" y nada más', async () => {
    const antes = recepcion(DEUDA_COBRADA);
    cierre = recepcion({ ...DEUDA_COBRADA, observaciones: 'se anotó tarde' });
    await armar();

    fixture.componentInstance.abrirFormulario(antes);

    expect(mensajes).toEqual(['Recepción guardada']);
  });

  it('aprobada sin nada trabado: la respuesta dice que volvió a borrador, y el aviso también', async () => {
    cierre = recepcion({ liquidacion_estado: 'borrador', liquidacion_estado_leche: 'borrador' });
    await armar();

    fixture.componentInstance.abrirFormulario(recepcion({}));

    expect(mensajes).toEqual([
      'Recepción guardada. La liquidación de la leche de este día volvió a borrador: ' +
        'revísela y apruébela otra vez.',
    ]);
  });

  it('en borrador trabado por la deuda cobrada: tampoco dice que se recalculó', async () => {
    const borrador = {
      ...DEUDA_COBRADA,
      liquidacion_estado: 'borrador' as const,
      liquidacion_estado_leche: 'borrador' as const,
    };
    cierre = recepcion(borrador);
    await armar();

    fixture.componentInstance.abrirFormulario(recepcion(borrador));

    expect(mensajes).toEqual(['Recepción guardada']);
  });

  it('borrar un día de una aprobada sí la devuelve a borrador, y lo dice', async () => {
    cierre = true; // la confirmación
    await armar();

    fixture.componentInstance.eliminar(recepcion({}));
    await fixture.whenStable();

    expect(mensajes).toEqual([
      'Recepción eliminada. La liquidación de la leche de este día volvió a borrador: ' +
        'revísela y apruébela otra vez.',
    ]);
  });
});
