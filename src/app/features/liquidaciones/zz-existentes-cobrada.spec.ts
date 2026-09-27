import { HttpErrorResponse } from '@angular/common/http';
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
 * LAS FILAS DE LA CAPTURA DEL DUEÑO ("Aprobada" + "quedó debiendo · cobrada") Y LO QUE
 * LA PANTALLA LE OFRECE HACER CON ELLAS, con las formas exactas que devuelve el backend
 * (medidas en Back-Lactis/tests/test_zz_existentes_cobrada.py).
 */

const PD = 'pagada · quedó debiendo';

const comoSeLee = (t: string | null | undefined): string =>
  (t ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const leido = (e: Element | null | undefined): string => comoSeLee(e?.textContent);

const det = (id: string, fecha: string, litros: string, precio: string, valor: string): LiquidacionDetalle => ({
  id, fecha, litros, precio_litro: precio, valor, ruta_id: null, ruta_nombre: null, ruta_borrada: false,
});

const base = (cifras: Partial<Liquidacion>): Liquidacion => ({
  id: 'l-q1',
  empresa_id: 'e-1',
  estado: 'aprobada',
  created_at: '2026-06-16T00:00:00Z',
  updated_at: '2026-06-16T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Henri C',
  transportador_id: null,
  transportador_nombre: null,
  periodo_inicio: '2026-06-01',
  periodo_fin: '2026-06-15',
  total_litros: '100',
  precio_promedio: '1800',
  valor_bruto: '180000',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '0',
  anticipos: '300000',
  valor_total: '180000',
  neto_a_pagar: '-120000',
  pagado: '0',
  saldo: '-120000',
  le_queda_debiendo: '120000',
  observaciones: null,
  detalles: [det('d-1', '2026-06-02', '100', '1800', '180000')],
  pagos: [],
  ...cifras,
});

/** La fila de la captura: aprobada, quedó debiendo, deuda YA cobrada en la siguiente. */
const COBRADA: Partial<Liquidacion> = {
  estado_visible: PD,
  deuda_trasladada_a_id: 'l-q2',
  deuda_trasladada_a: {
    id: 'l-q2',
    periodo_inicio: '2026-06-16',
    periodo_fin: '2026-06-30',
    periodo_texto: '16/06/2026 al 30/06/2026',
  },
} as Partial<Liquidacion>;

class ServicioFalso {
  readonly porId = new Subject<Liquidacion>();
  pagos = 0;
  respuestaPagar: () => Observable<Liquidacion> = () => throwError(() => new Error('sin configurar'));
  getById(): Observable<Liquidacion> {
    return this.porId as unknown as Observable<Liquidacion>;
  }
  pagar(): Observable<Liquidacion> {
    this.pagos += 1;
    return this.respuestaPagar();
  }
  correcciones(): Observable<unknown[]> {
    return of([]);
  }
}

class SnackbarFalso {
  readonly mensajes: string[] = [];
  open(m: string): void {
    this.mensajes.push(m);
  }
}

describe('zz existentes: la fila "quedó debiendo · cobrada" de la captura', () => {
  let fixture: ComponentFixture<LiquidacionDetailDialog>;
  let servicio: ServicioFalso;
  let snackbar: SnackbarFalso;
  let confirmaciones: ConfirmData[];
  let respuesta: unknown;

  const armar = async (item: Liquidacion): Promise<void> => {
    TestBed.resetTestingModule();
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
    spyOn(fixture.debugElement.injector.get(MatDialog), 'open').and.callFake(
      (_c: unknown, config?: { data?: ConfirmData }) => {
        if (config?.data) confirmaciones.push(config.data);
        return { afterClosed: () => of(respuesta) } as ReturnType<MatDialog['open']>;
      },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const pantalla = () => ({
    chip: leido(fixture.nativeElement.querySelector('.info app-estado-chip')),
    pasoActual: leido(fixture.nativeElement.querySelector('.paso.actual')),
    ayuda: leido(fixture.nativeElement.querySelector('app-liquidacion-estado-stepper .ayuda')),
    botones: Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button'))
      .map((b) => leido(b as Element))
      .filter((t) => t !== ''),
    candados: Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions .nota-recalcular')).map(
      (n) => leido(n as Element),
    ),
    motivoNoRecalcular: fixture.componentInstance.motivoNoRecalcular(),
    motivoNoAnular: fixture.componentInstance.motivoNoAnular(),
    motivoNoPagar: fixture.componentInstance.motivoNoPagar(),
    notaLeDebe: leido(fixture.nativeElement.querySelector('.nota-le-debe')),
    notaCero: leido(fixture.nativeElement.querySelector('.nota-saldo-cero')),
  });

  const tiene = (lista: string[], texto: string): boolean => lista.some((b) => b.includes(texto));

  it('(1) proveedor, deuda YA cobrada: qué dice y qué botones quedan', async () => {
    await armar(base(COBRADA));
    const p = pantalla();
    console.log('[zz cobrada proveedor]', JSON.stringify(p, null, 1));

    expect(p.chip).toBe(PD);
    expect(p.pasoActual).toContain('Pagada');
    expect(p.notaLeDebe).toContain('YA se le cobró en la liquidación del 16/06/2026 al 30/06/2026');
    // Ninguna acción que mueva plata o estado; solo los papeles y los candados.
    expect(tiene(p.botones, 'Pagar')).toBeFalse();
    expect(tiene(p.botones, 'Marcar pagada')).toBeFalse();
    expect(tiene(p.botones, 'Aprobar')).toBeFalse();
    expect(p.botones.some((b) => b.endsWith('Anular'))).toBeFalse();
    expect(tiene(p.botones, 'Corregir esta quincena')).toBeFalse();
    expect(p.botones.some((b) => b.endsWith('Recalcular'))).toBeFalse();
    expect(tiene(p.candados, 'No se puede recalcular')).toBeTrue();
    expect(tiene(p.candados, 'No se puede anular')).toBeTrue();
    expect(tiene(p.candados, 'No hay nada que pagar')).toBeTrue();
    expect(tiene(p.candados, 'No se puede corregir')).toBeFalse();
  });

  it('(2) transportador, deuda YA cobrada: lo mismo', async () => {
    await armar(
      base({
        ...COBRADA,
        tipo: 'transportador',
        proveedor_id: null,
        proveedor_nombre: null,
        transportador_id: 't-1',
        transportador_nombre: 'Transportes RES',
        valor_bruto: '0',
        valor_transporte: '200',
        valor_total: '200',
        anticipos: '600',
        neto_a_pagar: '-400',
        saldo: '-400',
        le_queda_debiendo: '400',
      }),
    );
    const p = pantalla();
    console.log('[zz cobrada transportador]', JSON.stringify(p, null, 1));
    expect(p.chip).toBe(PD);
    expect(tiene(p.botones, 'Pagar')).toBeFalse();
    expect(p.botones.some((b) => b.endsWith('Anular'))).toBeFalse();
    expect(tiene(p.candados, 'No hay nada que pagar')).toBeTrue();
  });

  it('(3) deuda PENDIENTE: el chip dice pagada y al lado queda "Anular"', async () => {
    await armar(base({ estado_visible: PD }));
    const p = pantalla();
    console.log('[zz pendiente]', JSON.stringify(p, null, 1));
    expect(p.chip).toBe(PD);
    expect(p.botones.some((b) => b.endsWith('Anular'))).toBeTrue();
    expect(tiene(p.botones, 'Pagar')).toBeFalse();
    // El candado de Recalcular le habla de una "aprobada" a la que "todavía no se le ha
    // pagado nada", al lado de un chip que dice "Pagada".
    expect(p.motivoNoRecalcular).toContain('Está aprobada');
    expect(p.motivoNoRecalcular).toContain('todavía no se le ha pagado nada');
  });

  it('(4) la SIGUIENTE, en cero por la deuda: chip "Aprobada", botón "Marcar pagada" y el servidor lo rebota', async () => {
    const MENSAJE_DEL_SERVIDOR =
      "Esta liquidación no hay que pagarla: no queda un peso por entregar —lo que el " +
      'tercero quedó debiendo de la quincena pasada ($120.000) se llevó lo que faltaba del ' +
      "neto—. Déjela en 'aprobada': marcarla pagada sin que salga un peso trabaría los días " +
      'de la quincena con un aviso que no es cierto';
    await armar(
      base({
        id: 'l-q2',
        periodo_inicio: '2026-06-16',
        periodo_fin: '2026-06-30',
        estado_visible: 'aprobada',
        precio_promedio: '1200',
        valor_bruto: '120000',
        valor_total: '120000',
        anticipos: '0',
        saldo_anterior: '120000',
        deudas_cobradas: [
          {
            id: 'l-q1',
            periodo_inicio: '2026-06-01',
            periodo_fin: '2026-06-15',
            periodo_texto: '01/06/2026 al 15/06/2026',
            le_queda_debiendo: '120000',
          },
        ],
        neto_a_pagar: '0',
        saldo: '0',
        le_queda_debiendo: '0',
        detalles: [det('d-2', '2026-06-20', '100', '1200', '120000')],
      } as Partial<Liquidacion>),
    );
    const p = pantalla();
    console.log('[zz siguiente en cero]', JSON.stringify(p, null, 1));
    expect(p.chip).toBe('aprobada');
    expect(p.ayuda).toContain('usa "Pagar" cuando entregues el dinero');
    expect(tiene(p.botones, 'Marcar pagada')).toBeTrue();

    servicio.respuestaPagar = () =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: { error: { code: 'business_rule', detail: MENSAJE_DEL_SERVIDOR } },
          }),
      );
    respuesta = true; // el dueño confirma "Marcar pagada"
    const boton = Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button')).find(
      (b) => leido(b as Element).includes('Marcar pagada'),
    ) as HTMLButtonElement;
    boton.click();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    console.log('[zz siguiente en cero] confirmacion:', comoSeLee(confirmaciones[0]?.mensaje));
    console.log('[zz siguiente en cero] snackbar:', snackbar.mensajes);
    expect(confirmaciones.length).toBe(1);
    expect(servicio.pagos).toBe(1);
    expect(snackbar.mensajes).toContain(MENSAJE_DEL_SERVIDOR);
    expect(fixture.componentInstance.liq().estado).toBe('aprobada');
    // Y el botón sigue ahí para volver a oprimirlo.
    expect(tiene(pantalla().botones, 'Marcar pagada')).toBeTrue();
  });
});
