import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion } from '../../core/models';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * LA AYUDA DE LA LÍNEA DE ESTADOS NO MANDA A UN BOTÓN QUE QUIEN MIRA NO TIENE.
 *
 * "usa Pagar", "usa Marcar pagada" y "apruébala" nombran botones de 'administrar'. Compras
 * (consultar, crear, editar, exportar, imprimir) y Consulta (solo consultar) abren este
 * detalle, no ven esos botones, y el servidor les rebota /pagar, /pagos y /aprobar con 403.
 * Medido con Compras en la aprobada de $180.000: la ayuda decía "usa Pagar" y el candado de
 * Recalcular, en el mismo diálogo, "pídale a un Administrador de la empresa que la anule".
 * Lo que la ayuda dice de la plata es igual para todos; para el Administrador no cambia nada.
 */

type Fixture = ComponentFixture<LiquidacionDetailDialog>;

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/\s+/g, ' ').trim();
const leido = (elemento: Element | null | undefined): string => comoSeLee(elemento?.textContent);

const COMPRAS = ['consultar', 'crear', 'editar', 'exportar', 'imprimir'].map(
  (accion) => `liquidaciones:${accion}`,
);
const CONSULTA = ['liquidaciones:consultar'];
const ADMINISTRADOR = [...COMPRAS, 'liquidaciones:administrar', 'liquidaciones:eliminar'];

const quincena = (cifras: Partial<Liquidacion> = {}): Liquidacion => ({
  id: 'l-1',
  empresa_id: 'e-1',
  estado: 'aprobada',
  estado_visible: 'aprobada',
  version: 1,
  created_at: '2026-06-16T00:00:00Z',
  updated_at: '2026-06-16T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Rep4 Borrador',
  transportador_id: null,
  transportador_nombre: null,
  periodo_inicio: '2026-06-01',
  periodo_fin: '2026-06-15',
  total_litros: '100',
  precio_promedio: '1800',
  valor_bruto: '180000.00',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '0',
  anticipos: '0.00',
  saldo_anterior: '0.00',
  valor_total: '180000.00',
  neto_a_pagar: '180000.00',
  pagado: '0.00',
  saldo: '180000.00',
  le_queda_debiendo: '0',
  con_abonos: false,
  observaciones: null,
  detalles: [{ id: 'd-1', fecha: '2026-06-02', litros: '100', precio_litro: '1800', valor: '180000' }],
  pagos: [],
  ...cifras,
});

