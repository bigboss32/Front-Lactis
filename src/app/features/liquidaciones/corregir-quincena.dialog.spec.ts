import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion, LiquidacionDetalle } from '../../core/models';
import { CorregirQuincenaDialog, MOTIVO_PROVISIONAL } from './corregir-quincena.dialog';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import {
  AnticipoDeLaQuincena,
  Correccion,
  CorregirQuincenaPayload,
  DiaSuelto,
  LiquidacionesService,
  PrevisualizacionCorreccion,
} from './liquidaciones.service';

/**
 * CORREGIR UNA QUINCENA QUE YA SE PAGÓ.
 *
 * Lo pidió el dueño: "que si soy administrador de empresa pueda editar la liquidación que
 * ya está pagada, es que se le olvidó un detalle y tiene que editarla". Y escogió UN SOLO
 * COMPROBANTE CORREGIDO (v2) en vez de dos papeles separados.
 *
 * ESTAS PRUEBAS MIDEN LAS DOS SITUACIONES DE PLATA, con las cifras que él dio:
 *
 *  A) SUBE. Quincena de $500.000 pagada con $500.000. Entra el día que se le olvidó, por
 *     $180.000: el total pasa a $680.000, lo ENTREGADO SIGUE en $500.000 y quedan
 *     $180.000 por entregarle. La quincena queda en parcial y después se oprime Pagar.
 *  B) BAJA. El precio de un día estaba mal y el total baja a $400.000 contra $500.000 ya
 *     entregados: se le pagó de más $100.000, y eso se lo descuenta sola la quincena
 *     siguiente.
 *
 * Y LA REGLA DE LA CASA POR ENCIMA DE TODO: todo desglose suma EXACTO la cifra grande.
 * El dueño lo verifica a mano con calculadora, así que acá se verifica igual: sumando y
 * restando lo que LA PANTALLA muestra, no lo que el servidor mandó. En particular se
 * cumple siempre: neto = pagado + saldo.
 */

const det = (
  id: string,
  fecha: string,
  litros: string,
  precio: string,
  valor: string,
): LiquidacionDetalle => ({
  id,
  fecha,
  litros,
  precio_litro: precio,
  valor,
  ruta_id: null,
  ruta_nombre: null,
});

/**
 * LA QUINCENA DEL DUEÑO: $500.000 de leche, pagada completa.
 *
 * Dos días de 100 L. Uno a $1.800 ($180.000) y otro a $3.200 ($320.000): suman los
 * $500.000 del papel que el productor ya tiene en la mano.
 */
const DIAS_QUE_YA_ESTAN = [
  det('d-1', '2026-06-02', '100', '1800', '180000'),
  det('d-2', '2026-06-05', '100', '3200', '320000'),
];

const laQuincena = (cifras: Partial<Liquidacion> = {}): Liquidacion => ({
  id: 'l-1',
  empresa_id: 'e-1',
  estado: 'pagada',
  created_at: '2026-06-16T00:00:00Z',
  updated_at: '2026-06-16T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Henri Castaño',
  transportador_id: null,
  transportador_nombre: null,
  periodo_inicio: '2026-06-01',
  periodo_fin: '2026-06-15',
  total_litros: '200',
  precio_promedio: '2500',
  valor_bruto: '500000',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '0',
  anticipos: '0',
  valor_total: '500000',
  saldo_anterior: '0',
  neto_a_pagar: '500000',
  pagado: '500000',
  saldo: '0',
  le_queda_debiendo: '0',
  version: 1,
  observaciones: null,
  detalles: DIAS_QUE_YA_ESTAN,
  pagos: [],
  ...cifras,
});

/** El día que se le olvidó: 100 L a $1.800 = $180.000. */
const EL_DIA_OLVIDADO: DiaSuelto = {
  recepcion_id: 'r-12',
  fecha: '2026-06-12',
  litros: '100',
  precio_litro: '1800',
  valor: '180000',
  nota_flete:
    'El flete de este día entra normal en el próximo comprobante del transportador',
};

/** Y OTRO día suelto, que el dueño NO quiere meter: es el que prueba las casillas. */
const EL_OTRO_DIA_SUELTO: DiaSuelto = {
  recepcion_id: 'r-13',
  fecha: '2026-06-13',
  litros: '50',
  precio_litro: '1800',
  valor: '90000',
  nota_flete: null,
};

/**
 * LOS ADELANTOS: plata que YA SE LE ENTREGÓ EN LA MANO a Henri, y que el comprobante le
 * resta. Por eso moverlos mueve la cifra grande igual que un día de leche.
 *
 * El del 12 es el que YA se le descontó en esta quincena —el que el dueño reconoce por
 * las observaciones, "el que le di para la droga"—. Los otros dos están sueltos: uno de
 * dentro del período y otro de hace meses, que el servidor manda SEÑALADO porque nunca
 * se le descontó a nadie.
 */
const EL_ADELANTO_DE_LA_DROGA: AnticipoDeLaQuincena = {
  anticipo_id: 'a-12',
  fecha: '2026-06-12',
  valor: '120000',
  observaciones: 'el que le di para la droga',
  aplicado: true,
  aviso: null,
};

const EL_ADELANTO_SUELTO: AnticipoDeLaQuincena = {
  anticipo_id: 'a-20',
  fecha: '2026-06-10',
  valor: '40000',
  observaciones: 'para el mercado',
  aplicado: false,
  aviso: null,
};

const EL_ADELANTO_VIEJO: AnticipoDeLaQuincena = {
  anticipo_id: 'a-99',
  fecha: '2025-12-20',
  valor: '30000',
  observaciones: 'diciembre',
  aplicado: false,
  aviso:
    'Este adelanto es de antes de este período y nunca se le descontó: si lo marca, se ' +
    'le descuenta aquí',
};

/**
 * EL ADELANTO FANTASMA: el que ESTA MISMA quincena sacó en una corrección anterior.
 *
 * Es el caso que existe la cuarta operación. Al sacarlo, el comprobante v2 que Henri
 * tiene en la mano quedó diciendo "se le descuenta en la siguiente", así que la pantalla
 * de Anticipos lo traba. Pero si ese adelanto NUNCA EXISTIÓ —se digitó dos veces— y Henri
 * dejó de entregar leche, sin esta pantalla ese fantasma de $300.000 se le iba a
 * descontar de plata que SÍ es suya.
 *
 * El `aviso` es el que escribe el servidor, y se pinta TAL CUAL.
 */
const EL_ADELANTO_FANTASMA: AnticipoDeLaQuincena = {
  anticipo_id: 'a-77',
  fecha: '2026-06-08',
  valor: '300000',
  observaciones: 'se digitó dos veces',
  aplicado: false,
  aviso:
    'Esta quincena lo sacó en una corrección y su comprobante dice que se le descuenta ' +
    'en la siguiente. Si ese adelanto NUNCA existió, bórrelo desde aquí: es la única ' +
    'pantalla que puede',
};

/**
 * UN SERVIDOR FALSO QUE SÍ HACE LA CUENTA, y hace la del backend de verdad:
 *
 *   valor_total = lo que ya estaba + los días MARCADOS + la diferencia de los precios
 *   neto        = valor_total − anticipos − lo que venía debiendo
 *   saldo       = neto − lo ya entregado   (o sea: neto = pagado + saldo, siempre)
 *
 * No devuelve cifras escritas a mano porque lo que estas pruebas cuidan es justamente que
 * marcar una casilla mueva la cifra grande. Con respuestas fijas, un diálogo que ignorara
 * las casillas pasaría igual.
 */
class ServicioFalso {
  readonly avances: CorregirQuincenaPayload[] = [];
  readonly correcciones_hechas: CorregirQuincenaPayload[] = [];

  liquidacion = laQuincena();
  sueltos: DiaSuelto[] = [EL_DIA_OLVIDADO, EL_OTRO_DIA_SUELTO];
  /**
   * Los adelantos que HOY se le descuentan en esta quincena.
   *
   * En null significa "la prueba no dice cuáles fueron": entonces se inventa UNO que
   * suma exacto la cifra guardada en la liquidación, que es lo que hace el servidor de
   * verdad —`liquidacion.anticipos` nunca es un número suelto, siempre es la suma de los
   * adelantos marcados—. Sin eso, una prueba de otra cosa que solo pone `anticipos` se
   * quedaría con un desglose que no suma su propia cifra.
   */
  anticiposAplicados: AnticipoDeLaQuincena[] | null = null;
  anticiposSueltos: AnticipoDeLaQuincena[] = [];
  /**
   * Los que ESTA MISMA quincena sacó en una corrección anterior y siguen esperando.
   *
   * Son los únicos que esta pantalla puede ANULAR además de los que hoy están
   * descontados: los imprimió ella, y su comprobante es el que promete descontarlos en la
   * siguiente.
   */
  anticiposSoltadosPorEsta: AnticipoDeLaQuincena[] = [];
  avisos: string[] = [];
  /** Si se pone, el avance falla con esto (es como el servidor rebota una no corregible). */
  fallaAlPrevisualizar: unknown = null;
  /** Si se pone, la corrección de verdad falla con esto. */
  fallaAlCorregir: unknown = null;
  corregida: Liquidacion | null = null;

