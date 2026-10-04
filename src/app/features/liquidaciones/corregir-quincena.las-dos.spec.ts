import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion } from '../../core/models';
import { CorregirQuincenaDialog } from './corregir-quincena.dialog';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import {
  CorregirQuincenaPayload,
  LiquidacionesService,
  PrevisualizacionCorreccion,
} from './liquidaciones.service';

/**
 * EL CASO «LAS DOS» AL CORREGIR: "LE QUEDA DEBIENDO", COMO EL PAPEL.
 *
 * 250 L × $2.000 = $500.000 con $300.000 de anticipo, pagada con $200.000. Se corrige el
 * precio a $1.000: valor $250.000, neto −$50.000 (250.000 − 300.000), pagado $200.000,
 * saldo −$250.000 (−50.000 − 200.000). El PDF cierra en "LE QUEDA DEBIENDO $250.000": de
 * esa plata, en efectivo salieron $200.000 y los otros $50.000 son anticipo. El cuadre del
 * diálogo de corregir y el aviso de después decían "se le pagó de más" por los $250.000.
 */

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/\s+/g, ' ').trim();

const LA_QUINCENA: Liquidacion = {
  id: 'l-1',
  empresa_id: 'e-1',
  estado: 'pagada',
  estado_visible: 'pagada',
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
  precio_promedio: '2000',
  valor_bruto: '500000',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '0',
  anticipos: '300000',
  saldo_anterior: '0',
  valor_total: '500000',
  neto_a_pagar: '200000',
  pagado: '200000',
  saldo: '0',
  le_queda_debiendo: '0',
  version: 1,
  observaciones: null,
  detalles: [
    {
      id: 'd-1',
      fecha: '2026-06-02',
      litros: '250',
      precio_litro: '2000',
      valor: '500000',
      ruta_id: null,
      ruta_nombre: null,
    },
  ],
  pagos: [{ id: 'p-1', fecha: '2026-06-16', valor: '200000', observaciones: null }],
};

/** La misma después de corregir, como la devuelve el servidor. */
const CORREGIDA: Liquidacion = {
  ...LA_QUINCENA,
  estado_visible: 'pagada · quedó debiendo',
  version: 2,
  precio_promedio: '1000',
  valor_bruto: '250000',
  valor_total: '250000',
  neto_a_pagar: '-50000',
  saldo: '-250000',
  le_queda_debiendo: '250000',
};

/**
 * El aviso de la vista previa del servidor para «las dos» a $1.000 (`_aviso_le_queda_debiendo`
 * en el backend): 200.000 de efectivo + 50.000 que los anticipos pasan del valor = 250.000.
 */
const AVISO_LAS_DOS =
  'Le queda debiendo $250.000: ya se le habían entregado $200.000, y además los anticipos ' +
  'aplicados ($300.000) pasan en $50.000 del valor total de la quincena corregida ' +
  '($250.000). Esa deuda se le descuenta de la quincena siguiente; si el productor deja de ' +
  'entregar leche, no vuelve';

/**
 * El avance del servidor: suma los precios que lleva el pedido y resta lo que no cambia.
 *
 * Con `vieja` responde como el servidor de antes: la deuda entera en `se_le_pago_de_mas` y
 * sin `le_queda_debiendo`. Si no, como el de hoy: `se_le_pago_de_mas` solo cuando el PDF
 * cerraría en "SE LE PAGÓ DE MÁS" (neto en cero o arriba) y lo demás en `le_queda_debiendo`.
 */
class ServicioFalso {
  constructor(private readonly vieja = false) {}

  previsualizarCorreccion(
    _id: string,
    payload: CorregirQuincenaPayload,
  ): Observable<PrevisualizacionCorreccion> {
    const precio = payload.precios.find((p) => p.detalle_id === 'd-1')?.precio_litro ?? 2000;
    const total = 250 * precio;
    const neto = total - 300000;
    const saldo = neto - 200000;
    const debe = saldo < 0 ? -saldo : 0;
    const deMas = neto >= 0 ? debe : 0;
    const comun = {
      dias_sueltos: [],
      anticipos_aplicados: [],
      anticipos_sueltos: [],
      anticipos_soltados_por_esta: [],
      valor_total_antes: '500000',
      valor_total_despues: String(total),
      anticipos_antes: '300000',
      anticipos_despues: '300000',
      neto_antes: '200000',
      neto_despues: String(neto),
      pagado: '200000',
      saldo_antes: '0',
      saldo_despues: String(saldo),
      estado_antes: 'pagada',
      estado_despues: saldo > 0 ? 'parcial' : 'pagada',
      queda_por_entregar: String(saldo > 0 ? saldo : 0),
      version_actual: 1,
    };
    if (this.vieja) return of({ ...comun, se_le_pago_de_mas: String(debe), avisos: [] });
    return of({
      ...comun,
      se_le_pago_de_mas: String(deMas),
      le_queda_debiendo: String(debe - deMas),
      avisos: precio === 1000 ? [AVISO_LAS_DOS] : [],
    });
  }
}

