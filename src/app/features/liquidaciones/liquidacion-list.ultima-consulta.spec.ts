import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion, Page } from '../../core/models';
import { LiquidacionListPage } from './liquidacion-list.page';
import { LiquidacionesService, ResumenLiquidaciones } from './liquidaciones.service';

/**
 * LA ÚLTIMA CONSULTA MANDA: la respuesta vieja que llega tarde no pisa a la nueva.
 *
 * El caso, con los botones de quincena: un doble clic en "1.ª quincena" la marca y la
 * desmarca. Se piden dos listas —la del 1 al 15 y la de todo— y si la del 1 al 15 es la
 * lenta y llega de última, las fechas quedan vacías pero la tabla y las tarjetas siguen
 * siendo de ese período: cifras de una quincena que ninguna fecha en pantalla nombra.
 */

const liq = (id: string): Liquidacion =>
  ({
    id,
    empresa_id: 'e-1',
    estado: 'borrador',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    tipo: 'proveedor',
    proveedor_id: 'p-1',
    proveedor_nombre: id,
    transportador_id: null,
    transportador_nombre: null,
    periodo_inicio: '2026-10-01',
    periodo_fin: '2026-10-15',
    total_litros: '100',
    precio_promedio: '1800',
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
    detalles: [],
    pagos: [],
  }) as Liquidacion;

const pagina = (ids: string[]): Page<Liquidacion> => ({
  items: ids.map(liq),
  total: ids.length,
  page: 1,
  page_size: 20,
  pages: 1,
});

const resumenCon = (borradores: number): ResumenLiquidaciones => ({
  borradores,
  aprobadas: 0,
  saldo_aprobadas: '0.00',
  parciales: 0,
  saldo_parciales: '0.00',
  pagadas: 0,
  le_quedaron_debiendo: '0.00',
  liquidaciones_que_deben: 0,
});

interface FiltrosPedidos {
  desde?: string | null;
  hasta?: string | null;
}

/** Cada pedido queda abierto: la prueba decide en qué orden se contesta. */
class ServicioDiferido {
  listas: { filtros: FiltrosPedidos; salida: Subject<Page<Liquidacion>> }[] = [];
  resumenes: { filtros: FiltrosPedidos; salida: Subject<ResumenLiquidaciones> }[] = [];

  list(params?: FiltrosPedidos): Observable<Page<Liquidacion>> {
    const salida = new Subject<Page<Liquidacion>>();
    this.listas.push({ filtros: { desde: params?.desde, hasta: params?.hasta }, salida });
    return salida;
  }

  resumen(filtros: FiltrosPedidos): Observable<ResumenLiquidaciones> {
    const salida = new Subject<ResumenLiquidaciones>();
    this.resumenes.push({ filtros: { desde: filtros.desde, hasta: filtros.hasta }, salida });
    return salida;
  }
}

describe('LiquidacionListPage: la última consulta manda', () => {
  let fixture: ComponentFixture<LiquidacionListPage>;
  let servicio: ServicioDiferido;

  beforeEach(async () => {
    sessionStorage.clear();
    servicio = new ServicioDiferido();
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
    // La carga de entrada: se contesta de una vez para partir de una pantalla quieta.
    servicio.listas[0].salida.next(pagina(['de-entrada']));
    servicio.resumenes[0].salida.next(resumenCon(1));
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => sessionStorage.clear());

  const pantalla = () => fixture.componentInstance;
  const idsEnPantalla = (): string[] => pantalla().filas().map((fila) => fila.id);
  const primerBoton = (): HTMLButtonElement =>
    fixture.nativeElement.querySelectorAll('app-selector-quincena .q-btn')[0];
  const dobleClic = (): void => {
    primerBoton().click(); // marca la quincena
    primerBoton().click(); // y la desmarca
  };
  const asentar = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('el doble clic: si la respuesta de la quincena llega DESPUÉS de la de "todo", la tabla es la de todo', async () => {
    dobleClic();
    const marcar = servicio.listas[1];
    const desmarcar = servicio.listas[2];
    expect(marcar.filtros.desde).not.toBeNull();
    expect(desmarcar.filtros).toEqual({ desde: null, hasta: null });

    desmarcar.salida.next(pagina(['a-1', 'a-2']));
    await asentar();
    marcar.salida.next(pagina(['solo-quincena']));
    await asentar();

    expect(pantalla().desde.value).toBeNull();
    expect(idsEnPantalla()).toEqual(['a-1', 'a-2']);
    expect(pantalla().total()).toBe(2);
    expect(pantalla().cargando()).toBeFalse();
  });

  it('la respuesta vieja que llega ANTES no apaga el "cargando" ni cambia la tabla', async () => {
    dobleClic();
    const marcar = servicio.listas[1];
    const desmarcar = servicio.listas[2];

    marcar.salida.next(pagina(['solo-quincena']));
    await asentar();

    expect(idsEnPantalla()).toEqual(['de-entrada']);
    expect(pantalla().cargando()).toBeTrue();

    desmarcar.salida.next(pagina(['a-1', 'a-2']));
    await asentar();

    expect(idsEnPantalla()).toEqual(['a-1', 'a-2']);
    expect(pantalla().cargando()).toBeFalse();
  });

  it('las tarjetas igual: las de la consulta vieja no pisan a las nuevas', async () => {
    dobleClic();
    const marcar = servicio.resumenes[1];
    const desmarcar = servicio.resumenes[2];

    desmarcar.salida.next(resumenCon(7));
    await asentar();
    marcar.salida.next(resumenCon(3));
    await asentar();

    expect(pantalla().resumen()?.borradores).toBe(7);
  });

  it('un error de la consulta vieja, después de que la nueva respondió bien, no tumba la pantalla', async () => {
    dobleClic();
    const marcar = servicio.listas[1];
    const desmarcar = servicio.listas[2];
    const marcarResumen = servicio.resumenes[1];
    const desmarcarResumen = servicio.resumenes[2];

    desmarcar.salida.next(pagina(['a-1']));
    desmarcarResumen.salida.next(resumenCon(4));
    await asentar();
    marcar.salida.error(new Error('se cortó'));
    marcarResumen.salida.error(new Error('se cortó'));
    await asentar();

    expect(pantalla().errorCarga()).toBeNull();
    expect(idsEnPantalla()).toEqual(['a-1']);
    expect(pantalla().resumen()?.borradores).toBe(4);
    expect(pantalla().resumenFallo()).toBeNull();
  });

  it('con una sola consulta en camino todo sigue igual: se contesta y se pinta', async () => {
    primerBoton().click();
    servicio.listas[1].salida.next(pagina(['q-1']));
    servicio.resumenes[1].salida.next(resumenCon(9));
    await asentar();

    expect(idsEnPantalla()).toEqual(['q-1']);
    expect(pantalla().resumen()?.borradores).toBe(9);
    expect(pantalla().cargando()).toBeFalse();
  });
});
