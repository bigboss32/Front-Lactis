import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Page, Transportador } from '../../core/models';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { TransportadorListPage } from './transportador-list.page';
import { TransportadoresService } from './transportadores.service';

/**
 * La tabla tiene que dejar leer de un vistazo CUÁNTO se le paga en cada ruta.
 *
 * Los tres casos que hay que ver: el señor de dos rutas (el de Alex Agudelo), uno
 * sin ninguna —que cobra solo la tarifa general— y uno de cuatro. Y las tarifas van
 * CON CENTAVOS: $242,76 leído como "$ 243" es una cifra que no se paga.
 */

const transportador = (
  id: string,
  nombre: string,
  rutas: {
    ruta_id: string;
    nombre: string | null;
    valor_transporte: string;
    ruta_borrada?: boolean;
  }[],
): Transportador => ({
  id,
  empresa_id: 'e-1',
  estado: 'activo',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  nombre,
  documento: '1094',
  telefono: '3115550000',
  valor_transporte: '238.00',
  rutas,
});

const FILAS: Transportador[] = [
  transportador('t-1', 'Alex Agudelo', [
    { ruta_id: 'r-1', nombre: 'Nápoles', valor_transporte: '242.76' },
    { ruta_id: 'r-2', nombre: 'Mira Valle', valor_transporte: '300.00' },
  ]),
  transportador('t-2', 'Sin Rutas Pérez', []),
  transportador('t-3', 'Cuatro Rutas', [
    { ruta_id: 'r-1', nombre: 'Nápoles', valor_transporte: '242.76' },
    { ruta_id: 'r-2', nombre: 'Mira Valle', valor_transporte: '300.00' },
    { ruta_id: 'r-3', nombre: 'San Vicente', valor_transporte: '1250.50' },
    // Ruta borrada después de asignarla: el API manda el nombre en nulo.
    { ruta_id: 'r-4', nombre: null, valor_transporte: '180.00' },
  ]),
  // Ruta borrada de la que TODAVÍA se sabe el nombre: es lo que manda el backend
  // cuando marca la ruta como borrada (`ruta_borrada`) en vez de perder el nombre.
  transportador('t-4', 'Con Ruta Borrada', [
    { ruta_id: 'r-5', nombre: 'La Y', valor_transporte: '210.00', ruta_borrada: true },
  ]),
];

class ServicioFalso {
  list(): Observable<Page<Transportador>> {
    return of({ items: FILAS, total: FILAS.length, page: 1, page_size: 20, pages: 1 });
  }
}

describe('TransportadorListPage: rutas y tarifa en la tabla', () => {
  let fixture: ComponentFixture<TransportadorListPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransportadorListPage, NoopAnimationsModule],
      providers: [
        { provide: TransportadoresService, useValue: new ServicioFalso() },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        { provide: EstadoFiltrosService, useValue: { vincular: () => {} } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TransportadorListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  /** Los renglones de la celda "Rutas y tarifa" de una fila. */
  const rutasDeLaFila = (i: number): string[] => {
    const filas = fixture.nativeElement.querySelectorAll('tr.mat-mdc-row');
    return Array.from((filas[i] as HTMLElement).querySelectorAll('ul.rutas li')).map((li) =>
      // El espacio duro de Intl ("$ 242,76") se normaliza; entre el nombre y la
      // tarifa no hay texto, los separa el `gap` del CSS.
      ((li as HTMLElement).textContent ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(),
    );
  };

  it('el de dos rutas las muestra las dos con su tarifa, con centavos', async () => {
    // $242,76 y no "$ 243": es la cifra por la que se multiplican los litros.
    // Y POR NOMBRE, no en el orden que manda el API (que es por id de ruta, un
    // UUID): el PDF del comprobante imprime los renglones del día por nombre de
    // ruta, y el dueño compara la pantalla con el papel.
    expect(rutasDeLaFila(0)).toEqual(['Mira Valle$ 300/L', 'Nápoles$ 242,76/L']);
  });

  it('el que no tiene rutas propias no muestra ninguna', async () => {
    expect(rutasDeLaFila(1)).toEqual([]);
    const celda = (
      fixture.nativeElement.querySelectorAll('tr.mat-mdc-row')[1] as HTMLElement
    ).querySelectorAll('td')[3];
    expect((celda.textContent ?? '').trim()).toBe('—');
  });

  it('el de cuatro rutas las muestra las cuatro, y la borrada con nombre de relleno', async () => {
    // Alfabético, y la que llegó sin nombre de última: no hay por dónde ordenarla.
    // "$ 1.250,50" y no "$ 1.250,5": un solo decimal en plata se lee como si se
    // hubiera perdido un centavo, y el PDF de esa misma tarifa imprime los dos.
    expect(rutasDeLaFila(2)).toEqual([
      'Mira Valle$ 300/L',
      'Nápoles$ 242,76/L',
      'San Vicente$ 1.250,50/L',
      'Ruta sin nombre$ 180/L',
    ]);
  });

  it('la ruta borrada se marca sin esconder la tarifa', async () => {
    // La tarifa es plata que está guardada y se sigue viendo; lo que hay que poder
    // saber es que esa ruta ya no está en el catálogo, o el dueño se pone a
    // buscarla en Rutas.
    expect(rutasDeLaFila(3)).toEqual(['La Y(borrada)$ 210/L']);
  });

  it('la tarifa general va aparte de las de las rutas', async () => {
    const celda = (
      fixture.nativeElement.querySelectorAll('tr.mat-mdc-row')[0] as HTMLElement
    ).querySelectorAll('td')[4];
    expect((celda.textContent ?? '').replace(/\u00a0/g, ' ').trim()).toBe('$ 238');
  });
});
