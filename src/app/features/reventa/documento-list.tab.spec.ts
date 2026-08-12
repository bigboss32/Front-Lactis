import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { EMPTY, Observable, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Page } from '../../core/models';
import { DocumentoReventaListTab } from './documento-list.tab';
import {
  CatalogoReventaService,
  CompraQueso,
  DocumentoCompra,
  DocumentoVenta,
  ProductoReventa,
  ReventaService,
  VentaQueso,
} from './reventa.service';

/**
 * EL CATÁLOGO, DE MENTIRAS PERO CON LA FORMA DE VERDAD: la lista rotula cada renglón
 * con el NOMBRE que el dueño le puso, no con la clave interna. Un producto que no
 * esté aquí sale con su clave, que es lo único cierto que se sabe de él.
 */
const CATALOGO: ProductoReventa[] = [
  { nombre: 'Queso', clave: 'queso', unidad: 'kg', se_pesa: true },
  { nombre: 'Borona', clave: 'borona', unidad: 'kg', se_pesa: true },
  { nombre: 'Mozzarella', clave: 'mozzarella', unidad: 'unidad', se_pesa: false },
].map((p, i) => ({ ...p, id: `p-${i}`, estado: 'activo' }) as ProductoReventa);

class CatalogoFalso {
  catalogo(): Observable<readonly ProductoReventa[]> {
    return of(CATALOGO);
  }
  refrescar(): void {}
}

/**
 * LA LISTA DE FACTURAS: UNA FACTURA ES UNA FILA.
 *
 * Lo que estas pruebas cuidan:
 *  · que una factura de tres productos sea UNA fila y no tres, y que el chevron
 *    despliegue los tres con su cuenta escrita;
 *  · que NO existan las columnas "Cantidad" y "Precio": una factura de tres
 *    productos distintos no tiene una cantidad ni un precio, y ponerlos ahí sería la
 *    mentira que este módulo evita;
 *  · que el desglose del detalle SUME EXACTO la cifra grande —se leen las cifras como
 *    se ven, se suman como las sumaría el dueño, y tiene que dar el total impreso—,
 *    incluso cuando uno de los productos está anulado, que es el caso en el que la
 *    columna deja de cerrar si la plata anulada se esconde;
 *  · y que el filtro de estado diga que solo revisa la página que tiene cargada, en
 *    vez de dejar al dueño creyendo que revisó toda su cartera.
 */

const CIFRAS = {
  queso: 1563658.47,
  borona: 53512.55,
  mozzarella: 153993,
  total: 1771164.02,
  abonado: 1600000,
  saldo: 171164.02,
  fleteQueso: 31417.87,
};

const renglonVenta = (datos: Partial<VentaQueso>): VentaQueso =>
  ({
    id: 'v-x',
    empresa_id: 'e-1',
    estado: 'pendiente',
    created_at: '2026-07-10T00:00:00Z',
    updated_at: '2026-07-10T00:00:00Z',
    fecha: '2026-07-10',
    cliente: 'Tienda La 33',
    documento_id: 'd-1',
    orden: 0,
    tipo: 'queso',
    unidad: 'kg',
    kilos: '0',
    precio_kilo: '0',
    barras: '0',
    precio_barra: '0',
    valor_total: '0',
    gasto_concepto: null,
    gasto_por_kilo: '0',
    gasto_por_barra: '0',
    gasto_monto: '0',
    abonado: '0',
    saldo: '0',
    observaciones: null,
    abonos: [],
    adjuntos_count: 0,
    ...datos,
  }) as VentaQueso;

const renglonCompra = (datos: Partial<CompraQueso>): CompraQueso =>
  ({
    id: 'c-x',
    empresa_id: 'e-1',
    estado: 'pendiente',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    fecha: '2026-07-01',
    productor: 'Yeferson Muñoz',
    documento_id: 'd-9',
    orden: 0,
    tipo: 'queso',
    unidad: 'kg',
    kilos_brutos: '0',
    borona_kilos: '0',
    kilos_netos: '0',
    precio_kilo: '0',
    barras: '0',
    precio_barra: '0',
    valor_total: '0',
    abonado: '0',
    saldo: '0',
    observaciones: null,
    abonos: [],
    adjuntos_count: 0,
    ...datos,
  }) as CompraQueso;

