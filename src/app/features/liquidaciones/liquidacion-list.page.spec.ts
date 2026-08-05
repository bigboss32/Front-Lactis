import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion, Page } from '../../core/models';
import { LiquidacionListPage } from './liquidacion-list.page';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * LA LISTA TIENE QUE DISTINGUIR DE UN VISTAZO A QUIÉN SE LE DEBE DE QUIÉN LE DEBE.
 *
 * La columna "Saldo" mostraba el negativo pelado: "-$ 4.955,77" bajo un rótulo que se
 * lee como "esto hay que pagarlo". Es la cifra al revés —esa plata la debe el tercero a
 * la quesera— y desde que se cobra en la quincena siguiente el dueño necesita ver tres
 * cosas sin abrir nada: quién quedó debiendo, si ya se le cobró, y cuáles liquidaciones
 * traen un descuento que no sale de sus propias recepciones.
 */

const liq = (cifras: Partial<Liquidacion>): Liquidacion => ({
  id: 'l-1',
  empresa_id: 'e-1',
  estado: 'aprobada',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  tipo: 'transportador',
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
  le_queda_debiendo: '0',
  observaciones: null,
  detalles: [],
  pagos: [],
  ...cifras,
});

/** El caso real: se le adelantó más de lo que produjo la quincena. */
const LE_QUEDO_DEBIENDO: Partial<Liquidacion> = {
  id: 'l-debe',
  transportador_nombre: 'Alex Agudelo',
  anticipos: '49462.09',
  neto_a_pagar: '-4955.77',
  saldo: '-4955.77',
  le_queda_debiendo: '4955.77',
};

/** Una normal, con plata por entregar. */
const POR_PAGAR: Partial<Liquidacion> = { id: 'l-paga', saldo: '120000' };

/**
 * LAS CIFRAS DEL CASO QUE REPORTÓ EL DUEÑO, para la tarjeta y el tablero.
 *
 * Henri quedó debiendo $120.000 (quincena de $180.000 contra $300.000 de anticipo ya
 * entregado) y a Alex hay que entregarle $130.000. Sumadas crudas dan $10.000, que es
 * lo que mostraba una de las dos pantallas; lo que el dueño pregunta es cuánta plata
 * tiene que SACAR, y eso son $130.000.
 */
const HENRI_QUEDO_DEBIENDO_120K: Partial<Liquidacion> = {
  id: 'l-henri-120',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Henri Castaño',
  transportador_id: null,
  transportador_nombre: null,
  valor_transporte: '0',
  valor_bruto: '180000',
  anticipos: '300000',
  valor_total: '180000',
  neto_a_pagar: '-120000',
  saldo: '-120000',
  le_queda_debiendo: '120000',
};

const A_ALEX_130K: Partial<Liquidacion> = {
  id: 'l-alex-130',
  valor_transporte: '130000',
  valor_total: '130000',
  neto_a_pagar: '130000',
  saldo: '130000',
};

class ServicioFalso {
  /** Lo que devuelve la lista principal; las tarjetas piden lo mismo filtrado. */
  filas: Liquidacion[] = [];

  list(params?: { estado?: string | null }): Observable<Page<Liquidacion>> {
    const items = params?.estado
      ? this.filas.filter((fila) => fila.estado === params.estado)
      : this.filas;
    return of({ items, total: items.length, page: 1, page_size: 20, pages: 1 });
  }
}

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

