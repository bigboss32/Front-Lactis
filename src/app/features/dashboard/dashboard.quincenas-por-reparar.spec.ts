import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { Dashboard } from '../../core/models';
import { DashboardPage } from './dashboard.page';

/**
 * EL "$ 0 POR PAGAR" DEL TABLERO NO PUEDE CALLAR LA QUINCENA CON DEUDA BORRADA.
 *
 * La quincena de julio de Henri: 90 L × $2.000 = $180.000 contra $300.000 de adelanto; la
 * migración de los abonos le borró los $120.000 que él quedaba debiendo. Después se le
 * corrigió con un día olvidado de 100 L = $200.000: valor $380.000, anticipos $300.000,
 * pagado −$120.000, saldo $200.000, y lo que de verdad falta entregarle es $80.000. El
 * servidor no la deja pagar hasta repararla, así que no entra en "por pagar":
 * GET /reportes/dashboard da liquidaciones_por_pagar = 0 y le_quedan_debiendo = 0, y la
 * tarjeta lo decía sin una palabra.
 */

const tablero = (c: Partial<Dashboard>): Dashboard =>
  ({
    fecha: '2026-09-30',
    litros_hoy: '0',
    litros_quincena: '0',
    valor_leche_quincena: '0',
    produccion_kg_mes: '0',
    ventas_mes: '0',
    gastos_mes: '0',
    litros_quincena_anterior: '0',
    produccion_kg_mes_anterior: '0',
    ventas_mes_anterior: '0',
    gastos_mes_anterior: '0',
    cartera_pendiente: '0',
    liquidaciones_por_pagar: '0.00',
    terceros_le_quedan_debiendo: '0.00',
    alertas_no_leidas: 0,
    litros_por_dia: [],
    ventas_por_dia: [],
    gastos_por_categoria: [],
    produccion_por_tipo: [],
    top_proveedores: [],
    ...c,
  }) as Dashboard;

describe('Tablero: la nota de las quincenas con deuda borrada al lado de "por pagar"', () => {
  let fixture: ComponentFixture<DashboardPage>;

  const armar = async (datos: Dashboard, permisos: string[] = ['liquidaciones']): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [DashboardPage, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of(datos) } },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        {
          provide: AuthService,
          useValue: {
            hasPermission: (modulo: string) => permisos.includes(modulo),
            perfil: () => null,
            esSuperadmin: () => false,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** La tarjeta "Liquidaciones por pagar", leída como la lee el dueño. */
  const tarjetaPorPagar = (): string => {
    const tarjetas = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.kpi-card'),
    ).map((t) => (t.textContent ?? '').replace(/\s+/g, ' ').trim());
    return tarjetas.find((t) => t.includes('Liquidaciones por pagar')) ?? '(no está)';
  };

  it('la de Henri ($0 por pagar, 1 por reparar): la tarjeta lo dice', async () => {
    await armar(tablero({ quincenas_por_reparar: 1 }));

    expect(tarjetaPorPagar()).toContain(
      '1 quincena con deuda borrada por la migración no entra en esta cifra: hay que ' +
        'repararla (ver Liquidaciones)',
    );
  });

  it('con varias, en plural', async () => {
    await armar(tablero({ quincenas_por_reparar: 3 }));

    expect(tarjetaPorPagar()).toContain(
      '3 quincenas con deuda borrada por la migración no entran en esta cifra: hay que ' +
        'repararlas (ver Liquidaciones)',
    );
  });

  it('sin permiso de Liquidaciones no lo manda allá', async () => {
    await armar(tablero({ quincenas_por_reparar: 1 }), ['reportes']);

    expect(tarjetaPorPagar()).toContain('no entra en esta cifra: hay que repararla');
    expect(tarjetaPorPagar()).not.toContain('ver Liquidaciones');
  });

  it('sin quincenas por reparar ($550.000 de las sanas): solo la cifra', async () => {
    await armar(tablero({ liquidaciones_por_pagar: '550000.00', quincenas_por_reparar: 0 }));

    expect(tarjetaPorPagar()).not.toContain('deuda borrada');
    expect((fixture.nativeElement as HTMLElement).querySelector('.kpi-nota')).toBeNull();
  });

  it('una respuesta vieja, sin el campo: tampoco hay nota', async () => {
    await armar(tablero({}));

    expect((fixture.nativeElement as HTMLElement).querySelector('.kpi-nota')).toBeNull();
  });
});
