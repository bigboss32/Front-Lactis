import { HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { authInterceptor } from '../../core/auth/auth.interceptor';
import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion, Page } from '../../core/models';
import { LiquidacionListPage } from './liquidacion-list.page';
import { LiquidacionesService, ResumenLiquidaciones } from './liquidaciones.service';

/**
 * LA LISTA DICE LO MISMO QUE EL PAPEL SOBRE LA DEUDA, Y NO ADIVINA POR QUÉ FALTAN LOS TOTALES.
 *
 *  · EL CASO «LAS DOS»: 250 L × $2.000 = $500.000 con $300.000 de anticipo, pagada con
 *    $200.000 y corregida a $1.000 el litro. Queda pagada v2 con valor $250.000, neto
 *    −$50.000, pagado $200.000 y saldo −$250.000 (250.000 − 300.000 = −50.000; −50.000 −
 *    200.000 = −250.000). El PDF y el detalle cierran en "LE QUEDA DEBIENDO $250.000", y la
 *    marca de la columna Saldo decía "se le pagó de más": dos causas para la misma plata.
 *  · EL AVISO DE LOS TOTALES decía siempre que "la consulta no alcanzó a llegar", también
 *    cuando el servidor respondió 422 (el front publicado antes que el back) o 500. Ahora
 *    muestra el texto del servidor o del interceptor, el mismo de `errorCarga`.
 */

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const liq = (c: Partial<Liquidacion>): Liquidacion => ({
  id: 'x',
  empresa_id: 'e-1',
  estado: 'pagada',
  created_at: '2026-06-16T00:00:00Z',
  updated_at: '2026-06-16T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Las Dos',
  transportador_id: null,
  transportador_nombre: null,
  periodo_inicio: '2026-06-01',
  periodo_fin: '2026-06-15',
  total_litros: '250',
  precio_promedio: '1000',
  valor_bruto: '250000',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '0',
  anticipos: '0',
  valor_total: '250000',
  neto_a_pagar: '250000',
  pagado: '0',
  saldo: '250000',
  le_queda_debiendo: '0',
  observaciones: null,
  detalles: [],
  pagos: [],
  ...c,
});

/** La fila tal como la devolvió GET /liquidaciones después de corregir (caso «las dos»). */
const LAS_DOS = liq({
  id: 'las-dos',
  estado_visible: 'pagada · quedó debiendo',
  version: 2,
  anticipos: '300000.00',
  saldo_anterior: '0.00',
  valor_total: '250000.00',
  neto_a_pagar: '-50000.00',
  pagado: '200000.00',
  saldo: '-250000.00',
  le_queda_debiendo: '250000.00',
  con_abonos: true,
  pagos: [{ id: 'p-1', fecha: '2026-06-16', valor: '200000', observaciones: null }],
});

/** Control 'entregado_de_mas': v2 de $400.000 con $500.000 entregados. */
const DE_MAS = liq({
  id: 'de-mas',
  proveedor_nombre: 'Henri Castaño',
  estado_visible: 'pagada · quedó debiendo',
  version: 2,
  valor_total: '400000',
  neto_a_pagar: '400000',
  pagado: '500000',
  saldo: '-100000',
  le_queda_debiendo: '100000',
  pagos: [{ id: 'p-2', fecha: '2026-06-16', valor: '500000', observaciones: null }],
});

/** Control 'anticipos': $180.000 de leche contra $300.000 de adelanto, aprobada. */
const ANTICIPOS = liq({
  id: 'anticipos',
  proveedor_nombre: 'Henri',
  estado: 'aprobada',
  estado_visible: 'pagada · quedó debiendo',
  valor_total: '180000',
  anticipos: '300000',
  neto_a_pagar: '-120000',
  saldo: '-120000',
  le_queda_debiendo: '120000',
});

const RESUMEN: ResumenLiquidaciones = {
  borradores: 0,
  aprobadas: 1,
  saldo_aprobadas: '0.00',
  parciales: 0,
  saldo_parciales: '0.00',
  pagadas: 2,
  le_quedaron_debiendo: '470000.00',
  liquidaciones_que_deben: 3,
};