describe('CorregirQuincenaDialog: el caso «las dos» cierra en "LE QUEDA DEBIENDO"', () => {
  let fixture: ComponentFixture<CorregirQuincenaDialog>;

  const asentar = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** Abre el diálogo, le baja el precio del día y devuelve la caja de "ahora". */
  const corregirA = async (
    precio: string,
    servicio: ServicioFalso,
  ): Promise<{ rotulo: string; cifra: string }> => {
    await TestBed.configureTestingModule({
      imports: [CorregirQuincenaDialog, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { liquidacion: LA_QUINCENA } },
        { provide: LiquidacionesService, useValue: servicio },
        {
          provide: MatDialogRef,
          useValue: {
            disableClose: false,
            close: () => {},
            backdropClick: () => new Subject<MouseEvent>(),
            keydownEvents: () => new Subject<KeyboardEvent>(),
          },
        },
        { provide: MatSnackBar, useValue: { open: () => {} } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CorregirQuincenaDialog);
    const dialogo = fixture.componentInstance;
    await asentar();

    dialogo.editarPrecio(LA_QUINCENA.detalles[0]);
    dialogo.alEscribirPrecio(precio);
    dialogo.aplicarPrecio(LA_QUINCENA.detalles[0]);
    await asentar();

    const cierres = Array.from(fixture.nativeElement.querySelectorAll('.cierre')).map((caja) => ({
      rotulo: comoSeLee((caja as Element).querySelector('.cierre-rotulo')?.textContent),
      cifra: comoSeLee((caja as Element).querySelector('.cierre-cifra')?.textContent),
    }));
    return cierres[1];
  };

  it('bajar el precio a $1.000: "LE QUEDA DEBIENDO $ 250.000", con el campo y el aviso del servidor', async () => {
    const ahora = await corregirA('1.000', new ServicioFalso());

    // El servidor manda la deuda en `le_queda_debiendo` y `se_le_pago_de_mas` en cero: el
    // rótulo es el del campo que trae la cifra.
    expect(ahora).toEqual({ rotulo: 'LE QUEDA DEBIENDO', cifra: '$ 250.000' });
    // La cifra no cambia: 250.000 − 300.000 = −50.000; −50.000 − 200.000 = −250.000.
    expect(250000 - 300000 - 200000).toBe(-250000);
    // El aviso del servidor sale tal cual, y nada en el diálogo dice "se le pagó de más".
    const avisos = Array.from(fixture.nativeElement.querySelectorAll('.aviso-servidor span')).map(
      (span) => comoSeLee((span as Element).textContent),
    );
    expect(avisos).toContain(AVISO_LAS_DOS);
    expect(comoSeLee(fixture.nativeElement.textContent).toLowerCase()).not.toContain(
      'pagó de más',
    );
  });

  it('una respuesta vieja (la deuda entera en `se_le_pago_de_mas`) cierra igual, con la pregunta del PDF', async () => {
    const ahora = await corregirA('1.000', new ServicioFalso(true));

    expect(ahora).toEqual({ rotulo: 'LE QUEDA DEBIENDO', cifra: '$ 250.000' });
  });

  it('control: a $1.600 todo es efectivo entregado de más y dice "SE LE PAGÓ DE MÁS $ 100.000"', async () => {
    const ahora = await corregirA('1.600', new ServicioFalso());

    // 250 × 1.600 = 400.000 − 300.000 = 100.000 de neto; se le entregaron 200.000.
    expect(400000 - 300000 - 200000).toBe(-100000);
    expect(ahora).toEqual({ rotulo: 'SE LE PAGÓ DE MÁS', cifra: '$ 100.000' });
  });
});

describe('LiquidacionDetailDialog: el aviso de después de corregir en el caso «las dos»', () => {
  it('"Quincena corregida. Le queda debiendo $ 250.000", no "Se le pagó de más"', async () => {
    const avisos: string[] = [];
    await TestBed.configureTestingModule({
      imports: [LiquidacionDetailDialog, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { item: LA_QUINCENA } },
        {
          provide: LiquidacionesService,
          useValue: {
            getById: () => new Subject<Liquidacion>(),
            correcciones: () => of([]),
          },
        },
        { provide: MatSnackBar, useValue: { open: (texto: string) => avisos.push(texto) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LiquidacionDetailDialog);
    // El diálogo de corregir "devuelve" la quincena ya corregida. Se espía el MatDialog que
    // el componente tiene inyectado (importa MatDialogModule: uno puesto en `providers` no
    // se usaría).
    spyOn(fixture.debugElement.injector.get(MatDialog), 'open').and.returnValue({
      afterClosed: () => of(CORREGIDA),
    } as never);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.corregirQuincena();
    await fixture.whenStable();

    const aviso = comoSeLee(avisos[avisos.length - 1]);
    expect(aviso).toBe(
      'Quincena corregida. Le queda debiendo $ 250.000: se le descuenta solo en la quincena ' +
        'siguiente',
    );
    expect(aviso).not.toContain('pagó de más');
  });
});