describe('LiquidacionListPage: quién debe y quién le debe', () => {
  let fixture: ComponentFixture<LiquidacionListPage>;
  let servicio: ServicioFalso;

  const armar = async (filas: Liquidacion[]): Promise<void> => {
    servicio = new ServicioFalso();
    servicio.filas = filas;
    await TestBed.configureTestingModule({
      imports: [LiquidacionListPage, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: LiquidacionesService, useValue: servicio },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LiquidacionListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** La celda de la columna Saldo de cada fila, como se lee. */
  const celdasDeSaldo = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('td[data-label="Saldo"]')).map((celda) =>
      comoSeLee((celda as HTMLElement).textContent),
    );

  /** Las tarjetas de arriba, como se leen. */
  const tarjetas = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.tarjeta')).map((tarjeta) =>
      comoSeLee((tarjeta as HTMLElement).textContent),
    );

  /** La tarjeta que habla de esto, como se lee (o '' si no está en pantalla). */
  const tarjetaCon = (texto: string): string =>
    tarjetas().find((tarjeta) => tarjeta.includes(texto)) ?? '';

  it('la que quedó debiendo se lee en POSITIVO y con su marca, no como un negativo', async () => {
    await armar([liq(LE_QUEDO_DEBIENDO)]);

    const celda = celdasDeSaldo()[0];
    // La cifra que muestran el detalle y el PDF, sin signo: "-$ 4.955,77" bajo "Saldo"
    // se lee como si hubiera que pagarlo.
    expect(celda).toContain('$ 4.956');
    expect(celda).not.toContain('-');
    expect(celda).toContain('quedó debiendo');
    // Y no se confunde con las que sí hay que pagar.
    expect(celda).not.toContain('por pagar');
  });

  it('la fila lleva su propio borde: se distingue sin leer la columna', async () => {
    await armar([liq(LE_QUEDO_DEBIENDO)]);

    const fila = fixture.nativeElement.querySelector('tr.mat-mdc-row') as HTMLElement;
    expect(fila.classList).toContain('fila-le-debe');
  });

  it('la marca dice si esa deuda está pendiente o si ya se cobró', async () => {
    await armar([
      liq(LE_QUEDO_DEBIENDO),
      liq({
        ...LE_QUEDO_DEBIENDO,
        id: 'l-cobrada',
        transportador_nombre: 'Henri Castaño',
        deuda_trasladada_a_id: 'l-julio',
      }),
    ]);

    const [pendiente, cobrada] = celdasDeSaldo();
    expect(pendiente).toContain('quedó debiendo');
    expect(pendiente).not.toContain('cobrada');
    // Son dos situaciones distintas: pendiente = la va a recoger la próxima
    // liquidación; cobrada = ya está descontada en otra y, si hay que anular esta,
    // primero hay que anular esa.
    expect(cobrada).toContain('quedó debiendo · cobrada');

    const pagina = fixture.componentInstance;
    expect(comoSeLee(pagina.tooltipLeQuedaDebiendo(liq(LE_QUEDO_DEBIENDO)))).toBe(
      'Alex Agudelo quedó debiendo $ 4.955,77: se le cobra en la próxima quincena que se le ' +
        'liquide después de esta',
    );
  });

  it('la que se COBRÓ una deuda vieja lo dice: si no, su saldo no cuadra en la lista', async () => {
    // En la lista se leen Valor total, Anticipos y Saldo. Con un saldo anterior de por
    // medio la resta no da, y el dueño no tiene de dónde sacar la diferencia.
    await armar([
      liq({
        id: 'l-cobra',
        proveedor_nombre: 'Henri Castaño',
        transportador_nombre: null,
        tipo: 'proveedor',
        valor_total: '144482.00',
        anticipos: '20000.10',
        saldo_anterior: '4955.77',
        neto_a_pagar: '119526.13',
        saldo: '119526.13',
      }),
    ]);

    const celda = celdasDeSaldo()[0];
    expect(celda).toContain('cobra lo anterior');
    expect(comoSeLee(fixture.componentInstance.tooltipSaldoAnterior(fixture.componentInstance.filas()[0]))).toBe(
      'En esta quincena se le cobraron $ 4.955,77 que Henri Castaño había quedado debiendo de una quincena pasada',
    );
  });

  it('una deuda del tercero NO baja el "en saldos" de las aprobadas', async () => {
    // La tarjeta dice "$X en saldos" y esa cifra es plata por SALIR. Sumado crudo, un
    // saldo de -$4.955,77 la bajaba: dos liquidaciones, una de $120.000 por pagar y una
    // deuda del tercero, mostraban menos plata por entregar de la que hay.
    await armar([liq(POR_PAGAR), liq(LE_QUEDO_DEBIENDO)]);

    expect(fixture.componentInstance.resumen()?.saldoAprobadas).toBe(120000);
  });

  it('la cadena se lee entera: cobró lo anterior Y volvió a quedar debiendo', async () => {
    // El caso de tres quincenas seguidas. Las dos marcas salen a la vez y ninguna puede
    // tapar a la otra: son las dos cosas que le pasaron a ese comprobante.
    await armar([
      liq({
        id: 'l-cadena',
        valor_transporte: '3000.00',
        valor_total: '3000.00',
        anticipos: '1000.00',
        saldo_anterior: '4955.77',
        neto_a_pagar: '-2955.77',
        saldo: '-2955.77',
        le_queda_debiendo: '2955.77',
      }),
    ]);

    const celda = celdasDeSaldo()[0];
    expect(celda).toContain('$ 2.956');
    expect(celda).toContain('quedó debiendo');
    expect(celda).toContain('cobra lo anterior');
    expect(celda).not.toContain('por pagar');
  });

  // ---------------------------------------------------------------------------
  // EL AVISO QUE MENTÍA. La marca prometía siempre "se le cobra en la próxima
  // liquidación que se le genere", sin mirar nada: lo prometía igual sobre una
  // liquidación ANULADA —de donde el servidor no le cobra la deuda a nadie— y no decía
  // DÓNDE se había cobrado cuando ya estaba cobrada. Ahora dice lo que va a pasar, y con
  // las palabras del servidor: la deuda se cobra en una quincena POSTERIOR a esta, y
  // viaja igual desde un borrador.
  // ---------------------------------------------------------------------------
  it('cuando ya se cobró, la marca nombra la liquidación que se la cobró, no la promesa', async () => {
    // Un id no le dice nada al dueño: lo que él necesita leer es el período, que es como
    // identifica un comprobante, y es lo que tiene que anular primero si quiere tocar
    // esta. El período viene YA ARMADO del backend (el mismo que imprime el PDF).
    await armar([
      liq({
        ...LE_QUEDO_DEBIENDO,
        deuda_trasladada_a_id: 'l-julio',
        deuda_trasladada_a: {
          id: 'l-julio',
          periodo_inicio: '2026-07-01',
          periodo_fin: '2026-07-15',
          periodo_texto: '01/07/2026 al 15/07/2026',
        },
      }),
    ]);

    expect(celdasDeSaldo()[0]).toContain('quedó debiendo · cobrada');
    const tooltip = comoSeLee(
      fixture.componentInstance.tooltipLeQuedaDebiendo(fixture.componentInstance.filas()[0]),
    );
    expect(tooltip).toBe(
      'Alex Agudelo quedó debiendo $ 4.955,77, y ya se le cobró en la liquidación del ' +
        '01/07/2026 al 15/07/2026',
    );
    // Y ya no promete nada: esa plata no la vuelve a cobrar nadie.
    expect(tooltip).not.toContain('próxima');
  });

  it('la ANULADA no promete nada: esa deuda no se le cobra en ninguna parte', async () => {
    // Acá la promesa era falsa. El servidor busca las deudas por cobrar entre las
    // liquidaciones que no están anuladas ni borradas, así que lo que quedó debiendo un
    // comprobante anulado no lo recoge ninguna liquidación futura.
    await armar([liq({ ...LE_QUEDO_DEBIENDO, estado: 'anulada' })]);

    expect(celdasDeSaldo()[0]).toContain('quedó debiendo · no se cobra');
    const tooltip = comoSeLee(
      fixture.componentInstance.tooltipLeQuedaDebiendo(fixture.componentInstance.filas()[0]),
    );
    expect(tooltip).toContain('Esta liquidación está anulada');
    expect(tooltip).toContain('no se le cobran en ninguna parte');
    expect(tooltip).toContain('Vuelva a generar la quincena');
    expect(tooltip).not.toContain('se le cobra en la próxima');
  });

  it('del BORRADOR la deuda viaja igual, y se dice con esas palabras', async () => {
    // La regla del servidor: la deuda viaja desde cualquier liquidación que no esté
    // anulada ni borrada, borrador incluido. Hay que decirlo porque es la sorpresa: quien
    // ve un borrador en negativo asume que "todavía no cuenta", y sí cuenta.
    await armar([liq({ ...LE_QUEDO_DEBIENDO, estado: 'borrador' })]);

    expect(celdasDeSaldo()[0]).toContain('quedó debiendo');
    expect(
      comoSeLee(
        fixture.componentInstance.tooltipLeQuedaDebiendo(fixture.componentInstance.filas()[0]),
      ),
    ).toBe(
      'Alex Agudelo quedó debiendo $ 4.955,77: se le cobra en la próxima quincena que se le ' +
        'liquide después de esta. Viaja aunque esta siga en borrador',
    );
  });

  // ---------------------------------------------------------------------------
  // LA TARJETA TIENE QUE DECIR CUÁNTA PLATA HAY QUE SACAR, y esa es una sola cifra:
  // los saldos POSITIVOS. Revueltos con las deudas de los terceros daba $10.000 donde
  // hay $130.000 por entregar, y las dos pantallas que el dueño compara —esta y el
  // tablero— decían cosas distintas.
  // ---------------------------------------------------------------------------
  it('la tarjeta suma solo lo que hay que SACAR: la deuda del tercero no la baja', async () => {
    await armar([liq(A_ALEX_130K), liq(HENRI_QUEDO_DEBIENDO_120K)]);

    const resumen = fixture.componentInstance.resumen()!;
    expect(resumen.saldoAprobadas).toBe(130000);
    const tarjeta = tarjetaCon('Aprobadas por pagar');
    expect(tarjeta).toContain('$ 130.000 por pagar');
    // La cifra que salía de sumar el negativo con el positivo, y que el dueño vio en el
    // tablero mientras la lista decía otra: no puede volver a aparecer.
    expect(tarjeta).not.toContain('10.000');
  });

  it('lo que le deben a la quesera va APARTE y con su nombre', async () => {
    await armar([liq(A_ALEX_130K), liq(HENRI_QUEDO_DEBIENDO_120K)]);

    const resumen = fixture.componentInstance.resumen()!;
    expect(resumen.leQuedaronDebiendo).toBe(120000);
    expect(resumen.liquidacionesQueDeben).toBe(1);

    const tarjeta = tarjetaCon('Le quedaron debiendo');
    expect(tarjeta).toContain('$ 120.000');
    expect(tarjeta).toContain('Le quedaron debiendo a la quesera');
    expect(tarjeta).toContain('en 1 liquidación');
    // No es un botón como las otras cuatro: una deuda del tercero no es un estado y no
    // hay filtro que aplicar, así que un clic no llevaría a ninguna parte.
    const elemento = Array.from(
      fixture.nativeElement.querySelectorAll('.tarjeta') as NodeListOf<HTMLElement>,
    ).find((t) => comoSeLee(t.textContent).includes('Le quedaron debiendo'))!;
    expect(elemento.tagName).toBe('DIV');
    expect(
      comoSeLee(fixture.componentInstance.tooltipLeQuedaronDebiendo(120000, 1)),
    ).toBe(
      '$ 120.000 que los terceros le quedaron debiendo a la quesera en una liquidación del ' +
        'período, y que todavía nadie les ha cobrado. NO es plata por pagar: se le descuenta ' +
        'a cada uno en la próxima quincena que se le liquide',
    );
  });

  it('no se cuenta dos veces: la deuda ya cobrada y la anulada quedan por fuera', async () => {
    // La ya cobrada está descontada dentro del saldo de la liquidación que se la cobró, y
    // la anulada no se le cobra a nadie. Sumarlas acá sería prometerle al dueño un cobro
    // que no existe.
    await armar([
      liq({ ...HENRI_QUEDO_DEBIENDO_120K, id: 'l-cobrada', deuda_trasladada_a_id: 'l-otra' }),
      liq({ ...HENRI_QUEDO_DEBIENDO_120K, id: 'l-anulada', estado: 'anulada' }),
      liq({ ...HENRI_QUEDO_DEBIENDO_120K, id: 'l-viva', estado: 'borrador' }),
    ]);

    const resumen = fixture.componentInstance.resumen()!;
    // Solo la del borrador, que es la única cuya deuda va a viajar de verdad.
    expect(resumen.leQuedaronDebiendo).toBe(120000);
    expect(resumen.liquidacionesQueDeben).toBe(1);
  });

  it('sin deudas la tarjeta no sale: una tarjeta en $0 le quita espacio a las de siempre', async () => {
    await armar([liq(A_ALEX_130K)]);

    expect(fixture.componentInstance.resumen()?.leQuedaronDebiendo).toBe(0);
    expect(tarjetaCon('Le quedaron debiendo')).toBe('');
  });

  it('lo normal no cambia: la que hay que pagar sigue con su marca de siempre', async () => {
    await armar([liq(POR_PAGAR)]);

    const celda = celdasDeSaldo()[0];
    expect(celda).toContain('$ 120.000');
    expect(celda).toContain('por pagar');
    expect(celda).not.toContain('quedó debiendo');
    expect(celda).not.toContain('cobra lo anterior');
  });
});
