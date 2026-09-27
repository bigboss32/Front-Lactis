import { TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NEVER, of } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Recepcion } from '../../core/models';
import { RecepcionFormDialog } from './recepcion-form.dialog';
import { RecepcionesService } from './recepciones.service';

/**
 * EL CANDADO DE ELIMINAR DENTRO DEL DIÁLOGO DICE LA RAZÓN DEL SERVIDOR.
 *
 * La 'pagada' que dejó el botón Pagar de antes con Beto debiendo (pagado $0), cuya deuda
 * ya se cobró la siguiente: no salió un peso, y "La leche de este día ya se pagó" lo
 * mandaba a buscar un pago que no existe. El backend escribe el porqué en `candado_aviso`.
 */

const AVISO_DEUDA_COBRADA =
  'Lo que Beto Cobrada quedó debiendo en la quincena de la leche de este día ya se le ' +
  'cobró en la del 16/07/2026 al 31/07/2026: no se puede cambiar los litros, el precio ' +
  'por litro y la fecha. Sí se puede corregir el transportador, la ruta y las ' +
  'observaciones, porque su flete todavía no se ha liquidado.';

const dia = (c: Partial<Recepcion>): Recepcion =>
  ({
    id: 'r-1',
    empresa_id: 'e-1',
    estado: 'activo',
    created_at: '2026-07-03T00:00:00Z',
    updated_at: '2026-07-03T00:00:00Z',
    fecha: '2026-07-03',
    proveedor_id: 'p-b',
    proveedor_nombre: 'Beto Cobrada',
    transportador_id: null,
    ruta_id: null,
    sucursal_id: null,
    cantidad_litros: '90',
    precio_litro: '2000',
    bonificaciones: '0',
    descuentos: '0',
    valor_bruto: '180000',
    valor_transporte: '0',
    valor_neto: '180000',
    observaciones: null,
    liquidacion_id: 'l-b',
    liquidacion_transporte_id: null,
    liquidacion_estado: 'pagada',
    liquidacion_estado_leche: 'pagada',
    liquidacion_estado_flete: null,
    leche_pagada: true,
    flete_pagado: false,
    campos_bloqueados: ['cantidad_litros', 'precio_litro', 'fecha'],
    campos_editables: ['transportador_id', 'ruta_id', 'observaciones'],
    candado_aviso: null,
    ...c,
  }) as Recepcion;

const abrir = async (item: Recepcion): Promise<RecepcionFormDialog> => {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RecepcionFormDialog, NoopAnimationsModule],
    providers: [
      provideNativeDateAdapter(),
      { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
      { provide: MAT_DIALOG_DATA, useValue: { item } },
      {
        provide: MatDialogRef,
        useValue: { close: () => {}, backdropClick: () => NEVER, keydownEvents: () => NEVER },
      },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
      { provide: MatSnackBar, useValue: { open: () => {} } },
      {
        provide: ApiService,
        useValue: { get: () => of({ items: [], total: 0, page: 1, page_size: 100, pages: 1 }) },
      },
      { provide: RecepcionesService, useValue: {} },
    ],
  }).compileComponents();
  return TestBed.createComponent(RecepcionFormDialog).componentInstance;
};

describe('RecepcionFormDialog: por qué no se puede eliminar', () => {
  it('la "pagada" cuya deuda ya se cobró: dice el aviso del servidor, no "ya se pagó"', async () => {
    const dialogo = await abrir(dia({ candado_aviso: AVISO_DEUDA_COBRADA }));

    expect(dialogo.puedeEliminar).toBeFalse();
    expect(dialogo.motivoNoEliminar).toBe(`No se puede eliminar. ${AVISO_DEUDA_COBRADA}`);
    expect(dialogo.motivoNoEliminar).not.toContain('ya se pagó');
  });

  it('con la leche pagada de verdad, también manda el aviso del servidor', async () => {
    const aviso = 'La leche de este día ya se le pagó a Beto Cobrada: …';
    const dialogo = await abrir(dia({ candado_aviso: aviso }));

    expect(dialogo.motivoNoEliminar).toBe(`No se puede eliminar. ${aviso}`);
  });

  it('sin el aviso (respuesta vieja), los textos cortos, y "ya se pagó" solo si fue plata', async () => {
    expect((await abrir(dia({}))).motivoNoEliminar).toBe(
      'La leche de este día ya se pagó: borrarlo descuadraría esa liquidación',
    );
    // Una aprobada nunca tiene pagos: su candado no es plata entregada.
    expect(
      (await abrir(dia({ liquidacion_estado: 'aprobada', liquidacion_estado_leche: 'aprobada' })))
        .motivoNoEliminar,
    ).toBe('Las cifras de este día quedaron en firme: no se puede eliminar');
  });
});
