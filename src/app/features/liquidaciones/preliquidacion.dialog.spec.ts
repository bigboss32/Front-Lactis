import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { EMPTY, Observable, of } from 'rxjs';

import { Page, Proveedor, Transportador } from '../../core/models';
import { ProveedoresService } from '../proveedores/proveedores.service';
import { TransportadoresService } from '../transportadores/transportadores.service';
import { LiquidacionesService, PreLiquidacion } from './liquidaciones.service';
import { PreLiquidacionDialog } from './preliquidacion.dialog';

/**
 * La PRE-LIQUIDACIÓN es el "¿cómo va?" que el dueño mira a mitad de quincena, y se
 * comparte por WhatsApp con el mismo tercero al que después le llega el comprobante.
 * O sea que es un desglose, y le aplica la misma regla que al comprobante: cada
 * renglón tiene que poder comprobarse (litros × precio = valor) y la columna tiene
 * que sumar EXACTO la cifra grande.
 *
 * Sin la columna Precio/L la cuenta del medio no estaba en la pantalla, y dos
 * renglones del mismo día y la MISMA ruta —partidos porque le cambiaron la tarifa a
 * mitad de quincena— se leían como la misma línea repetida con valores distintos.
 */

const vacia = <T>(): Observable<Page<T>> =>
  of({ items: [], total: 0, page: 1, page_size: 200, pages: 1 });

class ServicioFalso {
  previsualizar(): Observable<PreLiquidacion[]> {
    return EMPTY;
  }
}

/** El avance del transportador: un día con dos rutas y otro con la tarifa cambiada. */
const AVANCE: PreLiquidacion = {
  tipo: 'transportador',
  tercero_id: 't-1',
  tercero_nombre: 'Alex Agudelo',
  tercero_detalle: null,
  periodo_inicio: '2026-07-01',
  periodo_fin: '2026-07-15',
  total_litros: '175',
  precio_promedio: '0',
  valor_bruto: '0',
  bonificaciones: '0',
  descuentos: '0',
  // 19.906,32 + 24.600 + 1.213,80 + 1.500 = 47.220,12
  valor_transporte: '47220.12',
  anticipos: '0',
  valor_total: '47220.12',
  saldo: '47220.12',
  detalles: [
    {
      fecha: '2026-07-07',
      litros: '82',
      precio_litro: '242.76',
      valor: '19906.32',
      ruta_id: 'r-nap',
      ruta_nombre: 'Nápoles',
    },
    {
      fecha: '2026-07-07',
      litros: '82',
      precio_litro: '300.00',
      valor: '24600.00',
      ruta_id: 'r-mir',
      ruta_nombre: 'Mira Valle',
    },
    // El MISMO día y la MISMA ruta, partido en dos porque le cambiaron la tarifa:
    // sin la columna del precio son dos líneas iguales con valores distintos.
    {
      fecha: '2026-07-08',
      litros: '5',
      precio_litro: '242.76',
      valor: '1213.80',
      ruta_id: 'r-nap',
      ruta_nombre: 'Nápoles',
    },
    {
      fecha: '2026-07-08',
      litros: '6',
      precio_litro: '250.00',
      valor: '1500.00',
      ruta_id: 'r-nap',
      ruta_nombre: 'Nápoles',
      ruta_borrada: true,
    },
  ],
  anticipos_detalle: [],
};

