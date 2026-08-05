import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Page } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { ReventaProductoFormDialog } from './producto-form.dialog';
import { ReventaProductosPage } from './productos.page';
import { ProductoReventa, ReventaService } from './reventa.service';

/**
 * LA PESTAÑA DE PRODUCTOS.
 *
 * Lo que estas pruebas cuidan:
 *  · que la lista sea CORTA y sin códigos: el producto, cómo se mide, si ya se
 *    registra y su estado — y que la clave interna ('queso') no se le muestre al
 *    dueño en ninguna parte, porque renombrar es justamente lo que la clave permite
 *    sin que nadie se entere;
 *  · que la columna "¿Ya se registra?" diga la verdad de este corte producto por
 *    producto, y que la nota que lo explica salga SOLO cuando hay un producto que
 *    todavía no se ofrece;
 *  · que quitar un producto con movimientos muestre EL MENSAJE DEL SERVIDOR —el que
 *    trae la cuenta exacta de compras y ventas y la salida— en una caja que no
 *    desaparece sola;
 *  · que desactivar pase por confirmación y mande `estado: 'inactivo'`, que es la
 *    salida real de un producto que ya se movió;
 *  · y que en celular cada celda se lea "Etiqueta: valor".
 */

const producto = (datos: Partial<ProductoReventa>): ProductoReventa =>
  ({
    id: 'p-x',
    empresa_id: 'e-1',
    estado: 'activo',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    nombre: 'Queso',
    clave: 'queso',
    unidad: 'kg',
    decimales: 2,
    subproducto_de_id: null,
    subproducto_de_nombre: null,
    admite_ajustes: true,
    se_pesa: true,
    orden: 0,
    ...datos,
  }) as ProductoReventa;

/** Los tres que trae toda empresa, más uno que el dueño acabó de agregar. */
const QUESO = producto({ id: 'p-1', nombre: 'Queso', clave: 'queso', orden: 0 });
const BORONA = producto({
  id: 'p-2',
  nombre: 'Borona',
  clave: 'borona',
  subproducto_de_id: 'p-1',
  subproducto_de_nombre: 'Queso',
  orden: 1,
});
const MOZZARELLA = producto({
  id: 'p-3',
  nombre: 'Mozzarella',
  clave: 'mozzarella',
  unidad: 'unidad',
  decimales: 0,
  admite_ajustes: false,
  se_pesa: false,
  orden: 2,
});
const CUAJADA = producto({ id: 'p-4', nombre: 'Cuajada', clave: 'cuajada', orden: 3 });

/** El rechazo real del backend al quitar un producto que ya se movió. */
const MENSAJE_CON_MOVIMIENTOS =
  "Solo se puede quitar un producto que no tenga movimientos: 'Queso' ya tiene 3 " +
  'compras y 2 ventas. Si ya no lo maneja, desactívelo: deja de aparecer al ' +
  'registrar y su historia se queda completa';

class ServicioFalso {
  productos: ProductoReventa[] = [];
  /** Cuántas veces se pidió la lista: sirve para comprobar que se recarga. */
  consultas = 0;
  quitados: string[] = [];
  ediciones: { id: string; payload: Record<string, unknown> }[] = [];
  errorAlQuitar: unknown = null;

  listarProductos(): Observable<Page<ProductoReventa>> {
    this.consultas += 1;
    return of({
      items: this.productos,
      total: this.productos.length,
      page: 1,
      page_size: 20,
      pages: 1,
    });
  }

  eliminarProducto(id: string): Observable<void> {
    if (this.errorAlQuitar) return throwError(() => this.errorAlQuitar);
    this.quitados.push(id);
    return of(undefined);
  }

  editarProducto(id: string, payload: Record<string, unknown>): Observable<ProductoReventa> {
    this.ediciones.push({ id, payload });
    return of(producto({ id, ...payload }));
  }
}

/** Un MatDialog de mentiras: guarda con qué se abrió y devuelve lo que se le diga. */
class DialogoFalso {
  abiertos: { componente: unknown; datos: unknown }[] = [];
  respuesta: unknown = null;

  open(componente: unknown, config?: { data?: unknown }): { afterClosed: () => Observable<unknown> } {
    this.abiertos.push({ componente, datos: config?.data });
    const respuesta = this.respuesta;
    return { afterClosed: () => of(respuesta) };
  }
}

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

