import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion } from '../../core/models';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * LA PANTALLA DICE LO MISMO QUE EL PAPEL, Y NO MANDA A ENTREGAR UN PAPEL QUE NO SE ENTREGA.
 *
 *  · EL AVISO ROJO DE LA DEUDA BORRADA dice la posición de hoy con la frase del servidor
 *    (`aviso_deuda_borrada`), la misma del 422 de Pagar o Corregir esa fila y de la nota
 *    del PDF. La pantalla hacía la cuenta por su lado y decía otras palabras.
 *  · LA BANDA DEL COMPROBANTE CORREGIDO mandaba a "entregarle esta versión" en la v2 con
 *    deuda borrada, el mismo papel que la pantalla no deja compartir: dice "SALDO A PAGAR
 *    $50.000" a quien todavía debe $70.000.
 *  · EL RENGLÓN DE CIERRE: el PDF dice "SE LE PAGÓ DE MÁS" cuando el negativo es plata
 *    entregada de más, y la pantalla decía "Le queda debiendo" con la misma cifra.
 */

type Fixture = ComponentFixture<LiquidacionDetailDialog>;

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const leido = (elemento: Element | null | undefined): string => comoSeLee(elemento?.textContent);

const quincena = (cifras: Partial<Liquidacion> = {}): Liquidacion => ({
  id: 'l-1',
  empresa_id: 'e-1',
  estado: 'pagada',
  estado_visible: 'pagada',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Henri Castaño',
  transportador_id: null,
  transportador_nombre: null,
  periodo_inicio: '2026-07-01',
  periodo_fin: '2026-07-15',
  total_litros: '90',
  precio_promedio: '2000',
  valor_bruto: '180000',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '0',
  anticipos: '0',
  valor_total: '180000',
  neto_a_pagar: '180000',
  pagado: '0',
  saldo: '180000',
  le_queda_debiendo: '0',
  observaciones: null,
  detalles: [
    { id: 'd-1', fecha: '2026-07-03', litros: '90', precio_litro: '2000', valor: '180000' },
  ],
  pagos: [],
  ...cifras,
});

/** La de julio, $180.000 contra $300.000, tal como la dejó la migración: borró $120.000. */
const MIGRADA_SIN_TOCAR: Partial<Liquidacion> = {
  anticipos: '300000',
  neto_a_pagar: '-120000',
  pagado: '-120000',
  saldo: '0',
  deuda_borrada_por_la_migracion: '120000',
};

/** La misma, corregida hacia arriba sin pagar: valor $380.000, saldo $200.000. */
const CORREGIDA_HACIA_ARRIBA: Partial<Liquidacion> = {
  ...MIGRADA_SIN_TOCAR,
  estado: 'parcial',
  estado_visible: 'parcial',
  version: 2,
  total_litros: '190',
  valor_bruto: '380000',
  valor_total: '380000',
  neto_a_pagar: '80000',
  saldo: '200000',
};

/** "Mas50 Sin Pagar": corregida con un día de $50.000. El papel dice SALDO A PAGAR $50.000. */
const MAS50_SIN_PAGAR: Partial<Liquidacion> = {
  ...MIGRADA_SIN_TOCAR,
  estado: 'parcial',
  estado_visible: 'parcial',
  version: 2,
  proveedor_nombre: 'Mas50 Sin Pagar',
  total_litros: '115',
  valor_bruto: '230000',
  valor_total: '230000',
  neto_a_pagar: '-70000',
  saldo: '50000',
};

class ServidorFalso {
  readonly porId = new Subject<Liquidacion>();
  getById(): Observable<Liquidacion> {
    return this.porId;
  }
  correcciones(): Observable<[]> {
    return of([]);
  }
}

const abrir = async (item: Liquidacion): Promise<Fixture> => {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [LiquidacionDetailDialog, NoopAnimationsModule],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { item } },
      { provide: LiquidacionesService, useValue: new ServidorFalso() },
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

const avisoRojo = (fixture: Fixture): string =>
  leido(fixture.nativeElement.querySelector('.aviso-deuda-borrada span'));
const banda = (fixture: Fixture): string =>
  leido(fixture.nativeElement.querySelector('.banda-corregida'));
const botonesDe = (fixture: Fixture): string[] =>
  Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button'))
    .map((boton) => leido(boton as Element))
    .filter((texto) => texto !== '');