class ServidorFalso {
  filas: Liquidacion[] = [LAS_DOS, DE_MAS, ANTICIPOS];
  respuesta: () => Observable<ResumenLiquidaciones> = () => of(RESUMEN);

  list(): Observable<Page<Liquidacion>> {
    return of({ items: this.filas, total: this.filas.length, page: 1, page_size: 20, pages: 1 });
  }

  resumen(): Observable<ResumenLiquidaciones> {
    return this.respuesta();
  }
}

const limpiar = () => {
  try {
    sessionStorage.removeItem('qe.filtros.liquidaciones');
  } catch {
    /* sin sessionStorage no hay nada que limpiar */
  }
};

describe('LiquidacionListPage: la marca de la deuda y el aviso de los totales', () => {
  let fixture: ComponentFixture<LiquidacionListPage>;

  beforeEach(limpiar);
  afterEach(limpiar);

  const refrescar = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const armar = async (preparar: (s: ServidorFalso) => void = () => {}): Promise<void> => {
    const servidor = new ServidorFalso();
    preparar(servidor);
    await TestBed.configureTestingModule({
      imports: [LiquidacionListPage, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: LiquidacionesService, useValue: servidor },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LiquidacionListPage);
    await refrescar();
  };

  /** [marca, tooltip] de la columna Saldo, en el orden de las filas. */
  const marcas = (): [string, string][] =>
    fixture.debugElement
      .queryAll(By.css('.badge-le-debe'))
      .map((m) => [comoSeLee(m.nativeElement.textContent), m.injector.get(MatTooltip).message]);

  const aviso = (): string =>
    comoSeLee(fixture.nativeElement.querySelector('.aviso-totales')?.textContent);

  // ------------------------------------------------------------------ «las dos»
  it('«las dos»: la marca dice "quedó debiendo", como el PDF y el detalle', async () => {
    await armar();
    const [marca, tooltip] = marcas()[0];

    expect(marca).toBe('quedó debiendo');
    expect(marca).not.toContain('pagó de más');
    expect(comoSeLee(tooltip)).toBe(
      'Las Dos quedó debiendo $ 250.000: ya se le habían entregado $ 200.000, y además los ' +
        'anticipos aplicados ($ 300.000) suman más que el valor total de esta liquidación ' +
        '($ 250.000). Se le cobra en la próxima quincena que se le liquide después de esta',
    );
    expect(tooltip).not.toContain('se le pagó de más');
    // La cifra no cambia: solo la palabra.
    expect(comoSeLee(fixture.nativeElement.querySelector('.al-reves')?.textContent)).toBe(
      '$ 250.000',
    );
  });

  it('control: la plata entregada de más ($500.000 contra $400.000) sigue "se le pagó de más"', async () => {
    await armar();
    const [marca, tooltip] = marcas()[1];

    expect(marca).toBe('se le pagó de más');
    expect(comoSeLee(tooltip)).toContain(
      'A Henri Castaño se le pagó de más: ya se le habían entregado $ 500.000',
    );
  });

  it('control: los anticipos ($180.000 contra $300.000) siguen "quedó debiendo"', async () => {
    await armar();
    const [marca, tooltip] = marcas()[2];

    expect(marca).toBe('quedó debiendo');
    expect(comoSeLee(tooltip)).toBe(
      'Henri quedó debiendo $ 120.000: se le cobra en la próxima quincena que se le liquide ' +
        'después de esta',
    );
  });

  // ------------------------------------------------------------ los totales
  it('un 422 del servidor: el aviso trae su texto y no dice que la consulta no llegó', async () => {
    const detalle =
      "Dato inválido en 'path.entity_id': Input should be a valid UUID, invalid character: " +
      'expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `r` at 1';
    await armar(
      (s) =>
        (s.respuesta = () =>
          throwError(
            () =>
              new HttpErrorResponse({
                status: 422,
                error: { error: { code: 'validation_error', detail: detalle } },
              }),
          )),
    );

    expect(aviso()).toContain('No se pudieron cargar los totales.');
    expect(aviso()).toContain(detalle);
    expect(aviso()).toContain('Eso no quiere decir que no haya nada por pagar ni que nadie deba.');
    expect(aviso()).not.toContain('no alcanzó a llegar');
    // Sin tarjetas, y la tabla se ve.
    expect(fixture.nativeElement.querySelectorAll('.tarjeta').length).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('tr.mat-mdc-row').length).toBe(3);
  });

  it('una cifra ilegible no culpa a la red ni pinta la cifra', async () => {
    await armar((s) => (s.respuesta = () => of({ ...RESUMEN, le_quedaron_debiendo: 'NaN' })));

    expect(aviso()).toContain('No se pudieron cargar los totales.');
    expect(aviso()).not.toContain('NaN');
    expect(aviso()).not.toContain('$');
    expect(aviso()).not.toContain('no alcanzó a llegar');
    expect(fixture.nativeElement.querySelector('.aviso-totales .detalle-del-fallo')).toBeNull();
  });
});

