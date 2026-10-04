import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion, LiquidacionDetalle, PagoLiquidacion } from '../../core/models';
import { ConfirmData } from '../../shared/confirm-dialog';
import { SoportesDialog } from '../../shared/soportes.dialog';
import { SoportesResultado } from '../../shared/soportes.model';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { Correccion, LiquidacionesService } from './liquidaciones.service';

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

/**
 * UN RENGLÓN DE DÍA COMPLETO, como lo manda el backend.
 *
 * La tarifa viaja en CERO y eso es la verdad, no un dato que falte: no existe ninguna
 * tarifa por litro que reproduzca $150.000 el día. Los litros van al lado como
 * información —hacen falta para que el total de litros siga siendo la suma de la
 * columna— y lo que NO hay que hacer con ellos es multiplicarlos.
 */
const detFijo = (
  id: string,
  fecha: string,
  litros: string,
  valor: string,
  ruta?: [string, string],
  yaCobrado = false,
): LiquidacionDetalle => ({
  ...det(id, fecha, litros, '0', valor, ruta),
  modo_transporte: 'dia_fijo',
  // POR QUÉ VALE $0,00 LO DICE EL BACKEND, no la cifra: un fijo en cero puede serlo
  // porque ese día ya se cobró en otro comprobante (true) o porque la tarifa fija de esa
  // ruta es de $0,00 (false). Ver `dia_fijo_ya_cobrado`.
  dia_fijo_ya_cobrado: yaCobrado,
});

/**
 * EL CASO DEL DUEÑO, con las cifras medidas: el día que recogió de CINCO proveedores en
 * la ruta a fábrica (499,95 L) y otro día por litro en Nápoles.
 *
 * El día completo vale $150.000 —UNA vez, no cinco— y el de Nápoles se sigue
 * comprobando multiplicando: 219,45 L × $242,76 = $53.273,68. Los dos suman
 * $203.273,68, que es la cifra grande del comprobante.
 */
const EL_DIA_A_FABRICA = [
  detFijo('d-1', '2026-07-16', '499.95', '150000.00', ['r-fab', 'A fábrica']),
  det('d-2', '2026-07-17', '219.45', '242.76', '53273.68', ['r-nap', 'Nápoles']),
];