/** Las cinco quincenas, con las cifras que devolvió la API (100 L × $1.800 = $180.000). */
const CASOS: Record<string, Partial<Liquidacion>> = {
  borrador: { estado: 'borrador', estado_visible: 'borrador' },
  aprobada: {},
  parcial_con_abono: {
    estado: 'parcial',
    estado_visible: 'parcial',
    pagado: '30000.00',
    saldo: '150000.00',
    con_abonos: true,
    pagos: [{ id: 'p-1', fecha: '2026-06-20', valor: '30000', observaciones: null }],
  },
  // $216.000 − $180.000 de adelanto = $36.000, sin un solo pago.
  parcial_v2_sin_abonos: {
    estado: 'parcial',
    estado_visible: 'parcial',
    version: 2,
    proveedor_nombre: 'Rep4 Corregida',
    total_litros: '120',
    valor_bruto: '216000.00',
    valor_total: '216000.00',
    anticipos: '180000.00',
    neto_a_pagar: '36000.00',
    saldo: '36000.00',
  },
  // $180.000 de leche contra $180.000 de adelanto: neto y saldo en cero.
  exacta: {
    proveedor_nombre: 'Rep4 Exacta',
    anticipos: '180000.00',
    neto_a_pagar: '0.00',
    saldo: '0.00',
  },
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

const abrir = async (item: Liquidacion, permisos: string[]): Promise<Fixture> => {
  TestBed.resetTestingModule();
  const tiene = new Set(permisos);
  await TestBed.configureTestingModule({
    imports: [LiquidacionDetailDialog, NoopAnimationsModule],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { item } },
      { provide: LiquidacionesService, useValue: new ServidorFalso() },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
      {
        provide: AuthService,
        useValue: {
          hasPermission: (modulo: string, accion = 'consultar') => tiene.has(`${modulo}:${accion}`),
          perfil: () => null,
          esSuperadmin: () => false,
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(LiquidacionDetailDialog);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
};

const ayudaDe = (fixture: Fixture): string =>
  leido(fixture.nativeElement.querySelector('app-liquidacion-estado-stepper .ayuda'));
const botonesDe = (fixture: Fixture): string[] =>
  Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button'))
    .map((boton) => leido(boton as Element))
    .filter((texto) => texto !== '');
const tieneBoton = (fixture: Fixture, rotulo: string): boolean =>
  botonesDe(fixture).some((b) => b === rotulo || b.endsWith(` ${rotulo}`));

/** Lo que la ayuda NO puede decir sin el botón al lado. */
const NOMBRA_UN_BOTON = /usa "Pagar"|usa "Marcar pagada"|apruébala/;

/** Lo que la ayuda afirma de la plata en cada caso: igual con o sin permiso. */
const LO_QUE_DICE_DE_LA_PLATA: Record<string, string> = {
  borrador: 'para poder pagarla',
  aprobada: 'Los valores quedaron en firme',
  parcial_con_abono: 'Se le abonó una parte y todavía queda debiendo',
  parcial_v2_sin_abonos: 'Se corrigió y quedó un saldo por entregar, sin ningún abono registrado',
  exacta: 'Los valores quedaron en firme y no hay plata por entregar',
};

describe('LiquidacionDetailDialog: la ayuda de arriba con el permiso de quien mira', () => {
  for (const [rol, permisos] of [
    ['Compras', COMPRAS],
    ['Consulta', CONSULTA],
  ] as const) {
    for (const [nombre, cifras] of Object.entries(CASOS)) {
      it(`${rol} · ${nombre}: no nombra Pagar, Marcar pagada ni Aprobar, y dice lo mismo de la plata`, async () => {
        const fixture = await abrir(quincena(cifras), [...permisos]);
        const ayuda = ayudaDe(fixture);

        expect(ayuda).not.toMatch(NOMBRA_UN_BOTON);
        expect(ayuda).toContain(LO_QUE_DICE_DE_LA_PLATA[nombre]);
        expect(ayuda).toContain('Administrador de la empresa');
        // Y de verdad no tiene esos botones.
        for (const boton of ['Pagar', 'Marcar pagada', 'Aprobar']) {
          expect(tieneBoton(fixture, boton)).withContext(boton).toBeFalse();
        }
      });
    }
  }

  it('Compras, las frases enteras: dicen quién lo hace, como el candado de Recalcular', async () => {
    const esperadas: Record<string, string> = {
      borrador:
        'Falta revisar los valores y que un Administrador de la empresa la apruebe para poder ' +
        'pagarla.',
      aprobada:
        'Los valores quedaron en firme: el pago lo registra un Administrador de la empresa ' +
        'cuando se entregue el dinero.',
      parcial_con_abono:
        'Se le abonó una parte y todavía queda debiendo: el pago del resto lo registra un ' +
        'Administrador de la empresa.',
      parcial_v2_sin_abonos:
        'Se corrigió y quedó un saldo por entregar, sin ningún abono registrado: el pago lo ' +
        'registra un Administrador de la empresa cuando se entregue el dinero.',
      exacta:
        'Los valores quedaron en firme y no hay plata por entregar: un Administrador de la ' +
        'empresa la marca pagada para cerrarla.',
    };
    for (const [nombre, cifras] of Object.entries(CASOS)) {
      const fixture = await abrir(quincena(cifras), COMPRAS);
      expect(ayudaDe(fixture)).withContext(nombre).toBe(esperadas[nombre]);
    }
    // En la aprobada, la ayuda y el candado de Recalcular mandan al mismo lado.
    const aprobada = await abrir(quincena(), COMPRAS);
    expect(leido(aprobada.nativeElement.querySelector('.ayuda-precio.con-candado span'))).toContain(
      'pídale a un Administrador de la empresa',
    );
  });

  it('Administrador: la ayuda de siempre, cada una con el botón que nombra', async () => {
    const conSuBoton: Record<string, [string, string]> = {
      borrador: ['Revisa los valores y apruébala para poder pagarla.', 'Aprobar'],
      aprobada: ['Los valores quedaron en firme: usa "Pagar" cuando entregues el dinero.', 'Pagar'],
      parcial_con_abono: [
        'Se le abonó una parte y todavía queda debiendo: usa "Pagar" para el resto.',
        'Pagar',
      ],
      parcial_v2_sin_abonos: [
        'Se corrigió y quedó un saldo por entregar, sin ningún abono registrado: usa "Pagar" ' +
          'cuando entregues el dinero.',
        'Pagar',
      ],
      exacta: [
        'Los valores quedaron en firme y no hay plata por entregar: usa "Marcar pagada" para ' +
          'cerrarla.',
        'Marcar pagada',
      ],
    };
    for (const [nombre, cifras] of Object.entries(CASOS)) {
      const fixture = await abrir(quincena(cifras), ADMINISTRADOR);
      const [ayuda, boton] = conSuBoton[nombre];
      expect(ayudaDe(fixture)).withContext(nombre).toBe(ayuda);
      expect(tieneBoton(fixture, boton)).withContext(`${nombre}: ${boton}`).toBeTrue();
    }
  });

  it('el botón Aprobar y la ayuda que lo nombra salen de la misma señal (`puedeAprobar`)', async () => {
    const compras = await abrir(quincena(CASOS['borrador']), COMPRAS);
    expect(compras.componentInstance.puedeAprobar()).toBeFalse();
    expect(tieneBoton(compras, 'Aprobar')).toBeFalse();

    const admin = await abrir(quincena(CASOS['borrador']), ADMINISTRADOR);
    expect(admin.componentInstance.puedeAprobar()).toBeTrue();
    expect(tieneBoton(admin, 'Aprobar')).toBeTrue();
    // Sobre una aprobada no hay Aprobar, ni para el Administrador.
    const aprobada = await abrir(quincena(), ADMINISTRADOR);
    expect(aprobada.componentInstance.puedeAprobar()).toBeFalse();
    expect(tieneBoton(aprobada, 'Aprobar')).toBeFalse();
  });
});