/** El renglón de cierre del resumen: [rótulo, cifra]. */
const cierreDelResumen = (fixture: Fixture): [string, string] => {
  const celdas = Array.from(
    (fixture.nativeElement.querySelector('.resumen') as HTMLElement).children,
  ).map((celda) => leido(celda));
  return [celdas[celdas.length - 2], celdas[celdas.length - 1]];
};

/**
 * LAS FRASES REALES DE `posicion_de_hoy` (backend, service.py), una por rama, sin punto
 * final, como las manda `aviso_deuda_borrada`. Ninguna trae la cola del 422 ("así que
 * pagarle el saldo le entregaría $120.000 de más"): esa la pone `_aviso_deuda_borrada`.
 */
const POSICION_DEBE = 'Hoy el tercero todavía le debe $120.000 a la quesera';
const POSICION_FALTA =
  'El saldo dice $200.000, pero lo que de verdad falta entregarle es $80.000: los otros ' +
  '$120.000 son la deuda que borró la migración';
// El saldo entero es lo borrado: "esos $120.000", no "los otros" (no hay unos primeros).
const POSICION_NADA =
  'El saldo dice $120.000, pero de verdad no falta entregarle nada: esos $120.000 son la ' +
  'deuda que borró la migración';

/** La misma, corregida a $300.000 sin pagar: saldo $120.000, justo lo borrado. */
const CORREGIDA_HASTA_CERO: Partial<Liquidacion> = {
  ...CORREGIDA_HACIA_ARRIBA,
  total_litros: '150',
  valor_bruto: '300000',
  valor_total: '300000',
  neto_a_pagar: '0',
  saldo: '120000',
};

/** Cuántas veces sale una cifra, con o sin el espacio de `pesosExactos`. */
const veces = (texto: string, cifra: string): number =>
  (texto.match(new RegExp(`\\$\\s?${cifra.replace(/\./g, '\\.')}(?![\\d.])`, 'g')) ?? [])
    .length;

describe('LiquidacionDetailDialog: el aviso rojo dice la posición de hoy con la frase del servidor', () => {
  it('rama «debe» (la migrada sin tocar): la frase tal cual, sin otro nombre ni otro formato', async () => {
    const fixture = await abrir(
      quincena({ ...MIGRADA_SIN_TOCAR, aviso_deuda_borrada: POSICION_DEBE }),
    );

    const aviso = avisoRojo(fixture);
    expect(aviso).toBe(
      'Esta quincena viene de antes de que existieran los abonos, y en el resumen lleva el ' +
        'renglón «Deuda borrada por la migración». Hoy el tercero todavía le debe $120.000 a ' +
        'la quesera. Hay que repararla antes de cualquier otra cosa: mientras tanto no se ' +
        'puede corregir, pagar, abonar ni anular.',
    );
    expect(aviso).not.toContain('Tal como están las cifras');
    // Un solo nombre ("el tercero", el del servidor) y un solo formato de pesos.
    expect(aviso).not.toContain('Henri Castaño');
    expect(aviso).not.toMatch(/\$\s\d/);
  });

  it('rama «falta» ($200.000 de saldo): la cifra borrada sale UNA vez, la del servidor', async () => {
    const fixture = await abrir(
      quincena({ ...CORREGIDA_HACIA_ARRIBA, aviso_deuda_borrada: POSICION_FALTA }),
    );

    const aviso = avisoRojo(fixture);
    expect(aviso).toContain(`${POSICION_FALTA}.`);
    expect(veces(aviso, '120.000')).toBe(1);
    // La cuenta del dueño cierra en el mismo párrafo: 200.000 − 120.000 = 80.000.
    expect(veces(aviso, '200.000')).toBe(1);
    expect(veces(aviso, '80.000')).toBe(1);
    expect(aviso).not.toContain('Henri Castaño');
    expect(aviso).not.toMatch(/\$\s\d/);
    // "Borró" lo dice una vez la frase del servidor; el marco solo nombra el renglón.
    expect((aviso.match(/borr[óo]/g) ?? []).length).toBe(1);
    expect(aviso).not.toContain('Lo que de verdad falta por entregarle a Henri');
  });

  it('rama «nada» ($120.000 de saldo): el marco no le suma ninguna cifra a la frase', async () => {
    const fixture = await abrir(
      quincena({ ...CORREGIDA_HASTA_CERO, aviso_deuda_borrada: POSICION_NADA }),
    );

    const aviso = avisoRojo(fixture);
    expect(aviso).toContain(`${POSICION_NADA}.`);
    // Las dos que hay son las de la frase (el saldo y lo borrado): el marco no pone otra.
    expect(veces(aviso, '120.000')).toBe(veces(POSICION_NADA, '120.000'));
    expect(aviso).not.toContain('los otros');
    expect(aviso).not.toContain('Henri Castaño');
    expect(aviso).not.toMatch(/\$\s\d/);
  });

  it('una respuesta vieja sin la frase sigue con la cuenta de la pantalla', async () => {
    const fixture = await abrir(quincena(MIGRADA_SIN_TOCAR));

    expect(avisoRojo(fixture)).toContain(
      'Tal como están las cifras, Henri Castaño todavía le debe $ 120.000 al negocio por esta ' +
        'quincena.',
    );
  });
});