/** El QUESO de la factura del dueño, con su flete de $317 el kilo. */
const QUESO = renglonVenta({
  id: 'v-1',
  orden: 0,
  tipo: 'queso',
  unidad: 'kg',
  kilos: '99.11',
  precio_kilo: '15777',
  valor_total: '1563658.47',
  gasto_concepto: 'Flete',
  gasto_por_kilo: '317',
  gasto_monto: '31417.87',
  abonado: '1563658.47',
  estado: 'pagada',
  adjuntos_count: 2,
});

const BORONA = renglonVenta({
  id: 'v-2',
  orden: 1,
  tipo: 'borona',
  unidad: 'kg',
  kilos: '12.35',
  precio_kilo: '4333',
  valor_total: '53512.55',
  abonado: '36341.53',
  saldo: '17171.02',
  estado: 'parcial',
});

const MOZZARELLA = renglonVenta({
  id: 'v-3',
  orden: 2,
  tipo: 'mozzarella',
  unidad: 'barra',
  barras: '7',
  precio_barra: '21999',
  valor_total: '153993',
  saldo: '153993',
});

/** La factura de tres productos con el abono de $1.600.000 ya derramado. */
const FACTURA_TRES: DocumentoVenta = {
  id: 'd-1',
  empresa_id: 'e-1',
  estado: 'activo',
  created_at: '2026-07-10T00:00:00Z',
  updated_at: '2026-07-10T00:00:00Z',
  tipo: 'venta',
  fecha: '2026-07-10',
  tercero: 'Tienda La 33',
  observaciones: 'pedido del sabado',
  total: '1771164.02',
  abonado: '1600000',
  saldo: '171164.02',
  total_anulado: '0',
  estado_pago: 'parcial',
  cantidad_renglones: 3,
  renglones: [QUESO, BORONA, MOZZARELLA],
};

/** La misma factura, pero con la mozzarella anulada. */
const FACTURA_CON_ANULADO: DocumentoVenta = {
  ...FACTURA_TRES,
  id: 'd-2',
  total: '1617171.02',
  abonado: '1600000',
  saldo: '17171.02',
  total_anulado: '153993',
  estado_pago: 'parcial',
  renglones: [QUESO, BORONA, { ...MOZZARELLA, estado: 'anulada', saldo: '0' }],
};

/** Una de un solo producto: es como se ven todas las de antes del cambio. */
const FACTURA_UNA: DocumentoVenta = {
  ...FACTURA_TRES,
  id: 'd-3',
  tercero: 'Panadería El Trigal',
  observaciones: null,
  total: '1563658.47',
  abonado: '0',
  saldo: '1563658.47',
  estado_pago: 'pendiente',
  cantidad_renglones: 1,
  renglones: [{ ...QUESO, abonado: '0', saldo: '1563658.47', estado: 'pendiente' }],
};

/** Una factura de compra: 77,77 kg de queso (con borona gratis) y 12 barras. */
const FACTURA_COMPRA: DocumentoCompra = {
  id: 'd-9',
  empresa_id: 'e-1',
  estado: 'activo',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  tipo: 'compra',
  fecha: '2026-07-01',
  tercero: 'Yeferson Muñoz',
  observaciones: null,
  total: '939401.41',
  abonado: '0',
  saldo: '939401.41',
  total_anulado: '0',
  estado_pago: 'pendiente',
  cantidad_renglones: 2,
  renglones: [
    renglonCompra({
      id: 'c-1',
      orden: 0,
      kilos_brutos: '77.77',
      kilos_netos: '77.77',
      borona_kilos: '3.33',
      precio_kilo: '10333',
      valor_total: '803597.41',
      saldo: '803597.41',
    }),
    renglonCompra({
      id: 'c-2',
      orden: 1,
      tipo: 'mozzarella',
      unidad: 'barra',
      barras: '12',
      precio_barra: '11317',
      valor_total: '135804',
      saldo: '135804',
    }),
  ],
};

class ServicioFalso {
  ventas: DocumentoVenta[] = [];
  compras: DocumentoCompra[] = [];

  listarDocumentosVenta(): Observable<Page<DocumentoVenta>> {
    return of(this.pagina(this.ventas));
  }

  listarDocumentosCompra(): Observable<Page<DocumentoCompra>> {
    return of(this.pagina(this.compras));
  }

  private pagina<T>(items: T[]): Page<T> {
    return { items, total: items.length, page: 1, page_size: 20, pages: 1 };
  }
}

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/** "$ 1.563.658,47" -> 1563658.47, como lo lee el dueño. */
const aNumero = (texto: string): number => {
  const limpio = comoSeLee(texto).replace(/[^\d,.-]/g, '');
  return Number(limpio.replace(/\./g, '').replace(',', '.'));
};

