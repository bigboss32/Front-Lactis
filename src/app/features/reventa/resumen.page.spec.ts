import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, of } from 'rxjs';

import { ReventaResumenPage } from './resumen.page';
import {
  ExistenciaProducto,
  GananciaProducto,
  ResumenReventa,
  ReventaService,
} from './reventa.service';

/**
 * EL RESUMEN: UNA FILA POR PRODUCTO, Y LA COLUMNA SUMA EXACTO LA CIFRA GRANDE.
 *
 * Lo que estas pruebas cuidan, que es lo que el dueño hace con una calculadora en la
 * mano:
 *
 *  · que el desglose tenga UNA FILA POR PRODUCTO —incluidos los que él agregó al
 *    catálogo— y no las tres fijas de queso, borona y mozzarella;
 *  · que la columna "Ganancia" de las filas que SE VEN sume exactamente el total
 *    impreso al pie. Se leen las cifras COMO SE VEN EN PANTALLA y se suman como él
 *    las sumaría: no se comparan cifras internas del componente contra sí mismas, que
 *    no probaría nada;
 *  · que NINGUNA fila con plata se esconda, ni siquiera la que tiene ganancia $0
 *    porque su ingreso y su costo se cancelan. La fila 'sin_producto' es justamente
 *    esa, y es el único aviso de que una plata no cupo en ninguna otra: esconderla
 *    sería tapar la alarma;
 *  · que cada cantidad salga EN SU UNIDAD —kilos, barras o unidades— y que ninguna se
 *    sume con otra de unidad distinta;
 *  · y que el inventario y el aviso de "qué falta para cerrar la temporada" salgan de
 *    TODOS los productos: con las dos cifras fijas de antes, la pantalla decía
 *    "Temporada al día" con la bodega llena de un producto nuevo.
 */

const fila = (datos: Partial<GananciaProducto>): GananciaProducto =>
  ({
    producto: 'queso',
    etiqueta: 'Vendido como queso',
    nota: 'vendido como queso entero',
    unidad: 'kg',
    kilos: '0',
    kilos_vendidos: '0',
    barras: '0',
    barras_vendidas: '0',
    ingreso: '0',
    costo: '0',
    gastos: '0',
    ganancia: '0',
    precio_venta_kilo: '0',
    costo_kilo: '0',
    precio_venta_barra: '0',
    costo_barra: '0',
    ...datos,
  }) as GananciaProducto;

/**
 * EL DESGLOSE DE UN PERÍODO REAL: los tres productos de siempre, el "costeño" que el
 * dueño creó por kilo, una "panela" por unidad, y la fila de la red de seguridad.
 *
 * Las cuatro columnas suman exactamente el encabezado, que es lo que el backend
 * garantiza por construcción:
 *     costo    2.509.219   ingreso 3.059.993   gastos 40.000   ganancia 510.774
 */