describe('LiquidacionDetailDialog: la v2 con la deuda borrada no se manda a entregar', () => {
  it('"Mas50 Sin Pagar": la banda no dice "entréguele", y el PDF no se rotula como el que se manda', async () => {
    const fixture = await abrir(quincena(MAS50_SIN_PAGAR));
    const c = fixture.componentInstance;

    expect(banda(fixture)).not.toContain('entréguele');
    expect(banda(fixture)).toContain(
      'El papel que Mas50 Sin Pagar tiene en la mano puede ser el anterior. No le entregue ' +
        'esta versión todavía: primero hay que reparar la quincena (ver el aviso rojo).',
    );
    // La banda sigue: el productor puede tener dos papeles.
    expect(banda(fixture)).toContain('Comprobante corregido · v2');
    // Y el aviso rojo al que manda, también.
    expect(avisoRojo(fixture)).toContain('Hay que repararla antes de cualquier otra cosa');
    expect(c.rotuloPdf()).toBe('Descargar PDF (pendiente de reparar)');
    const botones = botonesDe(fixture);
    expect(botones.some((b) => b.endsWith('Descargar PDF (pendiente de reparar)'))).toBeTrue();
    expect(botones.some((b) => b.endsWith('Compartir PDF'))).toBeFalse();
  });

  it('la v2 sana sigue igual: "entréguele esta versión", su rótulo y Compartir PDF', async () => {
    const fixture = await abrir(
      quincena({
        version: 2,
        valor_bruto: '230000',
        valor_total: '230000',
        neto_a_pagar: '230000',
        pagado: '180000',
        saldo: '50000',
        estado: 'parcial',
        estado_visible: 'parcial',
        pagos: [{ id: 'p-1', fecha: '2026-07-20', valor: '180000', observaciones: null }],
      }),
    );

    expect(banda(fixture)).toContain(
      'El papel que Henri Castaño tiene en la mano puede ser el anterior: entréguele esta ' +
        'versión y recójale la vieja.',
    );
    expect(fixture.componentInstance.rotuloPdf()).toBe('Descargar comprobante corregido (v2)');
    expect(botonesDe(fixture).some((b) => b.endsWith('Compartir PDF'))).toBeTrue();
  });
});

describe('LiquidacionDetailDialog: el renglón de cierre con las palabras del PDF', () => {
  it('se le pagaron $500.000 y la corregida quedó en $400.000: "Se le pagó de más $ 100.000"', async () => {
    const fixture = await abrir(
      quincena({
        estado_visible: 'pagada · quedó debiendo',
        version: 2,
        total_litros: '250',
        precio_promedio: '1600',
        valor_bruto: '400000',
        valor_total: '400000',
        neto_a_pagar: '400000',
        pagado: '500000',
        saldo: '-100000',
        le_queda_debiendo: '100000',
        pagos: [{ id: 'p-1', fecha: '2026-06-16', valor: '500000', observaciones: null }],
      }),
    );

    expect(cierreDelResumen(fixture)).toEqual(['Se le pagó de más', '$ 100.000']);
  });

  it('el negativo que hicieron los anticipos sigue siendo "Le queda debiendo"', async () => {
    const fixture = await abrir(
      quincena({
        estado: 'aprobada',
        estado_visible: 'pagada · quedó debiendo',
        anticipos: '300000',
        neto_a_pagar: '-120000',
        saldo: '-120000',
        le_queda_debiendo: '120000',
      }),
    );

    expect(cierreDelResumen(fixture)).toEqual(['Le queda debiendo', '$ 120.000']);
  });
});
