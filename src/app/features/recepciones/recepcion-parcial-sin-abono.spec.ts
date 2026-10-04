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
import { RecepcionGrillaTab } from './recepcion-grilla.tab';
import { RecepcionListPage } from './recepcion-list.page';
import { CeldaGrilla, GrillaQuincena, RecepcionesService } from './recepciones.service';

/**
 * LA QUINCENA CORREGIDA QUE QUEDÓ 'parcial' SIN UN SOLO PAGO NO TIENE "ABONO".
 *
 * Camino A: 100 L × $1.800 = $180.000 el 02/06, cubiertos exacto por un adelanto de
 * $180.000; Pagar la cierra 'pagada' con pagado $0. Corregir le mete un día olvidado de
 * 20 L = $36.000 y queda 'parcial' v2, pagado $0, sin pagos, saldo $36.000
 * (216.000 − 180.000 − 0 = 36.000). Camino C: sin adelanto, se paga con $180.000, se
 * corrige con los mismos 20 L y se borra ese pago mal registrado: 'parcial' v2, pagado
 * $0, sin pagos, saldo $216.000. En los dos, el día 02/06 de Recepción diaria llega con
 * `liquidacion_estado` 'parcial' y el chip decía "Con abono" al lado de un tooltip que
 * dice "ya emitió un comprobante corregido". No ha salido un peso por pagos.
 */

const AVISO_CORREGIDA =
  'La quincena de la leche de este día ya emitió un comprobante corregido: no se puede ' +
  'cambiar la fecha, el proveedor, los litros, el precio por litro, las bonificaciones, ' +
  'los descuentos y el estado del día. Sí se puede corregir el transportador, la ruta, la ' +
  'sucursal y las observaciones, porque su flete todavía no se ha liquidado.';

const AVISO_ABONO =
  'La leche de este día ya se le abonó a Rosa Abonada: no se puede cambiar la fecha, el ' +
  'proveedor, los litros, el precio por litro, las bonificaciones, los descuentos y el ' +
  'estado del día. Sí se puede corregir el transportador, la ruta, la sucursal y las ' +
  'observaciones, porque su flete todavía no se ha liquidado.';

/** El día 02/06 tal como lo manda el servidor: 100 L × $1.800, en la quincena 'parcial'. */
const dia = (c: Partial<Recepcion>): Recepcion =>
  ({
    id: 'r-0206',
    empresa_id: 'e-1',
    estado: 'activo',
    created_at: '2026-06-02T00:00:00Z',
    updated_at: '2026-06-02T00:00:00Z',
    fecha: '2026-06-02',
    proveedor_id: 'p-36',
    proveedor_nombre: 'V2R Treinta Y Seis',
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
    liquidacion_id: 'l-36',
    liquidacion_transporte_id: null,
    liquidacion_estado: 'parcial',
    liquidacion_estado_leche: 'parcial',
    liquidacion_estado_flete: null,
    leche_pagada: true,
    flete_pagado: false,
    campos_bloqueados: [
      'fecha', 'proveedor_id', 'cantidad_litros', 'precio_litro', 'bonificaciones',
      'descuentos', 'estado',
    ],
    campos_editables: ['transportador_id', 'ruta_id', 'sucursal_id', 'observaciones'],
    candado_aviso: AVISO_CORREGIDA,
    liquidacion_con_abono: false,
    ...c,
  }) as Recepcion;

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

describe('Recepción diaria: el chip de una quincena "parcial" sin ningún abono', () => {
  let fixture: ComponentFixture<RecepcionListPage>;

  beforeEach(() => {
    try {
      sessionStorage.clear();
    } catch {
      /* sin almacenamiento: nada que limpiar */
    }
  });

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

  const chip = (): { texto: string; tooltip: string } => {
    const elemento = fixture.debugElement.query(By.css('span.liq'));
    return {
      texto: (elemento.nativeElement.textContent ?? '').replace(/\s+/g, ' ').trim(),
      tooltip: elemento.injector.get(MatTooltip).message,
    };
  };

  it('caminos A y C (pagado $0, sin pagos): "En firme" y el porqué del servidor', async () => {
    // El día 02/06 llega igual por los dos caminos: lo que cambia es el saldo de la
    // quincena ($36.000 o $216.000), que el día no trae.
    await armar(dia({}));

    expect(chip().texto).toBe('lock En firme');
    expect(chip().texto).not.toContain('abono');
    expect(chip().tooltip).toBe(AVISO_CORREGIDA);
  });

  it('la parcial con un abono de verdad sigue diciendo "Con abono"', async () => {
    await armar(
      dia({
        proveedor_nombre: 'Rosa Abonada',
        candado_aviso: AVISO_ABONO,
        liquidacion_con_abono: true,
      }),
    );

    expect(chip().texto).toBe('lock Con abono');
    expect(chip().tooltip).toBe(AVISO_ABONO);
  });

  it('una respuesta vieja, sin la señal del servidor: el chip de siempre', async () => {
    const vieja = dia({ candado_aviso: AVISO_ABONO });
    delete (vieja as Partial<Recepcion>).liquidacion_con_abono;
    await armar(vieja);

    expect(chip().texto).toBe('lock Con abono');
  });
});

describe('Recepción diaria: la celda de una "parcial" sin aviso del servidor', () => {
  const celda = (c: Partial<CeldaGrilla>): CeldaGrilla => ({
    recepcion_id: 'r-0206',
    litros: '100.00',
    liquidada: true,
    pagada: true,
    candado_aviso: null,
    leche_pagada: true,
    flete_pagado: false,
    liquidacion_estado: 'parcial',
    con_transporte: false,
    ...c,
  });

  it('no manda a "eliminar antes el pago": la celda no sabe si ese pago existe', () => {
    // La corregida del camino A no tiene ningún pago, y en una corregida que sí lo tiene
    // borrarlo no la destraba (sigue en la versión 2).
    const tooltip = RecepcionGrillaTab.prototype.tooltipTrabada(celda({}));

    expect(tooltip).not.toContain('eliminar antes el pago');
    expect(tooltip).not.toContain('abon');
  });

  it('con el aviso del servidor, la celda dice ese aviso tal cual', () => {
    expect(
      RecepcionGrillaTab.prototype.tooltipTrabada(celda({ candado_aviso: AVISO_CORREGIDA })),
    ).toBe(AVISO_CORREGIDA);
  });
});