describe('ReventaProductosPage: la lista de lo que se compra y se revende', () => {
  let fixture: ComponentFixture<ReventaProductosPage>;
  let pagina: ReventaProductosPage;
  let servicio: ServicioFalso;
  let dialogo: DialogoFalso;
  let avisos: string[];

  const armar = async (productos: ProductoReventa[]): Promise<void> => {
    // Los filtros se recuerdan en sessionStorage: sin limpiarla, el estado que dejó
    // otra prueba se restauraría y esta empezaría filtrando.
    sessionStorage.clear();
    TestBed.resetTestingModule();
    servicio = new ServicioFalso();
    servicio.productos = productos;
    dialogo = new DialogoFalso();
    avisos = [];
    await TestBed.configureTestingModule({
      imports: [ReventaProductosPage, NoopAnimationsModule],
      providers: [
        { provide: ReventaService, useValue: servicio },
        { provide: MatDialog, useValue: dialogo },
        {
          provide: MatSnackBar,
          useValue: {
            open: (mensaje: string) => {
              avisos.push(mensaje);
            },
          },
        },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ReventaProductosPage);
    pagina = fixture.componentInstance;
    await estabilizar();
  };

  const estabilizar = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const encabezados = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('th')).map((th) =>
      comoSeLee((th as HTMLElement).textContent),
    );

  const filas = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('tr.mat-mdc-row'));

  /** El texto de una celda de la fila, buscada por su rótulo de celular. */
  const celda = (fila: HTMLElement, rotulo: string): string =>
    comoSeLee(fila.querySelector(`td[data-label="${rotulo}"]`)?.textContent);

  const textoPantalla = (): string => comoSeLee(fixture.nativeElement.textContent);

  // --------------------------------------------------------- la lista, corta
  it('una fila por producto, con el nombre, cómo se mide y de quién es subproducto', async () => {
    await armar([QUESO, BORONA, MOZZARELLA]);

    expect(filas().length).withContext('tres productos, tres filas').toBe(3);
    expect(encabezados()).toEqual([
      'Producto',
      'Cómo se mide',
      '¿Ya se registra?',
      'Estado',
      '',
    ]);

    expect(celda(filas()[0], 'Producto')).toBe('Queso');
    expect(celda(filas()[0], 'Cómo se mide')).toBe('Por kilo Se pesa: admite decimales');
    // La borona dice de quién sale, en su propio renglón debajo del nombre: es lo que
    // hace que herede el costo del queso.
    expect(comoSeLee(filas()[1].querySelector('.nombre')?.textContent)).toBe('Borona');
    expect(comoSeLee(filas()[1].querySelector('.fina')?.textContent)).toBe(
      'Subproducto de Queso',
    );
    // La mozzarella se cuenta, y se dice que va en piezas enteras.
    expect(celda(filas()[2], 'Cómo se mide')).toBe('Por unidad Se cuenta: piezas enteras');
  });

  it('no se le muestra al dueño ninguna clave ni ningún código', async () => {
    await armar([QUESO, BORONA, MOZZARELLA]);

    // La clave es la identidad interna con la que las compras y las ventas nombran
    // al producto ('queso'), y es justo lo que permite renombrar sin romper nada.
    // En pantalla no aparece: el dueño ve "Queso", no un código.
    const texto = textoPantalla();
    expect(texto).toContain('Queso');
    expect(texto).not.toContain("'queso'");
    expect(encabezados()).not.toContain('Clave');
    expect(encabezados()).not.toContain('Decimales');
  });

  // ------------------------------------------- la verdad de este corte
  it('dice producto por producto si ya se ofrece al registrar', async () => {
    await armar([QUESO, BORONA, MOZZARELLA, CUAJADA]);

    expect(celda(filas()[0], '¿Ya se registra?')).toBe('Sí: se compra y se vende');
    // La borona solo se vende: entra gratis con el queso, no se le compra a nadie.
    expect(celda(filas()[1], '¿Ya se registra?')).toBe('Sí: se vende');
    expect(celda(filas()[2], '¿Ya se registra?')).toBe('Sí: se compra y se vende');
    // El que el dueño acabó de agregar TODAVÍA NO se ofrece al registrar, y se dice.
    expect(celda(filas()[3], '¿Ya se registra?')).toBe('Todavía no');
    expect(textoPantalla()).toContain('quedan guardados en la lista');
  });

  it('la nota de "todavía no" no aparece si todos los productos ya se registran', async () => {
    await armar([QUESO, BORONA, MOZZARELLA]);

    // Explicaría algo que no le pasó: los tres de siempre ya se ofrecen.
    expect(textoPantalla()).not.toContain('quedan guardados en la lista');
  });

  // ------------------------------------------------------------ quitar
  it('quitar un producto con movimientos muestra el mensaje del servidor, con su cuenta', async () => {
    await armar([QUESO, BORONA, MOZZARELLA]);
    servicio.errorAlQuitar = new HttpErrorResponse({
      status: 422,
      error: { error: { code: 'business_rule', detail: MENSAJE_CON_MOVIMIENTOS } },
    });
    dialogo.respuesta = true; // el dueño confirma en el diálogo

    pagina.quitar(QUESO);
    await estabilizar();

    // El mensaje va TAL CUAL: es el único que trae "3 compras y 2 ventas" y la salida.
    const aviso = fixture.nativeElement.querySelector('.aviso-quitar');
    expect(aviso).withContext('la caja del aviso está en pantalla').not.toBeNull();
    expect(comoSeLee(aviso.textContent)).toContain('ya tiene 3 compras y 2 ventas');
    expect(comoSeLee(aviso.textContent)).toContain('desactívelo');
    // Y el producto sigue en la lista: no se quitó nada.
    expect(servicio.quitados).toEqual([]);
    expect(filas().length).toBe(3);
  });

  it('quitar un producto sin movimientos lo saca y recarga la lista', async () => {
    await armar([QUESO, BORONA, MOZZARELLA, CUAJADA]);
    const consultasAntes = servicio.consultas;
    dialogo.respuesta = true;

    pagina.quitar(CUAJADA);
    await estabilizar();

    expect(servicio.quitados).toEqual(['p-4']);
    expect(servicio.consultas).toBeGreaterThan(consultasAntes);
    expect(fixture.nativeElement.querySelector('.aviso-quitar')).toBeNull();
  });

  it('sin confirmar no se quita nada', async () => {
    await armar([QUESO, CUAJADA]);
    dialogo.respuesta = null; // cerró el diálogo sin confirmar

    pagina.quitar(CUAJADA);
    await estabilizar();

    expect(servicio.quitados).toEqual([]);
  });

  // -------------------------------------------------- activar / desactivar
  it('desactivar pide confirmación y manda estado inactivo', async () => {
    await armar([QUESO, BORONA, MOZZARELLA]);
    dialogo.respuesta = true;

    pagina.desactivar(QUESO);
    await estabilizar();

    expect(dialogo.abiertos.at(-1)?.componente).toBe(ConfirmDialog);
    expect(servicio.ediciones).toEqual([{ id: 'p-1', payload: { estado: 'inactivo' } }]);
  });

  it('activar no pide confirmación: no le quita nada a nadie', async () => {
    await armar([{ ...QUESO, estado: 'inactivo' }]);

    pagina.activar({ ...QUESO, estado: 'inactivo' });
    await estabilizar();

    expect(dialogo.abiertos.length).withContext('ningún diálogo').toBe(0);
    expect(servicio.ediciones).toEqual([{ id: 'p-1', payload: { estado: 'activo' } }]);
  });

  // ------------------------------------------------------ agregar producto
  it('el botón "Nuevo producto" abre el formulario de las tres preguntas', async () => {
    await armar([QUESO]);
    dialogo.respuesta = null;

    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((b) => comoSeLee((b as HTMLElement).textContent).includes('Nuevo producto'));
    expect(boton).withContext('el botón está en pantalla').toBeTruthy();
    (boton as HTMLButtonElement).click();
    await estabilizar();

    expect(dialogo.abiertos.at(-1)?.componente).toBe(ReventaProductoFormDialog);
    expect(dialogo.abiertos.at(-1)?.datos).toEqual({ item: undefined });
  });

  it('agregar uno que se había quitado avisa que volvió tal como estaba', async () => {
    await armar([QUESO, BORONA]);
    // El servidor no crea otro: REVIVE la misma fila con la unidad que ya tenía. Se
    // pidió "por kilo" (es lo único que este corte deja pedir) y volvió por unidad,
    // así que hay que decirlo en vez de dejar al dueño creyendo que quedó en kilos.
    dialogo.respuesta = MOZZARELLA;

    pagina.nuevo();
    await estabilizar();

    expect(avisos.length).toBe(1);
    expect(avisos[0]).toContain('ya estaba en la lista y volvió tal como estaba');
    expect(avisos[0]).toContain('se cuenta por unidad');
  });

  it('agregar uno nuevo de verdad solo avisa que quedó en la lista', async () => {
    await armar([QUESO]);
    dialogo.respuesta = CUAJADA;

    pagina.nuevo();
    await estabilizar();

    expect(avisos[0]).toBe('«Cuajada» quedó en la lista');
  });

  // ----------------------------------------------------------- en celular
  it('en celular cada celda se lee "Etiqueta: valor" (menos la de los botones)', async () => {
    await armar([QUESO, BORONA, MOZZARELLA]);

    // La tabla usa el modo tarjetas de styles.scss, que pinta el rótulo de cada
    // celda con su data-label. La única sin rótulo es la de las acciones: unos
    // iconos no necesitan que les digan "Acciones:".
    const celdas = Array.from(filas()[0].querySelectorAll('td'));
    const sinRotulo = celdas.filter((td) => !(td as HTMLElement).dataset['label']);
    expect(fixture.nativeElement.querySelector('.table-card.tarjetas')).not.toBeNull();
    expect(sinRotulo.length).toBe(1);
    expect((sinRotulo[0] as HTMLElement).classList).toContain('col-acciones');
  });

  // --------------------------------------------------------- si falla la red
  it('si la consulta falla no se pinta una tabla vacía: se dice que no llegó', async () => {
    await armar([]);
    servicio.listarProductos = () =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 0,
            error: { error: { code: 'sin_conexion', detail: 'No hay conexión' } },
          }),
      );

    await pagina.cargar();
    await estabilizar();

    expect(fixture.nativeElement.querySelector('table')).withContext('sin tabla').toBeNull();
    expect(textoPantalla()).toContain('No hay conexión');
    expect(textoPantalla()).toContain('Sus productos siguen ahí');
  });
});