  previsualizarCorreccion(
    _id: string,
    payload: CorregirQuincenaPayload,
  ): Observable<PrevisualizacionCorreccion> {
    this.avances.push(payload);
    if (this.fallaAlPrevisualizar) return throwError(() => this.fallaAlPrevisualizar);

    const l = this.liquidacion;
    const entran = this.sueltos
      .filter((dia) => payload.recepciones_a_incluir.includes(dia.recepcion_id))
      .reduce((suma, dia) => suma + Number(dia.valor), 0);
    const diferencias = payload.precios.reduce((suma, precio) => {
      const dia = (l.detalles ?? []).find((d) => d.id === precio.detalle_id);
      if (!dia) return suma;
      return suma + Number(dia.litros) * (precio.precio_litro - Number(dia.precio_litro));
    }, 0);

    // LOS ADELANTOS SE VUELVEN A SUMAR DESDE LOS QUE QUEDAN MARCADOS, igual que el
    // servidor de verdad: nunca sumándole o restándole a la cifra guardada, que es como
    // una petición repetida termina descontando dos veces.
    const valorDe = (ade: AnticipoDeLaQuincena): number =>
      payload.valores_de_anticipos.find((v) => v.anticipo_id === ade.anticipo_id)?.valor ??
      Number(ade.valor);
    // Y EL QUE SE ANULA TAMPOCO QUEDA: el servidor lo borra, así que deja de restarse.
    // Anular uno que hoy está descontado aquí SUBE lo que hay que entregarle, igual que
    // sacarlo; anular uno que esta quincena ya había sacado no mueve esta cuenta.
    const aBorrar = payload.anticipos_a_borrar ?? [];
    const quedan = [
      ...this.aplicados().filter(
        (a) =>
          !payload.anticipos_a_soltar.includes(a.anticipo_id) &&
          !aBorrar.includes(a.anticipo_id),
      ),
      ...this.anticiposSueltos.filter((a) =>
        payload.anticipos_a_incluir.includes(a.anticipo_id),
      ),
    ];
    const anticiposAntes = this.aplicados().reduce((suma, a) => suma + Number(a.valor), 0);
    const anticiposDespues = quedan.reduce((suma, a) => suma + valorDe(a), 0);

    const totalAntes = Number(l.valor_total);
    const totalDespues = totalAntes + entran + diferencias;
    const viejo = Number(l.saldo_anterior ?? 0);
    const netoAntes = totalAntes - anticiposAntes - viejo;
    const netoDespues = totalDespues - anticiposDespues - viejo;
    const pagado = Number(l.pagado ?? 0);
    const saldoAntes = netoAntes - pagado;
    const saldoDespues = netoDespues - pagado;

    return of({
      dias_sueltos: this.sueltos,
      // Las dos listas van con lo que hay GUARDADO HOY, no con lo que el dueño lleva
      // marcado: el avance no escribe nada, así que un adelanto recién marcado sigue
      // saliendo en los sueltos. Es como responde el servidor.
      anticipos_aplicados: this.aplicados(),
      anticipos_sueltos: this.anticiposSueltos,
      anticipos_soltados_por_esta: this.anticiposSoltadosPorEsta,
      valor_total_antes: String(totalAntes),
      valor_total_despues: String(totalDespues),
      anticipos_antes: String(anticiposAntes),
      anticipos_despues: String(anticiposDespues),
      neto_antes: String(netoAntes),
      neto_despues: String(netoDespues),
      pagado: String(pagado),
      saldo_antes: String(saldoAntes),
      saldo_despues: String(saldoDespues),
      estado_antes: l.estado,
      estado_despues: saldoDespues > 0 ? 'parcial' : 'pagada',
      queda_por_entregar: String(saldoDespues > 0 ? saldoDespues : 0),
      se_le_pago_de_mas: String(saldoDespues < 0 ? -saldoDespues : 0),
      version_actual: Number(l.version ?? 1),
      avisos: this.avisos,
    });
  }

  /** Los que hoy se le descuentan: los que puso la prueba, o uno que suma la cifra. */
  private aplicados(): AnticipoDeLaQuincena[] {
    if (this.anticiposAplicados !== null) return this.anticiposAplicados;
    const total = Number(this.liquidacion.anticipos ?? 0);
    if (total <= 0) return [];
    return [{ ...EL_ADELANTO_DE_LA_DROGA, valor: String(total) }];
  }

  corregir(_id: string, payload: CorregirQuincenaPayload): Observable<Liquidacion> {
    this.correcciones_hechas.push(payload);
    if (this.fallaAlCorregir) return throwError(() => this.fallaAlCorregir);
    return of(this.corregida ?? this.liquidacion);
  }
}

/**
 * Un texto tal como se LEE en pantalla: el espacio de "$ 500.000" que pone Intl es duro
 * (U+00A0) y se normaliza para poder escribir las cifras esperadas a mano.
 */
const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const leido = (elemento: Element | null | undefined): string => comoSeLee(elemento?.textContent);

/** "$ 500.000" → 50000000 centavos enteros. La cuenta del dueño, sin coma flotante. */
const centavos = (texto: string): number =>
  Math.round(Number(texto.replace(/[^\d,-]/g, '').replace(',', '.')) * 100);

/**
 * UN REBOTE DEL SERVIDOR CON LA FORMA DE VERDAD.
 *
 * El detalle viaja en `error.error.detail` —así lo envuelve el backend y así lo lee
 * `detalleDeError`—: con el sobre mal armado la pantalla mostraría el texto de respaldo y
 * la prueba pasaría sin haber medido que el motivo del servidor se muestra.
 */
const comoRebotaElServidor = (detail: string): HttpErrorResponse =>
  new HttpErrorResponse({ status: 400, error: { error: { detail } } });