const POR_PRODUCTO: GananciaProducto[] = [
  fila({
    producto: 'queso',
    etiqueta: 'Vendido como queso',
    kilos: '100',
    kilos_vendidos: '100',
    ingreso: '1900000',
    costo: '1200000',
    gastos: '30000',
    ganancia: '670000',
    precio_venta_kilo: '19000',
    costo_kilo: '12000',
  }),
  fila({
    producto: 'borona',
    etiqueta: 'Vendido como borona',
    nota: 'subproducto vendido más barato',
    kilos: '10',
    kilos_vendidos: '12',
    ingreso: '96000',
    costo: '120000',
    ganancia: '-24000',
    precio_venta_kilo: '8000',
    costo_kilo: '12000',
  }),
  fila({
    producto: 'merma',
    etiqueta: 'Merma (pérdida real)',
    nota: 'se pagó y no se vendió: pérdida',
    kilos: '5',
    kilos_vendidos: '5',
    costo: '60000',
    ganancia: '-60000',
    costo_kilo: '12000',
  }),
  fila({
    producto: 'pendiente',
    etiqueta: 'Aún en inventario',
    nota: 'plata invertida, aún sin vender',
    kilos: '25',
    kilos_vendidos: '25',
    costo: '300000',
    ganancia: '-300000',
    costo_kilo: '12000',
  }),
  // El producto que el dueño creó él mismo. Antes su plata caía en la fila de la
  // borona —"todo lo que se pesa y no es queso es borona"— y su fila no existía.
  fila({
    producto: 'costeno',
    etiqueta: 'Vendido como Costeño',
    nota: 'producto del catálogo, vendido por kilo',
    kilos: '40',
    kilos_vendidos: '40',
    ingreso: '560000',
    costo: '400000',
    gastos: '10000',
    ganancia: '150000',
    precio_venta_kilo: '14000',
    costo_kilo: '10000',
  }),
  fila({
    producto: 'costeno_pendiente',
    etiqueta: 'Costeño aún en inventario',
    nota: 'plata invertida, aún sin vender',
    kilos: '10',
    kilos_vendidos: '10',
    costo: '100000',
    ganancia: '-100000',
    costo_kilo: '10000',
  }),
  fila({
    producto: 'mozzarella',
    etiqueta: 'Mozzarella vendida (barras)',
    nota: 'se compra y se vende por barra completa',
    unidad: 'barra',
    barras: '7',
    barras_vendidas: '7',
    ingreso: '153993',
    costo: '79219',
    ganancia: '74774',
    precio_venta_barra: '21999',
    costo_barra: '11317',
  }),
  // Un producto POR UNIDAD que no es la mozzarella: sus piezas se dicen "unidades".
  fila({
    producto: 'panela',
    etiqueta: 'Panela vendida (unidades)',
    nota: 'producto del catálogo, vendido por unidad',
    unidad: 'barra',
    barras: '100',
    barras_vendidas: '100',
    ingreso: '300000',
    costo: '200000',
    ganancia: '100000',
    precio_venta_barra: '3000',
    costo_barra: '2000',
  }),
  // LA RED DE SEGURIDAD: plata que no cupo en ninguna fila de producto. Ganancia $0
  // porque el ingreso y el costo se cancelan, y AUN ASÍ tiene que verse.
  fila({
    producto: 'sin_producto',
    etiqueta: 'Sin producto (plata sin clasificar)',
    nota: 'revise el producto de esos movimientos: no quedó en ninguna unidad',
    ingreso: '50000',
    costo: '50000',
    ganancia: '0',
  }),
];

const EXISTENCIAS: ExistenciaProducto[] = [
  { producto: 'queso', etiqueta: 'Queso', unidad: 'kg', disponible: '25' },
  { producto: 'borona', etiqueta: 'Borona', unidad: 'kg', disponible: '3' },
  { producto: 'mozzarella', etiqueta: 'Mozzarella', unidad: 'unidad', disponible: '0' },
  { producto: 'costeno', etiqueta: 'Costeño', unidad: 'kg', disponible: '10' },
  { producto: 'panela', etiqueta: 'Panela', unidad: 'unidad', disponible: '0' },
];

const RESUMEN: ResumenReventa = {
  desde: '2026-08-01',
  hasta: '2026-08-31',
  kilos_comprados: '180',
  total_compras: '2509219',
  kilos_vendidos: '140',
  total_ventas: '3059993',
  precio_promedio_compra: '11556',
  precio_promedio_venta: '17571',
  total_gastos: '40000',
  ganancia_estimada: '510774',
  margen_por_kilo: '2500',
  kilos_borona_vendidos: '12',
  total_ventas_borona: '96000',
  barras_compradas: '7',
  total_compras_mozzarella: '79219',
  barras_vendidas: '7',
  total_ventas_mozzarella: '153993',
  total_gastos_mozzarella: '0',
  precio_promedio_compra_barra: '11317',
  precio_promedio_venta_barra: '21999',
  margen_por_barra: '10682',
  valor_realizado_barra: '21999',
  barras_pendientes: '0',
  kilos_a_borona: '10',
  kilos_merma: '5',
  kilos_pendientes: '35',
  valor_realizado_kilo: '14000',
  por_producto: POR_PRODUCTO,
  por_productor: [],
  kilos_disponibles: '25',
  borona_disponible: '3',
  barras_disponibles: '0',
  existencias: EXISTENCIAS,
  por_pagar_productores: '0',
  por_cobrar_clientes: '0',
  por_cobrar_libro_anterior: '0',
  por_pagar_libro_anterior: '0',
} as ResumenReventa;

class ServicioFalso {
  datos: ResumenReventa = RESUMEN;

  resumen(): Observable<ResumenReventa> {
    return of(this.datos);
  }
}

/** Lo que se lee en pantalla, con los espacios raros de Intl normalizados. */
const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/** "-$ 300.000" -> -300000, leído como lo lee el dueño (punto de miles, coma decimal). */
const aNumero = (texto: string): number => {
  const limpio = comoSeLee(texto).replace(/[^\d,.-]/g, '');
  return Number(limpio.replace(/\./g, '').replace(',', '.'));
};