const CIFRAS_A_FABRICA: Partial<Liquidacion> = {
  total_litros: '719.40',
  // Con días fijos mezclados el backend manda el promedio en CERO a propósito: esa
  // división no reproduce la tarifa de ningún renglón. La pantalla no lo imprime.
  precio_promedio: '0',
  tiene_dias_fijos: true,
  valor_transporte: '203273.68',
  valor_total: '203273.68',
  neto_a_pagar: '203273.68',
  saldo: '203273.68',
};

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

  /**
   * El `POST /pagar` del servidor: marca pagada SIN registrar ningún pago.
   *
   * Es el camino de la quincena que quedó saldada en cero, y no el del diálogo de abonos:
   * el servidor rebota los abonos cuando el saldo no es positivo. Se cuentan las llamadas
   * porque lo que la prueba cuida es que la pantalla llame a ESTE y no al otro.
   */
  pagada: Liquidacion | null = null;
  cerradas = 0;

  pagar(): Observable<Liquidacion> {
    this.cerradas += 1;
    return of(this.pagada as Liquidacion);
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
 * EL RESUMEN EN ORDEN: los rótulos de arriba abajo, tal como se leen.
 *
 * `leerResumen` devuelve un diccionario y un diccionario no tiene orden, así que no
 * podía delatar el defecto que el dueño reportó: "Anticipos aplicados" y "Pagado"
 * estaban ARRIBA de VALOR TOTAL, y son descuentos DEL total. Ese defecto se ve
 * únicamente en la secuencia.
 */
const rotulosDelResumen = (fixture: Fixture): string[] =>
  Array.from((fixture.nativeElement.querySelector('.resumen') as HTMLElement).children)
    .filter((_, i) => i % 2 === 0)
    .map((celda) => leido(celda));

/** La cuenta del resumen, hecha con lo que la PANTALLA muestra. Ver `cuadreDelResumen`. */
interface Cuadre {
  /** Lo que suman, con su signo, los renglones que van ANTES de VALOR TOTAL. */
  antesDelTotal: number;
  /** VALOR TOTAL como lo muestra la pantalla. */
  valorTotal: number;
  /** El total menos los descuentos de abajo (anticipos, saldo anterior, pagado). */
  despuesDeLosDescuentos: number;
  /** El renglón de cierre EN SU DIRECCIÓN REAL: negativo si el tercero quedó debiendo. */
  cierre: number;
}

/**
 * LA REGLA DE ORO DEL RESUMEN, medida como la mide el dueño: sumando y restando de
 * arriba abajo lo que LEE en la pantalla, no lo que el backend mandó.
 *
 * Recorre los renglones marcados con `data-cuenta` —los litros y el precio promedio no
 * lo llevan: son la medida de la quincena, no plata que se sume— y aplica el signo que
 * cada cifra tiene IMPRESO. Si la pantalla redondeara, o si un renglón que no entra en
 * la cuenta se colara en la columna, esta cuenta no daría y ahí está el defecto.
 *
 * El renglón de cierre se compara en su dirección real: "Le queda debiendo" muestra la
 * cifra en positivo a propósito (un menos pegado a un total se lee mal), pero la cuenta
 * de verdad terminó por debajo de cero.
 */
const cuadreDelResumen = (fixture: Fixture): Cuadre => {
  const celdas = Array.from(
    fixture.nativeElement.querySelectorAll('.resumen .num[data-cuenta]'),
  ) as HTMLElement[];
  const cuadre: Cuadre = {
    antesDelTotal: 0,
    valorTotal: 0,
    despuesDeLosDescuentos: 0,
    cierre: 0,
  };
  let pasoElTotal = false;
  for (const celda of celdas) {
    const clave = celda.getAttribute('data-clave');
    const texto = leido(celda);
    // `centavos` ignora el signo de resta (es U+2212, no el guion), así que la cifra
    // llega en positivo y acá se decide si suma o resta según lo IMPRESO.
    const valor = centavos(texto);
    const resta = texto.startsWith('−');
    if (clave === 'valor_total') {
      cuadre.valorTotal = valor;
      cuadre.despuesDeLosDescuentos = valor;
      pasoElTotal = true;
    } else if (clave === 'saldo' || clave === 'le_queda_debiendo') {
      cuadre.cierre = clave === 'le_queda_debiendo' ? -valor : valor;
    } else if (pasoElTotal) {
      cuadre.despuesDeLosDescuentos += resta ? -valor : valor;
    } else {
      cuadre.antesDelTotal += resta ? -valor : valor;
    }
  }
  return cuadre;
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

  // ==========================================================================
  // EL DÍA COBRADO POR DÍA COMPLETO
  // ==========================================================================
  // "El transporte de leche a fábrica vale 150k independientemente de los litros".
  //
  // Ese renglón NO se puede mostrar como los demás, porque litros × precio no da su
  // valor. Y la regla de oro no se afloja: la columna sigue sumando EXACTO la cifra
  // grande, y el dueño tiene que poder verificar cada línea a mano —la fija leyéndola,
  // la de por litro multiplicando—.

  it('el día fijo se lee como el día completo, no como litros × precio', async () => {
    await armar(liquidacion(EL_DIA_A_FABRICA, 'transportador', CIFRAS_A_FABRICA));

    expect(detalleEnPantalla().slice(1)).toEqual([
      // Los litros van al lado como información; la columna Precio/L lleva una PALABRA,
      // que es la misma que imprime el PDF que se le entrega al conductor.
      ['16/07/2026', 'A fábrica', '499,95 L', 'Día completo', '$ 150.000'],
      ['17/07/2026', 'Nápoles', '219,45 L', '$ 242,76', '$ 53.273,68'],
    ]);
  });

  it('en el renglón fijo no hay NINGUNA tarifa por litro que invite a multiplicar', async () => {
    // Escribir "$ 150.000" en esa columna invitaría a multiplicarlo por los 499,95
    // litros —y a preguntar por los setenta y cinco millones que no aparecen—, y
    // escribir "$ 0,00" diría que ese día se recogió gratis. Va la palabra.
    await armar(liquidacion(EL_DIA_A_FABRICA, 'transportador', CIFRAS_A_FABRICA));

    const precio = detalleEnPantalla()[1][3];
    expect(precio).toBe('Día completo');
    expect(precio).not.toContain('$');
  });

  it('la columna Valor sigue sumando EXACTO la cifra grande con un día fijo adentro', async () => {
    // LA REGLA DE ORO, con el caso nuevo: el dueño suma la columna con la calculadora
    // y tiene que caer. 150.000 + 53.273,68 = 203.273,68.
    await armar(liquidacion(EL_DIA_A_FABRICA, 'transportador', CIFRAS_A_FABRICA));

    const sumado = sumaDelDesglose();
    const resumen = resumenEnPantalla();
    expect(sumado).toBe(20327368);
    expect(centavos(resumen['Valor transporte'])).toBe(sumado);
    expect(centavos(resumen['Valor total'])).toBe(sumado);
    expect(centavos(resumen['Saldo a pagar'])).toBe(sumado);
    // Y los litros del día fijo entran en el total como los demás: 499,95 + 219,45.
    expect(resumen['Total litros']).toBe('719,4 L');
  });

  it('el día de los cinco proveedores es UN renglón de $150.000, no cinco', async () => {
    // Es el error que había que hacer imposible. El comprobante trae un solo renglón
    // por (día, ruta) —lo reparte el backend entre las cinco recepciones— y la
    // pantalla no lo puede volver a multiplicar por nada.
    await armar(liquidacion(EL_DIA_A_FABRICA, 'transportador', CIFRAS_A_FABRICA));

    const delDia = detalleEnPantalla()
      .slice(1)
      .filter((fila) => fila[0] === '16/07/2026');
    expect(delDia.length).toBe(1);
    expect(delDia[0][4]).toBe('$ 150.000');
    expect(fixture.nativeElement.textContent).not.toContain('750.000');
  });

  it('un día completo que YA se cobró va en $0,00 y lo dice con esas palabras', async () => {
    // Leche anotada después de que ese día ya se liquidó: el día costó $150.000 una
    // vez y recoger un proveedor más ese mismo día no cuesta más. Un renglón en cero
    // sin explicación parece un error del sistema o una plata que alguien quitó.
    await armar(
      liquidacion(
        [
          detFijo('d-1', '2026-07-16', '82.00', '0', ['r-fab', 'A fábrica'], true),
          det('d-2', '2026-07-17', '219.45', '242.76', '53273.68', ['r-nap', 'Nápoles']),
        ],
        'transportador',
        {
          total_litros: '301.45',
          precio_promedio: '0',
          tiene_dias_fijos: true,
          valor_transporte: '53273.68',
          valor_total: '53273.68',
          neto_a_pagar: '53273.68',
          saldo: '53273.68',
        },
      ),
    );

    expect(detalleEnPantalla()[1]).toEqual([
      '16/07/2026',
      'A fábrica',
      '82 L',
      'Ya cobrado',
      '$ 0',
    ]);
    // Y la columna sigue cuadrando: el renglón en cero no suma ni resta nada.
    expect(sumaDelDesglose()).toBe(5327368);
    expect(centavos(resumenEnPantalla()['Valor transporte'])).toBe(5327368);
    expect(fixture.nativeElement.textContent).toContain('ya se le pagó en otro comprobante');
  });

  it('la letra chica dice cómo se lee esa línea, con las palabras del papel', async () => {
    await armar(liquidacion(EL_DIA_A_FABRICA, 'transportador', CIFRAS_A_FABRICA));

    const texto = comoSeLee(fixture.nativeElement.textContent);
    // Palabra por palabra como el PDF: el dueño pone el papel al lado de la pantalla.
    expect(texto).toContain('«Día completo» se cobran POR DÍA y no por litro');
    expect(texto).toContain('sin importar cuántos litros ni cuántos proveedores se recogieron');
    expect(texto).toContain('multiplicarlos no da el valor');
    // La segunda nota es solo para los renglones MARCADOS como ya cobrados, y acá no
    // hay ninguno: el día fijo de este comprobante vale sus $150.000.
    expect(texto).not.toContain('«Ya cobrado»');
  });

  it('un fijo de $0,00 que NUNCA se cobró dice «Día completo», no «Ya cobrado»', async () => {
    // EL DEFECTO, con las dos cifras del dueño. Un renglón de día fijo puede valer
    // $0,00 por DOS razones que no se distinguen mirando la cifra:
    //   · ese día ya se le pagó en OTRO comprobante  → «Ya cobrado»;
    //   · la tarifa fija de esa ruta es de $0,00 —el dueño decidió no cobrar ese
    //     viaje—  → «Día completo», porque a nadie se le ha pagado nada.
    // Deduciéndolo del cero, la pantalla le afirmaba al dueño que al conductor ya se le
    // había pagado ese día mientras el PDF —que sí usa el dato guardado— decía "Día
    // completo". El backend manda la bandera; la pantalla la usa.
    await armar(
      liquidacion(
        [
          detFijo('d-1', '2026-07-16', '82.00', '0', ['r-fab', 'A fábrica'], false),
          det('d-2', '2026-07-17', '219.45', '242.76', '53273.68', ['r-nap', 'Nápoles']),
        ],
        'transportador',
        {
          total_litros: '301.45',
          precio_promedio: '0',
          tiene_dias_fijos: true,
          valor_transporte: '53273.68',
          valor_total: '53273.68',
          neto_a_pagar: '53273.68',
          saldo: '53273.68',
        },
      ),
    );

    expect(detalleEnPantalla()[1]).toEqual([
      '16/07/2026',
      'A fábrica',
      '82 L',
      'Día completo',
      '$ 0',
    ]);
    const texto = comoSeLee(fixture.nativeElement.textContent);
    expect(texto).not.toContain('«Ya cobrado»');
    expect(fixture.nativeElement.textContent).not.toContain('ya se le pagó en otro comprobante');
    // Y la cifra grande no se movió por esto: el renglón en cero no suma ni resta.
    expect(sumaDelDesglose()).toBe(5327368);
  });

  it('sin días fijos no aparece ninguna nota: el comprobante de siempre no cambia', async () => {
    await armar(liquidacion(EL_MARTES));

    const texto = comoSeLee(fixture.nativeElement.textContent);
    expect(texto).not.toContain('Día completo');
    expect(texto).not.toContain('se cobran POR DÍA');
    expect(fixture.nativeElement.querySelector('.nota-dia-fijo')).toBeNull();
  });

  it('con días fijos NO se afirma ningún promedio por litro', async () => {
    // El backend manda `precio_promedio` en CERO cuando hay días fijos mezclados,
    // porque esa división no reproduce la tarifa de ningún renglón ($150.000 del día
    // más $53.273,68 a $242,76 daría "$363,80/L", que no es tarifa de nada). El
    // comprobante del transportador no imprime ese promedio —su PDF tampoco—, así que
    // lo que la pantalla no puede hacer es estrenarlo en "$ 0,00 el litro".
    await armar(liquidacion(EL_DIA_A_FABRICA, 'transportador', CIFRAS_A_FABRICA));

    expect(rotulosDelResumen(fixture)).not.toContain('Precio promedio');
    expect(comoSeLee(fixture.nativeElement.textContent)).not.toContain('$ 0,00');
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
    // aplicaron enteros, y ahí está de dónde sale la diferencia. Con SU SIGNO DE RESTA,
    // como en el comprobante en PDF: es un descuento del valor total, y el dueño resta
    // de arriba abajo. (El signo es U+2212 y no el guion del teclado justamente para
    // que "− $ 49.462,09" no se lea como una cifra negativa.)
    expect(resumen['Anticipos aplicados']).toBe('− $ 49.462,09');
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

  // =========================================================================
  // EL COBRO DE LO QUE QUEDÓ DEBIENDO, que es lo que pidió el dueño con estas
  // palabras: "en la liquidación a los que quedaron en negativo, ese saldo que se
  // queda debiendo se cobre en la siguiente liquidación".
  //
  // Antes de esto "le queda debiendo $X" era SOLO UN RÓTULO: la pantalla y el papel lo
  // mostraban y ahí moría, ningún documento cobraba esa plata. Lo que estas pruebas
  // cuidan son las dos puntas —de dónde vino el descuento y dónde se cobró la deuda— y,
  // por encima de todo, que la columna del resumen siga sumando EXACTO de arriba abajo
  // con un renglón más en el medio.
  // =========================================================================

  /**
   * LA QUINCENA QUE QUEDÓ DEBIENDO, con las cifras del caso real de Alex: se le
   * adelantaron $49.462,09 contra una quincena de $44.506,32, así que quedó debiendo
   * $4.955,77. Está APROBADA, que es el caso corriente. La deuda viaja igual desde un
   * BORRADOR —esa es la regla del servidor, y por ahí se estaba perdiendo la deuda de las
   * quincenas recién generadas— y NO viaja desde una anulada.
   */
  const LA_QUE_DEJO_LA_DEUDA: Partial<Liquidacion> = {
    ...LE_DEBE,
    estado: 'aprobada',
    periodo_inicio: '2026-06-16',
    periodo_fin: '2026-06-30',
  };

  /**
   * LA QUINCENA SIGUIENTE, la que SE COBRA esos $4.955,77. Es de proveedor a propósito:
   * es la que lleva bonificaciones y descuentos, o sea la columna más larga que hay que
   * hacer cuadrar, y con centavos en cada renglón.
   *
   *   143.482,50 + 1.500,25 − 500,75            = 144.482,00  (VALOR TOTAL)
   *   144.482,00 − 20.000,10 − 4.955,77 − 10.000,13 = 109.526,00  (SALDO A PAGAR)
   */
  const LA_QUE_LA_COBRA: Partial<Liquidacion> = {
    tipo: 'proveedor',
    estado: 'parcial',
    proveedor_nombre: 'Henri Castaño',
    transportador_nombre: null,
    periodo_inicio: '2026-07-01',
    periodo_fin: '2026-07-15',
    total_litros: '81.99',
    precio_promedio: '1750',
    valor_bruto: '143482.50',
    bonificaciones: '1500.25',
    descuentos: '500.75',
    valor_transporte: '0',
    valor_total: '144482.00',
    anticipos: '20000.10',
    saldo_anterior: '4955.77',
    // El desglose del renglón, como lo manda el backend: el período ya viene armado
    // (`periodo_texto`) para que la pantalla y el papel no lo formateen cada uno a su
    // manera, y la cifra de cada origen es su `le_queda_debiendo`.
    deudas_cobradas: [
      {
        id: 'l-junio',
        periodo_inicio: '2026-06-16',
        periodo_fin: '2026-06-30',
        periodo_texto: '16/06/2026 al 30/06/2026',
        le_queda_debiendo: '4955.77',
      },
    ],
    neto_a_pagar: '119526.13',
    pagado: '10000.13',
    saldo: '109526.00',
    le_queda_debiendo: '0',
    pagos: [{ id: 'p-1', fecha: '2026-07-16', valor: '10000.13', observaciones: null }],
  };

  const EL_DIA_DE_HENRI = [det('d-1', '2026-07-07', '81.99', '1750', '143482.50')];

  it('el renglón nuevo se lee con el rótulo del comprobante y su cifra', async () => {
    await armar(liquidacion(EL_DIA_DE_HENRI, 'proveedor', LA_QUE_LA_COBRA));

    // EL MISMO texto que imprime el PDF: el dueño pone los dos documentos uno al lado
    // del otro, y si la pantalla lo dijera con otras palabras no sabría que es el mismo
    // renglón. Con su signo de resta, porque es un descuento del valor total.
    expect(resumenEnPantalla()['Lo que quedó debiendo de la quincena pasada']).toBe(
      '− $ 4.955,77',
    );
  });

  it('el resumen suma EXACTO de arriba abajo con el renglón nuevo en el medio', async () => {
    await armar(liquidacion(EL_DIA_DE_HENRI, 'proveedor', LA_QUE_LA_COBRA));

    const cuadre = cuadreDelResumen(fixture);
    // 143.482,50 + 1.500,25 − 500,75 = 144.482,00, que es el VALOR TOTAL impreso.
    expect(cuadre.valorTotal).toBe(14448200);
    expect(cuadre.antesDelTotal).toBe(cuadre.valorTotal);
    // Y de ahí para abajo: − 20.000,10 − 4.955,77 − 10.000,13 = 109.526,00, el saldo.
    expect(cuadre.cierre).toBe(10952600);
    expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);
  });

  it('el orden es el de la cuenta: los descuentos DEBAJO del valor total', async () => {
    await armar(liquidacion(EL_DIA_DE_HENRI, 'proveedor', LA_QUE_LA_COBRA));

    // El defecto que el dueño reportó: "Anticipos aplicados" y "Pagado" salían ARRIBA
    // de VALOR TOTAL, y son descuentos DEL total; leídos antes que él no hay nada de
    // dónde restarlos. Es el mismo orden del comprobante en PDF.
    expect(rotulosDelResumen(fixture)).toEqual([
      'Total litros',
      'Precio promedio',
      'Valor bruto',
      'Bonificaciones',
      'Descuentos',
      'Valor total',
      'Anticipos aplicados',
      'Lo que quedó debiendo de la quincena pasada',
      'Pagado',
      'Saldo a pagar',
    ]);
  });

  it('la que SE COBRA la deuda dice de dónde vino, con el período de la otra', async () => {
    await armar(liquidacion(EL_DIA_DE_HENRI, 'proveedor', LA_QUE_LA_COBRA));

    // Un descuento sin explicación es lo que hace que el dueño desconfíe del sistema:
    // esta plata no sale de ninguna recepción de esta quincena.
    const nota = leido(fixture.nativeElement.querySelector('.nota-saldo-anterior'));
    expect(nota).toContain('$ 4.955,77');
    expect(nota).toContain('Henri Castaño');
    expect(nota).toContain('la liquidación del 16/06/2026 al 30/06/2026');
    expect(nota).toContain('una sola vez');
  });

  it('si fueron varias las quincenas que quedaron debiendo, van una por renglón', async () => {
    // Dos quincenas seguidas en negativo se cobran juntas, y sus cifras tienen que SUMAR
    // el renglón del resumen: es como el dueño comprueba el descuento.
    await armar(
      liquidacion(EL_DIA_DE_HENRI, 'proveedor', {
        ...LA_QUE_LA_COBRA,
        saldo_anterior: '7955.77',
        deudas_cobradas: [
          {
            id: 'l-mayo',
            periodo_inicio: '2026-05-16',
            periodo_fin: '2026-05-31',
            periodo_texto: '16/05/2026 al 31/05/2026',
            le_queda_debiendo: '3000.00',
          },
          {
            id: 'l-junio',
            periodo_inicio: '2026-06-16',
            periodo_fin: '2026-06-30',
            periodo_texto: '16/06/2026 al 30/06/2026',
            le_queda_debiendo: '4955.77',
          },
        ],
        // 144.482,00 − 20.000,10 − 7.955,77 − 10.000,13 = 106.526,00
        neto_a_pagar: '116526.13',
        saldo: '106526.00',
      }),
    );

    const renglones = Array.from(
      fixture.nativeElement.querySelectorAll('.origenes-deuda li'),
    ).map((li) => leido(li as Element));
    expect(renglones).toEqual([
      'Liquidación del 16/05/2026 al 31/05/2026: $ 3.000',
      'Liquidación del 16/06/2026 al 30/06/2026: $ 4.955,77',
    ]);
    // 300.000 + 495.577 = 795.577 centavos, o sea los $ 7.955,77 del renglón.
    expect(centavos(resumenEnPantalla()['Lo que quedó debiendo de la quincena pasada'])).toBe(
      795577,
    );
    // Y la columna sigue cuadrando con la deuda más grande.
    const cuadre = cuadreDelResumen(fixture);
    expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);
    expect(cuadre.cierre).toBe(10652600);
  });

  it('la que DEJÓ la deuda ya no promete: dice en qué liquidación se le cobró', async () => {
    await armar(
      liquidacion(EL_MARTES, 'transportador', {
        ...LA_QUE_DEJO_LA_DEUDA,
        deuda_trasladada_a_id: 'l-julio',
        deuda_trasladada_a: {
          id: 'l-julio',
          periodo_inicio: '2026-07-01',
          periodo_fin: '2026-07-15',
          periodo_texto: '01/07/2026 al 15/07/2026',
        },
      }),
    );

    const nota = leido(fixture.nativeElement.querySelector('.nota-le-debe'));
    expect(nota).toContain('Alex Agudelo le queda debiendo $ 4.955,77');
    expect(nota).toContain('YA se le cobró en la liquidación del 01/07/2026 al 15/07/2026');
    // La promesa que no cumplía nadie ya no está.
    expect(nota).not.toContain('se le cobra o se le descuenta en la próxima quincena');
  });

  it('mientras no se le haya cobrado, dice que está PENDIENTE y con qué rótulo va a salir', async () => {
    await armar(liquidacion(EL_MARTES, 'transportador', LA_QUE_DEJO_LA_DEUDA));

    const nota = leido(fixture.nativeElement.querySelector('.nota-le-debe'));
    expect(nota).toContain('PENDIENTE');
    // "después de esta" no es adorno: el servidor solo se la cobra en una liquidación
    // cuyo período empiece después de que este termine.
    expect(nota).toContain('próxima quincena que se le liquide después de esta');
    // Con el rótulo con que va a aparecer allá: así lo reconoce cuando lo vea.
    expect(nota).toContain('Lo que quedó debiendo de la quincena pasada');
  });

  it('si el enlace llega sin las fechas, dice que ya se cobró en vez de callarse', async () => {
    // El backend puede mandar el id sin el período. "Ya se cobró" sin fecha sigue siendo
    // mejor que una promesa falsa; lo que no puede es volver a decir "se le cobrará".
    await armar(
      liquidacion(EL_MARTES, 'transportador', {
        ...LA_QUE_DEJO_LA_DEUDA,
        deuda_trasladada_a_id: 'l-julio',
      }),
    );

    const nota = leido(fixture.nativeElement.querySelector('.nota-le-debe'));
    expect(nota).toContain('YA se le cobró en una liquidación posterior');
    expect(nota).not.toContain('PENDIENTE');
  });

  it('la cadena de tres quincenas no cobra dos veces, y la cuenta sigue cuadrando', async () => {
    /*
     * La tercera quincena: cobra los $4.955,77 que venían debiéndose, alcanza a cubrir
     * $2.000 con lo que produjo y vuelve a quedar debiendo $2.955,77. Esa cifra ya
     * INCLUYE la deuda vieja —no es una segunda deuda de $4.955,77 encima de la
     * primera—, y la nota lo tiene que decir: es la pregunta que sigue cuando el dueño
     * ve dos renglones de deuda seguidos.
     *
     *   3.000,00 (flete) − 1.000,00 (anticipos) − 4.955,77 (deuda vieja) = −2.955,77
     */
    await armar(
      liquidacion(EL_MARTES, 'transportador', {
        estado: 'aprobada',
        total_litros: '164',
        valor_transporte: '3000.00',
        valor_total: '3000.00',
        anticipos: '1000.00',
        saldo_anterior: '4955.77',
        deudas_cobradas: [
          {
            id: 'l-junio',
            periodo_inicio: '2026-06-16',
            periodo_fin: '2026-06-30',
            periodo_texto: '16/06/2026 al 30/06/2026',
            le_queda_debiendo: '4955.77',
          },
        ],
        neto_a_pagar: '-2955.77',
        saldo: '-2955.77',
        le_queda_debiendo: '2955.77',
      }),
    );

    const resumen = resumenEnPantalla();
    expect(resumen['Lo que quedó debiendo de la quincena pasada']).toBe('− $ 4.955,77');
    // El cierre en positivo y con el rótulo que dice de quién es la plata.
    expect(resumen['Le queda debiendo']).toBe('$ 2.955,77');
    expect(resumen['Saldo a pagar']).toBeUndefined();

    // LA CUENTA: 3.000 − 1.000 − 4.955,77 = −2.955,77, que es lo que dice el cierre.
    const cuadre = cuadreDelResumen(fixture);
    expect(cuadre.antesDelTotal).toBe(cuadre.valorTotal);
    expect(cuadre.cierre).toBe(-295577);
    expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);

    const nota = leido(fixture.nativeElement.querySelector('.nota-le-debe'));
    // La causa nombra las DOS cosas: sin la deuda vieja, la frase acusa a los anticipos
    // de una diferencia que no es toda suya y el dueño no le encuentra la cuenta.
    expect(nota).toContain('los anticipos aplicados ($ 1.000)');
    expect(nota).toContain('lo que ya venía debiendo de antes ($ 4.955,77)');
    expect(nota).toContain('no se le cobra dos veces');
  });

  it('en la del proveedor el flete sale del resumen y se explica aparte', async () => {
    // El flete de su leche NO se le descuenta a él —se le paga al transportador, que
    // tiene su propio comprobante—, así que metido en la columna la descuadraba: el
    // dueño lo restaba del valor total y le sobraba plata.
    await armar(
      liquidacion(EL_DIA_DE_HENRI, 'proveedor', {
        ...LA_QUE_LA_COBRA,
        valor_transporte: '20022.84',
      }),
    );

    expect(resumenEnPantalla()['Valor transporte']).toBeUndefined();
    const cuadre = cuadreDelResumen(fixture);
    expect(cuadre.antesDelTotal).toBe(cuadre.valorTotal);

    // Pero la cifra no se pierde: se dice como dato y con la razón al lado.
    const nota = leido(fixture.nativeElement.querySelector('.nota-flete'));
    expect(nota).toContain('$ 20.022,84');
    expect(nota).toContain('No se le descuenta a Henri Castaño');
  });

  it('en la del transportador no salen los renglones que siempre son cero', async () => {
    // Valor bruto, bonificaciones y descuentos son cero en TODOS sus comprobantes, y su
    // PDF nunca los imprimió: tres renglones en $0 entre los que sí cuentan.
    await armar(liquidacion(EL_MARTES));

    expect(rotulosDelResumen(fixture)).toEqual([
      'Total litros',
      'Valor transporte',
      'Valor total',
      'Anticipos aplicados',
      'Saldo a pagar',
    ]);
    const cuadre = cuadreDelResumen(fixture);
    expect(cuadre.antesDelTotal).toBe(cuadre.valorTotal);
    expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);
  });

  it('sin el campo nuevo (el backend todavía no lo manda) la pantalla se ve igual', async () => {
    // `saldo_anterior` llega en `undefined` mientras el servidor no lo exponga: el
    // renglón no puede aparecer en cero ni la nota inventarse un descuento que no hubo.
    await armar(liquidacion(EL_MARTES));

    expect(resumenEnPantalla()['Lo que quedó debiendo de la quincena pasada']).toBeUndefined();
    expect(fixture.nativeElement.querySelector('.nota-saldo-anterior')).toBeNull();
    expect(fixture.nativeElement.querySelector('.origenes-deuda')).toBeNull();
    expect(leerResumen(fixture)['Saldo a pagar']).toBe('$ 44.506,32');
  });

  // ----------------------------------------------------------------------------
  // LOS BOTONES QUE EL SERVIDOR AHORA REBOTA. La regla de esta pantalla es que no
  // puede ofrecer algo que el servidor va a negar —es la misma del candado de
  // Recepción diaria y del botón Recalcular—, y este trabajo agregó dos noes nuevos.
  // ----------------------------------------------------------------------------
  /** Un texto de la barra de acciones (el candado con su razón), si está. */
  const candadoEnAcciones = (): string =>
    Array.from(fixture.nativeElement.querySelectorAll('.nota-recalcular'))
      .map((nota) => leido(nota as Element))
      .join(' | ');

  const botonLlamado = (texto: string): HTMLButtonElement | null =>
    (Array.from(fixture.nativeElement.querySelectorAll('button')).find((boton) =>
      leido(boton as Element).includes(texto),
    ) as HTMLButtonElement | undefined) ?? null;

  it('no ofrece PAGAR a quien quedó debiendo: no hay nada que entregarle', async () => {
    // El servidor lo rebota, y con razón. Antes el botón aparecía igual (el estado
    // sigue siendo 'aprobada') y el diálogo de pago abría con el saldo prellenado, que
    // acá es una cifra NEGATIVA. Peor todavía: antes marcaba la liquidación PAGADA sin
    // que saliera un peso, y eso trababa los días de la quincena para siempre.
    await armar(liquidacion(EL_MARTES, 'transportador', LA_QUE_DEJO_LA_DEUDA));

    expect(fixture.componentInstance.puedePagar()).toBeFalse();
    expect(botonLlamado('Pagar')).toBeNull();
    expect(candadoEnAcciones()).toContain('No hay nada que pagar');
    const motivo = comoSeLee(fixture.componentInstance.motivoNoPagar());
    expect(motivo).toContain('Alex Agudelo quedó debiendo $ 4.955,77');
    expect(motivo).toContain('se le cobra en la próxima quincena que se le liquide');
  });

  // ----------------------------------------------------------------------------
  // LA QUINCENA QUE NO SE PODÍA CERRAR. Con el saldo en CERO EXACTO —el anticipo cubrió
  // justo la quincena— el botón desaparecía (exigía saldo > 0) y no había ningún otro:
  // esa liquidación se quedaba en 'aprobada' para siempre, con sus días abiertos a que
  // alguien les cambiara las cifras meses después. Y el servidor SÍ la acepta cuando el
  // cero lo hicieron los anticipos: su `pagar` rebota si el tercero quedó DEBIENDO o si
  // el cero lo hizo la deuda arrastrada sin pagos (ver el describe de "Marcar pagada que
  // siempre fallaba", más abajo).
  // ----------------------------------------------------------------------------
  /** El anticipo cubrió EXACTO la quincena: $44.506,32 contra $44.506,32. */
  const SALDADA_EN_CERO: Partial<Liquidacion> = {
    estado: 'aprobada',
    anticipos: '44506.32',
    neto_a_pagar: '0',
    saldo: '0',
    le_queda_debiendo: '0',
  };

  /**
   * EL MISMO CERO, PERO HECHO POR LA DEUDA VIEJA: $39.550,55 de anticipo más los
   * $4.955,77 que ya venía debiendo cubren exacto los $44.506,32 de la quincena.
   *
   * Es el caso en que el aviso mentía: decía "los anticipos ya entregados cubren
   * exactamente la quincena" y el dueño iba a buscar unos anticipos que no llegaban a
   * esa cifra.
   */
  const SALDADA_POR_LA_DEUDA_VIEJA: Partial<Liquidacion> = {
    estado: 'aprobada',
    anticipos: '39550.55',
    saldo_anterior: '4955.77',
    deudas_cobradas: [
      {
        id: 'l-junio',
        periodo_inicio: '2026-06-16',
        periodo_fin: '2026-06-30',
        periodo_texto: '16/06/2026 al 30/06/2026',
        le_queda_debiendo: '4955.77',
      },
    ],
    neto_a_pagar: '0',
    saldo: '0',
    le_queda_debiendo: '0',
  };

  it('con el saldo en CERO la quincena SÍ se puede cerrar: el servidor lo acepta', async () => {
    await armar(liquidacion(EL_MARTES, 'transportador', SALDADA_EN_CERO));

    // El botón no dice "Pagar" —no se paga nada— pero tiene que estar: sin él la
    // liquidación se queda abierta para siempre.
    expect(fixture.componentInstance.puedePagar()).toBeFalse();
    expect(fixture.componentInstance.puedeCerrarSinPago()).toBeTrue();
    expect(botonLlamado('Marcar pagada')).not.toBeNull();
    // Y ya no queda el candado diciendo que no hay nada que hacer al lado de un botón.
    expect(fixture.componentInstance.motivoNoPagar()).toBeNull();
    expect(candadoEnAcciones()).not.toContain('No hay nada que pagar');
  });

  it('el aviso del cero no le echa la culpa a los anticipos cuando fue la deuda vieja', async () => {
    await armar(liquidacion(EL_MARTES, 'transportador', SALDADA_POR_LA_DEUDA_VIEJA));

    const nota = comoSeLee(
      (fixture.nativeElement.querySelector('.nota-saldo-cero') as HTMLElement)?.textContent,
    );
    // Nombra LOS DOS renglones que hicieron el cero, con sus cifras: son los mismos del
    // resumen de arriba, así que el dueño puede cuadrarlo con la columna.
    expect(nota).toContain('los anticipos aplicados ($ 39.550,55)');
    expect(nota).toContain('lo que ya venía debiendo de antes ($ 4.955,77)');
    expect(nota).toContain('cubren EXACTO el valor total de la quincena ($ 44.506,32)');
    // 39.550,55 + 4.955,77 = 44.506,32: la explicación cuadra al centavo.
    expect(3955055 + 495577).toBe(4450632);
  });

  it('y cuando el cero SÍ lo hicieron solo los anticipos, dice solo eso', async () => {
    await armar(liquidacion(EL_MARTES, 'transportador', SALDADA_EN_CERO));

    const nota = comoSeLee(
      (fixture.nativeElement.querySelector('.nota-saldo-cero') as HTMLElement)?.textContent,
    );
    expect(nota).toContain('los anticipos aplicados ($ 44.506,32) cubren EXACTO el valor total');
    expect(nota).not.toContain('debiendo de antes');
  });

  it('en una PAGADA el cero es lo normal: no hay aviso ni botón que ofrecer', async () => {
    // Toda liquidación pagada tiene el saldo en cero. Ahí no hay nada que decidir, y una
    // nota explicando lo obvio en cada comprobante pagado sería ruido.
    await armar(
      liquidacion(EL_MARTES, 'transportador', {
        estado: 'pagada',
        pagado: '44506.32',
        saldo: '0',
        pagos: [{ id: 'p-1', fecha: '2026-07-16', valor: '44506.32', observaciones: null }],
      }),
    );

    expect(fixture.componentInstance.puedeCerrarSinPago()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.nota-saldo-cero')).toBeNull();
    expect(botonLlamado('Marcar pagada')).toBeNull();
  });

  it('la que quedó DEBIENDO sigue sin botón: ahí el servidor rebota', async () => {
    // El borde: el cero se cierra, el negativo no. Marcar pagada una quincena donde el
    // tercero quedó debiendo pondría "PAGADA" al lado de "LE QUEDA DEBIENDO" y trabaría
    // sus días sin que hubiera salido un peso.
    await armar(liquidacion(EL_MARTES, 'transportador', LA_QUE_DEJO_LA_DEUDA));

    expect(fixture.componentInstance.puedeCerrarSinPago()).toBeFalse();
    expect(botonLlamado('Marcar pagada')).toBeNull();
    expect(candadoEnAcciones()).toContain('No hay nada que pagar');
  });

  it('la que DEJÓ la deuda y se ANULÓ no promete un cobro que no va a pasar', async () => {
    // La promesa era falsa: de una liquidación anulada el servidor no le cobra la deuda a
    // nadie. Lo que hay que hacer es volver a generar la quincena.
    await armar(
      liquidacion(EL_MARTES, 'transportador', { ...LA_QUE_DEJO_LA_DEUDA, estado: 'anulada' }),
    );

    const nota = comoSeLee(
      (fixture.nativeElement.querySelector('.nota-le-debe') as HTMLElement).textContent,
    );
    expect(nota).toContain('Esta liquidación está ANULADA');
    expect(nota).toContain('no se le cobra en ninguna parte');
    expect(nota).toContain('vuelva a generar la quincena');
    expect(nota).not.toContain('queda PENDIENTE');
  });

  it('en BORRADOR la deuda viaja igual, y el aviso lo dice con esas palabras', async () => {
    await armar(
      liquidacion(EL_MARTES, 'transportador', { ...LA_QUE_DEJO_LA_DEUDA, estado: 'borrador' }),
    );

    const nota = comoSeLee(
      (fixture.nativeElement.querySelector('.nota-le-debe') as HTMLElement).textContent,
    );
    expect(nota).toContain('se le cobra en la próxima quincena que se le liquide después de esta');
    expect(nota).toContain('Se le cobra aunque esta liquidación siga en borrador');
  });

  it('con la deuda ya cobrada, tampoco ofrece ANULAR: dice cuál anular primero', async () => {
    // Anularla dejaría a la otra liquidación descontando la deuda de un documento
    // anulado. Lo importante del aviso no es el "no": es el nombre de la que hay que
    // anular primero, porque sin eso el dueño queda atascado.
    await armar(
      liquidacion(EL_MARTES, 'transportador', {
        ...LA_QUE_DEJO_LA_DEUDA,
        deuda_trasladada_a_id: 'l-julio',
        deuda_trasladada_a: {
          id: 'l-julio',
          periodo_inicio: '2026-07-01',
          periodo_fin: '2026-07-15',
          periodo_texto: '01/07/2026 al 15/07/2026',
        },
      }),
    );

    expect(fixture.componentInstance.puedeAnular()).toBeFalse();
    expect(botonLlamado('Anular')).toBeNull();
    expect(candadoEnAcciones()).toContain('No se puede anular');
    const motivo = comoSeLee(fixture.componentInstance.motivoNoAnular());
    expect(motivo).toContain('ya se le cobró en la liquidación del 01/07/2026 al 15/07/2026');
    expect(motivo).toContain('Anule primero esa liquidación');
  });

  it('mientras la deuda esté libre, la quincena SÍ se puede anular', async () => {
    // La otra mitad de lo que pidió el dueño: si no salió plata y nadie le cobró la
    // deuda, esa quincena sigue corregible. Trabarla sería trabar un día por una plata
    // que no se movió.
    await armar(liquidacion(EL_MARTES, 'transportador', LA_QUE_DEJO_LA_DEUDA));

    expect(fixture.componentInstance.puedeAnular()).toBeTrue();
    expect(botonLlamado('Anular')).not.toBeNull();
    expect(fixture.componentInstance.motivoNoAnular()).toBeNull();
  });

  it('lo normal no cambia: con saldo por pagar, el botón Pagar sigue ahí', async () => {
    await armar(liquidacion(EL_MARTES, 'transportador', { estado: 'aprobada' }));

    expect(fixture.componentInstance.puedePagar()).toBeTrue();
    expect(botonLlamado('Pagar')).not.toBeNull();
    expect(fixture.componentInstance.motivoNoPagar()).toBeNull();
  });

  it('el mensaje de WhatsApp lleva el renglón nuevo y se puede cuadrar', async () => {
    // Ese mensaje se lo reenvían al tercero, suelto y sin la tabla alrededor. Antes
    // llevaba cuatro cifras escogidas a mano y le faltaban los descuentos del medio:
    // llegaba un valor total y un saldo que no daban.
    await armar(liquidacion(EL_DIA_DE_HENRI, 'proveedor', LA_QUE_LA_COBRA));

    let enviado = '';
    spyOn(window, 'open').and.callFake((url?: string | URL): Window | null => {
      enviado = decodeURIComponent(String(url ?? ''));
      return null;
    });
    fixture.componentInstance.enviarWhatsApp();
    const texto = comoSeLee(enviado);

    expect(texto).toContain('Valor total: $ 144.482');
    expect(texto).toContain('Anticipos aplicados: − $ 20.000,10');
    expect(texto).toContain('Lo que quedó debiendo de la quincena pasada: − $ 4.955,77');
    expect(texto).toContain('Pagado: − $ 10.000,13');
    expect(texto).toContain('Saldo a pagar: $ 109.526');
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
    // Del flete Corregir no recibe nada: borrar el pago es la única salida por dentro, y va
    // con su advertencia, como el candado del anticipo de esa misma quincena.
    expect(comoSeLee(fixture.componentInstance.motivoNoRecalcular())).toBe(
      'Ya se le abonó $ 24.600 contra estas cifras: quedan en firme y no se pueden ' +
        'recalcular. Elimine primero ese pago si de verdad hay que rehacerlas —con él se van ' +
        'sus soportes, que no se recuperan—, o registre el ajuste en la quincena siguiente.',
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

/**
 * CERRAR LA QUINCENA QUE NO HAY QUE PAGAR, oprimiendo el botón de verdad.
 *
 * El caso: el anticipo cubrió EXACTO la quincena, el saldo quedó en $0 y antes no había
 * ningún botón —el de Pagar exigía saldo > 0—, así que esa liquidación se quedaba en
 * 'aprobada' para siempre con sus días abiertos a que alguien les cambiara las cifras.
 *
 * Lo que estas pruebas cuidan es POR DÓNDE sale la pantalla: el servidor acepta marcarla
 * pagada (`POST /pagar`) pero REBOTA un abono con saldo cero, así que este botón NO puede
 * abrir el diálogo de pago —abriría con $0 prellenado, el formulario inválido y el botón
 * muerto—. Y que se pregunte antes: cerrarla traba los días de la quincena en Recepción
 * diaria y de 'pagada' no se puede anular.
 */
describe('LiquidacionDetailDialog: la quincena saldada en cero se puede cerrar', () => {
  let fixture: Fixture;
  let servicio: ServicioFalso;
  let snackbar: SnackbarFalso;
  let confirmaciones: ConfirmData[];
  /** Lo que responde el usuario en la confirmación. `undefined` = cerró sin confirmar. */
  let respuesta: unknown;

  /** El anticipo cubrió justo la quincena: $44.506,32 contra $44.506,32. */
  const SALDADA: Partial<Liquidacion> = {
    estado: 'aprobada',
    anticipos: '44506.32',
    neto_a_pagar: '0',
    saldo: '0',
    le_queda_debiendo: '0',
  };

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
    // Se espía la instancia REAL que usa el componente, por lo mismo que en las pruebas
    // del recálculo: su MatDialog sale de su propio inyector (importa MatDialogModule) y
    // un doble en `providers` no se usaría nunca.
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

  const botonCerrar = (): HTMLButtonElement | null =>
    (Array.from(fixture.nativeElement.querySelectorAll('button')).find((boton) =>
      leido(boton as Element).includes('Marcar pagada'),
    ) as HTMLButtonElement | undefined) ?? null;

  const oprimirCerrar = async (): Promise<void> => {
    botonCerrar()!.click();
    // Dos vueltas: la primera resuelve la confirmación y la segunda la respuesta del
    // servidor.
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('pregunta antes, y la pregunta dice lo que va a pasar con los días', async () => {
    await armar(liquidacion(EL_MARTES, 'transportador', SALDADA));
    respuesta = undefined; // el usuario cierra la confirmación sin aceptar

    await oprimirCerrar();

    expect(confirmaciones.length).toBe(1);
    const pregunta = comoSeLee(confirmaciones[0].mensaje);
    expect(pregunta).toContain('No hay nada que entregarle a Alex Agudelo');
    expect(pregunta).toContain('los anticipos aplicados ($ 44.506,32)');
    expect(pregunta).toContain('sus días ya no se pueden corregir en Recepción diaria');
    expect(confirmaciones[0].accion).toBe('Marcar pagada');
    // Cerrar una quincena saldada no destruye nada: el rojo del diálogo está reservado
    // para lo que borra o anula.
    expect(confirmaciones[0].peligro).toBeFalse();
    // Y si no confirmó, no se tocó nada.
    expect(servicio.cerradas).toBe(0);
  });

  it('al confirmar va derecho al POST /pagar: no abre el diálogo de abonos', async () => {
    // El servidor rebota un ABONO con saldo cero (`registrar_pago` exige saldo > 0), y el
    // diálogo de pago abriría con $0 prellenado y el botón muerto. El camino correcto es
    // marcarla pagada, que el servidor sí acepta cuando nadie quedó debiendo.
    await armar(liquidacion(EL_MARTES, 'transportador', SALDADA));
    servicio.pagada = liquidacion(EL_MARTES, 'transportador', { ...SALDADA, estado: 'pagada' });
    respuesta = true;

    await oprimirCerrar();

    expect(servicio.cerradas).toBe(1);
    // La confirmación es el ÚNICO diálogo que se abrió: si hubiera pasado por el de
    // pagos, acá habría dos.
    expect(confirmaciones.length).toBe(1);
    // Y lo que se pinta es lo que respondió el servidor. (El chip muestra el estado tal
    // cual y lo capitaliza con CSS, así que el texto leído va en minúscula.)
    expect(leido(fixture.nativeElement.querySelector('app-estado-chip'))).toBe('pagada');
    expect(snackbar.mensajes.join(' ')).toContain('Liquidación cerrada');
  });

  it('cerrada ya no ofrece el botón: la quincena quedó en firme', async () => {
    await armar(liquidacion(EL_MARTES, 'transportador', SALDADA));
    servicio.pagada = liquidacion(EL_MARTES, 'transportador', { ...SALDADA, estado: 'pagada' });
    respuesta = true;

    await oprimirCerrar();

    expect(botonCerrar()).toBeNull();
    expect(fixture.componentInstance.puedeCerrarSinPago()).toBeFalse();
  });
});

/**
 * LA FOTO DE LA TRANSFERENCIA, PEGADA AL PAGO. Es lo que pidió el dueño con estas
 * palabras: "que se le puedan agregar los comprobantes a los pagos de los proveedores".
 *
 * Lo que estas pruebas cuidan es lo que el dueño tiene que poder entender sin que nadie
 * se lo explique:
 *
 *  · DÓNDE se anexa. En el pago, no en la quincena entera. Una quincena se paga en dos
 *    o tres entregas, cada una con su transferencia, y un montón de fotos colgadas del
 *    comprobante no dice cuál es de cuál. Por eso el clip va en la FILA del pago.
 *  · CUÁLES ya tienen su respaldo, de un vistazo: el número encima del clip.
 *  · QUE LA FOTO PESADA SE REDUCE SOLA, dicho ANTES de que pase.
 *  · Y que borrar el pago se lleva sus fotos, dicho ANTES de borrarlo: el servidor las
 *    borra también del almacenamiento, y enterarse después es haber perdido la única
 *    prueba de una entrega de plata.
 *
 * Los PERMISOS con que se abre son los de LIQUIDACIONES y no los de reventa —anexar pide
 * 'administrar', el mismo que registrar el pago— y eso también se mide: la pantalla es la
 * misma de reventa, y si le pasara los permisos del otro módulo mostraría botones que el
 * servidor va a rebotar.
 */
interface DatosDeApertura {
  titulo?: string;
  ayuda?: string;
  permisos?: { subir: string; compartir: string; eliminar: string };
  mensaje?: string;
}

class ServicioConPagos extends ServicioFalso {
  eliminados: string[] = [];
  trasEliminar: Liquidacion | null = null;

  eliminarPago(_id: string, pagoId: string): Observable<Liquidacion> {
    this.eliminados.push(pagoId);
    return of(this.trasEliminar as Liquidacion);
  }
}

describe('LiquidacionDetailDialog: los soportes de cada pago', () => {
  let fixture: Fixture;
  let servicio: ServicioConPagos;
  let snackbar: SnackbarFalso;
  /** Cada diálogo que la pantalla abrió: cuál componente y con qué datos. */
  let aperturas: { componente: unknown; data: DatosDeApertura }[];
  /** Lo que responde el diálogo que se abrió. */
  let respuesta: unknown;

  const pago = (
    id: string,
    fecha: string,
    valor: string,
    adjuntosCount?: number,
  ): PagoLiquidacion => ({
    id,
    fecha,
    valor,
    destinatario: null,
    observaciones: null,
    ...(adjuntosCount === undefined ? {} : { adjuntos_count: adjuntosCount }),
  });

  const conPagos = (pagos: PagoLiquidacion[]): Liquidacion =>
    liquidacion(EL_MARTES, 'transportador', {
      estado: 'parcial',
      pagado: '20000',
      saldo: '24506.32',
      pagos,
    });

  const armar = async (item: Liquidacion): Promise<void> => {
    servicio = new ServicioConPagos();
    snackbar = new SnackbarFalso();
    aperturas = [];
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
    // La instancia REAL, por lo mismo que en las demás pruebas de esta pantalla: su
    // MatDialog sale de su propio inyector (importa MatDialogModule) y un doble puesto
    // en `providers` no se usaría nunca.
    spyOn(fixture.debugElement.injector.get(MatDialog), 'open').and.callFake(
      (componente: unknown, config?: { data?: DatosDeApertura }) => {
        aperturas.push({ componente, data: config?.data ?? {} });
        return { afterClosed: () => of(respuesta) } as ReturnType<MatDialog['open']>;
      },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** El encabezado y las filas de la tabla de PAGOS (la segunda de la pantalla). */
  const leerPagos = (): string[][] => {
    const tablas = fixture.nativeElement.querySelectorAll('table');
    const tabla = tablas[tablas.length - 1] as HTMLTableElement;
    return Array.from(tabla.querySelectorAll('tr')).map((tr) =>
      Array.from((tr as HTMLElement).querySelectorAll('th,td')).map((celda) => leido(celda)),
    );
  };

  /** El clip de la fila n del cuerpo de la tabla de pagos. */
  const clip = (fila: number): HTMLButtonElement =>
    fixture.nativeElement.querySelectorAll('td.col-soportes button')[fila] as HTMLButtonElement;

  const textoEnPantalla = (): string => comoSeLee(fixture.nativeElement.textContent);

  it('la tabla de pagos trae la columna Soporte, y el clip sale en TODAS las filas', async () => {
    await armar(
      conPagos([pago('p-1', '2026-09-05', '20000', 2), pago('p-2', '2026-09-06', '5000', 0)]),
    );

    const filas = leerPagos();
    expect(filas[0]).toEqual([
      'Fecha', 'Valor', 'Girado a / Destinatario', 'Observaciones', 'Soporte', '',
    ]);
    // También en el pago que NO tiene fotos: si el clip solo saliera cuando ya hay
    // una, no habría por dónde anexar la primera.
    expect(fixture.nativeElement.querySelectorAll('td.col-soportes button').length).toBe(2);
  });

  it('el número encima del clip dice cuál pago ya tiene su respaldo', async () => {
    await armar(
      conPagos([pago('p-1', '2026-09-05', '20000', 2), pago('p-2', '2026-09-06', '5000', 0)]),
    );

    expect(leido(clip(0).querySelector('.badge-adjuntos'))).toBe('2');
    // Sin fotos NO va un "0": un cero encima del clip se lee como un botón muerto.
    expect(clip(1).querySelector('.badge-adjuntos')).toBeNull();
  });

  it('el clip habla en singular, en plural, y invita a anexar cuando no hay nada', async () => {
    await armar(
      conPagos([
        pago('p-1', '2026-09-05', '20000', 1),
        pago('p-2', '2026-09-06', '5000', 3),
        pago('p-3', '2026-09-07', '1000', 0),
      ]),
    );

    const componente = fixture.componentInstance;
    const [uno, tres, ninguno] = componente.liq().pagos;
    // "Ver los 1 soportes" es la clase de frase que hace que el dueño deje de leer
    // los avisos del sistema.
    expect(componente.rotuloSoportes(uno)).toBe('Ver el soporte de este pago (1 archivo)');
    expect(componente.rotuloSoportes(tres)).toBe('Ver los soportes de este pago (3 archivos)');
    expect(componente.rotuloSoportes(ninguno)).toBe(
      'Anexar la foto de la transferencia de este pago',
    );
  });

  it('una respuesta vieja, sin el campo, no pinta "undefined" ni un número inventado', async () => {
    await armar(conPagos([pago('p-1', '2026-09-05', '20000')]));

    const componente = fixture.componentInstance;
    expect(componente.cuantosSoportes(componente.liq().pagos[0])).toBe(0);
    expect(clip(0).querySelector('.badge-adjuntos')).toBeNull();
    expect(textoEnPantalla()).not.toContain('undefined');
  });

  it('abre los soportes de ESE pago y con los permisos de liquidaciones', async () => {
    await armar(
      conPagos([pago('p-1', '2026-09-05', '20000', 0), pago('p-2', '2026-09-06', '5000', 0)]),
    );

    clip(1).click();

    expect(aperturas.length).toBe(1);
    expect(aperturas[0].componente).toBe(SoportesDialog);
    // El título nombra el pago que se tocó —el SEGUNDO— con la misma fecha y la misma
    // cifra que su fila: el dueño tiene que reconocer cuál abrió.
    expect(comoSeLee(aperturas[0].data.titulo)).toBe('Pago del 06/09/2026 · $ 5.000');
    // Y la línea que dice que las fotos se pegan al pago, no a la quincena.
    expect(aperturas[0].data.ayuda).toContain('no a la liquidación entera');
    expect(aperturas[0].data.ayuda).toContain('Alex Agudelo');
    // Anexar pide 'administrar', EL MISMO permiso que registrar el pago: con 'crear'
    // —el de generar la quincena— quien no puede pagar colgaría el comprobante de
    // haber pagado. No son los de reventa aunque la pantalla sea la misma.
    expect(aperturas[0].data.permisos).toEqual({
      subir: 'liquidaciones:administrar',
      compartir: 'liquidaciones:exportar',
      eliminar: 'liquidaciones:eliminar',
    });
  });

  it('al volver del diálogo el clip queda con el número nuevo, sin ir al servidor', async () => {
    await armar(
      conPagos([pago('p-1', '2026-09-05', '20000', 0), pago('p-2', '2026-09-06', '5000', 1)]),
    );
    respuesta = { cambiado: true, cuantos: 3 } as SoportesResultado;

    clip(0).click();
    await fixture.whenStable();
    fixture.detectChanges();

    // Solo el del pago que se tocó. El otro se queda como estaba: anexar una foto en
    // uno no puede mover el número del de al lado.
    expect(leido(clip(0).querySelector('.badge-adjuntos'))).toBe('3');
    expect(leido(clip(1).querySelector('.badge-adjuntos'))).toBe('1');
    // Y las CIFRAS no se movieron: anexar una foto no es un peso más ni un peso menos.
    expect(fixture.componentInstance.liq().pagado).toBe('20000');
    expect(fixture.componentInstance.liq().saldo).toBe('24506.32');
  });

  it('si se cerró sin tocar nada, el clip no se mueve', async () => {
    await armar(conPagos([pago('p-1', '2026-09-05', '20000', 2)]));
    respuesta = { cambiado: false, cuantos: 2 } as SoportesResultado;

    clip(0).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(leido(clip(0).querySelector('.badge-adjuntos'))).toBe('2');
  });

  it('explica en cristiano dónde se anexa y que la foto pesada se reduce sola', async () => {
    await armar(conPagos([pago('p-1', '2026-09-05', '20000', 0)]));

    const enPantalla = textoEnPantalla();
    // Las cuatro cosas que el dueño tiene que saber, en la pantalla y no en un manual.
    expect(enPantalla).toContain('guarda la foto de la transferencia');
    expect(enPantalla).toContain('no en la liquidación entera');
    expect(enPantalla).toContain('Caben varias fotos');
    expect(enPantalla).toContain('se pueden quitar');
    expect(enPantalla).toContain('el sistema la reduce solo para que ocupe menos');
  });

  it('borrar un pago avisa ANTES que se van sus fotos, y cuántas', async () => {
    await armar(conPagos([pago('p-1', '2026-09-05', '20000', 2)]));
    servicio.trasEliminar = conPagos([]);
    respuesta = true;

    const borrar = fixture.nativeElement.querySelector(
      'td.col-acciones button',
    ) as HTMLButtonElement;
    borrar.click();
    await fixture.whenStable();

    expect(comoSeLee(aperturas[0].data.mensaje)).toContain('Se borran también sus 2 soportes');
    expect(servicio.eliminados).toEqual(['p-1']);
  });

  it('el aviso habla de UN soporte cuando es uno solo, y calla cuando no hay ninguno', async () => {
    await armar(
      conPagos([pago('p-1', '2026-09-05', '20000', 1), pago('p-2', '2026-09-06', '5000', 0)]),
    );
    const componente = fixture.componentInstance;
    const [uno, ninguno] = componente.liq().pagos;
    servicio.trasEliminar = conPagos([]);
    respuesta = false;

    componente.eliminarPago(uno);
    expect(comoSeLee(aperturas[0].data.mensaje)).toContain(
      'Se borra también su soporte (la foto de la transferencia).',
    );

    componente.eliminarPago(ninguno);
    // Sin fotos no se inventa una frase: el aviso queda como estaba antes de todo esto.
    expect(comoSeLee(aperturas[1].data.mensaje)).toBe(
      '¿Eliminar el pago de $ 5.000? El saldo volverá a subir por ese valor. Esta acción no ' +
        'se puede deshacer.',
    );
  });
});

/**
 * EL HISTORIAL DE CORRECCIONES: las TRES hojas de la misma quincena.
 *
 * El caso del dueño, tal como llega al mostrador: la quincena se corrigió tres veces, el
 * productor aparece con una hoja en la mano —puede ser cualquiera de las tres— y hay que
 * emparejarla. Hasta este trabajo la pantalla solo mostraba el motivo de la ÚLTIMA, así
 * que las dos versiones intermedias no existían para nadie y la discusión se cerraba con
 * la palabra del que tuviera el papel.
 *
 * Lo que estas pruebas cuidan, en orden de importancia:
 *  · que las TRES se lean, cada una con su versión, su fecha, su nombre y su motivo;
 *  · que QUÉ CAMBIÓ salga en frases y no en JSON, con las mismas palabras del papel;
 *  · que las cifras CUADREN: la de cierre de una corrección es la de arranque de la
 *    siguiente, y la última cae exacto en el resumen que esta misma pantalla muestra;
 *  · que en una corrección de PURO ADELANTO no se muestre solo el valor total —que ahí
 *    no se mueve—, porque eso dice "no cambió nada" y esconde lo que sí cambió.
 */
describe('LiquidacionDetailDialog: el historial de correcciones', () => {
  let fixture: Fixture;

  /** El servidor que SÍ responde el detalle y las correcciones. */
  class ServicioConCorrecciones {
    constructor(
      private readonly item: Liquidacion,
      private readonly lista: Correccion[],
    ) {}
    /** Cuántas veces se pidió la lista: no se pide sin necesidad. */
    pedidas = 0;

    getById(): Observable<Liquidacion> {
      return of(this.item);
    }

    correcciones(): Observable<Correccion[]> {
      this.pedidas += 1;
      return of(this.lista);
    }
  }

  /**
   * La quincena de Marleny después de las tres correcciones: $630.000 de leche, $150.000
   * de adelanto descontado y $480.000 entregados.
   */
  const LA_QUINCENA: Partial<Liquidacion> = {
    estado: 'pagada',
    version: 4,
    total_litros: '350',
    precio_promedio: '1800',
    valor_bruto: '630000',
    valor_transporte: '0',
    anticipos: '150000',
    valor_total: '630000',
    neto_a_pagar: '480000',
    pagado: '480000',
    saldo: '0',
  };

  /**
   * LA PRIMERA (v2): entró un día que se había quedado sin anotar.
   *
   * VIENE SIN `anticipos_antes`/`anticipos_despues` a propósito: es una corrección de las
   * viejas, hechas antes de que los adelantos se pudieran mover. No tocó ningún adelanto,
   * así que no hay nada que aclarar; lo que no puede pasar es que la pantalla se invente
   * un cero.
   */
  const ENTRO_UN_DIA: Correccion = {
    id: 'c-1',
    version_nueva: 2,
    motivo: 'Se quedó sin anotar la leche del viernes',
    corregido_por_nombre: 'Miguel Garzón',
    // 09:30 de la mañana en Colombia.
    created_at: '2026-06-20T14:30:00Z',
    valor_total_antes: '500000',
    valor_total_despues: '680000',
    neto_antes: '500000',
    neto_despues: '680000',
    pagado_al_momento: '500000',
    saldo_antes: '0',
    saldo_despues: '180000',
    estado_antes: 'pagada',
    estado_despues: 'parcial',
    dias_agregados: [
      { fecha: '2026-06-12', litros: '100', precio_litro: '1800', valor: '180000' },
    ],
    precios_corregidos: [],
  };

  /** LA SEGUNDA (v3): el precio de un día estaba mal tecleado. */
  const SE_CORRIGIO_UN_PRECIO: Correccion = {
    id: 'c-2',
    version_nueva: 3,
    motivo: 'El precio del lunes se tecleó a $2.000 y era $1.500',
    corregido_por_nombre: 'Miguel Garzón',
    created_at: '2026-07-01T16:05:00Z',
    valor_total_antes: '680000',
    valor_total_despues: '630000',
    neto_antes: '680000',
    neto_despues: '630000',
    pagado_al_momento: '500000',
    saldo_antes: '180000',
    saldo_despues: '130000',
    estado_antes: 'parcial',
    estado_despues: 'parcial',
    dias_agregados: [],
    precios_corregidos: [
      {
        fecha: '2026-06-08',
        litros: '100',
        precio_antes: '2000',
        precio_despues: '1500',
        valor_antes: '200000',
        valor_despues: '150000',
      },
    ],
  };

  /**
   * LA TERCERA (v4): PURO ADELANTO. El valor total NO se mueve.
   *
   * Es el caso que ya fue un defecto en el papel: cerrar diciendo "el VALOR TOTAL pasó de
   * $630.000 a $630.000" es una tautología que esconde los $150.000 que sí cambiaron, y
   * que son justo por los que el productor reclama.
   *
   * La hora es de las que cruzan el día: 02:04 UTC es 21:04 del día ANTERIOR en Colombia.
   */
  const ENTRO_UN_ADELANTO: Correccion = {
    id: 'c-3',
    version_nueva: 4,
    motivo: 'Faltaba descontarle el adelanto que se le dio para la droga',
    corregido_por_nombre: 'Marleny Ríos',
    created_at: '2026-09-07T02:04:00Z',
    valor_total_antes: '630000',
    valor_total_despues: '630000',
    neto_antes: '630000',
    neto_despues: '480000',
    pagado_al_momento: '480000',
    saldo_antes: '150000',
    saldo_despues: '0',
    estado_antes: 'parcial',
    estado_despues: 'pagada',
    dias_agregados: [],
    precios_corregidos: [],
    anticipos_antes: '0',
    anticipos_despues: '150000',
    anticipos_cambiados: [{ accion: 'entro', fecha: '2026-06-10', valor: '150000' }],
  };

  const LAS_TRES = [ENTRO_UN_DIA, SE_CORRIGIO_UN_PRECIO, ENTRO_UN_ADELANTO];

  let servicio: ServicioConCorrecciones;

  const armar = async (
    lista: Correccion[],
    cifras: Partial<Liquidacion> = LA_QUINCENA,
  ): Promise<void> => {
    const item = liquidacion(
      [det('d-1', '2026-06-12', '100', '1800', '180000')],
      'proveedor',
      cifras,
    );
    servicio = new ServicioConCorrecciones(item, lista);
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
    // Dos vueltas: la primera resuelve el detalle y la segunda la lista de correcciones,
    // que solo se pide DESPUÉS de saber la versión.
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const banda = (): string => leido(fixture.nativeElement.querySelector('.banda-corregida'));

  const enlaceHistorial = (): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector('.ver-historial');

  const abrirHistorial = async (): Promise<void> => {
    enlaceHistorial()!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** Cada corrección como se lee: versión, cuándo, quién, qué cambió, cifras y motivo. */
  const renglones = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.correccion'));

  const leerRenglon = (
    bloque: HTMLElement,
  ): {
    version: string;
    encabezado: string;
    cambios: string[];
    cifras: string[];
    motivo: string;
  } => ({
    version: leido(bloque.querySelector('.correccion-version')),
    encabezado: leido(bloque.querySelector('.correccion-cuando')),
    cambios: Array.from(bloque.querySelectorAll('.correccion-cambios li')).map((li) => leido(li)),
    // Celda por celda y no del renglón entero: los huecos entre cifras los pone la
    // rejilla (gap), así que el texto pegado de `textContent` diría "$ 0→$ 150.000".
    cifras: Array.from(bloque.querySelectorAll('.correccion-cifra')).map((fila) => {
      const [antes, despues] = Array.from(fila.querySelectorAll('.num')).map((celda) =>
        leido(celda),
      );
      return `${leido(fila.firstElementChild)} ${antes} → ${despues}`;
    }),
    motivo: leido(bloque.querySelector('.correccion-motivo')),
  });

  // ------------------------------------------------------------- LA BANDA, COMPACTA

  it('la banda sigue mostrando SOLO la última, y ofrece abrir las tres', async () => {
    await armar(LAS_TRES);

    const arriba = banda();
    // La última es la que explica el papel vigente: esa se queda a la vista.
    expect(arriba).toContain('v4');
    expect(arriba).toContain('Faltaba descontarle el adelanto');
    // Y las otras dos NO se le meten encima a la banda: siguen guardadas.
    expect(arriba).not.toContain('Se quedó sin anotar');
    expect(arriba).not.toContain('se tecleó a $2.000');
    // El enlace dice CUÁNTAS son: con tres hojas dando vueltas, saber el número es la
    // mitad del aviso.
    expect(leido(enlaceHistorial())).toContain('ver las 3 correcciones');
  });

  it('la fecha de la banda es la de Colombia, no la de UTC', async () => {
    await armar(LAS_TRES);

    // 02:04 UTC del 7 son las 21:04 del 6 acá. Antes se recortaban los diez primeros
    // caracteres del instante y la banda decía "07/09/2026": un día que no fue, y que
    // además no coincide con el que imprime el papel.
    expect(banda()).toContain('Corregido el 06/09/2026');
    expect(banda()).not.toContain('07/09/2026');
  });

  it('el historial arranca cerrado: la pantalla ya es densa', async () => {
    await armar(LAS_TRES);

    expect(renglones().length).toBe(0);
    expect(enlaceHistorial()!.getAttribute('aria-expanded')).toBe('false');
  });

  // ------------------------------------------- LAS TRES CORRECCIONES, DE TRES CLASES

  it('las tres se leen, de la más vieja a la más nueva y con quién las hizo', async () => {
    await armar(LAS_TRES);
    await abrirHistorial();

    const leidos = renglones().map(leerRenglon);
    expect(leidos.length).toBe(3);

    // EL ORDEN ES EL DEL PAPEL: v2, v3, v4. El productor llega con una hoja y el dueño
    // recorre las dos listas en paralelo para emparejarla.
    expect(leidos.map((r) => r.version)).toEqual(['v2', 'v3', 'v4']);

    // Cuándo (en hora de Colombia) y quién, en cada renglón.
    expect(leidos[0].encabezado).toContain('20/06/2026 09:30');
    expect(leidos[0].encabezado).toContain('Miguel Garzón');
    expect(leidos[1].encabezado).toContain('01/07/2026 11:05');
    expect(leidos[2].encabezado).toContain('06/09/2026 21:04');
    expect(leidos[2].encabezado).toContain('Marleny Ríos');

    // Y el motivo de CADA una, que es lo que la banda solo daba de la última.
    expect(leidos[0].motivo).toBe('Motivo: Se quedó sin anotar la leche del viernes');
    expect(leidos[1].motivo).toContain('El precio del lunes se tecleó');
    expect(leidos[2].motivo).toContain('Faltaba descontarle el adelanto');
  });

  it('qué cambió se lee en frases, no en JSON: un día, un precio y un adelanto', async () => {
    await armar(LAS_TRES);
    await abrirHistorial();

    const leidos = renglones().map(leerRenglon);

    // Las MISMAS palabras que imprime la letra chica del comprobante: las dos hojas se
    // ponen sobre la mesa y tienen que decir lo mismo.
    expect(leidos[0].cambios).toEqual([
      'entró el día del 12/06/2026 (100 L a $ 1.800 = $ 180.000)',
    ]);
    expect(leidos[1].cambios).toEqual(['el día del 08/06/2026 pasó de $ 2.000 a $ 1.500 el litro']);
    expect(leidos[2].cambios).toEqual(['se le descontó el adelanto del 10/06/2026 ($ 150.000)']);

    // Y en ninguna parte asoma el idioma de la base de datos.
    const historial = leido(fixture.nativeElement.querySelector('.historial'));
    for (const palabra of ['version_nueva', 'anticipos_cambiados', 'payload', 'accion']) {
      expect(historial).not.toContain(palabra);
    }
  });

  // ------------------------------------------------------------------ LAS CIFRAS

  it('la corrección de PURO ADELANTO muestra lo que SÍ se movió, no el valor total', async () => {
    await armar(LAS_TRES);
    await abrirHistorial();

    const ultima = leerRenglon(renglones()[2]);
    // El valor total NO se movió ($630.000 → $630.000): mostrarlo diría "no cambió nada".
    expect(ultima.cifras.some((fila) => fila.startsWith('Valor total'))).toBe(false);
    // Lo que sí cambió: el adelanto descontado y, con él, lo que hay que entregarle.
    expect(ultima.cifras).toEqual([
      'Adelantos descontados $ 0 → $ 150.000',
      'Lo que hay que entregarle $ 630.000 → $ 480.000',
    ]);
  });

  it('las cifras cuadran: cada una arranca donde terminó la anterior y la última cae en el resumen', async () => {
    await armar(LAS_TRES);
    await abrirHistorial();

    // Las cifras tal como se LEEN, en centavos enteros: es la cuenta que hace el dueño
    // con la pantalla puesta, no la que mandó el backend.
    const cifrasDe = (bloque: HTMLElement): Record<string, [number, number]> => {
      const filas: Record<string, [number, number]> = {};
      for (const fila of Array.from(bloque.querySelectorAll('.correccion-cifra'))) {
        const etiqueta = leido(fila.firstElementChild);
        const [antes, despues] = Array.from(fila.querySelectorAll('.num')).map((celda) =>
          centavos(leido(celda)),
        );
        filas[etiqueta] = [antes, despues];
      }
      return filas;
    };

    const [v2, v3, v4] = renglones().map(cifrasDe);

    // LA CADENA: el "después" de una es el "antes" de la siguiente. Si un eslabón no
    // cuadra, entre las dos hojas hay plata que nadie explica.
    expect(v2['Valor total']).toEqual([50000000, 68000000]);
    expect(v3['Valor total'][0]).toBe(v2['Valor total'][1]);
    expect(v3['Lo que hay que entregarle'][1]).toBe(v4['Lo que hay que entregarle'][0]);

    // Y LA ÚLTIMA CAE EN EL RESUMEN DE ESTA MISMA PANTALLA: valor total menos los
    // adelantos es lo que hay que entregarle. Por eso el historial va acá abajo y no en
    // otra ventana: estas dos cuentas se comparan con los ojos.
    const resumen = leerResumen(fixture);
    const valorTotal = centavos(resumen['Valor total']);
    const adelantos = centavos(resumen['Anticipos aplicados']);
    expect(valorTotal).toBe(63000000);
    expect(adelantos).toBe(v4['Adelantos descontados'][1]);
    expect(valorTotal - adelantos).toBe(v4['Lo que hay que entregarle'][1]);
  });

  // ------------------------------------------------- SACAR, ANULAR Y LOS NULOS

  it('sacar un adelanto y ANULARLO no se dicen igual: es plata distinta', async () => {
    const MOVIO_ADELANTOS: Correccion = {
      ...ENTRO_UN_ADELANTO,
      id: 'c-9',
      anticipos_cambiados: [
        { accion: 'salio', fecha: '2026-06-05', valor: '300000' },
        { accion: 'borrado', fecha: '2026-06-03', valor: '300000' },
        { accion: 'valor', fecha: '2026-06-07', valor: '120000', valor_antes: '100000' },
      ],
    };
    await armar([MOVIO_ADELANTOS]);
    await abrirHistorial();

    const cambios = leerRenglon(renglones()[0]).cambios;
    // El que SALE sigue vivo: se le descuenta en la quincena siguiente.
    expect(cambios[0]).toBe(
      'el adelanto del 05/06/2026 ($ 300.000) ya NO se descuenta en esta quincena: se le ' +
        'descuenta en la siguiente',
    );
    // El ANULADO nunca existió: prometerle un descuento sería quitarle plata que es suya.
    expect(cambios[1]).toBe(
      'el adelanto del 03/06/2026 ($ 300.000) se ANULÓ: no existió, y no se le descuenta ' +
        'en ninguna quincena',
    );
    expect(cambios[2]).toBe('el adelanto del 07/06/2026 pasó de $ 100.000 a $ 120.000');
  });

  it('una corrección vieja que tocó adelantos dice que no se sabe cuánto sumaban', async () => {
    // Las correcciones hechas antes de que los adelantos se pudieran mover no guardaron
    // esa cifra. Un cero ahí afirmaría que no había ningún adelanto descontado, que es
    // una afirmación sobre la plata del productor que nadie hizo.
    const VIEJA: Correccion = {
      ...ENTRO_UN_ADELANTO,
      id: 'c-8',
      anticipos_antes: null,
      anticipos_despues: null,
    };
    await armar([VIEJA]);
    await abrirHistorial();

    const renglon = renglones()[0];
    expect(leerRenglon(renglon).cifras.some((fila) => fila.includes('Adelantos'))).toBe(false);
    expect(leido(renglon.querySelector('.correccion-nota'))).toContain(
      'no quedó anotado cuánto sumaban los adelantos',
    );
    // Y NO se muestra un cero inventado en ninguna parte del renglón.
    expect(leido(renglon)).not.toContain('$ 0');
  });

  // ----------------------------------------------------------- UNA SOLA, Y NINGUNA

  it('con una sola corrección el enlace no dice "las 1"', async () => {
    await armar([ENTRO_UN_DIA], { ...LA_QUINCENA, version: 2 });

    expect(leido(enlaceHistorial())).toContain('ver qué cambió');
  });

  it('sin correcciones cargadas no hay enlace que abra una lista vacía', async () => {
    await armar([]);

    // La banda sale igual —la versión ya dice que hay otra hoja—, pero el enlace no:
    // abriría una lista sin renglones.
    expect(banda()).toContain('Comprobante corregido');
    expect(enlaceHistorial()).toBeNull();
  });

  it('en una quincena sin corregir no se le pide la lista al servidor', async () => {
    await armar(LAS_TRES, { estado: 'pagada' });

    expect(fixture.nativeElement.querySelector('.banda-corregida')).toBeNull();
    expect(servicio.pedidas).toBe(0);
  });
});

// =============================================================================
// "PAGADA · QUEDÓ DEBIENDO" CAMBIA LO QUE EL DUEÑO VE, NO LO QUE PUEDE HACER.
//
// El backend manda `estado_visible` para pintar el chip y la línea de estados. Los
// botones (Pagar, Anular, Corregir, Recalcular, Aprobar) y los candados siguen leyendo
// `estado`: es el que el servidor usa para aceptar o rebotar cada acción. La prueba de
// fondo ARMA DOS VECES la misma quincena —con el campo y sin él— y exige que la barra de
// acciones salga idéntica. Si algún día un botón empieza a mirar `estado_visible`, esa
// comparación se rompe aquí y no en la mano del dueño.
// =============================================================================
describe('LiquidacionDetailDialog: el estado como se lee no mueve ningún botón', () => {
  let fixture: ComponentFixture<LiquidacionDetailDialog>;
  const PAGADA_DEBIENDO = 'pagada · quedó debiendo';

  /** La quincena de Henri: $180.000 de leche contra $300.000 ya adelantados. */
  const HENRI_DEBE: Partial<Liquidacion> = {
    tipo: 'proveedor',
    proveedor_id: 'p-1',
    proveedor_nombre: 'Henri Castaño',
    transportador_id: null,
    transportador_nombre: null,
    total_litros: '100',
    precio_promedio: '1800',
    valor_bruto: '180000',
    valor_transporte: '0',
    valor_total: '180000',
    anticipos: '300000',
    neto_a_pagar: '-120000',
    saldo: '-120000',
    le_queda_debiendo: '120000',
    estado_visible: PAGADA_DEBIENDO,
  };
  const DETALLE_HENRI = [det('d-1', '2026-07-03', '100', '1800', '180000')];

  const armar = async (item: Liquidacion): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [LiquidacionDetailDialog, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { item } },
        { provide: LiquidacionesService, useValue: new ServicioFalso() },
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

  /** Todo lo que el dueño PUEDE hacer con esta quincena, como la pantalla lo ofrece. */
  const loQuePuedeHacer = () => {
    const c = fixture.componentInstance;
    return {
      botones: Array.from(fixture.nativeElement.querySelectorAll('button'))
        .map((boton) => leido(boton as Element))
        .filter((texto) => texto !== ''),
      candados: Array.from(fixture.nativeElement.querySelectorAll('.nota-recalcular')).map(
        (nota) => leido(nota as Element),
      ),
      puedePagar: c.puedePagar(),
      puedeCerrarSinPago: c.puedeCerrarSinPago(),
      puedeAnular: c.puedeAnular(),
      puedeCorregir: c.puedeCorregir(),
      puedeRecalcular: c.puedeRecalcular(),
      puedeEditarPrecio: c.puedeEditarPrecio(),
      motivoNoPagar: c.motivoNoPagar(),
      motivoNoAnular: c.motivoNoAnular(),
      motivoNoCorregir: c.motivoNoCorregir(),
      motivoNoRecalcular: c.motivoNoRecalcular(),
    };
  };

  /** Arma la quincena con el campo y sin él, y devuelve lo que se puede hacer en cada una. */
  const conYSinElCampo = async (cifras: Partial<Liquidacion>) => {
    await armar(liquidacion(DETALLE_HENRI, 'proveedor', cifras));
    const conElCampo = loQuePuedeHacer();
    const chipConElCampo = leido(fixture.nativeElement.querySelector('app-estado-chip'));
    await armar(liquidacion(DETALLE_HENRI, 'proveedor', { ...cifras, estado_visible: undefined }));
    const sinElCampo = loQuePuedeHacer();
    return { conElCampo, sinElCampo, chipConElCampo };
  };

  const boton = (acciones: { botones: string[] }, texto: string): boolean =>
    acciones.botones.some((b) => b.includes(texto));

  it('el chip y la línea de estados dicen "pagada · quedó debiendo"', async () => {
    await armar(liquidacion(DETALLE_HENRI, 'proveedor', { ...HENRI_DEBE, estado: 'aprobada' }));

    expect(leido(fixture.nativeElement.querySelector('app-estado-chip'))).toBe(PAGADA_DEBIENDO);
    // La línea se para en el último paso —no queda nada que entregarle— y la ayuda NO
    // manda a "usar Pagar", que es un botón que aquí no está.
    const actual = leido(fixture.nativeElement.querySelector('.paso.actual'));
    expect(actual).toContain('Pagada');
    const ayuda = leido(fixture.nativeElement.querySelector('app-liquidacion-estado-stepper .ayuda'));
    expect(ayuda).toContain('No hay nada que entregarle');
    expect(ayuda).not.toContain('Pagar');
  });

  it('una respuesta vieja, sin el campo, pinta el estado de siempre', async () => {
    await armar(
      liquidacion(DETALLE_HENRI, 'proveedor', {
        ...HENRI_DEBE,
        estado: 'aprobada',
        estado_visible: undefined,
      }),
    );
    expect(leido(fixture.nativeElement.querySelector('app-estado-chip'))).toBe('aprobada');
  });

  it('APROBADA que quedó debiendo: los mismos botones con el campo y sin él', async () => {
    const r = await conYSinElCampo({ ...HENRI_DEBE, estado: 'aprobada' });

    expect(r.chipConElCampo).toBe(PAGADA_DEBIENDO);
    // Lo que se PUEDE HACER es idéntico. Lo único que cambia es la REDACCIÓN del candado
    // de Recalcular, que sigue al chip de al lado: con el campo dice "no hay nada que
    // entregarle"; sin él, el chip dice 'aprobada' y el texto de siempre es el cierto.
    expect({ ...r.conElCampo, motivoNoRecalcular: null }).toEqual({
      ...r.sinElCampo,
      motivoNoRecalcular: null,
    });
    expect(r.conElCampo.motivoNoRecalcular).toContain('No hay nada que entregarle');
    expect(r.sinElCampo.motivoNoRecalcular).toContain('Está aprobada');
    // Y lo que eso significa, dicho con nombre: el chip dice "pagada" pero la quincena
    // SIGUE siendo una aprobada para el servidor, así que se puede anular (la deuda aún
    // no se cobró) y no se puede pagar (no hay nada que entregar).
    expect(r.conElCampo.puedeAnular).toBeTrue();
    expect(boton(r.conElCampo, 'Anular')).toBeTrue();
    expect(r.conElCampo.puedePagar).toBeFalse();
    expect(boton(r.conElCampo, 'Pagar')).toBeFalse();
    expect(r.conElCampo.candados.join(' ')).toContain('No hay nada que pagar');
  });

  it('PAGADA que quedó debiendo (se le pagó de más): "Corregir" sigue ahí', async () => {
    // Si "Corregir" mirara el chip ("pagada · quedó debiendo" no es 'pagada') se
    // escondería justo en la quincena que el dueño tiene que poder arreglar.
    const r = await conYSinElCampo({
      ...HENRI_DEBE,
      estado: 'pagada',
      anticipos: '0',
      pagado: '300000',
      pagos: [{ id: 'p-1', fecha: '2026-07-16', valor: '300000', observaciones: null }],
    });

    expect(r.chipConElCampo).toBe(PAGADA_DEBIENDO);
    expect(r.conElCampo).toEqual(r.sinElCampo);
    expect(r.conElCampo.puedeCorregir).toBeTrue();
    expect(boton(r.conElCampo, 'Corregir esta quincena')).toBeTrue();
  });

  it('PARCIAL que quedó debiendo: tampoco cambia nada de lo que se puede hacer', async () => {
    const r = await conYSinElCampo({
      ...HENRI_DEBE,
      estado: 'parcial',
      anticipos: '200000',
      pagado: '100000',
      pagos: [{ id: 'p-1', fecha: '2026-07-16', valor: '100000', observaciones: null }],
    });

    expect(r.chipConElCampo).toBe(PAGADA_DEBIENDO);
    expect(r.conElCampo).toEqual(r.sinElCampo);
    expect(r.conElCampo.puedeCorregir).toBeTrue();
  });

  it('con la deuda ya cobrada en otra, los candados son los mismos con el campo y sin él', async () => {
    const r = await conYSinElCampo({
      ...HENRI_DEBE,
      estado: 'aprobada',
      deuda_trasladada_a_id: 'l-siguiente',
      deuda_trasladada_a: {
        id: 'l-siguiente',
        periodo_inicio: '2026-07-16',
        periodo_fin: '2026-07-31',
        periodo_texto: '16/07/2026 al 31/07/2026',
      },
    });

    expect(r.conElCampo).toEqual(r.sinElCampo);
    expect(r.conElCampo.puedeAnular).toBeFalse();
    expect(r.conElCampo.motivoNoAnular).not.toBeNull();
  });
});

// =============================================================================
// TRES COSAS QUE LA PANTALLA DECÍA MAL, medidas con las mismas lecturas de arriba.
// =============================================================================

/** Abre el detalle con la fila dada y el servidor falso de siempre. */
const abrirDetalle = async (item: Liquidacion): Promise<Fixture> => {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [LiquidacionDetailDialog, NoopAnimationsModule],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { item } },
      { provide: LiquidacionesService, useValue: new ServicioFalso() },
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

const botonesDe = (fixture: Fixture): string[] =>
  Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button'))
    .map((boton) => leido(boton as Element))
    .filter((texto) => texto !== '');

const candadosDe = (fixture: Fixture): string[] =>
  Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions .nota-recalcular')).map(
    (nota) => leido(nota as Element),
  );

/** La quincena de Henri: $180.000 de leche contra $300.000 ya adelantados. */
const HENRI_QUEDO_DEBIENDO: Partial<Liquidacion> = {
  estado: 'aprobada',
  estado_visible: 'pagada · quedó debiendo',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Henri Castaño',
  transportador_id: null,
  transportador_nombre: null,
  total_litros: '100',
  precio_promedio: '1800',
  valor_bruto: '180000',
  valor_transporte: '0',
  valor_total: '180000',
  anticipos: '300000',
  neto_a_pagar: '-120000',
  saldo: '-120000',
  le_queda_debiendo: '120000',
};
const EL_DIA_DE_HENRI_Q1 = [det('d-1', '2026-07-03', '100', '1800', '180000')];

describe('LiquidacionDetailDialog: el candado de Recalcular dice lo mismo que el chip', () => {
  it('la que se lee "pagada · quedó debiendo" no dice "está aprobada, no se le ha pagado nada"', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_HENRI_Q1, 'proveedor', HENRI_QUEDO_DEBIENDO),
    );

    expect(leido(fixture.nativeElement.querySelector('.info app-estado-chip'))).toBe(
      'pagada · quedó debiendo',
    );
    const motivo = comoSeLee(fixture.componentInstance.motivoNoRecalcular());
    expect(motivo).toBe(
      'No hay nada que entregarle: Henri Castaño quedó debiendo $ 120.000. Sus cifras están ' +
        'en firme y Recalcular solo trabaja sobre borradores. Si quedaron mal —por ejemplo ' +
        'una tarifa que se corrigió después—, anúlela y vuelva a generarla: esa deuda ' +
        'todavía no se le ha cobrado en otra quincena.',
    );
    expect(motivo).not.toContain('Está aprobada');
    expect(motivo).not.toContain('no se le ha pagado nada');
    // Lo mismo en el párrafo de abajo, que es el que se lee sin pasar el mouse.
    expect(leido(fixture.nativeElement.querySelector('.ayuda-precio.con-candado'))).toContain(
      'No hay nada que entregarle',
    );
    // Y la salida que nombra EXISTE: el servidor anula mientras la deuda no se cobre.
    expect(fixture.componentInstance.puedeAnular()).toBeTrue();
    expect(botonesDe(fixture).some((b) => b.endsWith('Anular'))).toBeTrue();
  });

  it('con la deuda YA cobrada en otra, no manda a anular nada: dice dónde se cobró', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_HENRI_Q1, 'proveedor', {
        ...HENRI_QUEDO_DEBIENDO,
        deuda_trasladada_a_id: 'l-q2',
        deuda_trasladada_a: {
          id: 'l-q2',
          periodo_inicio: '2026-07-16',
          periodo_fin: '2026-07-31',
          periodo_texto: '16/07/2026 al 31/07/2026',
        },
      }),
    );

    const motivo = comoSeLee(fixture.componentInstance.motivoNoRecalcular());
    // Ni "anúlela" (el servidor también rebota Anular) ni "anule primero esa liquidación …
    // y vuelva a intentarlo": anulada la otra, esta sigue aprobada y Recalcular sigue sin poder.
    expect(motivo).toBe(
      'No hay nada que entregarle: Henri Castaño quedó debiendo $ 120.000, y eso ya se le ' +
        'cobró en la liquidación del 16/07/2026 al 31/07/2026. Sus cifras están en firme y ' +
        'Recalcular solo trabaja sobre borradores.',
    );
    expect(motivo).not.toContain('anúlela');
    expect(motivo).not.toContain('vuelva a intentarlo');
    expect(motivo).not.toContain('esa deuda todavía no se le ha cobrado');
    expect(botonesDe(fixture).some((b) => b.endsWith('Anular'))).toBeFalse();
  });

  it('la aprobada con plata por entregar conserva su texto: ahí sí es cierto', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_MARTES, 'transportador', { estado: 'aprobada', estado_visible: 'aprobada' }),
    );

    expect(comoSeLee(fixture.componentInstance.motivoNoRecalcular())).toBe(
      'Está aprobada y Recalcular solo trabaja sobre borradores. Si sus cifras quedaron mal ' +
        '—por ejemplo una tarifa que se corrigió después—, anúlela y vuelva a generarla: ' +
        'todavía no se le ha pagado nada.',
    );
  });
});