describe('CorregirQuincenaDialog: la quincena que ya se pagó', () => {
  let fixture: ComponentFixture<CorregirQuincenaDialog>;
  let dialogo: CorregirQuincenaDialog;
  let servicio: ServicioFalso;
  let avisos: string[];
  let cerradoCon: unknown[];

  /**
   * `preparar` corre ANTES de crear el componente: es la única forma de que el PRIMER
   * avance —el que dispara el constructor— responda distinto, que es justo lo que hay
   * que medir cuando el servidor rebota la quincena entera.
   */
  const armar = async (
    liquidacion = laQuincena(),
    preparar?: (falso: ServicioFalso) => void,
  ): Promise<void> => {
    servicio = new ServicioFalso();
    servicio.liquidacion = liquidacion;
    preparar?.(servicio);
    avisos = [];
    cerradoCon = [];

    await TestBed.configureTestingModule({
      imports: [CorregirQuincenaDialog, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { liquidacion } },
        { provide: LiquidacionesService, useValue: servicio },
        {
          provide: MatDialogRef,
          useValue: {
            disableClose: false,
            close: (valor?: unknown) => cerradoCon.push(valor),
            backdropClick: () => new Subject<MouseEvent>(),
            keydownEvents: () => new Subject<KeyboardEvent>(),
          },
        },
        { provide: MatSnackBar, useValue: { open: (texto: string) => avisos.push(texto) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CorregirQuincenaDialog);
    dialogo = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const asentar = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** El cuadre como se lee: por clave de renglón, la cifra de antes y la de ahora. */
  const leerCuadre = (): Record<string, { antes: string; ahora: string }> => {
    const hijos = Array.from(
      (fixture.nativeElement.querySelector('.cuadre') as HTMLElement).children,
    ) as HTMLElement[];
    // Los tres primeros son los encabezados ("", Antes, Ahora).
    const filas = hijos.slice(3);
    const cuadre: Record<string, { antes: string; ahora: string }> = {};
    for (let i = 0; i + 2 < filas.length + 1; i += 3) {
      const clave = filas[i].getAttribute('data-clave') ?? '';
      cuadre[clave] = { antes: leido(filas[i + 1]), ahora: leido(filas[i + 2]) };
    }
    return cuadre;
  };

  /** Las dos cifras grandes, con su rótulo, tal como se leen. */
  const leerCierres = (): { rotulo: string; cifra: string }[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.cierre')).map((caja) => ({
      rotulo: leido((caja as Element).querySelector('.cierre-rotulo')),
      cifra: leido((caja as Element).querySelector('.cierre-cifra')),
    }));

  const filasDe = (selector: string): string[][] =>
    Array.from(fixture.nativeElement.querySelectorAll(`${selector} tr`)).map((tr) =>
      Array.from((tr as Element).querySelectorAll('th,td')).map((celda) => leido(celda)),
    );

  const botonLlamado = (texto: string): HTMLButtonElement | null =>
    (Array.from(fixture.nativeElement.querySelectorAll('button')).find((boton) =>
      leido(boton as Element).includes(texto),
    ) as HTMLButtonElement | undefined) ?? null;

  // ==========================================================================
  // EL AVISO QUE NO SE PUEDE SALTAR
  // ==========================================================================
  it('lo primero que se lee es que el productor YA TIENE un papel con la cifra vieja', async () => {
    await armar();

    const rojo = leido(fixture.nativeElement.querySelector('.aviso-rojo'));
    expect(rojo).toContain('Henri Castaño ya tiene un papel con la cifra vieja');
    // Y con las dos cifras que el dueño necesita para reconocer ese papel.
    expect(rojo).toContain('$ 500.000');
    expect(rojo).toContain('v2');
  });

  it('el avance de entrada no manda ni un día ni un precio: solo pregunta cómo está', async () => {
    await armar();

    expect(servicio.avances.length).toBe(1);
    expect(servicio.avances[0].recepciones_a_incluir).toEqual([]);
    expect(servicio.avances[0].precios).toEqual([]);
    // El motivo viaja provisional porque el servidor exige el campo para leer el sobre,
    // pero el avance no lo usa ni lo guarda. Ver MOTIVO_PROVISIONAL.
    expect(servicio.avances[0].motivo).toBe(MOTIVO_PROVISIONAL);
  });

  // ==========================================================================
  // A) SUBE: el día que se le olvidó — las cifras del dueño
  // ==========================================================================
  it('A) el día olvidado de $180.000 sube el total a $680.000 y deja $180.000 por entregarle', async () => {
    await armar();

    dialogo.marcarDia(EL_DIA_OLVIDADO.recepcion_id, true);
    await asentar();

    const cuadre = leerCuadre();
    expect(cuadre['valor_total']).toEqual({ antes: '$ 500.000', ahora: '$ 680.000' });
    expect(cuadre['neto']).toEqual({ antes: '$ 500.000', ahora: '$ 680.000' });
    // LO ENTREGADO NO SE MUEVE: la corrección no toca un solo pago. Es la mitad de la
    // decisión del dueño —un comprobante corregido, no un pago nuevo—.
    expect(cuadre['pagado']).toEqual({ antes: '$ 500.000', ahora: '$ 500.000' });

    const cierres = leerCierres();
    expect(cierres[1].rotulo).toBe('QUEDA POR ENTREGARLE');
    expect(cierres[1].cifra).toBe('$ 180.000');
    // Y antes no quedaba nada por entregar: estaba pagada completa.
    expect(cierres[0].cifra).toBe('$ 0');
  });

  it('A) el desglose SUMA EXACTO la cifra grande, en las dos columnas', async () => {
    await armar();
    dialogo.marcarDia(EL_DIA_OLVIDADO.recepcion_id, true);
    await asentar();

    const cuadre = leerCuadre();
    const cierres = leerCierres();
    for (const [columna, cierre] of [
      ['antes', cierres[0]],
      ['ahora', cierres[1]],
    ] as const) {
      const total = centavos(cuadre['valor_total'][columna]);
      const pagado = centavos(cuadre['pagado'][columna]);
      const neto = centavos(cuadre['neto'][columna]);
      // No hay anticipos ni deuda vieja en esta quincena: esos renglones no se pintan
      // porque un "$ 0" en una columna que se suma a mano es ruido.
      expect(cuadre['anticipos']).toBeUndefined();
      expect(neto).toBe(total);
      // LA IDENTIDAD QUE MANDA SOBRE TODO: neto = pagado + saldo.
      expect(neto - pagado).toBe(centavos(cierre.cifra));
    }
  });

  it('A) dice en qué queda la quincena y que el comprobante pasa a ser la versión 2', async () => {
    await armar();
    dialogo.marcarDia(EL_DIA_OLVIDADO.recepcion_id, true);
    await asentar();

    const estado = leido(fixture.nativeElement.querySelector('.estado-que-queda'));
    expect(estado).toContain('parcial');
    expect(estado).toContain('versión 2');
  });

  // ==========================================================================
  // LAS CASILLAS: uno por uno, nunca "todo lo que esté suelto"
  // ==========================================================================
  it('los días sueltos van con casilla: el que no se marca NO entra', async () => {
    await armar();

    // Los dos aparecen con su fecha, sus litros y su valor…
    const sueltos = filasDe('.tabla-sueltos');
    expect(sueltos[0]).toEqual(['', 'Fecha', 'Litros', 'Precio/L', 'Valor']);
    expect(sueltos[1]).toEqual(['', '12/06/2026', '100 L', '$ 1.800', '$ 180.000']);

    // …pero solo entra el que se marca. Si "recogiera todo lo suelto", los $90.000 del
    // día 13 se le habrían pagado a Henri sin que el dueño los viera.
    dialogo.marcarDia(EL_DIA_OLVIDADO.recepcion_id, true);
    await asentar();

    const ultimo = servicio.avances[servicio.avances.length - 1];
    expect(ultimo.recepciones_a_incluir).toEqual([EL_DIA_OLVIDADO.recepcion_id]);
    expect(leerCuadre()['valor_total'].ahora).toBe('$ 680.000');
  });

  it('la casilla de verdad, la que se oprime, mueve la cifra grande', async () => {
    await armar();

    const casilla = fixture.nativeElement.querySelector(
      '.tabla-sueltos input[type="checkbox"]',
    ) as HTMLInputElement;
    casilla.click();
    await asentar();

    expect(leerCierres()[1].cifra).toBe('$ 180.000');
  });

  it('la nota del FLETE se muestra tal como la escribe el servidor: es el papel de otro', async () => {
    await armar();

    const notas = filasDe('.tabla-sueltos').map((fila) => fila.join(' '));
    expect(notas.some((fila) => fila.includes(EL_DIA_OLVIDADO.nota_flete!))).toBeTrue();
    // El día que no trae nota no inventa ninguna.
    expect(notas.filter((fila) => fila.includes('flete')).length).toBe(1);
  });

  // ==========================================================================
  // B) BAJA: el precio que estaba mal — las cifras del dueño
  // ==========================================================================
  it('B) el precio corregido baja el total a $400.000 y dice SE LE PAGÓ DE MÁS $100.000', async () => {
    await armar();

    // El día de 100 L estaba a $3.200 y era $2.200: el total baja $100.000.
    dialogo.editarPrecio(DIAS_QUE_YA_ESTAN[1]);
    dialogo.alEscribirPrecio('2.200');
    dialogo.aplicarPrecio(DIAS_QUE_YA_ESTAN[1]);
    await asentar();

    const cuadre = leerCuadre();
    expect(cuadre['valor_total']).toEqual({ antes: '$ 500.000', ahora: '$ 400.000' });
    expect(cuadre['pagado'].ahora).toBe('$ 500.000');

    const cierres = leerCierres();
    expect(cierres[1].rotulo).toBe('SE LE PAGÓ DE MÁS');
    expect(cierres[1].cifra).toBe('$ 100.000');
    // Y la cuenta cuadra en su dirección real: neto ($400.000) − entregado ($500.000).
    expect(centavos(cuadre['neto'].ahora) - centavos(cuadre['pagado'].ahora)).toBe(
      -centavos(cierres[1].cifra),
    );
  });

  it('B) muestra LA RESTA HECHA del precio tecleado, como la haría el dueño a mano', async () => {
    await armar();

    dialogo.editarPrecio(DIAS_QUE_YA_ESTAN[0]);
    dialogo.alEscribirPrecio('1.850');
    dialogo.aplicarPrecio(DIAS_QUE_YA_ESTAN[0]);
    await asentar();

    // 100 L × ($ 1.850 − $ 1.800) = + $ 5.000. Se lee y se comprueba multiplicando.
    expect(comoSeLee(dialogo.restaDelDia(DIAS_QUE_YA_ESTAN[0]))).toBe(
      '100 L × ($ 1.850 − $ 1.800) = + $ 5.000',
    );
    expect(filasDe('.tabla-dias').some((fila) => fila.join(' ').includes('= + $ 5.000'))).toBeTrue();
  });

  it('B) la resta va en NEGATIVO con el signo de resta cuando el precio baja', async () => {
    await armar();

    dialogo.editarPrecio(DIAS_QUE_YA_ESTAN[0]);
    dialogo.alEscribirPrecio('1.750');
    dialogo.aplicarPrecio(DIAS_QUE_YA_ESTAN[0]);
    await asentar();

    expect(comoSeLee(dialogo.restaDelDia(DIAS_QUE_YA_ESTAN[0]))).toBe(
      '100 L × ($ 1.750 − $ 1.800) = − $ 5.000',
    );
  });

  it('volver a poner el precio que ya tenía NO cuenta como corrección', async () => {
    await armar();

    dialogo.editarPrecio(DIAS_QUE_YA_ESTAN[0]);
    dialogo.alEscribirPrecio('1900');
    dialogo.aplicarPrecio(DIAS_QUE_YA_ESTAN[0]);
    await asentar();
    expect(dialogo.tienePrecioNuevo('d-1')).toBeTrue();

    dialogo.editarPrecio(DIAS_QUE_YA_ESTAN[0]);
    dialogo.alEscribirPrecio('1800');
    dialogo.aplicarPrecio(DIAS_QUE_YA_ESTAN[0]);
    await asentar();

    // Sin esto el comprobante subiría de versión por un día que quedó igual, y el
    // productor tendría dos papeles idénticos con números distintos de hoja.
    expect(dialogo.tienePrecioNuevo('d-1')).toBeFalse();
    expect(dialogo.sePuedeCorregir()).toBeFalse();
  });

  it('un precio que no se entiende no se manda: el campo se queda abierto y avisa', async () => {
    await armar();

    dialogo.editarPrecio(DIAS_QUE_YA_ESTAN[0]);
    dialogo.alEscribirPrecio('mil ochocientos');
    dialogo.aplicarPrecio(DIAS_QUE_YA_ESTAN[0]);
    await asentar();

    expect(dialogo.editandoId()).toBe('d-1');
    expect(dialogo.tienePrecioNuevo('d-1')).toBeFalse();
    expect(avisos.join(' ')).toContain('Escriba el precio por litro');
  });

  // ==========================================================================
  // EL MOTIVO, Y LO QUE SE MANDA
  // ==========================================================================
  it('sin motivo no se corrige: se avisa y no sale ninguna petición', async () => {
    await armar();
    dialogo.marcarDia(EL_DIA_OLVIDADO.recepcion_id, true);
    await asentar();

    await dialogo.corregir();

    expect(servicio.correcciones_hechas.length).toBe(0);
    expect(avisos.join(' ')).toContain('Escriba por qué se corrige');
  });

  it('sin nada marcado el botón no se ofrece y se dice qué le falta', async () => {
    await armar();

    expect(dialogo.sePuedeCorregir()).toBeFalse();
    expect(botonLlamado('Corregir la quincena')?.disabled).toBeTrue();
    expect(leido(fixture.nativeElement.querySelector('.falta'))).toContain(
      'Marque un día o corrija un precio',
    );
  });

  it('manda TODO EN UNA SOLA petición: los días marcados, los precios y el motivo', async () => {
    await armar();
    servicio.corregida = laQuincena({
      estado: 'parcial',
      valor_total: '680000',
      neto_a_pagar: '680000',
      saldo: '180000',
      version: 2,
    });

    dialogo.marcarDia(EL_DIA_OLVIDADO.recepcion_id, true);
    dialogo.editarPrecio(DIAS_QUE_YA_ESTAN[0]);
    dialogo.alEscribirPrecio('1850');
    dialogo.aplicarPrecio(DIAS_QUE_YA_ESTAN[0]);
    dialogo.form.controls.motivo.setValue('se le olvidó la leche del 12 de junio');
    await asentar();

    await dialogo.corregir();
    await asentar();

    // UNA sola petición: partirlas dejaría el comprobante a medio corregir entre las dos.
    expect(servicio.correcciones_hechas.length).toBe(1);
    expect(servicio.correcciones_hechas[0]).toEqual({
      motivo: 'se le olvidó la leche del 12 de junio',
      recepciones_a_incluir: ['r-12'],
      precios: [{ detalle_id: 'd-1', precio_litro: 1850 }],
      // Los adelantos van en el mismo sobre, y vacíos cuando no se tocó ninguno: esta
      // corrección no mueve un peso de lo que ya se le había adelantado.
      anticipos_a_incluir: [],
      anticipos_a_soltar: [],
      valores_de_anticipos: [],
      anticipos_a_borrar: [],
    });
    // Y se devuelve LA LIQUIDACIÓN QUE RESPONDIÓ EL SERVIDOR, no una calculada acá.
    expect(cerradoCon).toEqual([servicio.corregida]);
  });

  it('si la corrección falla, el diálogo NO se cierra: lo tecleado se queda', async () => {
    await armar();
    servicio.fallaAlCorregir = { status: 500 };

    dialogo.marcarDia(EL_DIA_OLVIDADO.recepcion_id, true);
    dialogo.form.controls.motivo.setValue('se le olvidó un día');
    await asentar();

    await dialogo.corregir();
    await asentar();

    expect(cerradoCon).toEqual([]);
    expect(dialogo.estaMarcado('r-12')).toBeTrue();
  });

  // ==========================================================================
  // LO QUE EL SERVIDOR AVISA
  // ==========================================================================
  it('los avisos del servidor se muestran TAL CUAL, antes de confirmar', async () => {
    const advertencia =
      'Se le pagó de más. Esa plata ya salió de la caja en efectivo y se recupera ' +
      'descontándola de la quincena siguiente, igual que un anticipo';
    await armar();
    servicio.avisos = [advertencia];

    dialogo.marcarDia(EL_DIA_OLVIDADO.recepcion_id, true);
    await asentar();

    const enPantalla = Array.from(
      fixture.nativeElement.querySelectorAll('.aviso-servidor'),
    ).map((p) => leido(p as Element));
    expect(enPantalla.join(' | ')).toContain(advertencia);
  });

  it('si el servidor no deja corregir esta quincena, se dice por qué y no se ofrece nada', async () => {
    // Es como responde el servidor cuando la deuda de esta quincena ya se cobró en otra:
    // ahí la ventana está cerrada y no se abre ni para el Administrador Empresa.
    const rebote = 'No se puede corregir esta liquidación: ya se le cobró en la del 16/06/2026';
    await armar(laQuincena(), (falso) => {
      falso.fallaAlPrevisualizar = comoRebotaElServidor(rebote);
    });

    expect(comoSeLee(dialogo.errorAlAbrir())).toContain(rebote);
    expect(leido(fixture.nativeElement.querySelector('.no-se-puede'))).toContain(rebote);
    // Y no se ofrece ni una casilla ni el botón: prometer algo que el servidor va a negar
    // sobre una quincena pagada es peor que no ofrecer nada.
    expect(fixture.nativeElement.querySelector('.cuadre')).toBeNull();
    expect(dialogo.sePuedeCorregir()).toBeFalse();
    expect(botonLlamado('Corregir la quincena')?.disabled).toBeTrue();
  });

  it('si se cae un avance posterior, se avisa que las cifras en pantalla quedaron viejas', async () => {
    await armar();
    // El primero pasó (hay cuadre en pantalla); el siguiente se cae.
    servicio.fallaAlPrevisualizar = { status: 0 };

    dialogo.marcarDia(EL_DIA_OLVIDADO.recepcion_id, true);
    await asentar();

    // El candado de arriba NO aparece: esta quincena sí se puede corregir, lo que falló
    // fue una consulta. Lo que no se puede es dejar las cifras viejas pareciendo frescas.
    expect(dialogo.errorAlAbrir()).toBeNull();
    expect(leido(fixture.nativeElement.querySelector('.aviso-servidor.error'))).toContain(
      'pueden estar viejas',
    );
  });

  // ==========================================================================
  // LA QUINCENA CON ANTICIPOS Y DEUDA VIEJA: la columna tiene que seguir cuadrando
  // ==========================================================================
  it('con anticipos y deuda vieja, la columna sigue sumando exacto la cifra grande', async () => {
    // $500.000 de leche, $120.000 de anticipos, $30.000 que venía debiendo: el neto es
    // $350.000 y se le entregaron $350.000. Entra el día olvidado de $180.000.
    await armar(
      laQuincena({
        anticipos: '120000',
        saldo_anterior: '30000',
        neto_a_pagar: '350000',
        pagado: '350000',
        saldo: '0',
      }),
    );

    dialogo.marcarDia(EL_DIA_OLVIDADO.recepcion_id, true);
    await asentar();

    const cuadre = leerCuadre();
    const cierre = leerCierres()[1];
    expect(cuadre['anticipos'].ahora).toBe('$ 120.000');
    expect(cuadre['saldo_anterior'].ahora).toBe('$ 30.000');
    expect(cuadre['neto'].ahora).toBe('$ 530.000');

    const cuenta =
      centavos(cuadre['valor_total'].ahora) -
      centavos(cuadre['anticipos'].ahora) -
      centavos(cuadre['saldo_anterior'].ahora);
    expect(cuenta).toBe(centavos(cuadre['neto'].ahora));
    expect(cuenta - centavos(cuadre['pagado'].ahora)).toBe(centavos(cierre.cifra));
    expect(cierre.rotulo).toBe('QUEDA POR ENTREGARLE');
  });

  // ==========================================================================
  // LOS ADELANTOS: plata que YA SE LE ENTREGÓ EN LA MANO
  // ==========================================================================
  /**
   * Lo pidió el dueño: "cuando le dé corregir, que también me deje corregir los
   * anticipos; cuando ya se cerró, entonces toca corregir también los anticipos".
   *
   * LA QUINCENA DE ESTAS PRUEBAS: $500.000 de leche, $120.000 que ya se le habían
   * adelantado (el del 12, "el que le di para la droga"), neto $380.000 y esos $380.000
   * ya entregados. Y dos adelantos sueltos esperando: el del 10 por $40.000 y uno viejo
   * de diciembre por $30.000 que nunca se le descontó a nadie.
   *
   * LA CUENTA QUE MANDA SOBRE TODO, en las dos columnas:
   *   neto = valor total − adelantos − lo que venía debiendo,  y  neto = pagado + saldo.
   */
  const armarConAdelantos = (cifras: Partial<Liquidacion> = {}): Promise<void> =>
    armar(
      laQuincena({
        anticipos: '120000',
        neto_a_pagar: '380000',
        pagado: '380000',
        saldo: '0',
        ...cifras,
      }),
      (falso) => {
        falso.anticiposAplicados = [EL_ADELANTO_DE_LA_DROGA];
        falso.anticiposSueltos = [EL_ADELANTO_SUELTO, EL_ADELANTO_VIEJO];
      },
    );

  const botonConEtiqueta = (etiqueta: string): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector(`button[aria-label="${etiqueta}"]`);

  it('los adelantos descontados se leen con su fecha, su cifra y PARA QUÉ FUERON', async () => {
    await armarConAdelantos();

    const filas = filasDe('.tabla-anticipos');
    expect(filas[0]).toEqual(['Fecha', 'Para qué fue', 'Lo que se le adelantó', '']);
    // Las observaciones son con lo que el dueño reconoce cuál adelanto fue; sin ellas
    // tendría que adivinar entre dos cifras iguales de la misma semana.
    expect(filas[1].slice(0, 3)).toEqual([
      '12/06/2026',
      'el que le di para la droga',
      '$ 120.000',
    ]);
  });

  it('SACAR un adelanto sube lo que hay que entregarle, y dice que NO se borra', async () => {
    await armarConAdelantos();

    dialogo.sacarAnticipo(EL_ADELANTO_DE_LA_DROGA);
    await asentar();

    const cuadre = leerCuadre();
    // El renglón de los adelantos ya NO pinta la misma cifra en las dos columnas.
    expect(cuadre['anticipos']).toEqual({ antes: '$ 120.000', ahora: '$ 0' });
    expect(cuadre['valor_total']).toEqual({ antes: '$ 500.000', ahora: '$ 500.000' });
    expect(cuadre['neto']).toEqual({ antes: '$ 380.000', ahora: '$ 500.000' });

    const cierre = leerCierres()[1];
    expect(cierre.rotulo).toBe('QUEDA POR ENTREGARLE');
    expect(cierre.cifra).toBe('$ 120.000');

    // Y LA LÍNEA QUE LO EXPLICA, que es la mitad de esta función: el dueño tiene que
    // leer que esa plata no desaparece, que se le entregó en la mano, y que se le
    // descuenta en la quincena siguiente.
    const nota = comoSeLee(dialogo.notaDelAnticipo(EL_ADELANTO_DE_LA_DROGA));
    expect(nota).toContain('se le entregan $ 120.000 más ahora');
    expect(nota).toContain('se le descuenta en la quincena siguiente');
    expect(nota).toContain('No se borra');
    expect(filasDe('.tabla-anticipos').some((fila) => fila.join(' ').includes('No se borra')))
      .toBeTrue();
  });

  it('SACAR y devolver: el desglose suma exacto la cifra grande en las dos columnas', async () => {
    await armarConAdelantos();

    dialogo.sacarAnticipo(EL_ADELANTO_DE_LA_DROGA);
    await asentar();

    const cuadre = leerCuadre();
    const cierres = leerCierres();
    for (const [columna, cierre] of [
      ['antes', cierres[0]],
      ['ahora', cierres[1]],
    ] as const) {
      const cuenta =
        centavos(cuadre['valor_total'][columna]) - centavos(cuadre['anticipos'][columna]);
      expect(cuenta).toBe(centavos(cuadre['neto'][columna]));
      expect(cuenta - centavos(cuadre['pagado'][columna])).toBe(centavos(cierre.cifra));
    }

    // Y se puede volver atrás: la quincena queda otra vez como estaba.
    dialogo.devolverAnticipo(EL_ADELANTO_DE_LA_DROGA.anticipo_id);
    await asentar();
    expect(dialogo.estaSacado(EL_ADELANTO_DE_LA_DROGA.anticipo_id)).toBeFalse();
    expect(leerCuadre()['anticipos'].ahora).toBe('$ 120.000');
    expect(dialogo.sePuedeCorregir()).toBeFalse();
  });

  it('el botón de verdad, el que se oprime, saca el adelanto y mueve la cifra grande', async () => {
    await armarConAdelantos();

    botonConEtiqueta('Sacar este adelanto de esta quincena')!.click();
    await asentar();

    expect(leerCierres()[1].cifra).toBe('$ 120.000');
    expect(fixture.nativeElement.querySelector('.tabla-anticipos tr.sacado')).not.toBeNull();
  });

  it('MARCAR un adelanto suelto baja lo que hay que entregarle', async () => {
    await armarConAdelantos();

    // Los dos sueltos se ofrecen con su casilla, pero solo entra el que se marca.
    const sueltos = filasDe('.tabla-anticipos-sueltos');
    expect(sueltos[0]).toEqual(['', 'Fecha', 'Para qué fue', 'Lo que se le adelantó']);
    expect(sueltos[1]).toEqual(['', '10/06/2026', 'para el mercado', '$ 40.000']);

    const casilla = fixture.nativeElement.querySelector(
      '.tabla-anticipos-sueltos input[type="checkbox"]',
    ) as HTMLInputElement;
    casilla.click();
    await asentar();

    const cuadre = leerCuadre();
    expect(cuadre['anticipos']).toEqual({ antes: '$ 120.000', ahora: '$ 160.000' });
    expect(cuadre['neto'].ahora).toBe('$ 340.000');
    // Se le entregaron $380.000 contra un neto de $340.000: se le pagó de más $40.000.
    const cierre = leerCierres()[1];
    expect(cierre.rotulo).toBe('SE LE PAGÓ DE MÁS');
    expect(cierre.cifra).toBe('$ 40.000');
    expect(comoSeLee(dialogo.notaDelAnticipoSuelto(EL_ADELANTO_SUELTO))).toContain(
      'se le entregan $ 40.000 menos',
    );

    // Y el que no se marcó no entró: los $30.000 viejos se quedaron esperando.
    const ultimo = servicio.avances[servicio.avances.length - 1];
    expect(ultimo.anticipos_a_incluir).toEqual([EL_ADELANTO_SUELTO.anticipo_id]);
  });

  it('el adelanto VIEJO sale señalado: es de antes del período y nunca se descontó', async () => {
    await armarConAdelantos();

    const senalado = leido(
      fixture.nativeElement.querySelector('.tabla-anticipos-sueltos tr.nota.senalada'),
    );
    expect(senalado).toContain(EL_ADELANTO_VIEJO.aviso!);
    // El del período, que no trae aviso, no inventa ninguno.
    expect(fixture.nativeElement.querySelectorAll('.tabla-anticipos-sueltos tr.senalada').length)
      .toBe(1);
  });

  it('CORREGIR la cifra de un adelanto: la nota dice cuánto más se le entrega', async () => {
    await armarConAdelantos();

    // Se le habían anotado $120.000 y fueron $100.000.
    dialogo.editarValor(EL_ADELANTO_DE_LA_DROGA);
    dialogo.alEscribirValor('100.000');
    dialogo.aplicarValor(EL_ADELANTO_DE_LA_DROGA);
    await asentar();

    expect(dialogo.tieneValorNuevo('a-12')).toBeTrue();
    expect(comoSeLee(dialogo.notaDelAnticipo(EL_ADELANTO_DE_LA_DROGA))).toBe(
      'Estaba anotado por $ 120.000 y se le adelantaron $ 100.000: se le entregan ' +
        '$ 20.000 más en esta quincena',
    );

    const cuadre = leerCuadre();
    expect(cuadre['anticipos']).toEqual({ antes: '$ 120.000', ahora: '$ 100.000' });
    expect(cuadre['neto'].ahora).toBe('$ 400.000');
    expect(leerCierres()[1].cifra).toBe('$ 20.000');

    const ultimo = servicio.avances[servicio.avances.length - 1];
    expect(ultimo.valores_de_anticipos).toEqual([{ anticipo_id: 'a-12', valor: 100000 }]);
  });

  it('volver a escribir la misma cifra del adelanto NO cuenta como corrección', async () => {
    await armarConAdelantos();

    dialogo.editarValor(EL_ADELANTO_DE_LA_DROGA);
    dialogo.alEscribirValor('100000');
    dialogo.aplicarValor(EL_ADELANTO_DE_LA_DROGA);
    await asentar();
    expect(dialogo.tieneValorNuevo('a-12')).toBeTrue();

    dialogo.editarValor(EL_ADELANTO_DE_LA_DROGA);
    dialogo.alEscribirValor('120000');
    dialogo.aplicarValor(EL_ADELANTO_DE_LA_DROGA);
    await asentar();

    // Sin esto el comprobante subiría de versión por un adelanto que quedó igual, y el
    // productor tendría dos papeles con números distintos de hoja y la misma cifra.
    expect(dialogo.tieneValorNuevo('a-12')).toBeFalse();
    expect(dialogo.sePuedeCorregir()).toBeFalse();
  });

  it('una cifra que no se entiende no se manda: el campo se queda abierto y avisa', async () => {
    await armarConAdelantos();

    dialogo.editarValor(EL_ADELANTO_DE_LA_DROGA);
    dialogo.alEscribirValor('como cien mil');
    dialogo.aplicarValor(EL_ADELANTO_DE_LA_DROGA);
    await asentar();

    expect(dialogo.editandoAnticipoId()).toBe('a-12');
    expect(dialogo.tieneValorNuevo('a-12')).toBeFalse();
    expect(avisos.join(' ')).toContain('Escriba en pesos lo que se le adelantó');
  });

  it('sacar un adelanto al que se le había corregido la cifra NO manda las dos cosas', async () => {
    await armarConAdelantos();

    dialogo.editarValor(EL_ADELANTO_DE_LA_DROGA);
    dialogo.alEscribirValor('100000');
    dialogo.aplicarValor(EL_ADELANTO_DE_LA_DROGA);
    await asentar();

    dialogo.sacarAnticipo(EL_ADELANTO_DE_LA_DROGA);
    await asentar();

    // El servidor rebota corregirle la cifra a un adelanto que se está sacando —se va a
    // descontar en OTRA quincena—, y ese rebote llegaría DESPUÉS de oprimir el botón,
    // encima de una quincena pagada. Ese sobre no se puede ni armar.
    const ultimo = servicio.avances[servicio.avances.length - 1];
    expect(ultimo.anticipos_a_soltar).toEqual(['a-12']);
    expect(ultimo.valores_de_anticipos).toEqual([]);
    expect(dialogo.tieneValorNuevo('a-12')).toBeFalse();
    // Y la cifra vuelve a ser la que estaba anotada, que es la que sale de la quincena.
    expect(leerCuadre()['anticipos'].ahora).toBe('$ 0');
  });

  it('mover SOLO un adelanto ya es algo que corregir: el botón se ofrece', async () => {
    await armarConAdelantos();

    // Sin nada tocado el botón está apagado y se dice qué le falta, nombrando también
    // los adelantos: un botón muerto sin razón es lo que hace que el dueño llame.
    expect(dialogo.sePuedeCorregir()).toBeFalse();
    expect(leido(fixture.nativeElement.querySelector('.falta'))).toContain('mueva un adelanto');

    dialogo.sacarAnticipo(EL_ADELANTO_DE_LA_DROGA);
    await asentar();

    expect(dialogo.sePuedeCorregir()).toBeTrue();
    expect(botonLlamado('Corregir la quincena')?.disabled).toBeFalse();
  });

  it('manda los adelantos en el MISMO sobre que los días y los precios', async () => {
    await armarConAdelantos();
    servicio.corregida = laQuincena({ version: 2 });

    dialogo.marcarDia(EL_DIA_OLVIDADO.recepcion_id, true);
    dialogo.incluirAnticipo(EL_ADELANTO_SUELTO.anticipo_id, true);
    dialogo.sacarAnticipo(EL_ADELANTO_DE_LA_DROGA);
    dialogo.form.controls.motivo.setValue('el adelanto del 12 no iba en esta quincena');
    await asentar();

    await dialogo.corregir();
    await asentar();

    // UNA sola petición: partirla dejaría el comprobante a medio corregir entre las dos,
    // con un saldo intermedio que nunca existió.
    expect(servicio.correcciones_hechas.length).toBe(1);
    expect(servicio.correcciones_hechas[0]).toEqual({
      motivo: 'el adelanto del 12 no iba en esta quincena',
      recepciones_a_incluir: ['r-12'],
      precios: [],
      anticipos_a_incluir: ['a-20'],
      anticipos_a_soltar: ['a-12'],
      valores_de_anticipos: [],
      anticipos_a_borrar: [],
    });
    expect(cerradoCon).toEqual([servicio.corregida]);
  });

  it('sin adelantos, las dos listas lo dicen en vez de quedar vacías sin explicación', async () => {
    await armar();

    const vacios = Array.from(fixture.nativeElement.querySelectorAll('.vacio')).map((p) =>
      leido(p as Element),
    );
    expect(vacios.join(' | ')).toContain('no se le descontó ningún adelanto');
    expect(vacios.join(' | ')).toContain('No hay adelantos sueltos');
    // Y el renglón de los adelantos no se pinta: un "$ 0" en una columna que se suma a
    // mano es ruido que hace perder el hilo.
    expect(leerCuadre()['anticipos']).toBeUndefined();
  });

  // ==========================================================================
  // ANULAR UN ADELANTO QUE NUNCA EXISTIÓ — la cuarta operación
  // ==========================================================================
  /**
   * POR QUÉ EXISTE, con el caso medido. Al SACAR un adelanto, el comprobante v2 que el
   * productor tiene en la mano imprime "se le descuenta en la siguiente", y por eso la
   * pantalla de Anticipos lo traba: allá no quedaría ni motivo ni versión nueva. Eso
   * abría un callejón sin salida: si el adelanto NUNCA EXISTIÓ —se digitó dos veces, o
   * se le anotó al productor equivocado— y el productor dejó de entregar leche, no había
   * NINGUNA pantalla donde borrarlo, y ese fantasma de $300.000 se le iba a descontar de
   * plata que SÍ es suya.
   *
   * Y LO QUE ESTAS PRUEBAS CUIDAN POR ENCIMA DE LA MECÁNICA: que SACAR y ANULAR no se
   * confundan. Sacar dice "no iba aquí" y la plata sigue viva; anular dice "no pasó" y se
   * borra. Confundirlas cuesta plata en las dos direcciones, y en el cuadre se ven igual
   * —las dos suben lo que hay que entregarle—: lo único que las separa es lo que dice la
   * pantalla.
   */
  const armarConFantasma = (): Promise<void> =>
    armar(
      laQuincena({
        anticipos: '120000',
        neto_a_pagar: '380000',
        pagado: '380000',
        saldo: '0',
      }),
      (falso) => {
        falso.anticiposAplicados = [EL_ADELANTO_DE_LA_DROGA];
        falso.anticiposSueltos = [];
        falso.anticiposSoltadosPorEsta = [EL_ADELANTO_FANTASMA];
      },
    );

  /** Anular pide confirmación: esta es la respuesta del dueño a esa pregunta. */
  const elDuenoResponde = (respuesta: boolean): jasmine.Spy =>
    spyOn(window, 'confirm').and.returnValue(respuesta);

  it('los que ESTA quincena sacó salen en su propia lista, con el aviso del servidor tal cual', async () => {
    await armarConFantasma();

    const filas = filasDe('.tabla-anticipos-soltados');
    expect(filas[0]).toEqual(['Fecha', 'Para qué fue', 'Lo que se le adelantó', '']);
    // Con su fecha, PARA QUÉ FUE y la cifra: es con eso —y no con el id— que el dueño
    // reconoce cuál adelanto fue.
    expect(filas[1].slice(0, 3)).toEqual(['08/06/2026', 'se digitó dos veces', '$ 300.000']);

    // Y el aviso del servidor SIN TRADUCIR: dice que el comprobante promete descontarlo
    // en la siguiente, y que esta es la única pantalla que lo puede anular.
    const senalado = leido(
      fixture.nativeElement.querySelector('.tabla-anticipos-soltados tr.nota.senalada'),
    );
    expect(senalado).toContain(EL_ADELANTO_FANTASMA.aviso!);

    // El título es el del dueño, no el del backend.
    const titulos = Array.from(fixture.nativeElement.querySelectorAll('h3')).map((h) =>
      leido(h as Element),
    );
    expect(titulos).toContain('Adelantos que esta quincena sacó');
  });

  it('la pantalla DICE la diferencia entre sacar y anular, que es la que decide si esa plata se descuenta', async () => {
    await armarConFantasma();

    const frases = Array.from(fixture.nativeElement.querySelectorAll('.distincion')).map((p) =>
      leido(p as Element),
    );
    expect(frases.length).toBeGreaterThan(0);
    const dicho = frases.join(' | ');
    expect(dicho).toContain('no iba aquí');
    expect(dicho).toContain('se le descuenta en la quincena siguiente');
    expect(dicho).toContain('ese adelanto no existió');
    expect(dicho).toContain('no se le descuenta en ninguna');
    // Y en las palabras del dueño: nada de "borrado lógico" ni "desvincular".
    expect(dicho.toLowerCase()).not.toContain('desvincular');
    expect(dicho.toLowerCase()).not.toContain('lógico');
  });

  it('ANULAR pregunta antes, y la pregunta dice la diferencia con SACAR', async () => {
    await armarConFantasma();
    const pregunta = elDuenoResponde(true);

    dialogo.anularAnticipo(EL_ADELANTO_FANTASMA);
    await asentar();

    expect(pregunta).toHaveBeenCalled();
    const texto = comoSeLee(pregunta.calls.mostRecent().args[0] as string);
    expect(texto).toContain('$ 300.000');
    expect(texto).toContain('ANULAR no es lo mismo que SACAR');
    expect(texto).toContain('esa plata sí se le entregó y se le descuenta en la siguiente');
    expect(texto).toContain('no se le descuenta en ninguna quincena');
    expect(texto).toContain('NUNCA se le entregó');
  });

  it('si el dueño dice que NO a la pregunta, no se anula nada y no sale ni un avance', async () => {
    await armarConFantasma();
    elDuenoResponde(false);
    const avancesAntes = servicio.avances.length;

    dialogo.anularAnticipo(EL_ADELANTO_FANTASMA);
    await asentar();

    expect(dialogo.estaAnulado('a-77')).toBeFalse();
    expect(servicio.avances.length).toBe(avancesAntes);
    expect(dialogo.sePuedeCorregir()).toBeFalse();
  });

  it('anular uno que esta quincena YA SACÓ: la cuenta no cambia, y la línea dice por qué', async () => {
    await armarConFantasma();
    elDuenoResponde(true);

    dialogo.anularAnticipo(EL_ADELANTO_FANTASMA);
    await asentar();

    // LA LÍNEA EXPLICATIVA, en las palabras del dueño.
    const nota = comoSeLee(dialogo.notaDeAnulado(EL_ADELANTO_FANTASMA));
    expect(nota).toContain('Se anula: ese adelanto no existió y no se le descuenta en ninguna quincena');
    expect(nota).toContain('ya no se le descuentan esos $ 300.000 en la quincena siguiente');
    // Y se lee en la tabla, no solo en el método.
    expect(
      filasDe('.tabla-anticipos-soltados').some((fila) =>
        fila.join(' ').includes('Se anula: ese adelanto no existió'),
      ),
    ).toBeTrue();

    // ESTA quincena no se mueve —ese adelanto ya había salido de ella—, y decirlo es la
    // mitad de la función: si no, el dueño busca en el cuadre un cambio que no está.
    const cuadre = leerCuadre();
    expect(cuadre['anticipos']).toEqual({ antes: '$ 120.000', ahora: '$ 120.000' });
    expect(leerCierres()[1].cifra).toBe('$ 0');

    // Pero SÍ hay algo que corregir, y viaja en el sobre.
    expect(dialogo.sePuedeCorregir()).toBeTrue();
    const ultimo = servicio.avances[servicio.avances.length - 1];
    expect(ultimo.anticipos_a_borrar).toEqual(['a-77']);
  });

  it('anular uno que HOY está descontado sube lo que hay que entregarle, y la línea lo dice', async () => {
    await armarConFantasma();
    elDuenoResponde(true);

    dialogo.anularAnticipo(EL_ADELANTO_DE_LA_DROGA);
    await asentar();

    // EL CUADRE SALE DE LA PREVISUALIZACIÓN: acá no se calcula ni un peso.
    const cuadre = leerCuadre();
    expect(cuadre['anticipos']).toEqual({ antes: '$ 120.000', ahora: '$ 0' });
    expect(cuadre['neto']).toEqual({ antes: '$ 380.000', ahora: '$ 500.000' });
    const cierre = leerCierres()[1];
    expect(cierre.rotulo).toBe('QUEDA POR ENTREGARLE');
    expect(cierre.cifra).toBe('$ 120.000');

    // Y LA LÍNEA TIENE QUE DECIR POR QUÉ SUBE: en el cuadre, anular y sacar se ven
    // IGUAL —las dos cifras son las mismas—, así que lo único que las separa es esto.
    const nota = comoSeLee(dialogo.notaDelAnticipo(EL_ADELANTO_DE_LA_DROGA));
    expect(nota).toContain('Se anula: ese adelanto no existió y no se le descuenta en ninguna quincena');
    expect(nota).toContain('por eso sube lo que hay que entregarle');
    expect(nota).toContain('se le entregan $ 120.000 más');
    // Y NO dice lo de sacar: que esa plata se le descuenta en la siguiente. Sería falso.
    expect(nota).not.toContain('quincena siguiente');

    const ultimo = servicio.avances[servicio.avances.length - 1];
    expect(ultimo.anticipos_a_borrar).toEqual(['a-12']);
    expect(ultimo.anticipos_a_soltar).toEqual([]);
  });

  it('anular y sacar SON DISTINTOS: el desglose suma exacto, y se puede volver atrás', async () => {
    await armarConFantasma();
    elDuenoResponde(true);

    dialogo.anularAnticipo(EL_ADELANTO_DE_LA_DROGA);
    await asentar();

    // LA REGLA DE LA CASA: las dos columnas suman exacto la cifra grande.
    const cuadre = leerCuadre();
    const cierres = leerCierres();
    for (const [columna, cierre] of [
      ['antes', cierres[0]],
      ['ahora', cierres[1]],
    ] as const) {
      const cuenta =
        centavos(cuadre['valor_total'][columna]) - centavos(cuadre['anticipos'][columna]);
      expect(cuenta).toBe(centavos(cuadre['neto'][columna]));
      expect(cuenta - centavos(cuadre['pagado'][columna])).toBe(centavos(cierre.cifra));
    }
    // El renglón se ve tachado, y distinto del que solo sale.
    expect(fixture.nativeElement.querySelector('.tabla-anticipos tr.anulado')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tabla-anticipos tr.sacado')).toBeNull();

    // Y se puede deshacer: la quincena queda otra vez como estaba.
    dialogo.desanularAnticipo('a-12');
    await asentar();
    expect(dialogo.estaAnulado('a-12')).toBeFalse();
    expect(leerCuadre()['anticipos'].ahora).toBe('$ 120.000');
    expect(dialogo.sePuedeCorregir()).toBeFalse();
  });

  it('anular un adelanto que estaba SACADO no manda las dos cosas sobre el mismo', async () => {
    await armarConFantasma();
    elDuenoResponde(true);

    dialogo.sacarAnticipo(EL_ADELANTO_DE_LA_DROGA);
    await asentar();
    dialogo.anularAnticipo(EL_ADELANTO_DE_LA_DROGA);
    await asentar();

    // El servidor rebota anular y a la vez sacar el mismo adelanto —el resultado
    // dependería del orden—, y ese rebote llegaría DESPUÉS de oprimir el botón, encima
    // de una quincena pagada. Ese sobre no se puede ni armar.
    const ultimo = servicio.avances[servicio.avances.length - 1];
    expect(ultimo.anticipos_a_borrar).toEqual(['a-12']);
    expect(ultimo.anticipos_a_soltar).toEqual([]);
    expect(dialogo.estaSacado('a-12')).toBeFalse();
    // Y lo que se lee es lo de anular, que es lo que va a pasar.
    expect(comoSeLee(dialogo.notaDelAnticipo(EL_ADELANTO_DE_LA_DROGA))).toContain(
      'ese adelanto no existió',
    );
  });

  it('anular un adelanto al que le habían corregido la cifra le quita el valor nuevo', async () => {
    await armarConFantasma();
    elDuenoResponde(true);

    dialogo.editarValor(EL_ADELANTO_DE_LA_DROGA);
    dialogo.alEscribirValor('100000');
    dialogo.aplicarValor(EL_ADELANTO_DE_LA_DROGA);
    await asentar();
    expect(dialogo.tieneValorNuevo('a-12')).toBeTrue();

    dialogo.anularAnticipo(EL_ADELANTO_DE_LA_DROGA);
    await asentar();

    // Corregirle la cifra a un adelanto que se va a borrar no significaría nada.
    expect(dialogo.tieneValorNuevo('a-12')).toBeFalse();
    const ultimo = servicio.avances[servicio.avances.length - 1];
    expect(ultimo.valores_de_anticipos).toEqual([]);
    expect(ultimo.anticipos_a_borrar).toEqual(['a-12']);
  });

  it('el botón de verdad, el que se oprime, anula y mueve la cifra grande', async () => {
    await armarConFantasma();
    elDuenoResponde(true);

    const botones = Array.from(
      fixture.nativeElement.querySelectorAll(
        'button[aria-label="Anular este adelanto: nunca existió"]',
      ),
    ) as HTMLButtonElement[];
    // Uno en los que se descontaron y otro en los que esta quincena sacó: el dueño puede
    // anular en los dos sitios, y en el backend son los dos únicos que puede borrar.
    expect(botones.length).toBe(2);

    botones[0].click();
    await asentar();

    expect(leerCierres()[1].cifra).toBe('$ 120.000');
    expect(fixture.nativeElement.querySelector('.tabla-anticipos tr.anulado')).not.toBeNull();
  });

  it('anular SOLO eso ya es algo que corregir, y el letrero del candado lo menciona', async () => {
    await armarConFantasma();
    elDuenoResponde(true);

    // Sin nada tocado el botón está apagado, y el letrero nombra también anular: un
    // botón muerto sin razón es lo que hace que el dueño llame a preguntar.
    expect(dialogo.sePuedeCorregir()).toBeFalse();
    const candado = leido(fixture.nativeElement.querySelector('.falta'));
    expect(candado).toContain('mueva un adelanto');
    expect(candado).toContain('anule uno que no existió');

    dialogo.anularAnticipo(EL_ADELANTO_FANTASMA);
    await asentar();

    expect(dialogo.sePuedeCorregir()).toBeTrue();
    expect(botonLlamado('Corregir la quincena')?.disabled).toBeFalse();
  });

  it('los anulados viajan en el MISMO sobre que todo lo demás, en una sola petición', async () => {
    await armarConFantasma();
    elDuenoResponde(true);
    servicio.corregida = laQuincena({ version: 2 });

    dialogo.marcarDia(EL_DIA_OLVIDADO.recepcion_id, true);
    dialogo.anularAnticipo(EL_ADELANTO_FANTASMA);
    dialogo.form.controls.motivo.setValue('ese adelanto se digitó dos veces: nunca existió');
    await asentar();

    await dialogo.corregir();
    await asentar();

    expect(servicio.correcciones_hechas.length).toBe(1);
    expect(servicio.correcciones_hechas[0]).toEqual({
      motivo: 'ese adelanto se digitó dos veces: nunca existió',
      recepciones_a_incluir: ['r-12'],
      precios: [],
      anticipos_a_incluir: [],
      anticipos_a_soltar: [],
      valores_de_anticipos: [],
      anticipos_a_borrar: ['a-77'],
    });
    expect(cerradoCon).toEqual([servicio.corregida]);
  });

  it('la quincena que nunca sacó un adelanto no muestra esa lista: no tendría qué anular', async () => {
    await armarConAdelantos();

    // A diferencia de las otras dos, esta no se pinta vacía: ponerle delante al dueño una
    // sección que no puede entender —y con el único botón que borra plata— justo cuando
    // no tiene nada que hacer con ella es peor que no mostrarla.
    expect(fixture.nativeElement.querySelector('.tabla-anticipos-soltados')).toBeNull();
    const titulos = Array.from(fixture.nativeElement.querySelectorAll('h3')).map((h) =>
      leido(h as Element),
    );
    expect(titulos).not.toContain('Adelantos que esta quincena sacó');
    // Pero el botón de anular sigue estando donde sí hace falta: en los que se le
    // descontaron, que el backend también deja borrar.
    expect(
      fixture.nativeElement.querySelector(
        '.tabla-anticipos button[aria-label="Anular este adelanto: nunca existió"]',
      ),
    ).not.toBeNull();
  });
});

// ============================================================================
// LA PUERTA: el botón en el detalle, y la banda del comprobante corregido
// ============================================================================
/**
 * El detalle es el único sitio desde donde se corrige, así que su botón —y el candado que
 * lo reemplaza cuando el servidor va a decir que no— son parte de esta función y no de
 * otra: sin ellos, lo de arriba es una pantalla a la que nadie puede llegar.
 */
class DetalleServicioFalso {
  liquidacion: Liquidacion = laQuincena();
  correccionesDe: Correccion[] = [];
  pedidosDeCorrecciones = 0;

  getById(): Observable<Liquidacion> {
    return of(this.liquidacion);
  }

  correcciones(): Observable<Correccion[]> {
    this.pedidosDeCorrecciones += 1;
    return of(this.correccionesDe);
  }
}

const LA_CORRECCION: Correccion = {
  id: 'c-1',
  version_nueva: 2,
  motivo: 'se le olvidó la leche del 12 de junio',
  corregido_por_nombre: 'Marleny',
  created_at: '2026-09-06T15:04:00Z',
  valor_total_antes: '500000',
  valor_total_despues: '680000',
  neto_antes: '500000',
  neto_despues: '680000',
  pagado_al_momento: '500000',
  saldo_antes: '0',
  saldo_despues: '180000',
  estado_antes: 'pagada',
  estado_despues: 'parcial',
  dias_agregados: [],
  precios_corregidos: [],
};

describe('LiquidacionDetailDialog: la puerta de la corrección', () => {
  let fixture: ComponentFixture<LiquidacionDetailDialog>;
  let servicio: DetalleServicioFalso;
  let abiertos: unknown[];

  const armar = async (
    item: Liquidacion,
    opciones: { permiso?: boolean; correcciones?: Correccion[] } = {},
  ): Promise<void> => {
    servicio = new DetalleServicioFalso();
    servicio.liquidacion = item;
    servicio.correccionesDe = opciones.correcciones ?? [];
    abiertos = [];

    await TestBed.configureTestingModule({
      imports: [LiquidacionDetailDialog, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { item } },
        { provide: LiquidacionesService, useValue: servicio },
        {
          provide: MatDialog,
          useValue: {
            open: (componente: unknown) => {
              abiertos.push(componente);
              return { afterClosed: () => of(null) };
            },
          },
        },
        {
          provide: AuthService,
          useValue: {
            hasPermission: () => opciones.permiso ?? true,
            perfil: () => null,
            esSuperadmin: () => false,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LiquidacionDetailDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const botonLlamado = (texto: string): HTMLButtonElement | null =>
    (Array.from(fixture.nativeElement.querySelectorAll('button')).find((boton) =>
      leido(boton as Element).includes(texto),
    ) as HTMLButtonElement | undefined) ?? null;

  const candados = (): string =>
    Array.from(fixture.nativeElement.querySelectorAll('.nota-recalcular'))
      .map((nota) => leido(nota as Element))
      .join(' | ');

  it('la quincena PAGADA de leche ofrece "Corregir esta quincena"', async () => {
    await armar(laQuincena());

    expect(fixture.componentInstance.puedeCorregir()).toBeTrue();
    expect(botonLlamado('Corregir esta quincena')).not.toBeNull();
    expect(candados()).not.toContain('No se puede corregir');
  });

  it('la PARCIAL también: se le abonó una parte y todavía se le puede meter un día', async () => {
    await armar(laQuincena({ estado: 'parcial', pagado: '300000', saldo: '200000' }));

    expect(fixture.componentInstance.puedeCorregir()).toBeTrue();
  });

  it('abre el diálogo de corregir, con ESTA liquidación', async () => {
    await armar(laQuincena());
    // Se espía el MatDialog QUE EL COMPONENTE TIENE INYECTADO, no uno provisto aparte:
    // así la prueba mide lo que de verdad se abre al oprimir, sin depender de por cuál
    // inyector resolvió Angular el servicio.
    const abridor = fixture.debugElement.injector.get(MatDialog);
    const espia = spyOn(abridor, 'open').and.returnValue({
      afterClosed: () => of(null),
    } as never);

    botonLlamado('Corregir esta quincena')!.click();

    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia.calls.mostRecent().args[0]).toBe(CorregirQuincenaDialog as never);
    const config = espia.calls.mostRecent().args[1] as { data: { liquidacion: Liquidacion } };
    expect(config.data.liquidacion.id).toBe('l-1');
  });

  it('con la deuda YA COBRADA en otra queda el candado, y NOMBRA la que hay que anular', async () => {
    await armar(
      laQuincena({
        estado: 'pagada',
        neto_a_pagar: '-4955.77',
        saldo: '-4955.77',
        le_queda_debiendo: '4955.77',
        pagado: '0',
        deuda_trasladada_a_id: 'l-otra',
        deuda_trasladada_a: {
          id: 'l-otra',
          periodo_inicio: '2026-06-16',
          periodo_fin: '2026-06-30',
          periodo_texto: '16/06/2026 al 30/06/2026',
        },
      }),
    );

    expect(fixture.componentInstance.puedeCorregir()).toBeFalse();
    expect(botonLlamado('Corregir esta quincena')).toBeNull();
    expect(candados()).toContain('No se puede corregir');
    const motivo = comoSeLee(fixture.componentInstance.motivoNoCorregir());
    expect(motivo).toContain('16/06/2026 al 30/06/2026');
  });

  it('la del FLETE no se corrige: se dice la salida que sí funciona', async () => {
    await armar(
      laQuincena({
        tipo: 'transportador',
        proveedor_id: null,
        proveedor_nombre: null,
        transportador_id: 't-1',
        transportador_nombre: 'Alex Agudelo',
      }),
    );

    expect(fixture.componentInstance.puedeCorregir()).toBeFalse();
    const motivo = comoSeLee(fixture.componentInstance.motivoNoCorregir());
    expect(motivo).toContain('Solo se puede corregir una quincena de leche');
    expect(motivo).toContain('segundo comprobante del período');
  });

  it('en BORRADOR no hay ni botón ni candado: esa se edita por el camino de siempre', async () => {
    await armar(laQuincena({ estado: 'borrador', pagado: '0', saldo: '500000' }));

    expect(botonLlamado('Corregir esta quincena')).toBeNull();
    expect(fixture.componentInstance.motivoNoCorregir()).toBeNull();
    expect(candados()).not.toContain('No se puede corregir');
  });

  // ------------------------------------------------ la banda del comprobante corregido
  it('sin corrección NO se pide el motivo ni sale banda, y el PDF se llama PDF', async () => {
    await armar(laQuincena());

    // La consulta de correcciones no se hace: en casi todos los comprobantes no hay
    // ninguna, y preguntar siempre sería una petición de más por cada uno que se abre.
    expect(servicio.pedidosDeCorrecciones).toBe(0);
    expect(fixture.nativeElement.querySelector('.banda-corregida')).toBeNull();
    expect(fixture.componentInstance.rotuloPdf()).toBe('PDF');
  });

  it('con versión 2 sale la banda con la fecha, la versión y el motivo', async () => {
    await armar(laQuincena({ version: 2, estado: 'parcial', saldo: '180000' }), {
      correcciones: [LA_CORRECCION],
    });

    expect(servicio.pedidosDeCorrecciones).toBe(1);
    const banda = leido(fixture.nativeElement.querySelector('.banda-corregida'));
    expect(banda).toContain('Corregido el 06/09/2026');
    expect(banda).toContain('v2');
    expect(banda).toContain('motivo: se le olvidó la leche del 12 de junio');
    // Y el papel viejo se nombra: es lo que hace que el dueño lo recoja.
    expect(banda).toContain('Henri Castaño');
  });

  it('el botón de PDF se rotula "comprobante corregido (v2)" cuando hay una corrección', async () => {
    await armar(laQuincena({ version: 2 }), { correcciones: [LA_CORRECCION] });

    expect(fixture.componentInstance.rotuloPdf()).toBe('Descargar comprobante corregido (v2)');
    expect(botonLlamado('Descargar comprobante corregido (v2)')).not.toBeNull();
  });

  it('si el motivo no llega, la banda sale igual: "hay una v2" ya es la mitad importante', async () => {
    await armar(laQuincena({ version: 2 }), { correcciones: [] });

    const banda = leido(fixture.nativeElement.querySelector('.banda-corregida'));
    expect(banda).toContain('Comprobante corregido');
    expect(banda).toContain('v2');
  });

  // ------------------------------------------------ la frase que antes mentía
  it('el sobrepago por corrección NO se le echa a los anticipos: no hubo ninguno', async () => {
    // $500.000 entregados contra una quincena corregida que quedó en $400.000. Antes esta
    // frase afirmaba "porque los anticipos que se le entregaron suman más que esta
    // quincena", y el dueño se iba a buscar unos anticipos que no existen.
    await armar(
      laQuincena({
        estado: 'parcial',
        version: 2,
        anticipos: '0',
        valor_total: '400000',
        neto_a_pagar: '400000',
        pagado: '500000',
        saldo: '-100000',
        le_queda_debiendo: '100000',
      }),
      { correcciones: [LA_CORRECCION] },
    );

    const motivo = comoSeLee(fixture.componentInstance.motivoNoPagar());
    expect(motivo).toContain('Henri Castaño quedó debiendo $ 100.000');
    expect(motivo).toContain('ya se le habían entregado $ 500.000');
    expect(motivo).toContain('la quincena, ya corregida, quedó en $ 400.000');
    expect(motivo).not.toContain('anticipos');
  });

  it('sin plata entregada, la frase de los anticipos se queda EXACTAMENTE como estaba', async () => {
    await armar(
      laQuincena({
        estado: 'aprobada',
        anticipos: '600000',
        valor_total: '500000',
        neto_a_pagar: '-100000',
        pagado: '0',
        saldo: '-100000',
        le_queda_debiendo: '100000',
      }),
    );

    const motivo = comoSeLee(fixture.componentInstance.motivoNoPagar());
    expect(motivo).toContain(
      'porque los anticipos que se le entregaron suman más que esta quincena',
    );
  });
});