describe('ReventaResumenPage: el desglose por producto', () => {
  let fixture: ComponentFixture<ReventaResumenPage>;
  let pagina: ReventaResumenPage;
  let servicio: ServicioFalso;

  const armar = async (datos: ResumenReventa = RESUMEN): Promise<void> => {
    TestBed.resetTestingModule();
    servicio = new ServicioFalso();
    servicio.datos = datos;
    await TestBed.configureTestingModule({
      imports: [ReventaResumenPage, NoopAnimationsModule],
      providers: [{ provide: ReventaService, useValue: servicio }],
    }).compileComponents();
    fixture = TestBed.createComponent(ReventaResumenPage);
    pagina = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** La tabla de "Ganancia por producto" (la primera de las dos de la pantalla). */
  const tablaProducto = (): HTMLTableElement =>
    fixture.nativeElement.querySelectorAll('table.tabla-datos')[0];

  /** Las filas impresas del desglose: su nombre, su cantidad y su ganancia. */
  const filasImpresas = (): { nombre: string; cantidad: string; ganancia: number }[] =>
    Array.from(tablaProducto().querySelectorAll('tbody tr')).map((tr) => {
      const celdas = Array.from((tr as HTMLElement).querySelectorAll('td'));
      return {
        nombre: comoSeLee(celdas[0].querySelector('.nombre')?.textContent),
        cantidad: comoSeLee(celdas[1].textContent),
        ganancia: aNumero(celdas[5].textContent ?? ''),
      };
    });

  /** La cifra del pie de la tabla, como se lee. */
  const totalImpreso = (): number =>
    aNumero(tablaProducto().querySelector('tfoot td:last-child')?.textContent ?? '');

  const textoPantalla = (): string => comoSeLee(fixture.nativeElement.textContent);

  // ------------------------------------------------- la columna suma el pie
  it('la columna Ganancia de las filas visibles suma EXACTO el total impreso', async () => {
    await armar();

    const filas = filasImpresas();
    const aMano = filas.reduce((suma, f) => suma + f.ganancia, 0);
    expect(totalImpreso()).toBe(510774);
    expect(aMano)
      .withContext('sumando la columna con calculadora tiene que dar el pie')
      .toBe(totalImpreso());
  });

  it('una fila por producto, con el nombre que manda el backend', async () => {
    await armar();

    // Las NUEVE filas, incluidas las dos del producto que el dueño creó y la de la
    // panela. Antes eran las fijas de queso, borona, merma, residuo y mozzarella.
    expect(filasImpresas().map((f) => f.nombre)).toEqual([
      'Vendido como queso',
      'Vendido como borona',
      'Merma (pérdida real)',
      'Aún en inventario',
      'Vendido como Costeño',
      'Costeño aún en inventario',
      'Mozzarella vendida (barras)',
      'Panela vendida (unidades)',
      'Sin producto (plata sin clasificar)',
    ]);
  });

  it('la fila "Sin producto" SE MUESTRA aunque su ganancia sea $0', async () => {
    // Es plata que no cupo en ninguna fila de producto: es el único aviso de que algo
    // se rompió. Con la regla vieja —esconder lo que no tiene cantidad ni ganancia—
    // esta fila desaparecía y el desglose dejaba de sumar el encabezado en las
    // columnas de ingreso y de costo, sin que nada lo dijera.
    await armar();

    expect(textoPantalla()).toContain('Sin producto (plata sin clasificar)');
    expect(pagina.filasProducto().some((f) => f.producto === 'sin_producto')).toBeTrue();
  });

  it('una fila completamente en ceros sí se esconde: no aporta nada', async () => {
    await armar({
      ...RESUMEN,
      por_producto: [
        ...POR_PRODUCTO,
        fila({ producto: 'cuajada', etiqueta: 'Vendido como Cuajada' }),
      ],
    } as ResumenReventa);

    expect(textoPantalla()).not.toContain('Cuajada');
    // Y el pie sigue cuadrando con lo que se ve.
    const aMano = filasImpresas().reduce((suma, f) => suma + f.ganancia, 0);
    expect(aMano).toBe(totalImpreso());
  });

  // ------------------------------------------------- cada cantidad en SU unidad
  it('cada cantidad sale en su unidad: kg, barras y unidades', async () => {
    await armar();

    const filas = filasImpresas();
    expect(filas[0].cantidad).toContain('kg');
    expect(filas[4].cantidad).withContext('el costeño se pesa').toContain('40 kg');
    // La mozzarella sigue diciendo BARRAS, que es como están sus comprobantes.
    expect(filas[6].cantidad).toBe('7 barras');
    // Y la panela dice UNIDADES: llamarle "barras" sería inventarle una unidad.
    expect(filas[7].cantidad).toBe('100 unidades');
  });

  it('el precio de la panela se rotula /unidad y el de la mozzarella /barra', async () => {
    await armar();

    const celdas = (indice: number): string[] =>
      Array.from(tablaProducto().querySelectorAll('tbody tr')[indice].querySelectorAll('td')).map(
        (td) => comoSeLee((td as HTMLElement).textContent),
      );

    expect(celdas(6)[2]).toContain('/barra');
    expect(celdas(7)[2]).toContain('/unidad');
    expect(celdas(0)[2]).toContain('/kg');
  });

  // ----------------------------------------------- la plata de los kilos, exacta
  it('"Comprado (en kilos)" suma las filas en kilos, no el total del período', async () => {
    // El total del período incluye la mozzarella Y la panela. Antes esta cifra era
    // "el total menos la mozzarella", así que la plata de la panela se quedaba
    // adentro de una cifra rotulada en kilos.
    await armar();

    // 1.200.000 + 120.000 + 60.000 + 300.000 + 400.000 + 100.000
    expect(pagina.compradoEnKilos()).toBe(2180000);
    expect(pagina.vendidoEnKilos()).toBe(2556000);
    const baldosas = Array.from(
      fixture.nativeElement.querySelectorAll('.desglose .dato'),
    ).map((d) => comoSeLee((d as HTMLElement).textContent));
    expect(baldosas[0]).toContain('Comprado (en kilos)');
    expect(baldosas[0]).toContain('$ 2.180.000');
  });

  // --------------------------------------------------- el inventario, por producto
  it('una tarjeta de inventario por producto, aunque esté en cero', async () => {
    await armar();

    const titulos = Array.from(
      fixture.nativeElement.querySelectorAll('.resumen-grid .titulo'),
    ).map((t) => comoSeLee((t as HTMLElement).textContent));
    expect(titulos.slice(0, 5)).toEqual([
      'Queso disponible',
      'Borona disponible',
      'Mozzarella disponible',
      'Costeño disponible',
      'Panela disponible',
    ]);
  });

  it('sin `existencias` (backend viejo) se muestran los tres de siempre', async () => {
    // La pantalla tiene que servir con las dos versiones del servidor: mientras la
    // lista nueva no llegue, el inventario sale de los tres campos de siempre y se ve
    // exactamente como se veía antes.
    const { existencias, ...sinExistencias } = RESUMEN;
    await armar(sinExistencias as ResumenReventa);

    const titulos = Array.from(
      fixture.nativeElement.querySelectorAll('.resumen-grid .titulo'),
    ).map((t) => comoSeLee((t as HTMLElement).textContent));
    expect(titulos.slice(0, 3)).toEqual([
      'Queso disponible',
      'Borona disponible',
      'Mozzarella disponible',
    ]);
    expect(pagina.existencias().length).toBe(3);
  });

  // ------------------------------------- lo que falta para cerrar la temporada
  it('el aviso de "falta" nombra TODOS los productos con mercancía', async () => {
    await armar();

    // Queso 25 kg, borona 3 kg y costeño 10 kg. La mozzarella y la panela están en
    // cero y no se nombran.
    expect(textoPantalla()).toContain('Para cerrar la temporada falta');
    expect(textoPantalla()).toContain('de Queso');
    expect(textoPantalla()).toContain('de Borona');
    expect(textoPantalla()).toContain('de Costeño');
    expect(pagina.conMercancia().map((e) => e.producto)).toEqual([
      'queso',
      'borona',
      'costeno',
    ]);
  });

  it('con mercancía de un producto nuevo NO dice "Temporada al día"', async () => {
    // Es la misma mentira que ya se había arreglado para la mozzarella: el queso en
    // cero y la bodega llena de otro producto.
    await armar({
      ...RESUMEN,
      kilos_disponibles: '0',
      borona_disponible: '0',
      existencias: [
        { producto: 'queso', etiqueta: 'Queso', unidad: 'kg', disponible: '0' },
        { producto: 'costeno', etiqueta: 'Costeño', unidad: 'kg', disponible: '10' },
      ],
    } as ResumenReventa);

    expect(pagina.temporadaAlDia(servicio.datos)).toBeFalse();
    expect(textoPantalla()).not.toContain('Temporada al día');
    expect(textoPantalla()).toContain('de Costeño');
  });

  it('sin mercancía de ningún producto sí dice "Temporada al día"', async () => {
    await armar({
      ...RESUMEN,
      kilos_disponibles: '0',
      borona_disponible: '0',
      existencias: EXISTENCIAS.map((e) => ({ ...e, disponible: '0' })),
    } as ResumenReventa);

    expect(textoPantalla()).toContain('Temporada al día');
  });
});