/**
 * CON EL INTERCEPTOR DE VERDAD: un 500 en `/resumen` (después de los dos reintentos) dice en
 * el aviso de los totales el MISMO texto que `errorCarga` dice cuando es la lista la que
 * recibe ese 500. Es la misma fuente (`detalleDeError`), no una tabla de status copiada.
 */
describe('LiquidacionListPage: el aviso de los totales con el interceptor de verdad', () => {
  let fixture: ComponentFixture<LiquidacionListPage>;
  let http: HttpTestingController;

  const CUERPO_500 = { error: { code: 'internal_error', detail: 'Error interno del servidor' } };
  const PAGINA = { items: [ANTICIPOS], total: 1, page: 1, page_size: 20, pages: 1 };
  const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const esResumen = (url: string) => url.endsWith('/liquidaciones/resumen');

  beforeEach(async () => {
    limpiar();
    await TestBed.configureTestingModule({
      imports: [LiquidacionListPage, NoopAnimationsModule],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: AuthService,
          useValue: {
            accessToken: 'tok',
            empresaActiva: () => null,
            esSuperadmin: () => false,
            perfil: () => null,
            hasPermission: () => true,
            recargarPerfil: async () => null,
            revalidarMembresia: async () => null,
            refrescar: async () => null,
          },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LiquidacionListPage);
  });
  afterEach(limpiar);

  /** Responde con 500 el pedido y sus dos reintentos (esperas de 500 y 1000 ms). */
  const tresVeces500 = async (cual: (url: string) => boolean) => {
    for (let intento = 0; intento < 3; intento++) {
      if (intento > 0) await esperar(1200);
      for (const p of http.match((r) => cual(r.url))) {
        p.flush(CUERPO_500, { status: 500, statusText: 'Internal Server Error' });
      }
    }
    await esperar(100);
    fixture.detectChanges();
  };

  it('el 500 de los totales se dice con las palabras de `errorCarga`, no con "no alcanzó a llegar"', async () => {
    fixture.detectChanges();
    await esperar(50);
    for (const p of http.match((r) => !esResumen(r.url))) p.flush(PAGINA);
    await tresVeces500(esResumen);

    const el: HTMLElement = fixture.nativeElement;
    const detalleTotales = comoSeLee(
      el.querySelector('.aviso-totales .detalle-del-fallo')?.textContent,
    );
    expect(detalleTotales).not.toBe('');
    expect(comoSeLee(el.querySelector('.aviso-totales')?.textContent)).not.toContain(
      'no alcanzó a llegar',
    );

    // La lista, con el mismo 500, muestra en `errorCarga` el mismo texto.
    void fixture.componentInstance.cargar();
    await esperar(50);
    await tresVeces500((url) => !esResumen(url));
    expect(comoSeLee(fixture.componentInstance.errorCarga())).toBe(detalleTotales);
    http.verify();
  }, 30000);
});
