import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, of } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { Gasto, Page } from '../../core/models';
import { GastoListPage } from './gasto-list.page';
import { GastoFiltro, GastosService } from './gastos.service';

/**
 * LA PANTALLA DE GASTOS: EL TOTAL DE LO FILTRADO Y LA FACTURA.
 *
 * Lo que pidió el dueño, textual: "que se vea el valor total dependiendo los
 * filtros, y que se le pueda subir la factura".
 *
 * Lo que se mide acá:
 *
 *   · EL TOTAL SALE DEL SERVIDOR Y NO DE LA PÁGINA. Sumar en la pantalla las
 *     filas que llegaron sería sumar veinte de sesenta, y el dueño creería que
 *     ese es el gasto del mes. Se prueba que la cifra es la del servidor y que se
 *     le mandan LOS MISMOS filtros que a la tabla.
 *   · EL CLIP SALE SIEMPRE, con el número cuando ya hay facturas: es lo que
 *     permite ver de un vistazo a cuáles les falta.
 *   · LA FACTURA VIEJA —la que quedó en la carpeta pública del servidor— se sigue
 *     pudiendo abrir, para no esconderle nada de lo que ya había subido.
 */

const gasto = (cambios: Partial<Gasto> = {}): Gasto => ({
  id: 'g-1',
  empresa_id: 'e-1',
  estado: 'activo',
  created_at: '2026-07-03T00:00:00Z',
  updated_at: '2026-07-03T00:00:00Z',
  fecha: '2026-07-03',
  categoria_id: 'c-1',
  categoria_nombre: 'Combustible',
  concepto: 'ACPM del camión',
  proveedor: 'Terpel',
  cantidad: null,
  precio_unitario: null,
  valor: '242760.75',
  numero_factura: 'F-001',
  observaciones: null,
  adjunto_url: null,
  adjuntos_count: 0,
  sucursal_id: null,
  ...cambios,
});

class ServicioFalso {
  filas: Gasto[] = [];
  suma = 0;
  /** Lo que se le pidió, para comprobar que la tabla y el total van juntos. */
  filtrosDeLaTabla: GastoFiltro[] = [];
  filtrosDelTotal: GastoFiltro[] = [];

  filtrar(opts: GastoFiltro = {}): Observable<Page<Gasto>> {
    this.filtrosDeLaTabla.push(opts);
    return of({
      items: this.filas,
      total: this.filas.length,
      page: 1,
      page_size: 20,
      pages: 1,
    });
  }

  sumaTotales(opts: GastoFiltro = {}): Observable<number> {
    this.filtrosDelTotal.push(opts);
    return of(this.suma);
  }

  adjuntos = () => of({ disponible: true, mensaje: null, cupo_restante: 20, adjuntos: [] });
  subirAdjuntos = () => of({ progreso: 100 });
  compartirAdjunto = () => of(null as never);
  eliminarAdjunto = () => of(undefined);
  remove = () => of(undefined);
}

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