// =============================================================================
// EL CANDADO DE RECALCULAR NO MANDA A UN PASO QUE NO DESTRABA NADA, NI NOMBRA UNA PLATA
// QUE NO SALIÓ. Se lee en el cuerpo del diálogo (`.ayuda-precio.con-candado`), sin pasar
// el mouse: lo que dice ahí el dueño lo hace.
// =============================================================================

describe('LiquidacionDetailDialog: el candado de Recalcular solo dice lo que es cierto', () => {
  const COBRADA_EN_LA_Q2: Partial<Liquidacion> = {
    deuda_trasladada_a_id: 'l-q2',
    deuda_trasladada_a: {
      id: 'l-q2',
      periodo_inicio: '2026-07-16',
      periodo_fin: '2026-07-31',
      periodo_texto: '16/07/2026 al 31/07/2026',
    },
  } as Partial<Liquidacion>;
  /** La v2 de una pagada que sus anticipos cubrieron exacto, corregida con $50.000 más. */
  const V2_SIN_PAGOS: Partial<Liquidacion> = {
    ...HENRI_QUEDO_DEBIENDO,
    estado: 'parcial',
    estado_visible: 'parcial',
    version: 2,
    anticipos: '180000',
    valor_bruto: '230000',
    valor_total: '230000',
    neto_a_pagar: '50000',
    pagado: '0',
    saldo: '50000',
    le_queda_debiendo: '0',
    pagos: [],
  };
  const candadoEnElCuerpo = (fixture: Fixture): string =>
    leido(fixture.nativeElement.querySelector('.ayuda-precio.con-candado span'));

  it('borrador con la deuda ya cobrada: no ofrece Recalcular y manda a anular la otra primero', async () => {
    // El `recalcular` del servidor rebota la deuda trasladada ANTES de mirar el estado: el
    // botón siempre fallaba. Y aquí sí sirve anular la otra: esta vuelve a recalcularse.
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_HENRI_Q1, 'proveedor', {
        ...HENRI_QUEDO_DEBIENDO,
        estado: 'borrador',
        estado_visible: 'borrador',
        ...COBRADA_EN_LA_Q2,
      }),
    );

    expect(fixture.componentInstance.puedeRecalcular()).toBeFalse();
    expect(botonesDe(fixture).some((b) => b.endsWith('Recalcular'))).toBeFalse();
    expect(candadoEnElCuerpo(fixture)).toBe(
      'No se puede recalcular esta liquidación: lo que Henri Castaño quedó debiendo ' +
        '($ 120.000) ya se le cobró en la liquidación del 16/07/2026 al 31/07/2026. Anule ' +
        'primero esa liquidación —así esta deuda vuelve a quedar libre— y vuelva a intentarlo.',
    );
  });

  it('pagada del Pagar de antes con la deuda ya cobrada: ni "vuelva a intentarlo" ni "ya está pagado ($ 0)"', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_HENRI_Q1, 'proveedor', {
        ...HENRI_QUEDO_DEBIENDO,
        estado: 'pagada',
        pagado: '0',
        ...COBRADA_EN_LA_Q2,
      }),
    );

    expect(candadoEnElCuerpo(fixture)).toBe(
      'No hay nada que entregarle: Henri Castaño quedó debiendo $ 120.000. Sus cifras están ' +
        'en firme y Recalcular solo trabaja sobre borradores.',
    );
  });

  it('pagada del Pagar de antes con la deuda pendiente: tampoco "ya está pagado"', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_HENRI_Q1, 'proveedor', {
        ...HENRI_QUEDO_DEBIENDO,
        estado: 'pagada',
        pagado: '0',
      }),
    );

    expect(candadoEnElCuerpo(fixture)).not.toContain('ya está pagado');
    expect(candadoEnElCuerpo(fixture)).toContain('Henri Castaño quedó debiendo $ 120.000');
  });

  it('pagada en cero por sus anticipos, sin un peso en pagos: dice que está en firme, sin cifra', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_HENRI_Q1, 'proveedor', {
        ...HENRI_QUEDO_DEBIENDO,
        estado: 'pagada',
        estado_visible: 'pagada',
        anticipos: '180000',
        neto_a_pagar: '0',
        pagado: '0',
        saldo: '0',
        le_queda_debiendo: '0',
      }),
    );

    expect(candadoEnElCuerpo(fixture)).toBe(
      'Sus cifras están en firme y Recalcular solo trabaja sobre borradores.',
    );
  });

  it('parcial v2 sin pagos: nombra el comprobante corregido, no un abono', async () => {
    const fixture = await abrirDetalle(liquidacion(EL_DIA_DE_HENRI_Q1, 'proveedor', V2_SIN_PAGOS));

    expect(candadoEnElCuerpo(fixture)).toBe(
      'De esta quincena ya salieron 2 comprobantes (el original y sus correcciones): sus ' +
        'cifras están en firme y Recalcular solo trabaja sobre borradores.',
    );
  });

  it('parcial v2 con un abono: no manda a eliminarlo (borrado, queda una aprobada v2 que tampoco se anula)', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_HENRI_Q1, 'proveedor', {
        ...V2_SIN_PAGOS,
        pagado: '20000',
        saldo: '30000',
        pagos: [{ id: 'p-1', fecha: '2026-07-20', valor: '20000', observaciones: null }],
      }),
    );

    expect(candadoEnElCuerpo(fixture)).not.toMatch(/elimine primero/i);
    expect(candadoEnElCuerpo(fixture)).toContain('ya salieron 2 comprobantes');
  });

  it('aprobada v2: no manda a anularla, porque Anular dice que no', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_HENRI_Q1, 'proveedor', {
        ...V2_SIN_PAGOS,
        estado: 'aprobada',
        estado_visible: 'aprobada',
      }),
    );
    const c = fixture.componentInstance;

    expect(c.puedeAnular()).toBeFalse();
    expect(candadoEnElCuerpo(fixture)).toBe(
      'De esta quincena ya salieron 2 comprobantes (el original y sus correcciones): sus ' +
        'cifras están en firme y Recalcular solo trabaja sobre borradores.',
    );
    expect(candadoEnElCuerpo(fixture)).not.toContain('anúlela');
  });
});