describe('DocumentoReventaListTab: una factura es una fila', () => {
  let fixture: ComponentFixture<DocumentoReventaListTab>;
  let tab: DocumentoReventaListTab;
  let servicio: ServicioFalso;

  const armar = async (
    tipo: 'venta' | 'compra',
    datos: { ventas?: DocumentoVenta[]; compras?: DocumentoCompra[] },
  ): Promise<void> => {
    // Los filtros se recuerdan en sessionStorage: sin limpiarla, el estado que dejó
    // otra prueba se restauraría y esta empezaría filtrando.
    sessionStorage.clear();
    TestBed.resetTestingModule();
    servicio = new ServicioFalso();
    servicio.ventas = datos.ventas ?? [];
    servicio.compras = datos.compras ?? [];
    await TestBed.configureTestingModule({
      imports: [DocumentoReventaListTab, NoopAnimationsModule],
      providers: [
        { provide: ReventaService, useValue: servicio },
        { provide: CatalogoReventaService, useValue: new CatalogoFalso() },
        { provide: MatSnackBar, useValue: { open: () => ({ onAction: () => EMPTY }) } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DocumentoReventaListTab);
    tab = fixture.componentInstance;
    fixture.componentRef.setInput('tipo', tipo);
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

  const filasDeFactura = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('tr.fila-factura'));

  const filasDeDetalle = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('tr.fila-detalle'));

  /** Los productos del detalle, tal como se leen: [texto de la cuenta, plata]. */
  const productosDelDetalle = (): { texto: string; plata: number }[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.detalle .renglon-detalle')).map((fila) => {
      const elemento = fila as HTMLElement;
      return {
        texto: comoSeLee(elemento.querySelector('.que')?.textContent),
        plata: aNumero(elemento.querySelector('.plata')?.textContent ?? ''),
      };
    });

  /** Las sumas del pie del detalle: [rótulo, plata]. */
  const sumasDelDetalle = (): { rotulo: string; plata: number }[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.detalle .sumas .suma')).map((fila) => {
      const elemento = fila as HTMLElement;
      return {
        rotulo: comoSeLee(elemento.querySelector('span')?.textContent),
        plata: aNumero(elemento.querySelector('.plata')?.textContent ?? ''),
      };
    });

  const plataDe = (rotulo: string): number =>
    sumasDelDetalle().find((s) => s.rotulo === rotulo)?.plata ?? NaN;

  const textoPantalla = (): string => comoSeLee(fixture.nativeElement.textContent);

  // ------------------------------------------------------- una factura, una fila
  it('una factura de tres productos es UNA fila, con "Productos" y sin cantidad ni precio', async () => {
    await armar('venta', { ventas: [FACTURA_TRES] });

    expect(filasDeFactura().length).withContext('una sola fila de factura').toBe(1);
    expect(encabezados()).toContain('Productos');
    // Las dos columnas que se fueron, y por qué: una factura de tres productos
    // distintos no tiene UNA cantidad ni UN precio.
    expect(encabezados()).not.toContain('Cantidad');
    expect(encabezados()).not.toContain('Precio');

    // La celda dice qué trae la factura, cada producto EN SU UNIDAD.
    const productos = comoSeLee(
      (fixture.nativeElement.querySelector('td[data-label="Productos"]') as HTMLElement)
        .textContent,
    );
    expect(productos).toContain('Queso 99,11 kg');
    expect(productos).toContain('Borona 12,35 kg');
    expect(productos).toContain('Mozzarella 7 barras');
  });

  it('el detalle arranca escondido y el chevron lo despliega', async () => {
    await armar('venta', { ventas: [FACTURA_TRES] });

    expect(tab.abierto('d-1')).toBeFalse();
    expect(filasDeDetalle()[0].classList).toContain('oculta');
    expect(productosDelDetalle().length).toBe(0);

    tab.alternar('d-1');
    await estabilizar();

    expect(filasDeDetalle()[0].classList).not.toContain('oculta');
    expect(productosDelDetalle().length).toBe(3);
    // La nota de la factura también sale en el detalle.
    expect(textoPantalla()).toContain('pedido del sabado');
  });

  // ---------------------------------------------------- el desglose suma exacto
  it('el desglose del detalle suma EXACTO el total de la factura', async () => {
    await armar('venta', { ventas: [FACTURA_TRES] });
    tab.alternar('d-1');
    await estabilizar();

    const productos = productosDelDetalle();
    expect(productos[0].texto).toContain('Queso 99,11 kg × $ 15.777');
    expect(productos[1].texto).toContain('Borona 12,35 kg × $ 4.333');
    expect(productos[2].texto).toContain('Mozzarella 7 barras × $ 21.999');
    expect(productos.map((p) => p.plata)).toEqual([
      CIFRAS.queso,
      CIFRAS.borona,
      CIFRAS.mozzarella,
    ]);

    // LA CUENTA DEL DUEÑO: se suman las cifras impresas y tiene que dar la grande.
    const aMano = productos.reduce((suma, p) => suma + p.plata, 0);
    expect(plataDe('Total de la venta')).toBeCloseTo(aMano, 2);
    expect(plataDe('Total de la venta')).toBeCloseTo(CIFRAS.total, 2);
    // Y el saldo es el total menos lo abonado, sin sorpresas.
    expect(plataDe('Abonado por el cliente')).toBeCloseTo(CIFRAS.abonado, 2);
    expect(plataDe('Saldo por cobrar')).toBeCloseTo(CIFRAS.total - CIFRAS.abonado, 2);
    expect(plataDe('Saldo por cobrar')).toBeCloseTo(CIFRAS.saldo, 2);
    // Sin nada anulado no hay línea de "Suma de los productos": los productos de
    // arriba suman directo el total y una línea repetida solo sería ruido.
    expect(textoPantalla()).not.toContain('Suma de los 3 productos');
  });

  it('con un producto anulado la columna sigue cerrando', async () => {
    // Es el caso en el que se descuadra si la plata anulada se esconde: los tres
    // productos siguen impresos, así que hay que mostrar su suma Y lo que se anuló.
    await armar('venta', { ventas: [FACTURA_CON_ANULADO] });
    tab.alternar('d-2');
    await estabilizar();

    const productos = productosDelDetalle();
    expect(productos.length).withContext('el anulado NO se esconde').toBe(3);
    expect(productos[2].texto).toContain('anulado');

    const aMano = productos.reduce((suma, p) => suma + p.plata, 0);
    expect(plataDe('Suma de los 3 productos')).toBeCloseTo(aMano, 2);
    expect(plataDe('Productos anulados')).toBeCloseTo(CIFRAS.mozzarella, 2);
    // La igualdad: suma de los productos − anulados = total de la factura.
    expect(plataDe('Total de la venta')).toBeCloseTo(aMano - CIFRAS.mozzarella, 2);
    expect(plataDe('Total de la venta')).toBeCloseTo(1617171.02, 2);
    expect(plataDe('Saldo por cobrar')).toBeCloseTo(1617171.02 - CIFRAS.abonado, 2);
  });

  it('el gasto de vender va DESPUÉS del total y con su cuenta escrita', async () => {
    await armar('venta', { ventas: [FACTURA_TRES] });
    tab.alternar('d-1');
    await estabilizar();

    const gastos = Array.from(
      fixture.nativeElement.querySelectorAll('.detalle .bloque-gastos .suma'),
    ).map((fila) => {
      const elemento = fila as HTMLElement;
      return {
        rotulo: comoSeLee(elemento.querySelector('span')?.textContent),
        plata: aNumero(elemento.querySelector('.plata')?.textContent ?? ''),
      };
    });
    expect(gastos[0].rotulo).toBe('Flete · Queso: 99,11 kg × $ 317 por kilo');
    expect(gastos[0].plata).toBeCloseTo(CIFRAS.fleteQueso, 2);
    expect(gastos[1].rotulo).toBe('Gastos de vender (los paga usted)');
    expect(gastos[1].plata).toBeCloseTo(CIFRAS.fleteQueso, 2);
    expect(gastos[2].rotulo).toBe('Le queda');
    expect(gastos[2].plata).toBeCloseTo(CIFRAS.total - CIFRAS.fleteQueso, 2);
  });

  // ------------------------------------------------------------------ celular
  it('cada celda se rotula sola (data-label) y el detalle se sale del molde', async () => {
    // En celular la tabla se vuelve tarjetas y cada celda se lee "Etiqueta: valor"
    // con el data-label. Una celda sin rótulo queda como una cifra suelta en una
    // tarjeta, que es la forma de leer la columna equivocada.
    await armar('venta', { ventas: [FACTURA_TRES] });
    tab.alternar('d-1');
    await estabilizar();

    const celdas = Array.from(filasDeFactura()[0].querySelectorAll('td'));
    const sinRotulo = celdas.filter((td) => !td.getAttribute('data-label'));
    // La única sin rótulo es la de los botones: los iconos se alinean a la derecha
    // y no necesitan nombre (la @media les quita el ::before).
    expect(sinRotulo.length).toBe(1);
    expect(sinRotulo[0].classList).toContain('col-acciones');
    // El chevron sí lleva rótulo, y dice qué va a hacer: un chevron suelto en una
    // tarjeta no se lee como nada.
    expect(celdas[0].getAttribute('data-label')).toBe('Ocultar la cuenta');

    // El detalle NO es una celda "Etiqueta: valor": lleva su propio recibo adentro y
    // ocupa todo el ancho de la tarjeta.
    const detalle = filasDeDetalle()[0].querySelector('td') as HTMLElement;
    expect(detalle.classList).toContain('celda-detalle');
    expect(detalle.getAttribute('colspan')).toBe(String(tab.columnas().length));
  });

  // ------------------------------------------------------------- los soportes
  it('con un solo producto el clip está en la fila; con varios, en cada producto', async () => {
    await armar('venta', { ventas: [FACTURA_UNA] });
    // Una factura de un producto se comporta igual que siempre: el clip en la fila,
    // con su contador.
    const clipEnLaFila = fixture.nativeElement.querySelector(
      'td.col-acciones .badge-adjuntos',
    ) as HTMLElement | null;
    expect(clipEnLaFila?.textContent).toBe('2');
    expect(fixture.nativeElement.querySelector('.clip-informativo')).toBeNull();

    // Con varios NO se inventa un "soporte de la factura" que iría a parar a un
    // producto elegido a dedo: la fila informa cuántos hay y el clip vive adentro.
    await armar('venta', { ventas: [FACTURA_TRES] });
    expect(
      fixture.nativeElement.querySelector('td.col-acciones .badge-adjuntos'),
    ).toBeNull();
    // El `attach_file` del texto es la ligadura del icono de Material.
    expect(
      comoSeLee(fixture.nativeElement.querySelector('.clip-informativo')?.textContent).replace(
        'attach_file',
        '',
      ),
    ).toBe('2');

    tab.alternar('d-1');
    await estabilizar();
    // Y el contador está en el producto que de verdad los tiene: el queso.
    const clips = Array.from(
      fixture.nativeElement.querySelectorAll('.detalle .renglon-detalle'),
    ).map((fila) =>
      comoSeLee((fila as HTMLElement).querySelector('.badge-adjuntos')?.textContent),
    );
    expect(clips).toEqual(['2', '', '']);
  });

  // ------------------------------------------------------- el filtro de estado
  it('el filtro de estado dice que solo revisa esta página', async () => {
    await armar('venta', { ventas: [FACTURA_TRES, FACTURA_UNA] });
    expect(filasDeFactura().length).toBe(2);

    tab.estado.setValue('pendiente');
    await estabilizar();

    // Filtra de verdad…
    expect(filasDeFactura().length).toBe(1);
    expect(tab.escondidas()).toBe(1);
    // …y lo dice, en vez de dejar creyendo que se revisaron todas las facturas.
    expect(textoPantalla()).toContain('De las 2 facturas de esta página se están mostrando 1');
    expect(textoPantalla()).toContain('página por página');
    // El paginador sigue contando FACTURAS, que es lo que trae el servidor.
    expect(tab.total()).toBe(2);
  });

  // ------------------------------------------------------------ las compras
  it('la factura de compra dice "Total a pagar", suma exacto y no inventa gastos', async () => {
    await armar('compra', { compras: [FACTURA_COMPRA] });
    expect(encabezados()).toContain('Productor');
    // Al comprar no hay gastos de vender: esas dos columnas no existen.
    expect(encabezados()).not.toContain('Gastos');
    expect(encabezados()).not.toContain('Venta libre');

    tab.alternar('d-9');
    await estabilizar();

    const productos = productosDelDetalle();
    expect(productos[0].texto).toContain('Queso 77,77 kg × $ 10.333');
    expect(productos[1].texto).toContain('Mozzarella 12 barras × $ 11.317');
    const aMano = productos.reduce((suma, p) => suma + p.plata, 0);
    expect(plataDe('Total a pagar')).toBeCloseTo(aMano, 2);
    expect(plataDe('Total a pagar')).toBeCloseTo(939401.41, 2);
    expect(plataDe('Saldo por pagar')).toBeCloseTo(939401.41, 2);

    // La borona que llegó gratis se ve, y SIN plata al frente: si tuviera una cifra
    // en la columna de la derecha, el desglose dejaría de sumar.
    expect(textoPantalla()).toContain('3,33 kg de borona que llegó con el queso');
    expect(textoPantalla()).toContain('no se paga');
  });
});
