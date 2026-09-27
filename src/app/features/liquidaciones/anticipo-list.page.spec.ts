import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { Anticipo } from '../../core/models';
import { AnticipoListPage } from './anticipo-list.page';
import { AnticiposService } from './anticipos.service';

/**
 * EL CANDADO DEL ANTICIPO DICE LA RAZÓN DEL SERVIDOR, NO UNA ADIVINADA.
 *
 * El adelanto de $300.000 de Beto está en una quincena 'aprobada' cuya deuda de $120.000
 * ya se cobró la siguiente: está trabado sin que haya salido un peso. El candado decía
 * "ya tiene un pago registrado. Elimine primero ese pago", y no hay ningún pago. El
 * backend manda el porqué en `candado_aviso`, con el mismo texto que daría el 422.
 */

const AVISO_DEL_SERVIDOR =
  'No se puede editar el anticipo de esta liquidación: lo que Beto Cobrada quedó ' +
  'debiendo ($ 120.000) ya se le cobró en la liquidación del 16/06/2026 al 30/06/2026.';

const anticipo = (c: Partial<Anticipo>): Anticipo =>
  ({
    id: 'a-1',
    empresa_id: 'e-1',
    estado: 'activo',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    tipo: 'proveedor',
    proveedor_id: 'p-b',
    transportador_id: null,
    empleado_id: null,
    proveedor_nombre: 'Beto Cobrada',
    tercero_nombre: 'Beto Cobrada',
    fecha: '2026-06-01',
    valor: '300000.00',
    observaciones: null,
    liquidacion_id: 'l-b',
    pago_empleado_id: null,
    aplicado: true,
    liquidacion_estado: 'aprobada',
    bloqueado: true,
    candado_aviso: null,
    ...c,
  }) as Anticipo;

const PAGINA = <T>(items: T[]) => ({ items, total: items.length, page: 1, page_size: 20, pages: 1 });

describe('AnticipoListPage: el porqué del candado', () => {
  let fixture: ComponentFixture<AnticipoListPage>;

  beforeEach(() => sessionStorage.clear());

  const armar = async (fila: Anticipo): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [AnticipoListPage, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
        { provide: ApiService, useValue: { get: () => of(PAGINA([])) } },
        {
          provide: AnticiposService,
          useValue: { list: () => of(PAGINA([fila])), sumaTotales: () => of(300000) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AnticipoListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const tooltipDelCandado = (): string =>
    fixture.debugElement.query(By.css('mat-icon.bloqueado')).injector.get(MatTooltip).message;

  it('con el aviso del servidor, el candado dice eso y nada más', async () => {
    await armar(anticipo({ candado_aviso: AVISO_DEL_SERVIDOR }));

    expect(tooltipDelCandado()).toBe(AVISO_DEL_SERVIDOR);
    expect(tooltipDelCandado()).not.toContain('Elimine primero ese pago');
  });

  it('el aviso manda aunque la quincena esté pagada: el servidor sabe más que el estado', async () => {
    const pagina = AnticipoListPage.prototype;
    expect(
      pagina.motivoDelCandado(
        anticipo({ liquidacion_estado: 'pagada', candado_aviso: AVISO_DEL_SERVIDOR }),
      ),
    ).toBe(AVISO_DEL_SERVIDOR);
  });

  it('sin el aviso (respuesta vieja), en una aprobada no manda a borrar un pago ni afirma que no lo hay', async () => {
    // Una 'aprobada' casi nunca tiene pagos, pero la de la deuda borrada por la migración
    // puede tener uno encima: el texto no dice ni lo uno ni lo otro.
    await armar(anticipo({}));

    expect(tooltipDelCandado()).toBe(
      'La liquidación en la que se descontó ya tiene sus cifras en firme: no se puede editar ' +
        'ni eliminar.',
    );
    expect(tooltipDelCandado()).not.toContain('pago registrado');
    expect(tooltipDelCandado()).not.toContain('ningún pago');
  });

  it('sin el aviso, en un borrador tampoco afirma que no hay pagos', () => {
    expect(
      AnticipoListPage.prototype.motivoDelCandado(anticipo({ liquidacion_estado: 'borrador' })),
    ).toBe('La liquidación en la que se descontó ya tiene sus cifras en firme: no se puede editar ni eliminar.');
  });

  it('sin el aviso, los textos de siempre donde sí son ciertos', () => {
    const motivo = (c: Partial<Anticipo>) => AnticipoListPage.prototype.motivoDelCandado(anticipo(c));

    expect(motivo({ liquidacion_estado: 'pagada' })).toBe(
      'La liquidación en la que se descontó ya se pagó. Si la cifra está mala, registre el ' +
        'ajuste en la quincena siguiente.',
    );
    // Una 'parcial' no siempre tiene un pago: la v2 que sus anticipos cubrían, corregida
    // hacia arriba, queda 'parcial' con pagado $0. No se afirma un pago ni se manda a
    // borrarlo.
    expect(motivo({ liquidacion_estado: 'parcial' })).toBe(
      'La liquidación en la que se descontó ya tiene sus cifras en firme (un abono o un ' +
        'comprobante corregido): no se puede editar ni eliminar.',
    );
    expect(motivo({ liquidacion_estado: 'parcial' })).not.toContain('Elimine primero ese pago');
    expect(motivo({ pago_empleado_id: 'n-1', liquidacion_id: null, liquidacion_estado: null })).toBe(
      'Ya se le descontó al empleado en un pago de nómina: no se puede editar ni eliminar.',
    );
    // Trabado sin quincena (el que una corrección soltó): tampoco inventa un pago.
    expect(motivo({ liquidacion_id: null, liquidacion_estado: null })).toBe(
      'Este anticipo quedó en firme: no se puede editar ni eliminar.',
    );
  });
});
