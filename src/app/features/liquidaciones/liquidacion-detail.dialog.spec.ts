import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion, LiquidacionDetalle } from '../../core/models';
import { ConfirmData } from '../../shared/confirm-dialog';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * El comprobante del TRANSPORTADOR: sus renglones son por DÍA Y RUTA.
 *
 * Lo que estas pruebas cuidan es que el dueño pueda leer el desglose. Desde que
 * Alex Agudelo hace Nápoles y Mira Valle el mismo martes, ese martes trae DOS
 * renglones a tarifas distintas: sin la columna "Ruta" se verían como el mismo día
 * repetido con cifras que no se explican. Y el comprobante del PROVEEDOR no tiene
 * rutas, así que ahí la columna no puede aparecer.
 */

const det = (
  id: string,
  fecha: string,
  litros: string,
  precio: string,
  valor: string,
  ruta?: [string, string],
  rutaBorrada = false,
): LiquidacionDetalle => ({
  id,
  fecha,
  litros,
  precio_litro: precio,
  valor,
  ruta_id: ruta?.[0] ?? null,
  ruta_nombre: ruta?.[1] ?? null,
  ruta_borrada: rutaBorrada,
});

const liquidacion = (
  detalles: LiquidacionDetalle[],
  tipo = 'transportador',
  cifras: Partial<Liquidacion> = {},
): Liquidacion => ({
  id: 'l-1',
  empresa_id: 'e-1',
  estado: 'borrador',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  tipo,
  proveedor_id: null,
  proveedor_nombre: null,
  transportador_id: 't-1',
  transportador_nombre: 'Alex Agudelo',
  periodo_inicio: '2026-07-01',
  periodo_fin: '2026-07-15',
  total_litros: '164',
  precio_promedio: '271.38',
  valor_bruto: '0',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '44506.32',
  anticipos: '0',
  valor_total: '44506.32',
  neto_a_pagar: '44506.32',
  pagado: '0',
  saldo: '44506.32',
  // Cero salvo que el caso lo pida: es la vuelta del saldo cuando queda por debajo de
  // cero, o sea la excepción. `...cifras` va después, así que un caso de saldo
  // negativo lo sobrescribe junto con `saldo` y `neto_a_pagar`.
  le_queda_debiendo: '0',
  observaciones: null,
  detalles,
  pagos: [],
  ...cifras,
});

/** El día en que hizo LAS DOS rutas, cada una a su tarifa. */
const EL_MARTES = [
  det('d-1', '2026-07-07', '82', '242.76', '19906.32', ['r-nap', 'Nápoles']),
  det('d-2', '2026-07-07', '82', '300.00', '24600.00', ['r-mir', 'Mira Valle']),
];

/**
 * El caso medido en pantalla, tal cual: dos rutas de pocos litros a $242,76.
 *
 * 5 × 242,76 = 1.213,80 y 6 × 242,76 = 1.456,56, que suman 2.670,36. Redondeado
 * renglón por renglón se leía "$ 1.214" y "$ 1.457" —que suman 2.671— contra un
 * resumen de "$ 2.670": UN PESO de diferencia entre el desglose y la cifra grande,
 * y el PDF del mismo comprobante sí imprimía los centavos.
 */
const EL_PESO_QUE_FALTABA = [
  det('d-1', '2026-07-09', '5', '242.76', '1213.80', ['r-nap', 'Nápoles']),
  det('d-2', '2026-07-09', '6', '242.76', '1456.56', ['r-mir', 'Mira Valle']),
];

/**
 * El renglón de CIERRE: el que existe para que no sobre ni falte un centavo.
 *
 * Cuando el flete guardado de un día no lo explica ninguna tarifa de dos decimales,
 * el backend parte el día en el grueso de los litros más una fracción de 0,01 L que
 * cierra la cuenta (ver `_renglones_de_ultimo_recurso`). Los dos renglones suman
 * exacto los $19.906,32 del día.
 *
 * Con un solo decimal en los litros ese renglón se leía "0 L" por $2 —litros en
 * cero cobrados en pesos— y su compañero "82 L" cuando son 81,99.
 */
const EL_CIERRE = [
  det('d-1', '2026-07-08', '81.99', '242.76', '19903.89', ['r-nap', 'Nápoles']),
  det('d-2', '2026-07-08', '0.01', '243.00', '2.43', ['r-nap', 'Nápoles']),
];

/** El getById se emite A MANO: el diálogo abre con la fila de la lista y recarga. */
class ServicioFalso {
  readonly porId = new Subject<Liquidacion>();
  /** Lo que devuelve el recálculo. */
  recalculada: Liquidacion | null = null;
  /** Si se pone, el recálculo falla con esto. */
  fallaAlRecalcular: unknown = null;
  recalculos = 0;

  getById(): Observable<Liquidacion> {
    return this.porId as unknown as Observable<Liquidacion>;
  }

  recalcular(): Observable<Liquidacion> {
    this.recalculos += 1;
    if (this.fallaAlRecalcular) return throwError(() => this.fallaAlRecalcular);
    return of(this.recalculada as Liquidacion);
  }
}

type Fixture = ComponentFixture<LiquidacionDetailDialog>;

/**
 * Un texto tal como se LEE en pantalla.
 *
 * El espacio de "$ 242,76" que pone Intl es duro (U+00A0): se normaliza para poder
 * escribir las cifras esperadas a mano. Va también para los textos que NO salen de
 * un elemento —el aviso de abajo, el motivo del candado—, que llevan el mismo
 * espacio duro porque salen del mismo formateador de plata.
 */
const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const leido = (elemento: Element | null | undefined): string => comoSeLee(elemento?.textContent);

/** El encabezado y las filas del detalle diario, como se leen en pantalla. */
const leerDetalle = (fixture: Fixture): string[][] => {
  const tabla = fixture.nativeElement.querySelector('table') as HTMLTableElement;
  return Array.from(tabla.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.querySelectorAll('th,td')).map((celda) => leido(celda)),
  );
};