describe('LiquidacionDetailDialog: la pagada de antes de los pagos parciales cuadra', () => {
  /**
   * UNA 'pagada' DE ANTES DE LOS PAGOS PARCIALES, como la dejó la migración: `pagado`
   * puesto y NINGÚN renglón en `pagos`. $400.000 de leche, $100.000 de anticipo y
   * $300.000 entregados:
   *
   *   400.000 − 100.000 − 300.000 = 0   (Saldo a pagar)
   *
   * Sin el renglón "Pagado" la columna decía 400.000 − 100.000 y cerraba en $0: el dueño
   * suma a mano y le sobran $300.000. El PDF sí lo imprime.
   */
  const PAGADA_VIEJA: Partial<Liquidacion> = {
    estado: 'pagada',
    estado_visible: 'pagada',
    tipo: 'proveedor',
    proveedor_id: 'p-1',
    proveedor_nombre: 'Rosa Pagada',
    transportador_id: null,
    transportador_nombre: null,
    total_litros: '200',
    precio_promedio: '2000',
    valor_bruto: '400000',
    valor_transporte: '0',
    valor_total: '400000',
    anticipos: '100000',
    neto_a_pagar: '300000',
    pagado: '300000',
    saldo: '0',
    pagos: [],
  };
  const EL_DIA_DE_ROSA = [det('d-1', '2026-06-05', '200', '2000', '400000')];

  it('pinta el renglón "Pagado" aunque no haya pagos en la lista, y la columna cierra', async () => {
    const fixture = await abrirDetalle(liquidacion(EL_DIA_DE_ROSA, 'proveedor', PAGADA_VIEJA));

    expect(leerResumen(fixture)['Pagado']).toBe('− $ 300.000');
    expect(rotulosDelResumen(fixture)).toEqual([
      'Total litros',
      'Precio promedio',
      'Valor bruto',
      'Bonificaciones',
      'Descuentos',
      'Valor total',
      'Anticipos aplicados',
      'Pagado',
      'Saldo a pagar',
    ]);
    // LA REGLA DE ORO, sumando lo que se LEE: 400.000 − 100.000 − 300.000 = 0.
    const cuadre = cuadreDelResumen(fixture);
    expect(cuadre.valorTotal).toBe(40000000);
    expect(cuadre.cierre).toBe(0);
    expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);
    // Y el texto que se manda por WhatsApp sale de los mismos renglones.
    expect(fixture.componentInstance.renglonesResumen().map((r) => r.clave)).toContain('pagado');
  });

  it('con pagos en la lista sigue igual: el renglón es lo pagado y la columna cierra', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_ROSA, 'proveedor', {
        ...PAGADA_VIEJA,
        estado: 'parcial',
        estado_visible: 'parcial',
        pagado: '120000',
        saldo: '180000',
        pagos: [{ id: 'p-1', fecha: '2026-06-20', valor: '120000', observaciones: null }],
      }),
    );

    expect(leerResumen(fixture)['Pagado']).toBe('− $ 120.000');
    const cuadre = cuadreDelResumen(fixture);
    expect(cuadre.cierre).toBe(18000000);
    expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);
  });

  it('un pagado NEGATIVO no se pinta: es la deuda borrada que se repara aparte', async () => {
    // La forma de zz-existentes-historia: la migración dejó pagado = −$120.000. Pintar
    // "− −$ 120.000" sería peor que el hueco, y esa fila tiene su propio arreglo.
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_ROSA, 'proveedor', {
        ...PAGADA_VIEJA,
        valor_bruto: '180000',
        valor_total: '180000',
        anticipos: '300000',
        neto_a_pagar: '-120000',
        pagado: '-120000',
        saldo: '0',
      }),
    );

    expect(rotulosDelResumen(fixture)).not.toContain('Pagado');
  });

  it('sin nada pagado no hay renglón en $ 0', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_MARTES, 'transportador', { estado: 'aprobada', pagado: '0', pagos: [] }),
    );

    expect(rotulosDelResumen(fixture)).not.toContain('Pagado');
    const cuadre = cuadreDelResumen(fixture);
    expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);
  });
});

