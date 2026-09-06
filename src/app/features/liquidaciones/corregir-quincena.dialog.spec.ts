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

    const totalAntes = Number(l.valor_total);
    const totalDespues = totalAntes + entran + diferencias;
    const descuentos = Number(l.anticipos ?? 0) + Number(l.saldo_anterior ?? 0);
    const netoAntes = totalAntes - descuentos;
    const netoDespues = totalDespues - descuentos;
    const pagado = Number(l.pagado ?? 0);
    const saldoAntes = netoAntes - pagado;
    const saldoDespues = netoDespues - pagado;

    return of({
      dias_sueltos: this.sueltos,
      valor_total_antes: String(totalAntes),
      valor_total_despues: String(totalDespues),
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