/** El resumen, rótulo por cifra, como se lee en pantalla. */
const leerResumen = (fixture: Fixture): Record<string, string> => {
  const celdas = Array.from(
    (fixture.nativeElement.querySelector('.resumen') as HTMLElement).children,
  ).map((celda) => leido(celda));
  const resumen: Record<string, string> = {};
  for (let i = 0; i + 1 < celdas.length; i += 2) resumen[celdas[i]] = celdas[i + 1];
  return resumen;
};

/**
 * "$ 19.906,32" → 19906.32. Es la cuenta que hace el dueño con lo que LEE, no con
 * lo que el backend mandó: si la pantalla redondea, este número redondea con ella
 * y la suma no cuadra. Ahí está el defecto.
 */
const aNumero = (texto: string): number => Number(texto.replace(/[^\d,-]/g, '').replace(',', '.'));

/**
 * Una cifra leída, en CENTAVOS ENTEROS.
 *
 * En centavos y no en pesos con coma porque sumar decimales en coma flotante se
 * desvía por fracciones de centavo, y el centavo es exactamente lo que estas
 * pruebas cuidan: la comparación tiene que salir EXACTA, no "casi".
 */
const centavos = (texto: string): number => Math.round(aNumero(texto) * 100);

/**
 * LA REGLA DE ORO, medida: la columna Valor del detalle sumada a mano, en centavos.
 *
 * Vive fuera de los describes a propósito. Es la única cuenta que de verdad
 * defiende el cuadre del comprobante y tiene que ser LA MISMA para el desglose
 * recién generado y para el que quedó después de un recálculo: dos copias de esto
 * se desincronizarían y una de las dos dejaría de proteger nada.
 */
const sumaDeLaColumnaValor = (fixture: Fixture): number =>
  leerDetalle(fixture)
    .slice(1)
    .reduce((total, fila) => total + centavos(fila[fila.length - 1]), 0);