describe('LiquidacionDetailDialog: "Marcar pagada" que siempre fallaba', () => {
  /**
   * LA QUINCENA 2 DE HENRI: vale justo los $120.000 que dejó debiendo la 1, sin
   * anticipos propios ni abonos. El neto cae en $0 por la deuda arrastrada y el
   * servidor rebota `POST /pagar` (`_no_sale_un_peso_por_la_deuda`): se queda 'aprobada'
   * a propósito. El botón estaba y siempre fallaba (zz-existentes-cobrada.spec.ts, caso 4).
   */
  const Q2_EN_CERO_POR_LA_DEUDA: Partial<Liquidacion> = {
    id: 'l-q2',
    estado: 'aprobada',
    estado_visible: 'aprobada',
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
    valor_transporte: '0',
    valor_total: '120000',
    anticipos: '0',
    saldo_anterior: '120000',
    deudas_cobradas: [
      {
        id: 'l-q1',
        periodo_inicio: '2026-07-01',
        periodo_fin: '2026-07-15',
        periodo_texto: '01/07/2026 al 15/07/2026',
        le_queda_debiendo: '120000',
      },
    ],
    neto_a_pagar: '0',
    pagado: '0',
    saldo: '0',
    le_queda_debiendo: '0',
  };
  const EL_DIA_DE_HENRI_Q2 = [det('d-2', '2026-07-20', '100', '1200', '120000')];

  it('no ofrece "Marcar pagada" y dice por qué: la deuda de la quincena pasada la cubrió', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_HENRI_Q2, 'proveedor', Q2_EN_CERO_POR_LA_DEUDA),
    );
    const c = fixture.componentInstance;

    expect(c.laDeudaViejaCubrioLaQuincena()).toBeTrue();
    expect(c.puedeCerrarSinPago()).toBeFalse();
    expect(botonesDe(fixture).some((b) => b.includes('Marcar pagada'))).toBeFalse();
    expect(botonesDe(fixture).some((b) => b.endsWith('Pagar'))).toBeFalse();
    // En su lugar, el candado con la razón.
    expect(candadosDe(fixture)).toContain('lock No hay nada que pagar');
    const nota = leido(fixture.nativeElement.querySelector('.nota-saldo-cero'));
    expect(nota).toBe(
      'No hay nada que entregarle a Henri Castaño: lo que ya venía debiendo de antes ' +
        '($ 120.000) cubre EXACTO el valor total de la quincena ($ 120.000), así que el ' +
        'saldo quedó en $ 0. Se queda aprobada: no queda un peso por entregarle, y cuando lo ' +
        'que venía debiendo de antes se lleva lo que faltaba del neto, el sistema no la marca ' +
        'pagada.',
    );
    // Sin la razón vieja: con el aviso de C3, el de los días de esa 'pagada' sería cierto.
    expect(nota).not.toContain('aviso que no es cierto');
    // El tooltip del candado dice LO MISMO que la nota: una sola redacción.
    expect(comoSeLee(c.motivoNoPagar())).toBe(nota);
    // Y el estado no se toca: sigue siendo la aprobada que el servidor quiere.
    expect(c.liq().estado).toBe('aprobada');
  });

  it('con anticipos Y deuda vieja entre los dos, tampoco: son las mismas tres condiciones', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_HENRI_Q2, 'proveedor', {
        ...Q2_EN_CERO_POR_LA_DEUDA,
        anticipos: '20000',
        saldo_anterior: '100000',
      }),
    );

    expect(fixture.componentInstance.puedeCerrarSinPago()).toBeFalse();
    expect(botonesDe(fixture).some((b) => b.includes('Marcar pagada'))).toBeFalse();
    const nota = leido(fixture.nativeElement.querySelector('.nota-saldo-cero'));
    expect(nota).toContain('los anticipos aplicados ($ 20.000)');
    expect(nota).toContain('lo que ya venía debiendo de antes ($ 100.000)');
    expect(nota).toContain('Se queda aprobada');
  });

  it('el cero que hicieron SUS PROPIOS anticipos (sin deuda vieja) sí ofrece "Marcar pagada"', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_HENRI_Q2, 'proveedor', {
        ...Q2_EN_CERO_POR_LA_DEUDA,
        anticipos: '120000',
        saldo_anterior: '0',
        deudas_cobradas: [],
      }),
    );

    expect(fixture.componentInstance.laDeudaViejaCubrioLaQuincena()).toBeFalse();
    expect(fixture.componentInstance.puedeCerrarSinPago()).toBeTrue();
    expect(botonesDe(fixture).some((b) => b.includes('Marcar pagada'))).toBeTrue();
    const nota = leido(fixture.nativeElement.querySelector('.nota-saldo-cero'));
    expect(nota).toContain('los anticipos aplicados ($ 120.000) cubren EXACTO');
    expect(nota).not.toContain('Se queda aprobada');
  });

  it('con saldo por entregar sigue el botón "Pagar", aunque haya cobrado deuda vieja', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_HENRI_Q2, 'proveedor', {
        ...Q2_EN_CERO_POR_LA_DEUDA,
        valor_bruto: '150000',
        valor_total: '150000',
        neto_a_pagar: '30000',
        saldo: '30000',
      }),
    );

    expect(fixture.componentInstance.puedePagar()).toBeTrue();
    expect(botonesDe(fixture).some((b) => b.endsWith('Pagar'))).toBeTrue();
    expect(fixture.componentInstance.motivoNoPagar()).toBeNull();
  });

  it('con un abono encima el servidor sí la cierra, y el botón vuelve', async () => {
    // `_no_sale_un_peso_por_la_deuda` deja pasar la que tiene pagos (`pagado > 0`): ahí
    // sí salió plata contra este comprobante.
    const fixture = await abrirDetalle(
      liquidacion(EL_DIA_DE_HENRI_Q2, 'proveedor', {
        ...Q2_EN_CERO_POR_LA_DEUDA,
        estado: 'parcial',
        estado_visible: 'parcial',
        valor_bruto: '150000',
        valor_total: '150000',
        neto_a_pagar: '30000',
        pagado: '30000',
        saldo: '0',
        pagos: [{ id: 'p-1', fecha: '2026-08-01', valor: '30000', observaciones: null }],
      }),
    );

    expect(fixture.componentInstance.laDeudaViejaCubrioLaQuincena()).toBeFalse();
    expect(botonesDe(fixture).some((b) => b.includes('Marcar pagada'))).toBeTrue();
  });
});

