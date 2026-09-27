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
 * LAS TARJETAS DEL LISTADO CON LAS QUINCENAS QUE YA EXISTEN.
 *
 * El falso de acá imita al servidor DE VERDAD en las tres cosas que importan para las
 * tarjetas: la partición por estado de `listar_filtrado` (service.py:4681-4693), el orden
 * `periodo_inicio DESC` (repository.py:26) y el corte de `page_size` (máximo 200) con el
 * `total` completo aparte. El falso del spec de la página no corta por página.
 */

const PD = 'pagada · quedó debiendo';

const liq = (c: Partial<Liquidacion>): Liquidacion => ({
  id: 'x',
  empresa_id: 'e-1',
  estado: 'aprobada',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Rosa',
  transportador_id: null,
  transportador_nombre: null,
  periodo_inicio: '2026-07-01',
  periodo_fin: '2026-07-15',
  total_litros: '100',
  precio_promedio: '2000',
  valor_bruto: '0',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '0',
  anticipos: '0',
  valor_total: '0',
  neto_a_pagar: '0',
  pagado: '0',
  saldo: '0',
  le_queda_debiendo: '0',
  observaciones: null,
  detalles: [],
  pagos: [],
  ...c,
});

/** Regla del backend (models.py:317-322), para armar filas como las manda la API. */
const conRotulo = (f: Liquidacion): Liquidacion => {
  const saldo = Number(f.saldo);
  const debe = saldo < 0 ? -saldo : 0;
  const firme = ['aprobada', 'parcial', 'pagada'].includes(f.estado);
  return {
    ...f,
    le_queda_debiendo: String(debe),
    estado_visible: firme && debe > 0 ? PD : f.estado,
  };
};

class ServidorConPaginas {
  filas: Liquidacion[] = [];
  /** true = el servidor de ANTES del cambio (filtraba `estado` pelado). */
  comoAntes = false;

  list(params?: { estado?: string | null; page_size?: number; page?: number }): Observable<Page<Liquidacion>> {
    const estado = params?.estado;
    const enFirme = ['aprobada', 'parcial', 'pagada'];
    const debe = (f: Liquidacion) => Number(f.saldo) < 0;
    const todas = this.filas
      .filter((f) => {
        if (!estado) return true;
        if (this.comoAntes) return f.estado === estado;
        if (estado === 'pagada') return f.estado === 'pagada' || (enFirme.includes(f.estado) && debe(f));
        if (estado === 'aprobada' || estado === 'parcial') return f.estado === estado && !debe(f);
        return f.estado === estado;
      })
      .sort((a, b) => b.periodo_inicio.localeCompare(a.periodo_inicio));
    const size = Math.min(params?.page_size ?? 20, 200);
    const page = params?.page ?? 1;
    const items = todas.slice((page - 1) * size, page * size);
    return of({ items, total: todas.length, page, page_size: size, pages: Math.ceil(todas.length / size) });
  }
}