describe('PreLiquidacionDialog: el avance también es un desglose', () => {
  let fixture: ComponentFixture<PreLiquidacionDialog>;
  let dialogo: PreLiquidacionDialog;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PreLiquidacionDialog, NoopAnimationsModule],
      providers: [
        // El diálogo lleva dos calendarios; sin adaptador de fecha no se construye.
        // Es el mismo que usa la aplicación (ver app.config.ts).
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: LiquidacionesService, useValue: new ServicioFalso() },
        { provide: ProveedoresService, useValue: { list: () => vacia<Proveedor>() } },
        { provide: TransportadoresService, useValue: { list: () => vacia<Transportador>() } },
        { provide: MatDialogRef, useValue: { close: () => {} } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PreLiquidacionDialog);
    dialogo = fixture.componentInstance;
    fixture.detectChanges();
  });

  /** El resultado se pone A MANO: lo que se prueba es cómo se PINTA, no la llamada. */
  const conElAvance = async (avance: PreLiquidacion = AVANCE): Promise<void> => {
    dialogo.resultado.set(avance);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const detalleEnPantalla = (): string[][] => {
    const tabla = fixture.nativeElement.querySelector('table.detalle') as HTMLTableElement;
    return Array.from(tabla.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td')).map((c) =>
        (c.textContent ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(),
      ),
    );
  };

  const resumenEnPantalla = (): Record<string, string> => {
    const celdas = Array.from(
      (fixture.nativeElement.querySelector('.resumen') as HTMLElement).children,
    ).map((c) =>
      ((c as HTMLElement).textContent ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(),
    );
    const resumen: Record<string, string> = {};
    for (let i = 0; i + 1 < celdas.length; i += 2) resumen[celdas[i]] = celdas[i + 1];
    return resumen;
  };

  /** Centavos enteros: sumar en coma flotante se desvía justo por el centavo. */
  const centavos = (texto: string): number =>
    Math.round(Number(texto.replace(/[^\d,-]/g, '').replace(',', '.')) * 100);

  it('el detalle lleva la TARIFA, así que cada renglón se puede comprobar a mano', async () => {
    await conElAvance();

    expect(detalleEnPantalla()[0]).toEqual(['Fecha', 'Ruta', 'Litros', 'Precio/L', 'Valor']);
    expect(detalleEnPantalla().slice(1)).toEqual([
      ['07/07/2026', 'Nápoles', '82 L', '$ 242,76', '$ 19.906,32'],
      ['07/07/2026', 'Mira Valle', '82 L', '$ 300', '$ 24.600'],
      // Mismo día, misma ruta: lo único que los distingue es la tarifa.
      ['08/07/2026', 'Nápoles', '5 L', '$ 242,76', '$ 1.213,80'],
      ['08/07/2026', 'Nápoles (borrada)', '6 L', '$ 250', '$ 1.500'],
    ]);
  });

  it('la columna Valor suma exacto el Valor transporte del resumen', async () => {
    await conElAvance();

    const sumado = detalleEnPantalla()
      .slice(1)
      .reduce((total, fila) => total + centavos(fila[4]), 0);

    expect(sumado).toBe(4722012); // $ 47.220,12
    const resumen = resumenEnPantalla();
    expect(resumen['Valor transporte']).toBe('$ 47.220,12');
    expect(centavos(resumen['Valor transporte'])).toBe(sumado);
    expect(centavos(resumen['Valor total'])).toBe(sumado);
  });

  it('el avance del proveedor también lleva la tarifa, pero no la ruta', async () => {
    await conElAvance({
      ...AVANCE,
      tipo: 'proveedor',
      total_litros: '81.99',
      precio_promedio: '1750',
      valor_bruto: '143482.50',
      valor_transporte: '0',
      valor_total: '143482.50',
      saldo: '143482.50',
      detalles: [
        { fecha: '2026-07-07', litros: '81.99', precio_litro: '1750', valor: '143482.50' },
      ],
    });

    expect(detalleEnPantalla()[0]).toEqual(['Fecha', 'Litros', 'Precio/L', 'Valor']);
    // Los litros con sus dos decimales y el valor completo, como en el PDF.
    expect(detalleEnPantalla()[1]).toEqual([
      '07/07/2026',
      '81,99 L',
      '$ 1.750',
      '$ 143.482,50',
    ]);
    expect(resumenEnPantalla()['Valor bruto']).toBe('$ 143.482,50');
  });
});