// =============================================================================
// LA QUINCENA CON LA DEUDA BORRADA POR LA MIGRACIÓN DE LOS ABONOS.
//
// La migración de agosto les escribió a las 'pagada' de antes pagado = valor total −
// anticipos y saldo = 0. Con $180.000 de leche contra $300.000 de adelanto eso dejó
// pagado en −$120.000: la deuda de Henri desapareció. El servidor manda
// `deuda_borrada_por_la_migracion` y rebota Corregir, Pagar y los abonos sobre esa fila;
// la pantalla hace la misma pregunta con ese campo y dice por qué el resumen no cuadra.
// =============================================================================

describe('LiquidacionDetailDialog: la quincena con la deuda borrada por la migración', () => {
  const HENRI: Partial<Liquidacion> = {
    tipo: 'proveedor',
    proveedor_id: 'p-1',
    proveedor_nombre: 'Henri Castaño',
    transportador_id: null,
    transportador_nombre: null,
    total_litros: '100',
    precio_promedio: '1800',
    valor_transporte: '0',
  };

  /** Como la dejó la migración: pagada, pagado −$120.000, saldo en cero, sin pagos. */
  const MIGRADA: Partial<Liquidacion> = {
    ...HENRI,
    estado: 'pagada',
    estado_visible: 'pagada',
    valor_bruto: '180000',
    valor_total: '180000',
    anticipos: '300000',
    neto_a_pagar: '-120000',
    pagado: '-120000',
    saldo: '0',
    le_queda_debiendo: '0',
    deuda_borrada_por_la_migracion: '120000.00',
  };

  /**
   * La que se corrigió antes de que existiera el guardia: un día olvidado de $50.000.
   * Henri debe $70.000 de verdad, y el saldo dice $50.000 "por pagar".
   */
  const CORREGIDA_SIN_REPARAR: Partial<Liquidacion> = {
    ...MIGRADA,
    estado: 'parcial',
    estado_visible: 'parcial',
    version: 2,
    valor_bruto: '230000',
    valor_total: '230000',
    neto_a_pagar: '-70000',
    saldo: '50000',
  };

  /**
   * Y esos $50.000 se le pagaron: volvió a 'aprobada' con pagado −$70.000 y saldo cero. Lo
   * borrado sigue siendo $120.000 —Σ pagos − pagado = 50.000 − (−70.000)—: el backend ya
   * no lo mide por el signo de `pagado`, que daba $70.000.
   */
  const ABONADA_ENCIMA: Partial<Liquidacion> = {
    ...CORREGIDA_SIN_REPARAR,
    estado: 'aprobada',
    estado_visible: 'aprobada',
    pagado: '-70000',
    saldo: '0',
    deuda_borrada_por_la_migracion: '120000.00',
    pagos: [{ id: 'p-1', fecha: '2026-08-10', valor: '50000', observaciones: null }],
  };

  const DIA = [det('d-1', '2026-07-03', '100', '1800', '180000')];
  const ayudaDe = (fixture: Fixture): string =>
    leido(fixture.nativeElement.querySelector('app-liquidacion-estado-stepper .ayuda'));

  it('la deuda borrada va en su renglón, la columna cierra y el aviso dice lo que de verdad queda', async () => {
    const fixture = await abrirDetalle(liquidacion(DIA, 'proveedor', MIGRADA));

    expect(leido(fixture.nativeElement.querySelector('.aviso-deuda-borrada span'))).toBe(
      'Esta quincena viene de antes de que existieran los abonos, y el sistema de esa ' +
        'época le borró los $ 120.000 que Henri Castaño quedaba debiendo. En el resumen van ' +
        'en el renglón «Deuda borrada por la migración». Tal como están las cifras, Henri ' +
        'Castaño todavía le debe $ 120.000 al negocio por esta quincena. Hay que repararla ' +
        'antes de cualquier otra cosa: mientras tanto no se puede corregir, pagar, abonar ni ' +
        'anular.',
    );
    // La cuenta del dueño con calculadora: 180.000 − 300.000 + 120.000 = 0, el "Saldo a
    // pagar $ 0" del final. Sin pagos no hay renglón "Pagado".
    expect(leerResumen(fixture)['Deuda borrada por la migración']).toBe('+ $ 120.000');
    expect(rotulosDelResumen(fixture)).not.toContain('Pagado');
    const cuadre = cuadreDelResumen(fixture);
    expect(cuadre.valorTotal).toBe(18000000);
    expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);
    expect(cuadre.cierre).toBe(0);
    // Ni la nota que explicaría un saldo que no es.
    expect(fixture.nativeElement.querySelector('.nota-le-debe')).toBeNull();
  });

  it('no ofrece Corregir, y el candado dice lo mismo que el servidor', async () => {
    const fixture = await abrirDetalle(liquidacion(DIA, 'proveedor', MIGRADA));
    const c = fixture.componentInstance;

    expect(c.puedeCorregir()).toBeFalse();
    expect(botonesDe(fixture).some((b) => b.includes('Corregir esta quincena'))).toBeFalse();
    expect(candadosDe(fixture)).toContain('lock No se puede corregir');
    expect(comoSeLee(c.motivoNoCorregir())).toBe(
      'No se puede corregir esta quincena: viene de antes de que existieran los abonos, y el ' +
        'sistema de esa época le borró lo que Henri Castaño quedaba debiendo ($ 120.000). Hay ' +
        'que repararla antes de tocarla: tal como está, el sistema le sumaría esos $ 120.000 a ' +
        'lo que falta por entregarle y mandaría a pagarle a alguien que todavía debe.',
    );
    // Ni la línea de estados dice "esta liquidación está completa", ni el candado de
    // Recalcular nombra un "pagado" negativo.
    expect(ayudaDe(fixture)).toBe(
      'Esta quincena trae una deuda borrada de antes de los abonos: hay que repararla antes ' +
        'de pagarla o corregirla.',
    );
    expect(comoSeLee(c.motivoNoRecalcular())).not.toContain('ya está pagado');
    expect(comoSeLee(c.motivoNoRecalcular())).toContain('deuda borrada');
  });

  it('una respuesta vieja, sin el campo, se ve como antes: la pregunta es la del servidor', async () => {
    const vieja: Partial<Liquidacion> = { ...MIGRADA };
    delete vieja.deuda_borrada_por_la_migracion;
    const fixture = await abrirDetalle(liquidacion(DIA, 'proveedor', vieja));

    expect(fixture.nativeElement.querySelector('.aviso-deuda-borrada')).toBeNull();
    expect(fixture.componentInstance.puedeCorregir()).toBeTrue();
  });

  it('corregida sin reparar: el saldo dice $ 50.000, pero no hay Pagar y el candado dice por qué', async () => {
    const fixture = await abrirDetalle(liquidacion(DIA, 'proveedor', CORREGIDA_SIN_REPARAR));
    const c = fixture.componentInstance;

    expect(leerResumen(fixture)['Saldo a pagar']).toBe('$ 50.000');
    expect(c.puedePagar()).toBeFalse();
    expect(botonesDe(fixture).some((b) => b.endsWith('Pagar'))).toBeFalse();
    // "No hay nada que pagar" al lado de "Saldo a pagar $ 50.000" sería falso: no se PUEDE.
    expect(candadosDe(fixture)).toContain('lock No se puede pagar');
    expect(comoSeLee(c.motivoNoPagar())).toBe(
      'No se puede pagar esta quincena: viene de antes de que existieran los abonos, y el ' +
        'sistema de esa época le borró lo que Henri Castaño quedaba debiendo ($ 120.000). Hay ' +
        'que repararla antes de tocarla: tal como está, el sistema le sumaría esos $ 120.000 a ' +
        'lo que falta por entregarle y mandaría a pagarle a alguien que todavía debe.',
    );
    // Tampoco Corregir, y la ayuda de arriba no manda a usar "Pagar" para el resto.
    expect(botonesDe(fixture).some((b) => b.includes('Corregir esta quincena'))).toBeFalse();
    expect(ayudaDe(fixture)).not.toContain('Pagar');
    // 230.000 − 300.000 + 120.000 = 50.000: la columna cierra en el saldo que se ve, y el
    // aviso dice que el saldo no es lo que queda: Henri debe $70.000.
    const cuadre = cuadreDelResumen(fixture);
    expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);
    expect(leido(fixture.nativeElement.querySelector('.aviso-deuda-borrada'))).toContain(
      'Henri Castaño todavía le debe $ 70.000 al negocio por esta quincena.',
    );
  });

  it('con un abono encima y el saldo en cero: no ofrece "Marcar pagada" ni culpa a los anticipos', async () => {
    const fixture = await abrirDetalle(liquidacion(DIA, 'proveedor', ABONADA_ENCIMA));
    const c = fixture.componentInstance;

    expect(c.puedeCerrarSinPago()).toBeFalse();
    expect(botonesDe(fixture).some((b) => b.includes('Marcar pagada'))).toBeFalse();
    expect(candadosDe(fixture)).toContain('lock No se puede pagar');
    // "los anticipos ($ 300.000) cubren EXACTO el valor total ($ 230.000)" no cuadra con nada.
    expect(fixture.nativeElement.querySelector('.nota-saldo-cero')).toBeNull();
    // Ni un "− −$ 70.000": "Pagado" es lo que suma la tabla de pagos, y lo borrado va en su
    // renglón con la cifra del servidor. 230.000 − 300.000 − 50.000 + 120.000 = 0.
    expect(leerResumen(fixture)['Pagado']).toBe('− $ 50.000');
    expect(leerResumen(fixture)['Deuda borrada por la migración']).toBe('+ $ 120.000');
    const cuadre = cuadreDelResumen(fixture);
    expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);
    expect(leido(fixture.nativeElement.querySelector('.aviso-deuda-borrada'))).toContain(
      'Henri Castaño todavía le debe $ 120.000 al negocio por esta quincena.',
    );
  });

  it('las demás no cambian: con "0.00" no hay aviso y los botones siguen donde estaban', async () => {
    const fixture = await abrirDetalle(
      liquidacion(EL_MARTES, 'transportador', {
        estado: 'aprobada',
        deuda_borrada_por_la_migracion: '0.00',
      }),
    );

    expect(fixture.nativeElement.querySelector('.aviso-deuda-borrada')).toBeNull();
    expect(botonesDe(fixture).some((b) => b.endsWith('Pagar'))).toBeTrue();
  });
});