describe('LiquidacionDetailDialog: renglones por día y ruta', () => {
  let fixture: ComponentFixture<LiquidacionDetailDialog>;
  let servicio: ServicioFalso;

  const armar = async (item: Liquidacion): Promise<void> => {
    servicio = new ServicioFalso();
    await TestBed.configureTestingModule({
      imports: [LiquidacionDetailDialog, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { item } },
        { provide: LiquidacionesService, useValue: servicio },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LiquidacionDetailDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  // Los lectores de la pantalla viven arriba, fuera del describe: los comparte con
  // las pruebas del recálculo, que miden el cuadre con la MISMA cuenta.
  const detalleEnPantalla = (): string[][] => leerDetalle(fixture);
  const resumenEnPantalla = (): Record<string, string> => leerResumen(fixture);
  const sumaDelDesglose = (): number => sumaDeLaColumnaValor(fixture);

  it('un día con dos rutas se distingue por el nombre de la ruta', async () => {
    await armar(liquidacion(EL_MARTES));

    const enPantalla = detalleEnPantalla();
    expect(enPantalla[0]).toEqual(['Fecha', 'Ruta', 'Litros', 'Precio/L', 'Valor']);
    // El renglón COMPLETO, columna Valor incluida: 82 × 242,76 = 19.906,32 exactos.
    // Antes esa columna iba con `| money` (sin centavos) y decía "$ 19.906".
    expect(enPantalla.slice(1)).toEqual([
      ['07/07/2026', 'Nápoles', '82 L', '$ 242,76', '$ 19.906,32'],
      ['07/07/2026', 'Mira Valle', '82 L', '$ 300', '$ 24.600'],
    ]);
  });

  it('la columna Ruta aparece cuando los detalles llegan del getById', async () => {
    // El diálogo se abre con la fila de la LISTA, que puede venir sin detalles.
    await armar(liquidacion([]));
    expect(detalleEnPantalla()[0]).toEqual(['Fecha', 'Litros', 'Precio/L', 'Valor']);

    servicio.porId.next(liquidacion(EL_MARTES));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(detalleEnPantalla()[0]).toEqual(['Fecha', 'Ruta', 'Litros', 'Precio/L', 'Valor']);
    expect(detalleEnPantalla()[1][1]).toBe('Nápoles');
  });

  it('el comprobante del proveedor sigue sin columna Ruta', async () => {
    await armar(liquidacion([det('d-1', '2026-07-07', '82', '1750', '143500')], 'proveedor'));

    expect(detalleEnPantalla()[0]).toEqual(['Fecha', 'Litros', 'Precio/L', 'Valor']);
  });

  it('un comprobante viejo del transportador (sin ruta) tampoco la gana', async () => {
    // Los renglones generados antes de este cambio eran por día y no traen ruta.
    await armar(liquidacion([det('d-1', '2026-07-07', '82', '242.76', '19906.32')]));

    expect(detalleEnPantalla()[0]).toEqual(['Fecha', 'Litros', 'Precio/L', 'Valor']);
  });

  // ------------------------------------------------------------ LA REGLA DE ORO
  // El desglose suma EXACTO la cifra grande. El dueño lo revisa a mano: suma la
  // columna Valor y la compara con el resumen. Un peso —o un centavo— de diferencia
  // es un defecto, no un redondeo aceptable.

  it('la columna Valor suma exacto el Valor transporte y el Valor total del resumen', async () => {
    await armar(liquidacion(EL_MARTES));

    const sumado = sumaDelDesglose();
    const resumen = resumenEnPantalla();

    // 19.906,32 + 24.600 = 44.506,32, que es lo que dice el resumen. Se compara lo
    // LEÍDO contra lo LEÍDO: es la cuenta que hace el dueño con la pantalla puesta.
    expect(sumado).toBe(4450632); // $ 44.506,32
    expect(centavos(resumen['Valor transporte'])).toBe(sumado);
    expect(centavos(resumen['Valor total'])).toBe(sumado);
    expect(centavos(resumen['Saldo a pagar'])).toBe(sumado);
  });

  it('el peso que faltaba: dos renglones de pocos litros a $242,76', async () => {
    // El caso medido en pantalla. Antes: "$ 1.214" + "$ 1.457" = 2.671 a mano, y el
    // resumen decía "$ 2.670".
    await armar(
      liquidacion(EL_PESO_QUE_FALTABA, 'transportador', {
        total_litros: '11',
        valor_transporte: '2670.36',
        valor_total: '2670.36',
        neto_a_pagar: '2670.36',
        saldo: '2670.36',
      }),
    );

    expect(detalleEnPantalla().slice(1)).toEqual([
      ['09/07/2026', 'Nápoles', '5 L', '$ 242,76', '$ 1.213,80'],
      ['09/07/2026', 'Mira Valle', '6 L', '$ 242,76', '$ 1.456,56'],
    ]);
    const resumen = resumenEnPantalla();
    expect(resumen['Valor transporte']).toBe('$ 2.670,36');
    // 121.380 + 145.656 = 267.036 centavos, o sea $ 2.670,36: el desglose y la
    // cifra grande dan lo MISMO. Antes daban 2.671 y 2.670.
    expect(sumaDelDesglose()).toBe(267036);
    expect(centavos(resumen['Valor total'])).toBe(267036);
  });

  it('el renglón de cierre se lee con sus 0,01 L y sus $ 2,43, y la columna sigue sumando', async () => {
    await armar(
      liquidacion(EL_CIERRE, 'transportador', {
        total_litros: '82',
        valor_transporte: '19906.32',
        valor_total: '19906.32',
        neto_a_pagar: '19906.32',
        saldo: '19906.32',
      }),
    );

    // Antes: "82 L … $ 19.904" y "0 L … $ 2" —un renglón de cero litros cobrado en
    // pesos, justo el que existe para cerrar el centavo—.
    expect(detalleEnPantalla().slice(1)).toEqual([
      ['08/07/2026', 'Nápoles', '81,99 L', '$ 242,76', '$ 19.903,89'],
      ['08/07/2026', 'Nápoles', '0,01 L', '$ 243', '$ 2,43'],
    ]);

    const resumen = resumenEnPantalla();
    // 1.990.389 + 243 = 1.990.632 centavos, o sea los $ 19.906,32 del día.
    expect(sumaDelDesglose()).toBe(1990632);
    expect(centavos(resumen['Valor transporte'])).toBe(1990632);
    // Y los litros también suman: 81,99 + 0,01 = 82.
    expect(resumen['Total litros']).toBe('82 L');
  });

  it('el comprobante del proveedor también muestra la cifra completa', async () => {
    // Su PDF ya imprime los centavos (el backend usa el mismo `pesos()` para los
    // dos), así que la pantalla tiene que decir lo mismo que el papel. Una quincena
    // de 81,99 L a $1.750 son $143.482,50 exactos, no "$ 143.483".
    await armar(
      liquidacion([det('d-1', '2026-07-07', '81.99', '1750', '143482.50')], 'proveedor', {
        total_litros: '81.99',
        precio_promedio: '1750',
        valor_bruto: '143482.50',
        valor_transporte: '0',
        valor_total: '143482.50',
        neto_a_pagar: '143482.50',
        saldo: '143482.50',
      }),
    );

    const fila = detalleEnPantalla()[1];
    expect(fila[0]).toBe('07/07/2026');
    expect(fila[1]).toBe('81,99 L');
    // En la del proveedor el precio SE PUEDE corregir, así que la celda es un botón
    // y arrastra el rótulo del lápiz: se comprueba con contains.
    expect(fila[2]).toContain('$ 1.750');
    expect(fila[3]).toBe('$ 143.482,50');

    const resumen = resumenEnPantalla();
    expect(resumen['Valor bruto']).toBe('$ 143.482,50');
    expect(resumen['Valor total']).toBe('$ 143.482,50');
    expect(resumen['Total litros']).toBe('81,99 L');
    expect(sumaDelDesglose()).toBe(centavos(resumen['Valor bruto']));
  });

  it('los pagos registrados suman exacto lo Pagado del resumen', async () => {
    // Pagar el saldo completo deja un pago con centavos: si la tabla de pagos
    // redondeara, los pagos no darían lo pagado.
    const liq = liquidacion(EL_MARTES, 'transportador', {
      estado: 'parcial',
      pagado: '24600',
      saldo: '19906.32',
      pagos: [
        { id: 'p-1', fecha: '2026-07-16', valor: '19906.32', observaciones: null },
        { id: 'p-2', fecha: '2026-07-17', valor: '4693.68', observaciones: null },
      ],
    });
    await armar(liq);

    const tablaPagos = fixture.nativeElement.querySelectorAll('table')[1] as HTMLTableElement;
    const valores = Array.from(tablaPagos.querySelectorAll('tr'))
      .slice(1)
      .map((tr) => centavos((tr.querySelectorAll('td')[1] as HTMLElement).textContent ?? ''));

    // 1.990.632 + 469.368 = 2.460.000 centavos = $ 24.600, lo que dice "Pagado".
    expect(valores).toEqual([1990632, 469368]);
    expect(valores.reduce((a, b) => a + b, 0)).toBe(2460000);
    expect(centavos(resumenEnPantalla()['Pagado'])).toBe(2460000);
  });

  it('una ruta borrada se marca en el renglón sin tocarle la cifra', async () => {
    // El comprobante es de una quincena pasada y la ruta pudo haberse borrado
    // después: el renglón lo dice, y la plata no se mueve.
    await armar(
      liquidacion([
        det('d-1', '2026-07-07', '82', '242.76', '19906.32', ['r-nap', 'Nápoles'], true),
      ]),
    );

    const fila = detalleEnPantalla()[1];
    expect(fila[1]).toBe('Nápoles (borrada)');
    expect(fila[4]).toBe('$ 19.906,32');
  });

  it('el precio por litro NO se ofrece para corregir en la del transportador', async () => {
    // Esa columna es la tarifa del flete, no el precio de la leche: el backend
    // rechaza el cambio y la pantalla no lo debe ni ofrecer.
    await armar(liquidacion(EL_MARTES));

    expect(fixture.componentInstance.puedeEditarPrecio()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.precio-editable')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // EL SALDO POR DEBAJO DE CERO: el tercero le quedó debiendo al negocio
  //
  // Pasa cuando los anticipos que ya se le entregaron suman más que la quincena. El
  // caso medido, con las cifras del comprobante de Alex: se le adelantaron $49.462,09
  // y la tarifa del flete se corrigió hacia abajo, así que la quincena quedó en
  // $44.506,32 y el saldo en -$4.955,77.
  //
  // Lo que la pantalla NO puede hacer es mostrar eso bajo el rótulo "Saldo a pagar":
  // el dueño lee ese renglón para saber cuánto entregar, y un menos pegado a un total
  // destacado es justo lo que se lee mal. Tiene que decir de quién es la plata.
  // -------------------------------------------------------------------------
  const LE_DEBE: Partial<Liquidacion> = {
    anticipos: '49462.09',
    valor_total: '44506.32',
    neto_a_pagar: '-4955.77',
    saldo: '-4955.77',
    le_queda_debiendo: '4955.77',
  };

  it('con el saldo por debajo de cero el resumen dice "Le queda debiendo", en positivo', async () => {
    await armar(liquidacion(EL_MARTES, 'transportador', LE_DEBE));

    const resumen = resumenEnPantalla();
    expect(resumen['Le queda debiendo']).toBe('$ 4.955,77');
    // Y el rótulo que se lee al revés ya no está.
    expect(resumen['Saldo a pagar']).toBeUndefined();
    // La cifra NO puede salir con el signo menos: es lo que hace que se lea mal.
    expect(resumen['Le queda debiendo']).not.toContain('-');
    // El resto del resumen sigue diciendo la verdad completa: los anticipos se
    // aplicaron enteros, y ahí está de dónde sale la diferencia.
    expect(resumen['Anticipos aplicados']).toBe('$ 49.462,09');
    expect(resumen['Valor total']).toBe('$ 44.506,32');
  });

  it('y lo explica en palabras, con el nombre y el motivo', async () => {
    await armar(liquidacion(EL_MARTES, 'transportador', LE_DEBE));

    const nota = leido(fixture.nativeElement.querySelector('.nota-le-debe'));
    expect(nota).toContain('Alex Agudelo le queda debiendo $ 4.955,77');
    expect(nota).toContain('$ 49.462,09');
    expect(nota).toContain('$ 44.506,32');
  });

  it('el resumen se sigue leyendo de dos en dos: el aviso no se mete en la rejilla', async () => {
    // La rejilla del resumen es rótulo + cifra. Si el aviso entrara ahí, descuadraría
    // los pares y las cifras se leerían corridas una casilla.
    await armar(liquidacion(EL_MARTES, 'transportador', LE_DEBE));

    const celdas = (fixture.nativeElement.querySelector('.resumen') as HTMLElement).children;
    expect(celdas.length % 2).toBe(0);
    expect(
      (fixture.nativeElement.querySelector('.resumen') as HTMLElement).querySelector(
        '.nota-le-debe',
      ),
    ).toBeNull();
  });

  it('el mensaje de WhatsApp tampoco manda un saldo negativo', async () => {
    // Ese texto llega SUELTO al proveedor, sin la tabla alrededor: "Saldo a pagar:
    // -$ 4.955,77" reenviado por chat es peor todavía.
    await armar(liquidacion(EL_MARTES, 'transportador', LE_DEBE));

    let enviado = '';
    spyOn(window, 'open').and.callFake((url?: string | URL): Window | null => {
      enviado = decodeURIComponent(String(url ?? ''));
      return null;
    });
    fixture.componentInstance.enviarWhatsApp();

    expect(comoSeLee(enviado)).toContain('Le queda debiendo: $ 4.955,77');
    expect(enviado).not.toContain('Saldo a pagar');
  });

  it('con saldo en CERO nadie le debe nada: sigue diciendo "Saldo a pagar"', async () => {
    // El borde exacto: anticipo igual a la quincena. El corte es "> 0", y un ">=" mal
    // puesto haría que una liquidación saldada dijera que el tercero debe $0.
    await armar(
      liquidacion(EL_MARTES, 'transportador', {
        anticipos: '44506.32',
        neto_a_pagar: '0',
        saldo: '0',
        le_queda_debiendo: '0',
      }),
    );

    const resumen = resumenEnPantalla();
    // "$ 0" y no "$ 0,00": la plata sin centavos se imprime sin centavos en toda la
    // pantalla y en el PDF (ver `pesosExactos`), y este renglón no es la excepción.
    expect(resumen['Saldo a pagar']).toBe('$ 0');
    expect(resumen['Le queda debiendo']).toBeUndefined();
    expect(fixture.nativeElement.querySelector('.nota-le-debe')).toBeNull();
  });

  it('lo normal no cambia: con saldo a favor del tercero, el rótulo de siempre', async () => {
    await armar(liquidacion(EL_MARTES));

    const resumen = resumenEnPantalla();
    expect(resumen['Saldo a pagar']).toBe('$ 44.506,32');
    expect(resumen['Le queda debiendo']).toBeUndefined();
    expect(fixture.nativeElement.querySelector('.nota-le-debe')).toBeNull();
  });
});

/** El aviso de abajo: se guardan los textos para poder leerlos tal cual. */
class SnackbarFalso {
  readonly mensajes: string[] = [];
  open(mensaje: string): void {
    this.mensajes.push(mensaje);
  }
}

/**
 * EL RECALCULAR DEL TRANSPORTADOR, que es lo que pidió el dueño.
 *
 * El caso real: tecleó mal la tarifa de Alex Agudelo, la corrigió en su ficha, y el
 * comprobante siguió mostrando la cifra vieja —sus renglones son la FOTO del día en
 * que se generó—. El botón era justo lo que lo arreglaba, y la pantalla no lo decía
 * ni le mostraba de cuánto a cuánto había cambiado el flete.
 *
 * Y lo que estas pruebas cuidan además: que después de que un recálculo cambie las
 * cifras, la columna Ruta y los centavos del comprobante sigan bien. El desglose
 * tiene que sumar EXACTO la cifra grande ANTES y DESPUÉS de recalcular; y si el
 * aviso dice una plata y el resumen otra, el dueño queda con dos cifras y ninguna
 * confiable.
 */
describe('LiquidacionDetailDialog: el recálculo dice cuánto cambió', () => {
  let fixture: Fixture;
  let servicio: ServicioFalso;
  let snackbar: SnackbarFalso;
  /** Los datos con que se abrió cada confirmación: es el texto que el dueño lee. */
  let confirmaciones: ConfirmData[];
  /** Lo que responde el usuario en la confirmación. `undefined` = cerró sin confirmar. */
  let respuesta: unknown;

  const armar = async (item: Liquidacion): Promise<void> => {
    servicio = new ServicioFalso();
    snackbar = new SnackbarFalso();
    confirmaciones = [];
    respuesta = undefined;
    await TestBed.configureTestingModule({
      imports: [LiquidacionDetailDialog, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { item } },
        { provide: LiquidacionesService, useValue: servicio },
        { provide: MatSnackBar, useValue: snackbar },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LiquidacionDetailDialog);

    /*
     * El MatDialog se intercepta con un espía sobre LA INSTANCIA QUE USA EL
     * COMPONENTE, y no con un `{ provide: MatDialog, useValue: … }`.
     *
     * El componente importa MatDialogModule, así que su MatDialog sale de su propio
     * inyector y no del de la prueba: un doble puesto en `providers` no se usaría
     * nunca y, peor, el MatDialog de verdad lo tomaría por su "MatDialog padre" y
     * reventaría al abrir. Espiar la instancia real evita las dos trampas.
     */
    spyOn(fixture.debugElement.injector.get(MatDialog), 'open').and.callFake(
      (_componente: unknown, config?: { data?: ConfirmData }) => {
        if (config?.data) confirmaciones.push(config.data);
        return { afterClosed: () => of(respuesta) } as ReturnType<MatDialog['open']>;
      },
    );

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** El botón Recalcular de la barra de acciones, si está. */
  const botonRecalcular = (): HTMLButtonElement | null =>
    (Array.from(fixture.nativeElement.querySelectorAll('button')).find((boton) =>
      leido(boton as Element).includes('Recalcular'),
    ) as HTMLButtonElement | undefined) ?? null;

  const oprimirRecalcular = async (): Promise<void> => {
    botonRecalcular()!.click();
    // Dos vueltas: la primera resuelve la confirmación (cuando la hay) y la segunda
    // la respuesta del servidor.
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** La frase de arriba del aviso: "El flete pasó de … a …". */
  const tituloDelRecalculo = (): string | null => {
    const titulo = fixture.nativeElement.querySelector('.cambio-titulo span');
    return titulo ? leido(titulo) : null;
  };

  /** Los renglones "rótulo | antes | → | ahora" del aviso, como se leen. */
  const filasDelRecalculo = (): string[][] =>
    Array.from(fixture.nativeElement.querySelectorAll('.cambio-fila')).map((fila) =>
      Array.from((fila as HTMLElement).children).map((celda) => leido(celda)),
    );

  const avisoDeEstado = (): string | null => {
    const aviso = fixture.nativeElement.querySelector('.cambio-aviso');
    return aviso ? leido(aviso) : null;
  };

  /** El texto de ayuda —o el del candado— que sale debajo del resumen. */
  const ayudaEnPantalla = (): string =>
    Array.from(fixture.nativeElement.querySelectorAll('.ayuda-precio'))
      .map((parrafo) => leido(parrafo as Element))
      .join(' ');

  /** El comprobante corregido: a Nápoles le iban $317,53, no $242,76. */
  const CON_LA_TARIFA_CORREGIDA = [
    det('d-3', '2026-07-07', '82', '317.53', '26037.46', ['r-nap', 'Nápoles']),
    det('d-4', '2026-07-07', '82', '300.00', '24600.00', ['r-mir', 'Mira Valle']),
  ];
  const CIFRAS_CORREGIDAS: Partial<Liquidacion> = {
    total_litros: '164',
    precio_promedio: '308.77',
    valor_transporte: '50637.46',
    valor_total: '50637.46',
    neto_a_pagar: '50637.46',
    saldo: '50637.46',
  };

  // ----------------------------------------------------------------- QUÉ CAMBIÓ
  it('dice de cuánto a cuánto pasó el flete, con la cifra de antes y la de ahora', async () => {
    // El martes hizo las dos rutas: Nápoles a $242,76 y Mira Valle a $300.
    await armar(liquidacion(EL_MARTES));
    expect(leerResumen(fixture)['Valor transporte']).toBe('$ 44.506,32');

    // Corregida la ficha, el recálculo trae 82 × 317,53 = $26.037,46 en ese renglón.
    servicio.recalculada = liquidacion(CON_LA_TARIFA_CORREGIDA, 'transportador', CIFRAS_CORREGIDAS);
    await oprimirRecalcular();

    expect(servicio.recalculos).toBe(1);
    // LA CIFRA, no "se recalculó y ya": es lo único que le dice al dueño que su
    // corrección de la tarifa entró de verdad.
    expect(tituloDelRecalculo()).toBe('El flete pasó de $ 44.506,32 a $ 50.637,46');
    expect(filasDelRecalculo()).toEqual([
      ['Valor transporte', '$ 44.506,32', '→', '$ 50.637,46'],
      ['Saldo a pagar', '$ 44.506,32', '→', '$ 50.637,46'],
    ]);
    // El mismo texto en el aviso de abajo: una sola cifra, dicha una sola vez.
    expect(snackbar.mensajes.map(comoSeLee)).toEqual([
      'El flete pasó de $ 44.506,32 a $ 50.637,46',
    ]);
  });

  it('el aviso dice la MISMA plata que el resumen y que el desglose', async () => {
    // Si el aviso dijera "$ 50.637" y el resumen "$ 50.637,46", el dueño tendría dos
    // cifras para el mismo comprobante. Se comparan las tres LEÍDAS de la pantalla.
    await armar(liquidacion(EL_MARTES));
    servicio.recalculada = liquidacion(CON_LA_TARIFA_CORREGIDA, 'transportador', CIFRAS_CORREGIDAS);
    await oprimirRecalcular();

    const resumen = leerResumen(fixture);
    const enElAviso = centavos(filasDelRecalculo()[0][3]);
    expect(enElAviso).toBe(5063746); // $ 50.637,46
    expect(centavos(resumen['Valor transporte'])).toBe(enElAviso);
    expect(centavos(resumen['Valor total'])).toBe(enElAviso);
    expect(sumaDeLaColumnaValor(fixture)).toBe(enElAviso);
  });

  it('un recálculo que no mueve un peso lo dice, en vez de fingir que hizo algo', async () => {
    // Antes el aviso decía "quedaron aplicados los anticipos pendientes" siempre,
    // aunque no hubiera nada que aplicar: el dueño no sabía si había pasado algo.
    await armar(liquidacion(EL_MARTES));
    servicio.recalculada = liquidacion(EL_MARTES);
    await oprimirRecalcular();

    expect(tituloDelRecalculo()).toBe('Recalculado: las cifras ya estaban al día, no cambió nada');
    expect(filasDelRecalculo()).toEqual([]);
  });

  it('si solo se reorganizó el desglose, lo dice también', async () => {
    // El reparto de centavos entre las recepciones de un día se puede mover sin que
    // el total cambie. "No cambió nada" sería mentira: el desglose quedó distinto y
    // es lo que el dueño suma a mano.
    await armar(liquidacion(EL_MARTES));
    servicio.recalculada = liquidacion(EL_CIERRE, 'transportador', {
      total_litros: '164',
      valor_transporte: '44506.32',
      valor_total: '44506.32',
      neto_a_pagar: '44506.32',
      saldo: '44506.32',
    });
    await oprimirRecalcular();

    expect(tituloDelRecalculo()).toBe(
      'Recalculado: se reorganizó el desglose y las cifras grandes quedaron iguales',
    );
  });

  it('en la del proveedor el aviso habla de sus cifras, no del flete', async () => {
    const suDia = [det('d-1', '2026-07-07', '81.99', '1750', '143482.50')];
    const susCifras: Partial<Liquidacion> = {
      total_litros: '81.99',
      valor_bruto: '143482.50',
      valor_transporte: '0',
      valor_total: '143482.50',
      neto_a_pagar: '143482.50',
      saldo: '143482.50',
    };
    await armar(liquidacion(suDia, 'proveedor', susCifras));

    // Le registraron un anticipo de $50.000 después de generarla: es el otro caso.
    servicio.recalculada = liquidacion(suDia, 'proveedor', {
      ...susCifras,
      anticipos: '50000',
      neto_a_pagar: '93482.50',
      saldo: '93482.50',
    });
    await oprimirRecalcular();

    expect(tituloDelRecalculo()).toBe('Los anticipos aplicados pasaron de $ 0 a $ 50.000');
    expect(filasDelRecalculo()).toEqual([
      ['Anticipos aplicados', '$ 0', '→', '$ 50.000'],
      ['Saldo a pagar', '$ 143.482,50', '→', '$ 93.482,50'],
    ]);
  });

  // -------------------------------------- LA REGLA DE ORO, DESPUÉS DE RECALCULAR
  it('la columna Ruta y los centavos siguen bien cuando el recálculo parte el día', async () => {
    // Comprobante VIEJO: un solo renglón por día, sin ruta. El recálculo lo parte en
    // las dos rutas del día, así que la columna Ruta tiene que APARECER.
    await armar(
      liquidacion([det('d-1', '2026-07-09', '11', '242.76', '2670.36')], 'transportador', {
        total_litros: '11',
        valor_transporte: '2670.36',
        valor_total: '2670.36',
        neto_a_pagar: '2670.36',
        saldo: '2670.36',
      }),
    );
    expect(leerDetalle(fixture)[0]).toEqual(['Fecha', 'Litros', 'Precio/L', 'Valor']);

    servicio.recalculada = liquidacion(EL_PESO_QUE_FALTABA, 'transportador', {
      total_litros: '11',
      valor_transporte: '2670.36',
      valor_total: '2670.36',
      neto_a_pagar: '2670.36',
      saldo: '2670.36',
    });
    await oprimirRecalcular();

    expect(leerDetalle(fixture)[0]).toEqual(['Fecha', 'Ruta', 'Litros', 'Precio/L', 'Valor']);
    // Con los centavos completos: "$ 1.214" + "$ 1.457" sumarían 2.671 contra un
    // resumen de 2.670. Ese peso de diferencia es el defecto que se arregló en la
    // ronda anterior y que un recálculo no puede traer de vuelta.
    expect(leerDetalle(fixture).slice(1)).toEqual([
      ['09/07/2026', 'Nápoles', '5 L', '$ 242,76', '$ 1.213,80'],
      ['09/07/2026', 'Mira Valle', '6 L', '$ 242,76', '$ 1.456,56'],
    ]);
    const resumen = leerResumen(fixture);
    expect(sumaDeLaColumnaValor(fixture)).toBe(267036); // $ 2.670,36
    expect(centavos(resumen['Valor transporte'])).toBe(267036);
    expect(centavos(resumen['Valor total'])).toBe(267036);
    expect(centavos(resumen['Saldo a pagar'])).toBe(267036);
  });

  it('el renglón de cierre sigue cuadrando el comprobante después de recalcular', async () => {
    // Cuando ninguna tarifa de dos decimales explica el flete guardado de un día, el
    // backend lo parte en el grueso de los litros más 0,01 L que cierran la cuenta.
    // Ese renglón nace de un recálculo, así que es justo ahí donde hay que medirlo.
    await armar(liquidacion(EL_MARTES));
    servicio.recalculada = liquidacion(EL_CIERRE, 'transportador', {
      total_litros: '82',
      valor_transporte: '19906.32',
      valor_total: '19906.32',
      neto_a_pagar: '19906.32',
      saldo: '19906.32',
    });
    await oprimirRecalcular();

    expect(leerDetalle(fixture).slice(1)).toEqual([
      ['08/07/2026', 'Nápoles', '81,99 L', '$ 242,76', '$ 19.903,89'],
      ['08/07/2026', 'Nápoles', '0,01 L', '$ 243', '$ 2,43'],
    ]);
    const resumen = leerResumen(fixture);
    // 1.990.389 + 243 = 1.990.632 centavos, o sea los $ 19.906,32 del día.
    expect(sumaDeLaColumnaValor(fixture)).toBe(1990632);
    expect(centavos(resumen['Valor transporte'])).toBe(1990632);
    // Y los litros del desglose siguen sumando el total: 81,99 + 0,01 = 82.
    expect(resumen['Total litros']).toBe('82 L');
    // La cifra del aviso es la del resumen, no una redondeada aparte.
    expect(centavos(filasDelRecalculo()[0][3])).toBe(1990632);
  });

  // --------------------------------------------------- LA APROBADA, QUE NO SE PUEDE
  /*
   * El servidor solo recalcula BORRADORES (LiquidacionService.recalcular rebota
   * cualquier otro estado y no hay endpoint que devuelva una aprobada a borrador).
   * Así que la pantalla no ofrece el botón ahí: prometer algo que el servidor va a
   * negar es peor que no ofrecerlo, sobre todo con plata de por medio.
   *
   * Lo que sí está listo —y probado aquí abajo— es la mitad de pantalla que le hace
   * falta a ese cambio: el aviso ANTES de oprimir. El día en que el backend acepte la
   * aprobada (devolviéndola a borrador, que es lo que ya hace `recuadrar` cuando se
   * corrige una recepción de una aprobada), se agrega 'aprobada' a
   * ESTADOS_QUE_ACEPTAN_RECALCULO y el aviso ya funciona.
   */
  it('aprobada: no ofrece el botón y dice cuál es la salida que sí funciona', async () => {
    await armar(liquidacion(EL_MARTES, 'transportador', { estado: 'aprobada' }));

    expect(fixture.componentInstance.puedeRecalcular()).toBeFalse();
    expect(botonRecalcular()).toBeNull();
    // No desaparece en silencio: dice por qué y qué hacer. Sin esto el dueño busca
    // un botón que no está, con la tarifa mal y el comprobante listo para pagar.
    expect(comoSeLee(fixture.componentInstance.motivoNoRecalcular())).toBe(
      'Está aprobada y Recalcular solo trabaja sobre borradores. Si sus cifras quedaron mal ' +
        '—por ejemplo una tarifa que se corrigió después—, anúlela y vuelva a generarla: ' +
        'todavía no se le ha pagado nada.',
    );
    expect(ayudaEnPantalla()).toContain('anúlela y vuelva a generarla');
  });

  it('el aviso de "volverá a borrador" está listo para cuando el servidor la acepte', async () => {
    // Se llama al método directamente porque hoy el botón no está en ese estado: lo
    // que se comprueba es que el aviso EXISTE y que sin confirmar no se toca nada.
    await armar(liquidacion(EL_MARTES, 'transportador', { estado: 'aprobada' }));

    // El tooltip del botón ya lo diría sin oprimir nada, para el día en que esté.
    expect(fixture.componentInstance.tooltipRecalcular()).toContain('volverá a borrador');

    respuesta = undefined; // cerró el diálogo sin confirmar
    await fixture.componentInstance.recalcular();
    fixture.detectChanges();

    expect(confirmaciones.length).toBe(1);
    expect(confirmaciones[0].titulo).toBe('Esta liquidación está aprobada');
    expect(confirmaciones[0].mensaje).toContain('VOLVERÁ A BORRADOR');
    expect(confirmaciones[0].mensaje).toContain('aprobarla otra vez');
    expect(comoSeLee(confirmaciones[0].mensaje)).toContain('tarifas de hoy del transportador');
    // Recalcular no borra nada: la confirmación no se pinta de rojo.
    expect(confirmaciones[0].peligro).toBeFalse();
    // Y si no confirmó, NO se llamó al servidor.
    expect(servicio.recalculos).toBe(0);
    expect(tituloDelRecalculo()).toBeNull();
  });

  it('si confirma, recalcula y avisa que hay que aprobarla otra vez', async () => {
    await armar(liquidacion(EL_MARTES, 'transportador', { estado: 'aprobada' }));
    respuesta = true;
    servicio.recalculada = liquidacion(CON_LA_TARIFA_CORREGIDA, 'transportador', {
      ...CIFRAS_CORREGIDAS,
      estado: 'borrador',
    });
    await fixture.componentInstance.recalcular();
    fixture.detectChanges();

    expect(servicio.recalculos).toBe(1);
    expect(tituloDelRecalculo()).toBe('El flete pasó de $ 44.506,32 a $ 50.637,46');
    // El estado lo dice el SERVIDOR, no la pantalla: el aviso solo cuenta lo que pasó.
    expect(avisoDeEstado()).toBe('Volvió a borrador: revísela y apruébela otra vez.');
    expect(snackbar.mensajes.map(comoSeLee)).toEqual([
      'El flete pasó de $ 44.506,32 a $ 50.637,46. Volvió a borrador: revísela y apruébela otra vez.',
    ]);
  });

  it('en borrador no pregunta nada: no hay visto bueno que quitar', async () => {
    await armar(liquidacion(EL_MARTES));
    servicio.recalculada = liquidacion(EL_MARTES);
    await oprimirRecalcular();

    expect(confirmaciones.length).toBe(0);
    expect(servicio.recalculos).toBe(1);
  });

  // ------------------------------------------------- CON PLATA YA ENTREGADA, NO
  it('pagada: no ofrece el botón y dice por qué no se puede', async () => {
    await armar(
      liquidacion(EL_MARTES, 'transportador', {
        estado: 'pagada',
        pagado: '44506.32',
        saldo: '0',
        pagos: [{ id: 'p-1', fecha: '2026-07-16', valor: '44506.32', observaciones: null }],
      }),
    );

    expect(fixture.componentInstance.puedeRecalcular()).toBeFalse();
    expect(botonRecalcular()).toBeNull();
    // El botón no desaparece en silencio: queda el candado con la razón, como el
    // "No se puede eliminar" de un día ya pagado en Recepción diaria.
    expect(leido(fixture.nativeElement.querySelector('.nota-recalcular'))).toContain(
      'No se puede recalcular',
    );
    expect(comoSeLee(fixture.componentInstance.motivoNoRecalcular())).toBe(
      'Este comprobante ya está pagado ($ 44.506,32): sus cifras quedan en firme y no se ' +
        'pueden recalcular.',
    );
    expect(ayudaEnPantalla()).toContain('ya está pagado ($ 44.506,32)');
  });

  it('con un abono tampoco, y dice qué hacer si de verdad hay que rehacerlas', async () => {
    await armar(
      liquidacion(EL_MARTES, 'transportador', {
        estado: 'parcial',
        pagado: '24600',
        saldo: '19906.32',
        pagos: [{ id: 'p-1', fecha: '2026-07-16', valor: '24600', observaciones: null }],
      }),
    );

    expect(botonRecalcular()).toBeNull();
    expect(comoSeLee(fixture.componentInstance.motivoNoRecalcular())).toBe(
      'Ya se le abonó $ 24.600 contra estas cifras: quedan en firme y no se pueden ' +
        'recalcular. Si de verdad hay que rehacerlas, primero elimine el abono.',
    );
  });

  it('anulada: no hay botón ni candado que explicar', async () => {
    await armar(liquidacion(EL_MARTES, 'transportador', { estado: 'anulada' }));

    expect(botonRecalcular()).toBeNull();
    expect(fixture.componentInstance.motivoNoRecalcular()).toBeNull();
    expect(fixture.nativeElement.querySelector('.nota-recalcular')).toBeNull();
  });

  // --------------------------------------------------------------- PARA QUÉ SIRVE
  it('la pantalla dice para qué sirve el botón: la tarifa que se corrigió después', async () => {
    // Esto es lo que faltaba: el dueño corrigió la tarifa en la ficha del
    // transportador y no había nada que le dijera que este botón era el arreglo.
    await armar(liquidacion(EL_MARTES));

    const ayuda = ayudaEnPantalla();
    expect(ayuda).toContain('tarifa del transportador');
    expect(ayuda).toContain('Recalcular');
    expect(ayuda).toContain('tarifas de hoy');
    expect(fixture.componentInstance.tooltipRecalcular()).toBe(
      'Vuelve a calcular el flete con las tarifas de hoy del transportador y los anticipos pendientes',
    );
  });

  it('en la del proveedor la ayuda habla del anticipo, no de tarifas', async () => {
    await armar(liquidacion([det('d-1', '2026-07-07', '82', '1750', '143500')], 'proveedor'));

    const ayuda = ayudaEnPantalla();
    expect(ayuda).toContain('anticipo');
    expect(ayuda).not.toContain('tarifa del transportador');
  });

  // ------------------------------------------------------------ SI EL SERVIDOR NO
  it('si el recálculo falla, no se pinta ningún cambio y la pantalla no miente', async () => {
    await armar(liquidacion(EL_MARTES));
    servicio.fallaAlRecalcular = { status: 400, error: { detail: 'No se pudo' } };
    await oprimirRecalcular();

    // Ninguna cifra nueva: lo que se ve sigue siendo lo que de verdad está guardado.
    expect(tituloDelRecalculo()).toBeNull();
    expect(leerResumen(fixture)['Valor transporte']).toBe('$ 44.506,32');
    expect(snackbar.mensajes.length).toBe(1);
  });

  it('el aviso se cierra cuando el usuario ya lo leyó', async () => {
    await armar(liquidacion(EL_MARTES));
    servicio.recalculada = liquidacion(EL_MARTES, 'transportador', {
      valor_transporte: '50637.46',
      valor_total: '50637.46',
      neto_a_pagar: '50637.46',
      saldo: '50637.46',
    });
    await oprimirRecalcular();
    expect(tituloDelRecalculo()).not.toBeNull();

    (
      fixture.nativeElement.querySelector(
        '[aria-label="Cerrar el aviso del recálculo"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(tituloDelRecalculo()).toBeNull();
  });
});