describe('zz existentes: tarjetas del listado con las quincenas que ya están en la base', () => {
  let fixture: ComponentFixture<LiquidacionListPage>;

  const limpiar = () => {
    try {
      sessionStorage.removeItem('qe.filtros.liquidaciones');
    } catch {
      /* nada */
    }
  };
  beforeEach(limpiar);
  afterEach(limpiar);

  const armar = async (servidor: ServidorConPaginas): Promise<void> => {
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
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const textoTarjetas = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.tarjeta')).map((t) =>
      ((t as HTMLElement).textContent ?? '').replace(/\s+/g, ' ').trim(),
    );

  /** El catálogo de formas existentes (mismo que tests/test_zz_existentes_filtro.py). */
  const catalogo = (): Liquidacion[] =>
    [
      liq({ id: 'borr_normal', estado: 'borrador', periodo_inicio: '2026-08-01', saldo: '300000' }),
      liq({ id: 'borr_debe', estado: 'borrador', periodo_inicio: '2026-08-01', saldo: '-120000' }),
      liq({ id: 'apr_por_pagar', estado: 'aprobada', periodo_inicio: '2026-07-16', saldo: '300000' }),
      liq({ id: 'apr_cero', estado: 'aprobada', periodo_inicio: '2026-07-16', saldo: '0' }),
      liq({ id: 'apr_debe', estado: 'aprobada', periodo_inicio: '2026-07-16', saldo: '-200000' }),
      liq({ id: 'apr_debe_cobrada', estado: 'aprobada', saldo: '-120000', deuda_trasladada_a_id: 'apr_cobra_anterior' }),
      liq({ id: 'apr_cobra_anterior', estado: 'aprobada', periodo_inicio: '2026-07-16', saldo: '280000', saldo_anterior: '120000' }),
      liq({ id: 'parc_normal', estado: 'parcial', periodo_inicio: '2026-07-16', saldo: '300000', pagado: '200000' }),
      liq({ id: 'pag_normal', estado: 'pagada', saldo: '0', pagado: '400000' }),
      liq({ id: 'pag_vieja_debe', estado: 'pagada', saldo: '-120000' }),
      liq({ id: 'pag_vieja_debe_cobrada', estado: 'pagada', saldo: '-50000', deuda_trasladada_a_id: 'apr_debe' }),
      liq({ id: 'anu_debe', estado: 'anulada', periodo_inicio: '2026-08-01', saldo: '-300000' }),
    ].map(conRotulo);

  it('con las filas que ya existen, cada tarjeta cuenta lo que dice el chip', async () => {
    const servidor = new ServidorConPaginas();
    servidor.filas = catalogo();
    await armar(servidor);
    const r = fixture.componentInstance.resumen()!;
    const chips = servidor.filas.map((f) => f.estado_visible);

    expect(r.borradores).toBe(chips.filter((c) => c === 'borrador').length);
    expect(r.aprobadas).toBe(chips.filter((c) => c === 'aprobada').length);
    expect(r.pagadas).toBe(chips.filter((c) => c === 'pagada' || c === PD).length);
    // $300.000 + $0 + $280.000: ninguna "pagada · quedó debiendo" suma en "por pagar".
    expect(r.saldoAprobadas).toBe(580000);
    // borr_debe $120.000 + apr_debe $200.000 + pag_vieja_debe $120.000. Ni cobradas ni anulada.
    expect(r.leQuedaronDebiendo).toBe(440000);
    expect(r.liquidacionesQueDeben).toBe(3);
  });

  it('pasadas 200 pagadas, la deuda vieja sin cobrar desaparece de la tarjeta (antes no)', async () => {
    const filas: Liquidacion[] = [
      // Quedó debiendo $120.000 en enero de 2025 y no volvió a entregar leche.
      liq({ id: 'deuda_vieja', estado: 'aprobada', periodo_inicio: '2025-01-01', saldo: '-120000' }),
    ];
    for (let i = 0; i < 200; i++) {
      const d = new Date(Date.UTC(2025, 0, 16 + i * 2)).toISOString().slice(0, 10);
      filas.push(liq({ id: `p${i}`, estado: 'pagada', periodo_inicio: d, saldo: '0', pagado: '100000' }));
    }

    const ahora = new ServidorConPaginas();
    ahora.filas = filas.map(conRotulo);
    await armar(ahora);
    const r = fixture.componentInstance.resumen()!;
    console.log(
      `[zz] ahora: pagadas=${r.pagadas} leQuedaronDebiendo=${r.leQuedaronDebiendo} ` +
        `tarjetas=${JSON.stringify(textoTarjetas())}`,
    );
    expect(r.pagadas).toBe(201);
    expect(r.leQuedaronDebiendo).toBe(0);
    expect(textoTarjetas().some((t) => t.includes('Le quedaron debiendo'))).toBeFalse();

    TestBed.resetTestingModule();
    const antes = new ServidorConPaginas();
    antes.comoAntes = true;
    antes.filas = filas.map(conRotulo);
    await armar(antes);
    const r2 = fixture.componentInstance.resumen()!;
    console.log(`[zz] antes: leQuedaronDebiendo=${r2.leQuedaronDebiendo}`);
    expect(r2.leQuedaronDebiendo).toBe(120000);
  });
});
