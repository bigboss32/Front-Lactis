import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatTabGroup } from '@angular/material/tabs';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Balance } from '../../core/models';
import { ContabilidadPage } from './contabilidad.page';
import { ContabilidadService } from './contabilidad.service';
import { notaQuincenasPorReparar } from './quincenas-por-reparar';

/**
 * EL BALANCE ES UNA LISTA DE PASIVOS, Y UN PASIVO NO PUEDE DESAPARECER SIN AVISO.
 *
 * La quincena de julio de Henri (90 L × $2.000 = $180.000 contra $300.000 de adelanto,
 * $120.000 de deuda borrada por la migración), corregida con un día olvidado de 100 L =
 * $200.000: saldo $200.000, y lo que de verdad falta entregarle es $80.000. El servidor no
 * deja pagarla hasta repararla y GET /contabilidad/balance da liquidaciones_por_pagar = 0:
 * la tarjeta decía "$ 0" y se leía como "no se le debe nada a nadie".
 */

const balance = (c: Partial<Balance>): Balance => ({
  fecha_corte: '2026-09-30',
  saldo_cajas: '0',
  saldo_bancos: '0',
  cartera_por_cobrar: '0',
  liquidaciones_por_pagar: '0.00',
  terceros_le_quedan_debiendo: '0.00',
  total_disponible: '0',
  ...c,
});

describe('Balance: la nota de las quincenas con deuda borrada al lado de "por pagar"', () => {
  let fixture: ComponentFixture<ContabilidadPage>;

  beforeEach(() => {
    try {
      sessionStorage.clear();
    } catch {
      /* sin almacenamiento: nada que limpiar */
    }
  });

  const armar = async (datos: Balance, permisos: string[] = ['liquidaciones']): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [ContabilidadPage, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        {
          provide: ContabilidadService,
          useValue: {
            estadoResultados: () => of(null),
            libroDiario: () => of(null),
            balance: () => of(datos),
          },
        },
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
    fixture = TestBed.createComponent(ContabilidadPage);
    fixture.detectChanges();
    await fixture.whenStable();
    // El balance es la tercera pestaña.
    const tabs = fixture.debugElement.query(By.directive(MatTabGroup))
      .componentInstance as MatTabGroup;
    tabs.selectedIndex = 2;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** La tarjeta "Liquidaciones por pagar", leída como la lee el dueño. */
  const tarjetaPorPagar = (): string => {
    const tarjetas = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.tarjeta-saldo'),
    ).map((t) => (t.textContent ?? '').replace(/\s+/g, ' ').trim());
    return tarjetas.find((t) => t.includes('Liquidaciones por pagar')) ?? '(no está)';
  };

  it('la de Henri ($0 por pagar, 1 por reparar): la tarjeta lo dice', async () => {
    await armar(balance({ quincenas_por_reparar: 1 }));

    expect(tarjetaPorPagar()).toContain(
      '1 quincena con deuda borrada por la migración no entra en esta cifra: hay que ' +
        'repararla (ver Liquidaciones)',
    );
  });

  it('sin permiso de Liquidaciones no lo manda allá', async () => {
    await armar(balance({ quincenas_por_reparar: 2 }), ['contabilidad']);

    expect(tarjetaPorPagar()).toContain(
      '2 quincenas con deuda borrada por la migración no entran en esta cifra: hay que ' +
        'repararlas',
    );
    expect(tarjetaPorPagar()).not.toContain('ver Liquidaciones');
  });

  it('sin quincenas por reparar ($550.000 de las sanas): solo la cifra', async () => {
    await armar(balance({ liquidaciones_por_pagar: '550000.00', quincenas_por_reparar: 0 }));

    expect(tarjetaPorPagar()).toContain('Liquidaciones por pagar');
    expect(tarjetaPorPagar()).not.toContain('deuda borrada');
  });

  it('una respuesta vieja, sin el campo: tampoco hay nota', async () => {
    await armar(balance({}));

    expect((fixture.nativeElement as HTMLElement).querySelector('.nota-reparar')).toBeNull();
  });
});

describe('notaQuincenasPorReparar: la misma redacción para el tablero y el balance', () => {
  it('cuenta quincenas, no pesos: la deuda borrada no es lo que se debe', () => {
    const nota = notaQuincenasPorReparar(1, true) ?? '';

    expect(nota).not.toContain('$');
    // Pagar está trabado en esas filas: la nota no puede mandar a pagarlas.
    expect(nota.toLowerCase()).not.toContain('pagar');
  });

  it('cero, ausente o basura: no hay nota', () => {
    expect(notaQuincenasPorReparar(0, true)).toBeNull();
    expect(notaQuincenasPorReparar(undefined, true)).toBeNull();
    expect(notaQuincenasPorReparar(null, true)).toBeNull();
    expect(notaQuincenasPorReparar(Number.NaN, true)).toBeNull();
  });
});