// =============================================================================
// LA COLUMNA CUADRA EN TODAS LAS FORMAS QUE DEJÓ LA MIGRACIÓN, y el aviso dice lo que
// queda de verdad.
//
// Con la deuda borrada, `pagado` lleva metida la deuda que se borró: borrada = Σ pagos −
// pagado, y saldo = neto − pagado. Por eso valor total − anticipos − Σ pagos + borrada =
// saldo en todas, y lo que de verdad falta entregar es saldo − borrada (negativo: el
// tercero debe). Las cifras son las del backend (tests/test_liquidacion_deuda_borrada_con_pagos.py).
// =============================================================================

describe('LiquidacionDetailDialog: la deuda borrada, forma por forma', () => {
  const HENRI: Partial<Liquidacion> = {
    tipo: 'proveedor',
    proveedor_id: 'p-1',
    proveedor_nombre: 'Henri Castaño',
    transportador_id: null,
    transportador_nombre: null,
    total_litros: '90',
    precio_promedio: '2000',
    valor_transporte: '0',
    anticipos: '300000',
    le_queda_debiendo: '0',
    deuda_borrada_por_la_migracion: '120000.00',
  };
  const DIA = [det('d-1', '2026-07-03', '90', '2000', '180000')];
  const pago = (id: string, valor: string): PagoLiquidacion =>
    ({ id, fecha: '2026-08-10', valor, observaciones: null }) as PagoLiquidacion;

  /** Como la dejó la migración: pagada, pagado −$120.000, saldo en cero, sin pagos. */
  const PLAIN: Partial<Liquidacion> = {
    ...HENRI,
    estado: 'pagada',
    estado_visible: 'pagada',
    valor_bruto: '180000',
    valor_total: '180000',
    neto_a_pagar: '-120000',
    pagado: '-120000',
    saldo: '0',
    pagos: [],
  };
  /** Un día olvidado de $50.000 y Pagar antes del guardia: aprobada, pagado −$70.000. */
  const MAS_CINCUENTA: Partial<Liquidacion> = {
    ...HENRI,
    estado: 'aprobada',
    estado_visible: 'aprobada',
    version: 2,
    valor_bruto: '230000',
    valor_total: '230000',
    neto_a_pagar: '-70000',
    pagado: '-70000',
    saldo: '0',
    pagos: [pago('pg-1', '50000.00')],
  };
  /** Un día olvidado de $200.000 y Pagar: pagada, pagado $80.000 y $200.000 en pagos. */
  const PASO_DE_CERO: Partial<Liquidacion> = {
    ...HENRI,
    estado: 'pagada',
    estado_visible: 'pagada',
    version: 2,
    valor_bruto: '380000',
    valor_total: '380000',
    neto_a_pagar: '80000',
    pagado: '80000',
    saldo: '0',
    pagos: [pago('pg-2', '200000.00')],
  };
  /** Abonos de $150.000 y $50.000, y el de $150.000 borrado: pagado −$70.000. */
  const DOS_ABONOS: Partial<Liquidacion> = {
    ...HENRI,
    estado: 'aprobada',
    estado_visible: 'aprobada',
    version: 2,
    valor_bruto: '380000',
    valor_total: '380000',
    neto_a_pagar: '80000',
    pagado: '-70000',
    saldo: '150000',
    pagos: [pago('pg-3', '50000.00')],
  };
  /** El día olvidado de $200.000 sin pagar todavía: el saldo dice $200.000. */
  const HACIA_ARRIBA_SIN_PAGAR: Partial<Liquidacion> = {
    ...HENRI,
    estado: 'parcial',
    estado_visible: 'parcial',
    version: 2,
    valor_bruto: '380000',
    valor_total: '380000',
    neto_a_pagar: '80000',
    pagado: '-120000',
    saldo: '200000',
    pagos: [],
  };

  const aviso = (fixture: Fixture): string =>
    leido(fixture.nativeElement.querySelector('.aviso-deuda-borrada span'));

  const DEBE_120 = 'Henri Castaño todavía le debe $ 120.000 al negocio por esta quincena.';
  const formas: {
    nombre: string;
    cifras: Partial<Liquidacion>;
    /** El renglón "Pagado" como se lee, o null si no hay pagos. */
    pagado: string | null;
    loQueQueda: string;
  }[] = [
    { nombre: 'la migrada tal cual', cifras: PLAIN, pagado: null, loQueQueda: DEBE_120 },
    {
      nombre: 'corregida +$50.000 y pagada',
      cifras: MAS_CINCUENTA,
      pagado: '− $ 50.000',
      loQueQueda: DEBE_120,
    },
    {
      nombre: 'corregida +$200.000 y pagada',
      cifras: PASO_DE_CERO,
      pagado: '− $ 200.000',
      loQueQueda: DEBE_120,
    },
    {
      // 380.000 − 300.000 − 50.000 = 30.000 de verdad, contra un saldo de 150.000.
      nombre: 'dos abonos y uno borrado',
      cifras: DOS_ABONOS,
      pagado: '− $ 50.000',
      loQueQueda:
        'Lo que de verdad falta por entregarle a Henri Castaño son $ 30.000, no los ' +
        '$ 150.000 del saldo.',
    },
    {
      nombre: 'corregida +$200.000 sin pagar',
      cifras: HACIA_ARRIBA_SIN_PAGAR,
      pagado: null,
      loQueQueda:
        'Lo que de verdad falta por entregarle a Henri Castaño son $ 80.000, no los ' +
        '$ 200.000 del saldo.',
    },
  ];

  for (const { nombre, cifras, pagado, loQueQueda } of formas) {
    it(`${nombre}: la columna cierra exacta y el aviso nombra el renglón y lo que queda`, async () => {
      const fixture = await abrirDetalle(liquidacion(DIA, 'proveedor', cifras));
      const resumen = leerResumen(fixture);

      // "Pagado" es lo que suma la tabla de pagos, y no sale si no hay ninguno.
      expect(resumen['Pagado'] ?? 'sin renglón').toBe(pagado ?? 'sin renglón');
      expect(resumen['Deuda borrada por la migración']).toBe('+ $ 120.000');
      // LA REGLA DE ORO, con lo que se lee: total − descuentos + borrada = renglón final.
      const cuadre = cuadreDelResumen(fixture);
      expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);
      expect(cuadre.cierre).toBe(centavos(resumen['Saldo a pagar']));
      // El aviso ya no dice que el resumen no cuadra: nombra el renglón y lo que queda.
      expect(aviso(fixture)).toContain('el renglón «Deuda borrada por la migración»');
      expect(aviso(fixture)).toContain(loQueQueda);
      expect(aviso(fixture)).not.toContain('no cuadra');
    });
  }

  it('el renglón "Pagado" suma la tabla al centavo', async () => {
    const fixture = await abrirDetalle(
      liquidacion(DIA, 'proveedor', {
        ...MAS_CINCUENTA,
        pagado: '-119999.70',
        saldo: '49999.70',
        pagos: [pago('pg-a', '0.10'), pago('pg-b', '0.20')],
      }),
    );

    expect(leerResumen(fixture)['Pagado']).toBe('− $ 0,30');
    // 230.000 − 300.000 − 0,30 + 120.000 = 49.999,70, al centavo.
    const cuadre = cuadreDelResumen(fixture);
    expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);
    expect(cuadre.cierre).toBe(4999970);
  });

  it('sin deuda que deba el tercero, el candado de Pagar no dice que "todavía debe"', async () => {
    const fixture = await abrirDetalle(liquidacion(DIA, 'proveedor', HACIA_ARRIBA_SIN_PAGAR));

    // Se le deben $80.000 de verdad: pagarle el saldo sería pagarle $120.000 de más.
    expect(comoSeLee(fixture.componentInstance.motivoNoPagar())).toBe(
      'No se puede pagar esta quincena: viene de antes de que existieran los abonos, y el ' +
        'sistema de esa época le borró lo que Henri Castaño quedaba debiendo ($ 120.000). Hay ' +
        'que repararla antes de tocarla: tal como está, el sistema le sumaría esos $ 120.000 a ' +
        'lo que falta por entregarle y le pagaría esos $ 120.000 de más.',
    );
  });

  it('aprobada con la deuda borrada: no ofrece Anular, y el candado da la razón del servidor', async () => {
    // `anular` hace primero `_exigir_sin_deuda_borrada`: el botón siempre fallaba.
    const fixture = await abrirDetalle(liquidacion(DIA, 'proveedor', MAS_CINCUENTA));
    const c = fixture.componentInstance;

    expect(c.puedeAnular()).toBeFalse();
    expect(botonesDe(fixture).some((b) => b.endsWith('Anular'))).toBeFalse();
    expect(candadosDe(fixture)).toContain('lock No se puede anular');
    expect(comoSeLee(c.motivoNoAnular())).toBe(
      'No se puede anular esta quincena: viene de antes de que existieran los abonos, y el ' +
        'sistema de esa época le borró lo que Henri Castaño quedaba debiendo ($ 120.000). Hay ' +
        'que repararla antes de tocarla: tal como está, el sistema le sumaría esos $ 120.000 a ' +
        'lo que falta por entregarle y mandaría a pagarle a alguien que todavía debe.',
    );
  });

  it('aprobada con correcciones y sin deuda borrada: tampoco Anular (el servidor la rebota)', async () => {
    // La v2 de una pagada que sus anticipos dejaron en cero, corregida hacia arriba.
    const fixture = await abrirDetalle(
      liquidacion(DIA, 'proveedor', {
        ...HENRI,
        estado: 'aprobada',
        estado_visible: 'aprobada',
        version: 2,
        anticipos: '180000',
        valor_bruto: '230000',
        valor_total: '230000',
        neto_a_pagar: '50000',
        pagado: '0',
        saldo: '50000',
        deuda_borrada_por_la_migracion: '0.00',
      }),
    );
    const c = fixture.componentInstance;

    expect(c.puedeAnular()).toBeFalse();
    expect(botonesDe(fixture).some((b) => b.endsWith('Anular'))).toBeFalse();
    expect(comoSeLee(c.motivoNoAnular())).toBe(
      'De esta quincena ya salieron 2 comprobantes (el original y sus correcciones): no se ' +
        'puede anular.',
    );
    // Pagar sí: el servidor lo acepta.
    expect(botonesDe(fixture).some((b) => b.endsWith('Pagar'))).toBeTrue();
  });

  /**
   * CON LAS DOS MARCAS: corregida hacia abajo antes del guardia (precio 2000 → 1500), valor
   * $135.000, saldo −$45.000, y esos $45.000 ya se los cobró la siguiente.
   */
  const CON_LAS_DOS: Partial<Liquidacion> = {
    ...HENRI,
    estado: 'pagada',
    estado_visible: 'pagada · quedó debiendo',
    version: 2,
    precio_promedio: '1500',
    valor_bruto: '135000',
    valor_total: '135000',
    neto_a_pagar: '-165000',
    pagado: '-120000',
    saldo: '-45000',
    le_queda_debiendo: '45000',
    pagos: [],
    deuda_trasladada_a_id: 'l-sig',
    deuda_trasladada_a: {
      id: 'l-sig',
      periodo_inicio: '2026-07-16',
      periodo_fin: '2026-07-31',
      periodo_texto: '16/07/2026 al 31/07/2026',
    },
  } as Partial<Liquidacion>;

  it('con la deuda borrada Y la deuda ya cobrada, Corregir da primero la borrada', async () => {
    // `_exigir_corregible` rebota primero por la borrada: "anule primero esa liquidación"
    // mandaría a anular la siguiente para nada.
    const fixture = await abrirDetalle(liquidacion(DIA, 'proveedor', CON_LAS_DOS));
    const motivo = comoSeLee(fixture.componentInstance.motivoNoCorregir());

    expect(motivo).toBe(
      'No se puede corregir esta quincena: viene de antes de que existieran los abonos, y el ' +
        'sistema de esa época le borró lo que Henri Castaño quedaba debiendo ($ 120.000). Hay ' +
        'que repararla antes de tocarla: tal como está, el sistema le sumaría esos $ 120.000 a ' +
        'lo que falta por entregarle y mandaría a pagarle a alguien que todavía debe.',
    );
    expect(motivo).not.toContain('Anule primero esa liquidación');
  });

  it('con las dos marcas, la columna cierra en "Le queda debiendo" y el aviso separa las dos deudas', async () => {
    const fixture = await abrirDetalle(liquidacion(DIA, 'proveedor', CON_LAS_DOS));

    // 135.000 − 300.000 + 120.000 = −45.000, el "Le queda debiendo $ 45.000" del final.
    const cuadre = cuadreDelResumen(fixture);
    expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);
    expect(cuadre.cierre).toBe(-4500000);
    expect(aviso(fixture)).toContain(
      'Tal como están las cifras, Henri Castaño quedó debiendo $ 165.000 por esta quincena: ' +
        'los $ 45.000 del renglón final ya se le cobraron en la liquidación del 16/07/2026 al ' +
        '31/07/2026, y la deuda borrada todavía la debe.',
    );
    // La cifra borrada la dice una vez el marco del aviso (45.000 + 120.000 = 165.000 en el
    // mismo párrafo): repetirla en la posición de hoy era la misma plata dos veces.
    expect((aviso(fixture).match(/\$\s120\.000/g) ?? []).length).toBe(1);
  });

  it('con las dos marcas, el candado de Recalcular también da primero la borrada', async () => {
    // Mismo orden que Corregir y Anular: "anule primero esa liquidación … y vuelva a
    // intentarlo" mandaría a anular la siguiente para nada.
    const fixture = await abrirDetalle(liquidacion(DIA, 'proveedor', CON_LAS_DOS));
    const motivo = comoSeLee(fixture.componentInstance.motivoNoRecalcular());

    expect(motivo).toBe(
      'Sus cifras están en firme y Recalcular solo trabaja sobre borradores. Además trae una ' +
        'deuda borrada de antes de los abonos (ver el aviso de arriba): hay que repararla ' +
        'antes de tocarla.',
    );
    expect(leido(fixture.nativeElement.querySelector('.ayuda-precio.con-candado span'))).toBe(
      motivo,
    );
  });

  /** Los botones de las acciones que le mandan algo al tercero, y el del PDF para el dueño. */
  const loQueSeManda = (fixture: Fixture) => {
    const botones = botonesDe(fixture);
    return {
      whatsApp: botones.some((b) => b.includes('WhatsApp')),
      compartir: botones.some((b) => b.includes('Compartir PDF')),
      verPdf: botones.some((b) => b.startsWith('picture_as_pdf')),
    };
  };

  for (const { nombre, cifras } of [
    ...formas,
    { nombre: 'con las dos marcas', cifras: CON_LAS_DOS },
  ]) {
    it(`${nombre}: no ofrece mandársela al tercero, y el dueño sí puede ver el PDF`, async () => {
      // El aviso dice que hay que repararla antes de cualquier otra cosa, y el renglón
      // «+ Deuda borrada» le llegaría suelto al tercero, leyéndose como un abono.
      const fixture = await abrirDetalle(liquidacion(DIA, 'proveedor', cifras));

      expect(loQueSeManda(fixture)).toEqual({ whatsApp: false, compartir: false, verPdf: true });
    });
  }

  it('la anulada con la deuda borrada, y una quincena normal, sí se pueden mandar', async () => {
    const anulada = await abrirDetalle(
      liquidacion(DIA, 'proveedor', { ...PLAIN, estado: 'anulada', estado_visible: 'anulada' }),
    );
    expect(loQueSeManda(anulada)).toEqual({ whatsApp: true, compartir: true, verPdf: true });

    const normal = await abrirDetalle(
      liquidacion(DIA, 'proveedor', {
        ...PLAIN,
        anticipos: '180000',
        neto_a_pagar: '0',
        pagado: '0',
        deuda_borrada_por_la_migracion: '0.00',
      }),
    );
    expect(loQueSeManda(normal)).toEqual({ whatsApp: true, compartir: true, verPdf: true });
  });

  it('una anulada no lleva aviso ni candados de la borrada, pero la columna sigue cerrando', async () => {
    // El `por_reparar` del backend no cuenta las anuladas: no hay nada que reparar ahí.
    const fixture = await abrirDetalle(
      liquidacion(DIA, 'proveedor', { ...PLAIN, estado: 'anulada', estado_visible: 'anulada' }),
    );

    expect(fixture.componentInstance.tieneDeudaBorrada()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.aviso-deuda-borrada')).toBeNull();
    const cuadre = cuadreDelResumen(fixture);
    expect(cuadre.despuesDeLosDescuentos).toBe(cuadre.cierre);
  });
});