describe('GastoListPage: el total de lo filtrado y la factura', () => {
  let fixture: ComponentFixture<GastoListPage>;
  let servicio: ServicioFalso;
  let abiertos: unknown[];

  const armar = async (filas: Gasto[], suma = 0): Promise<void> => {
    servicio = new ServicioFalso();
    servicio.filas = filas;
    servicio.suma = suma;
    abiertos = [];
    await TestBed.configureTestingModule({
      imports: [GastoListPage, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: GastosService, useValue: servicio },
        // La página pide las categorías por el ApiService directo.
        {
          provide: ApiService,
          useValue: {
            get: () => of({ items: [], total: 0, page: 1, page_size: 100, pages: 1 }),
          },
        },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        {
          provide: MatDialog,
          useValue: {
            open: (componente: unknown, config: unknown) => {
              abiertos.push({ componente, config });
              return { afterClosed: () => of(null) };
            },
          },
        },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(GastoListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** La barra de filtros, como se lee. */
  const barra = (): string =>
    comoSeLee((fixture.nativeElement.querySelector('.page-toolbar') as HTMLElement)?.textContent);

  const celdasDeFactura = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('td[data-label="Factura"]'));

  // ------------------------------------------------------------- el total
  it('el total que se muestra es el del SERVIDOR, no el de las filas de la página', async () => {
    // La página trae dos filas de $242.760,75 —$485.521,50 sumadas— pero el
    // filtro alcanza mucho más: el total tiene que ser el que dice el servidor.
    await armar([gasto(), gasto({ id: 'g-2' })], 1386077.44);

    expect(barra()).toContain('Total gastos:');
    expect(barra()).toContain('$ 1.386.077');
    expect(barra()).not.toContain('485.521');
  });

  it('el total y la tabla reciben LOS MISMOS filtros', async () => {
    await armar([gasto()], 242760.75);
    fixture.componentInstance.buscar.setValue('Terpel');
    fixture.componentInstance.categoria.setValue('c-1');
    await fixture.componentInstance.cargar();

    const tabla = servicio.filtrosDeLaTabla.at(-1)!;
    const total = servicio.filtrosDelTotal.at(-1)!;
    // Uno pagina y el otro no, pero los CUATRO filtros tienen que coincidir: si
    // se separan, la tabla muestra unas filas y el total suma otras.
    expect(total.search).toBe(tabla.search);
    expect(total.categoria_id).toBe(tabla.categoria_id);
    expect(total.desde).toBe(tabla.desde);
    expect(total.hasta).toBe(tabla.hasta);
    expect(tabla.search).toBe('Terpel');
    expect(tabla.categoria_id).toBe('c-1');
  });

  it('en cero se muestra $ 0 y no se deja el renglón en blanco', async () => {
    await armar([], 0);
    expect(barra()).toContain('Total gastos:');
    expect(barra()).toContain('$ 0');
  });

  // ----------------------------------------------------------- la factura
  it('el clip sale SIEMPRE, también en el gasto que no tiene factura', async () => {
    await armar([gasto({ adjuntos_count: 0 })]);

    const boton = celdasDeFactura()[0].querySelector('button');
    expect(boton).toBeTruthy();
    expect(boton!.getAttribute('aria-label')).toContain('Sin factura');
    // Sin facturas no hay número encima: el punto vacío confundiría.
    expect(celdasDeFactura()[0].querySelector('.badge-adjuntos')).toBeNull();
  });

  it('con facturas el clip lleva el número encima', async () => {
    await armar([gasto({ adjuntos_count: 3 })]);

    const celda = celdasDeFactura()[0];
    expect(comoSeLee(celda.querySelector('.badge-adjuntos')?.textContent)).toBe('3');
    expect(celda.querySelector('button')!.getAttribute('aria-label')).toContain('3');
  });

  it('tocar el clip abre las facturas de ESE gasto, con sus tres permisos', async () => {
    await armar([gasto({ id: 'g-7', concepto: 'Energía de julio' })]);

    celdasDeFactura()[0].querySelector('button')!.click();
    fixture.detectChanges();

    const { config } = abiertos[0] as { config: { data: Record<string, unknown> } };
    expect(config.data['titulo']).toContain('Energía de julio');
    // NO "Soportes de pago": una factura no dice que el gasto ya se pagó.
    expect(config.data['encabezado']).toBe('Factura del gasto');
    expect(config.data['permisos']).toEqual({
      subir: 'gastos:editar',
      compartir: 'gastos:exportar',
      eliminar: 'gastos:eliminar',
    });
    // Las cuatro llamadas van amarradas al gasto de la fila.
    (config.data['listar'] as () => void)();
    expect(typeof config.data['subir']).toBe('function');
  });

  it('la factura vieja se sigue pudiendo abrir, y se dice que es la de antes', async () => {
    await armar([gasto({ adjunto_url: 'e-1/gastos/factura.png' })]);

    const enlace = celdasDeFactura()[0].querySelector('a');
    expect(enlace).toBeTruthy();
    expect(enlace!.getAttribute('href')).toContain('e-1/gastos/factura.png');
    expect(enlace!.getAttribute('target')).toBe('_blank');
    // El clip nuevo sigue estando: la factura vieja no lo reemplaza.
    expect(celdasDeFactura()[0].querySelector('button')).toBeTruthy();
  });

  it('sin factura vieja no se pinta ningún enlace al servidor', async () => {
    await armar([gasto({ adjunto_url: null })]);
    expect(celdasDeFactura()[0].querySelector('a')).toBeNull();
  });
});
