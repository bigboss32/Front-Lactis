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

  it('el día completo se lee igual que en el comprobante y que en el papel', async () => {
    // El avance imprime un PDF que se comparte por WhatsApp con el MISMO conductor al
    // que después le llega el comprobante: si la pantalla dijera "$ 0,00" donde el
    // papel dice "Día completo", el dueño estaría mandando un documento que no se
    // parece a lo que él está viendo. Y la columna sigue sumando la cifra grande.
    await conElAvance({
      ...AVANCE,
      total_litros: '499.95',
      tiene_dias_fijos: true,
      valor_transporte: '150000.00',
      valor_total: '150000.00',
      saldo: '150000.00',
      detalles: [
        {
          fecha: '2026-07-16',
          litros: '499.95',
          // La tarifa viaja en cero: en un día fijo no existe ninguna por litro.
          precio_litro: '0',
          valor: '150000.00',
          ruta_id: 'r-fab',
          ruta_nombre: 'A fábrica',
          modo_transporte: 'dia_fijo',
          // Este día vale sus $150.000: no es ningún día ya cobrado en otra parte.
          dia_fijo_ya_cobrado: false,
        },
      ],
    });

    expect(detalleEnPantalla().slice(1)).toEqual([
      ['16/07/2026', 'A fábrica', '499,95 L', 'Día completo', '$ 150.000'],
    ]);
    const texto = (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ');
    expect(texto).toContain('«Día completo» se cobran POR DÍA y no por litro');
    expect(centavos(resumenEnPantalla()['Valor transporte'])).toBe(15000000);
  });

  it('en el avance, un fijo en $0,00 dice lo que el backend diga y no lo que el cero parezca', async () => {
    // LAS DOS RAZONES POR LAS QUE UN FIJO VALE $0,00, y la pantalla no las puede
    // confundir: el día ya se cobró en OTRO comprobante («Ya cobrado») o la tarifa fija
    // de esa ruta es de $0,00 y a nadie se le ha pagado nada («Día completo»). Antes se
    // deducía del cero y la mitad de las veces era falso; el avance se le manda al
    // conductor por WhatsApp, así que afirmarle un pago que no ocurrió es peor acá.
    await conElAvance({
      ...AVANCE,
      total_litros: '178.00',
      tiene_dias_fijos: true,
      valor_transporte: '0',
      valor_total: '0',
      saldo: '0',
      detalles: [
        {
          fecha: '2026-07-16',
          litros: '82.00',
          precio_litro: '0',
          valor: '0',
          ruta_id: 'r-fab',
          ruta_nombre: 'A fábrica',
          modo_transporte: 'dia_fijo',
          dia_fijo_ya_cobrado: true,
        },
        {
          fecha: '2026-07-17',
          litros: '96.00',
          precio_litro: '0',
          valor: '0',
          ruta_id: 'r-fab',
          ruta_nombre: 'A fábrica',
          modo_transporte: 'dia_fijo',
          dia_fijo_ya_cobrado: false,
        },
      ],
    });

    expect(detalleEnPantalla().slice(1)).toEqual([
      ['16/07/2026', 'A fábrica', '82 L', 'Ya cobrado', '$ 0'],
      ['17/07/2026', 'A fábrica', '96 L', 'Día completo', '$ 0'],
    ]);
  });

  it('sin días fijos el avance de siempre no cambia ni una palabra', async () => {
    await conElAvance();

    expect(fixture.nativeElement.textContent).not.toContain('Día completo');
    expect(fixture.nativeElement.querySelector('.nota-dia-fijo')).toBeNull();
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

  /** Los rótulos del resumen de arriba abajo: el orden ES la cuenta. */
  const rotulosDelResumen = (): string[] =>
    Array.from((fixture.nativeElement.querySelector('.resumen') as HTMLElement).children)
      .filter((_, i) => i % 2 === 0)
      .map((c) => ((c as HTMLElement).textContent ?? '').replace(/\s+/g, ' ').trim());

  it('el resumen se lee en el orden en que se resta, igual que el comprobante', async () => {
    // El mismo defecto que tenía el comprobante: "Anticipos aplicados" salía ARRIBA de
    // "Valor total", y son un descuento DEL total. El dueño suma y resta de arriba abajo,
    // y este avance se lo manda al tercero por WhatsApp antes de que exista el papel.
    await conElAvance({ ...AVANCE, anticipos: '7220.12', saldo: '40000.00' });

    expect(rotulosDelResumen()).toEqual([
      'Total litros',
      'Valor transporte',
      'Valor total',
      'Anticipos aplicados',
      'Saldo estimado',
    ]);
    const resumen = resumenEnPantalla();
    // Con su signo de resta, como en el PDF: 47.220,12 − 7.220,12 = 40.000.
    expect(resumen['Anticipos aplicados']).toBe('− $ 7.220,12');
    expect(centavos(resumen['Valor total']) - centavos(resumen['Anticipos aplicados'])).toBe(
      centavos(resumen['Saldo estimado']),
    );
  });

  it('avisa que el avance puede quedar corto: la liquidación de verdad cobra lo que se debía', async () => {
    // El avance no aparta ni conoce las deudas de quincenas pasadas. Si el dueño le
    // promete esta cifra al proveedor y después la liquidación le descuenta lo que quedó
    // debiendo, la discusión la pierde él.
    await conElAvance();

    const aviso = (
      fixture.nativeElement.querySelector('.aviso-estimado') as HTMLElement
    ).textContent;
    expect((aviso ?? '').replace(/\s+/g, ' ')).toContain(
      'si Alex Agudelo quedó debiendo algo de una quincena pasada',
    );
  });

  it('cuando el servidor mande la deuda, el renglón sale y el aviso se quita', async () => {
    // El campo es opcional: hoy llega en `undefined`. Este es el día en que llegue.
    await conElAvance({ ...AVANCE, saldo_anterior: '4955.77', saldo: '42264.35' });

    const resumen = resumenEnPantalla();
    expect(resumen['Lo que quedó debiendo de la quincena pasada']).toBe('− $ 4.955,77');
    // 47.220,12 − 0 − 4.955,77 = 42.264,35: la columna cuadra con el renglón nuevo.
    expect(centavos(resumen['Valor total']) - centavos(resumen['Lo que quedó debiendo de la quincena pasada'])).toBe(
      centavos(resumen['Saldo estimado']),
    );
    expect(fixture.nativeElement.querySelector('.aviso-estimado')).toBeNull();
  });

  /**
   * LA PANTALLA DEL AVANCE Y EL PAPEL DEL MISMO AVANCE TIENEN QUE DECIR LO MISMO.
   *
   * El caso medido en el backend, con las cifras: Henri quedó debiendo $120.000 de la
   * quincena pasada y su avance de la quincena en curso va en $250.000. El PDF de este
   * mismo avance ya avisaba que van a salir $130.000; la pantalla decía $250.000 y nada
   * más. El dueño manda el papel mirando la pantalla, así que las palabras y las cifras
   * del aviso son LAS DEL PAPEL.
   */
  const AVISO = '.aviso-deuda';
  /** El espacio del formateador de pesos es duro (U+00A0): se normaliza para comparar. */
  // El texto del aviso va en su <span>: el <mat-icon> hermano mete su ligadura
  // ("report_problem") en el textContent del párrafo entero.
  const textoDelAviso = (): string =>
    ((fixture.nativeElement.querySelector(`${AVISO} span`) as HTMLElement | null)?.textContent ??
      '')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const AVANCE_CON_DEUDA: PreLiquidacion = {
    ...AVANCE,
    tipo: 'proveedor',
    tercero_nombre: 'Henri C',
    total_litros: '100',
    precio_promedio: '2500',
    valor_bruto: '250000',
    valor_transporte: '0',
    valor_total: '250000',
    anticipos: '0',
    saldo: '250000',
    deuda_pendiente: '120000',
    detalles: [{ fecha: '2026-06-20', litros: '100', precio_litro: '2500', valor: '250000' }],
  };

  it('avisa la deuda con las MISMAS palabras del papel, y con el saldo de verdad', async () => {
    await conElAvance(AVANCE_CON_DEUDA);

    expect(textoDelAviso()).toBe(
      'AVISO: este avance TODAVÍA NO DESCUENTA lo que Henri C quedó debiendo de quincenas ' +
        'anteriores ($ 120.000). Ese saldo se le cobra en el momento de generar la ' +
        'liquidación oficial, así que el saldo de verdad va a quedar en $ 130.000 y no en ' +
        'el SALDO ESTIMADO de arriba.',
    );
    // El aviso genérico se va: ya no es "puede que baje", es "va a bajar, y a esto".
    expect(fixture.nativeElement.querySelector('.aviso-estimado')).toBeNull();
  });

  it('la deuda NO se resta en la columna, igual que en el papel: el desglose sigue cuadrando', async () => {
    // El avance no genera nada ni aparta ninguna deuda, así que no puede prometer el
    // descuento. Lo que NO puede pasar es que aparezca un renglón "− $120.000" encima de
    // un saldo que no lo tiene restado: el dueño suma la columna a mano.
    await conElAvance(AVANCE_CON_DEUDA);

    const r = resumenEnPantalla();
    expect(rotulosDelResumen()).not.toContain('Lo que quedó debiendo de la quincena pasada');
    expect(centavos(r['Valor total']) - centavos(r['Anticipos aplicados'])).toBe(
      centavos(r['Saldo estimado']),
    );
    expect(r['Saldo estimado']).toBe('$ 250.000');
  });

  it('cuando la deuda se come el saldo, dice que le seguiría quedando debiendo', async () => {
    // La otra rama del papel: 250.000 − 300.000 no deja saldo por pagarle, y decir
    // "el saldo va a quedar en −$50.000" se lee al revés.
    await conElAvance({ ...AVANCE_CON_DEUDA, deuda_pendiente: '300000' });

    expect(textoDelAviso()).toContain('quedó debiendo de quincenas anteriores ($ 300.000)');
    expect(textoDelAviso()).toContain(
      'así que no va a quedar saldo por pagarle: le seguiría quedando debiendo $ 50.000.',
    );
  });

  it('los centavos de la deuda salen al centavo, no redondeados', async () => {
    // 47.220,12 − 4.955,77 = 42.264,35. Si el aviso redondeara, el papel y la pantalla
    // discutirían por un centavo delante del proveedor.
    await conElAvance({ ...AVANCE, deuda_pendiente: '4955.77' });

    expect(textoDelAviso()).toContain('($ 4.955,77)');
    expect(textoDelAviso()).toContain('va a quedar en $ 42.264,35');
  });

  it('si el servidor dice que no debe nada, no sale ningún aviso', async () => {
    // Con la cifra en cero la pantalla YA SABE que no hay deuda: el aviso genérico
    // ("si quedó debiendo algo…") sobra y solo hace ruido.
    await conElAvance({ ...AVANCE, deuda_pendiente: '0' });

    expect(fixture.nativeElement.querySelector(AVISO)).toBeNull();
    expect(fixture.nativeElement.querySelector('.aviso-estimado')).toBeNull();
  });

  it('un saldo anterior que NO cuadra con la columna se avisa, no se resta', async () => {
    // La trampa: la deuda llega en el campo del comprobante (`saldo_anterior`) pero el
    // saldo del avance no la tiene restada. Pintar el renglón dejaría la columna sin
    // cuadrar contra la cifra grande; se avisa con las palabras del papel y punto.
    await conElAvance({ ...AVANCE_CON_DEUDA, deuda_pendiente: undefined, saldo_anterior: '120000' });

    expect(rotulosDelResumen()).not.toContain('Lo que quedó debiendo de la quincena pasada');
    expect(textoDelAviso()).toContain('($ 120.000)');
    expect(textoDelAviso()).toContain('va a quedar en $ 130.000');
  });

  it('el mensaje de WhatsApp lleva el mismo aviso: el proveedor recibe los dos', async () => {
    await conElAvance(AVANCE_CON_DEUDA);
    const abierto = spyOn(window, 'open');

    dialogo.enviarWhatsApp();

    const url = String(abierto.calls.mostRecent().args[0]);
    // Igual que en el aviso de la pantalla: el espacio duro del formateador se aplana.
    const mensaje = decodeURIComponent(url.split('?text=')[1]).replace(/\s+/g, ' ');
    expect(mensaje).toContain('Saldo estimado: $ 250.000');
    expect(mensaje).toContain('AVISO: este avance TODAVÍA NO DESCUENTA');
    expect(mensaje).toContain('va a quedar en $ 130.000');
    // Y NO lleva el renglón de la resta, igual que la pantalla y el papel.
    expect(mensaje).not.toContain('Lo que quedó debiendo de la quincena pasada');
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

  it('el avance del proveedor suma EXACTO de arriba abajo, con la deuda vieja en el medio', async () => {
    // LA COLUMNA MÁS LARGA QUE HAY: la del proveedor con bonificaciones, descuentos, el
    // anticipo y la deuda que se arrastra, todos con centavos. El dueño la suma y la resta
    // en el orden en que está impresa —el mismo del comprobante oficial— y tiene que caer
    // exacta dos veces: primero en VALOR TOTAL y después en el saldo.
    //
    //   143.482,50 + 1.500,25 − 500,75      = 144.482,00  (VALOR TOTAL)
    //   144.482,00 − 20.000,10 − 4.955,77   = 119.526,13  (SALDO ESTIMADO)
    await conElAvance({
      ...AVANCE,
      tipo: 'proveedor',
      tercero_nombre: 'Henri Castaño',
      total_litros: '81.99',
      precio_promedio: '1750',
      valor_bruto: '143482.50',
      bonificaciones: '1500.25',
      descuentos: '500.75',
      valor_transporte: '0',
      valor_total: '144482.00',
      anticipos: '20000.10',
      saldo_anterior: '4955.77',
      saldo: '119526.13',
      detalles: [
        { fecha: '2026-07-07', litros: '81.99', precio_litro: '1750', valor: '143482.50' },
      ],
    });

    // El orden ES la cuenta, y es el mismo del comprobante y del PDF: los descuentos van
    // DEBAJO de la cifra de la que se restan.
    expect(rotulosDelResumen()).toEqual([
      'Total litros',
      'Precio promedio',
      'Valor bruto',
      'Bonificaciones',
      'Descuentos',
      'Valor total',
      'Anticipos aplicados',
      'Lo que quedó debiendo de la quincena pasada',
      'Saldo estimado',
    ]);

    const r = resumenEnPantalla();
    // Hasta VALOR TOTAL, sumando lo que la PANTALLA muestra (no lo que mandó el servidor).
    expect(
      centavos(r['Valor bruto']) + centavos(r['Bonificaciones']) - centavos(r['Descuentos']),
    ).toBe(centavos(r['Valor total']));
    // Y de ahí para abajo, hasta el saldo.
    expect(
      centavos(r['Valor total']) -
        centavos(r['Anticipos aplicados']) -
        centavos(r['Lo que quedó debiendo de la quincena pasada']),
    ).toBe(centavos(r['Saldo estimado']));
    expect(r['Saldo estimado']).toBe('$ 119.526,13');
  });
});