// =============================================================================
// LA AYUDA DE LA LÍNEA DE ESTADOS NOMBRA LOS BOTONES QUE SÍ HAY.
//
// La de 'aprobada' decía siempre "usa Pagar cuando entregues el dinero", también encima
// de una quincena sin ese botón. El detalle se la cambia con las mismas señales que
// ponen o quitan los botones (`ayudaDelEstado`).
// =============================================================================

describe('LiquidacionDetailDialog: la ayuda de arriba dice lo mismo que los botones de abajo', () => {
  /** La quincena 2 de Henri: vale justo los $120.000 que dejó debiendo la 1. */
  const Q2: Partial<Liquidacion> = {
    estado: 'aprobada',
    estado_visible: 'aprobada',
    tipo: 'proveedor',
    proveedor_id: 'p-1',
    proveedor_nombre: 'Henri Castaño',
    transportador_id: null,
    transportador_nombre: null,
    total_litros: '100',
    precio_promedio: '1200',
    valor_bruto: '120000',
    valor_transporte: '0',
    valor_total: '120000',
    anticipos: '0',
    saldo_anterior: '120000',
    neto_a_pagar: '0',
    pagado: '0',
    saldo: '0',
    le_queda_debiendo: '0',
  };
  const DIA_Q2 = [det('d-2', '2026-07-20', '100', '1200', '120000')];
  const ayudaDe = (fixture: Fixture): string =>
    leido(fixture.nativeElement.querySelector('app-liquidacion-estado-stepper .ayuda'));

  it('en cero por la deuda vieja: no hay botón, y la ayuda no manda a buscar uno', async () => {
    const fixture = await abrirDetalle(liquidacion(DIA_Q2, 'proveedor', Q2));

    expect(
      botonesDe(fixture).some((b) => b.endsWith('Pagar') || b.includes('Marcar pagada')),
    ).toBeFalse();
    expect(ayudaDe(fixture)).toBe(
      'Los valores quedaron en firme y no queda un peso por entregarle: no hay que pagarla ni ' +
        'marcarla pagada.',
    );
  });

  it('y el candado de Recalcular ya no dice "todavía no se le ha pagado nada"', async () => {
    const fixture = await abrirDetalle(liquidacion(DIA_Q2, 'proveedor', Q2));
    const c = fixture.componentInstance;

    expect(comoSeLee(c.motivoNoRecalcular())).toBe(
      'No hay nada que entregarle a Henri Castaño: con lo que venía debiendo de antes, el saldo ' +
        'quedó en $ 0. Sus cifras están en firme y Recalcular solo trabaja sobre borradores. Si ' +
        'quedaron mal —por ejemplo una tarifa que se corrigió después—, anúlela y vuelva a ' +
        'generarla: al anularla, lo que venía debiendo vuelve a quedar pendiente.',
    );
    expect(comoSeLee(c.motivoNoRecalcular())).not.toContain('todavía no se le ha pagado nada');
    // La salida que nombra existe.
    expect(botonesDe(fixture).some((b) => b.endsWith('Anular'))).toBeTrue();
  });

  it('en cero por sus propios anticipos: la ayuda nombra "Marcar pagada", que es el botón que hay', async () => {
    const fixture = await abrirDetalle(
      liquidacion(DIA_Q2, 'proveedor', { ...Q2, anticipos: '120000', saldo_anterior: '0' }),
    );

    expect(botonesDe(fixture).some((b) => b.includes('Marcar pagada'))).toBeTrue();
    expect(ayudaDe(fixture)).toBe(
      'Los valores quedaron en firme y no hay plata por entregar: usa "Marcar pagada" para ' +
        'cerrarla.',
    );
  });

  it('con plata por entregar sigue la de siempre, que ahí sí es cierta', async () => {
    const fixture = await abrirDetalle(
      liquidacion(DIA_Q2, 'proveedor', {
        ...Q2,
        valor_bruto: '150000',
        valor_total: '150000',
        neto_a_pagar: '30000',
        saldo: '30000',
      }),
    );

    expect(botonesDe(fixture).some((b) => b.endsWith('Pagar'))).toBeTrue();
    expect(ayudaDe(fixture)).toBe(
      'Los valores quedaron en firme: usa "Pagar" cuando entregues el dinero.',
    );
  });
});
