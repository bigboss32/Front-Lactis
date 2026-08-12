import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { EMPTY, Observable, of, throwError } from 'rxjs';

import { DocumentoFormData, DocumentoReventaFormDialog } from './documento-form.dialog';
import {
  CatalogoReventaService,
  DocumentoCompra,
  DocumentoReventa,
  DocumentoReventaPayload,
  DocumentoReventaUpdatePayload,
  DocumentoVenta,
  ProductoReventa,
  SugerenciasReventa,
  VentaQueso,
} from './reventa.service';
import { ReventaService } from './reventa.service';

/**
 * LA FACTURA DE VARIOS PRODUCTOS, CON LAS CIFRAS DEL DUEÑO.
 *
 * El día que probó el backend es este: queso 99,11 kg a $15.777, borona 12,35 kg a
 * $4.333 y mozzarella 7 barras a $21.999, con flete de $317 el kilo del queso.
 *
 * Lo que estas pruebas cuidan es UNA SOLA COSA, que es la que el dueño revisa a
 * mano: que el recibo del pie SUME EXACTO. Se leen las cifras COMO SE VEN EN
 * PANTALLA, se suman como él las sumaría, y el resultado tiene que ser exactamente el
 * total impreso. No se comparan cifras internas del componente contra sí mismas —eso
 * no prueba nada—: se compara lo IMPRESO contra lo IMPRESO.
 *
 * Y cuidan lo otro que puede costar plata: que de cada renglón viaje SOLO el par de
 * campos de su unidad (kilos con precio por kilo, barras con precio por barra), que
 * las barras no acepten medias, y que una factura con abonos no pueda rehacer sus
 * productos.
 */

const CIFRAS = {
  queso: { kilos: 99.11, precio: 15777, total: 1563658.47, flete: 317, gasto: 31417.87 },
  borona: { kilos: 12.35, precio: 4333, total: 53512.55 },
  mozzarella: { barras: 7, precio: 21999, total: 153993 },
  totalFactura: 1771164.02,
};

/** La compra del mismo día: 77,77 kg a $10.333 y 12 barras a $11.317. */
const COMPRA = {
  queso: { kilos: 77.77, precio: 10333, total: 803597.41 },
  mozzarella: { barras: 12, precio: 11317, total: 135804 },
  total: 939401.41,
};

/**
 * EL CATÁLOGO DEL DUEÑO tal como lo tiene hoy en producción: los tres de siempre MÁS
 * el "costeño" que él creó por kilo. Se le agrega una "Panela" por unidad, que es el
 * caso que el módulo no sabía manejar: un producto que se cuenta y no es la
 * mozzarella.
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

const CATALOGO: ProductoReventa[] = [
  producto({ id: 'p-1', nombre: 'Queso', clave: 'queso', orden: 0 }),
  producto({
    id: 'p-2',
    nombre: 'Borona',
    clave: 'borona',
    subproducto_de_id: 'p-1',
    subproducto_de_nombre: 'Queso',
    orden: 1,
  }),
  producto({
    id: 'p-3',
    nombre: 'Mozzarella',
    clave: 'mozzarella',
    unidad: 'unidad',
    decimales: 0,
    admite_ajustes: false,
    se_pesa: false,
    orden: 2,
  }),
  producto({ id: 'p-4', nombre: 'Costeño', clave: 'costeno', orden: 3 }),
  producto({
    id: 'p-5',
    nombre: 'Panela',
    clave: 'panela',
    unidad: 'unidad',
    decimales: 0,
    admite_ajustes: false,
    se_pesa: false,
    orden: 4,
  }),
];

class CatalogoFalso {
  productos: ProductoReventa[] = CATALOGO;

  catalogo(): Observable<readonly ProductoReventa[]> {
    return of(this.productos);
  }

  refrescar(): void {
    // No hace falta para estas pruebas: el catálogo se pide una vez por diálogo.
  }
}

class ServicioFalso {
  creado: DocumentoReventaPayload | null = null;
  editado: { id: string; payload: DocumentoReventaUpdatePayload } | null = null;

  sugerencias(): Observable<SugerenciasReventa> {
    return of({ productores: ['Yeferson Muñoz'], clientes: ['Tienda La 33'] });
  }

  crearDocumento(payload: DocumentoReventaPayload): Observable<DocumentoReventa> {
    this.creado = payload;
    return of({ renglones: [] } as unknown as DocumentoReventa);
  }

  editarDocumento(
    id: string,
    payload: DocumentoReventaUpdatePayload,
  ): Observable<DocumentoReventa> {
    this.editado = { id, payload };
    return of({ renglones: [] } as unknown as DocumentoReventa);
  }
}

const renglonVenta = (datos: Partial<VentaQueso>): VentaQueso =>
  ({
    id: 'v-1',
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

/** Lo que se lee en pantalla, con los espacios raros de Intl normalizados. */
const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/**
 * "$ 1.563.658,47" -> 1563658.47. Se lee la cifra COMO LA VE EL DUEÑO: el punto es
 * de los miles y la coma es el decimal, que es como se escribe en Colombia.
 */
const aNumero = (texto: string): number => {
  const limpio = comoSeLee(texto).replace(/[^\d,.-]/g, '');
  return Number(limpio.replace(/\./g, '').replace(',', '.'));
};

describe('DocumentoReventaFormDialog: el recibo de varios productos', () => {
  let fixture: ComponentFixture<DocumentoReventaFormDialog>;
  let dialogo: DocumentoReventaFormDialog;
  let servicio: ServicioFalso;
  let catalogo: CatalogoFalso;

  /**
   * `ajustarCatalogo` corre ANTES de crear el componente: el catálogo se pide en el
   * constructor del diálogo, así que una prueba que quiera otro catálogo (o una
   * consulta que falle) tiene que dejarlo puesto antes, no después.
   */
  const armar = async (
    data: DocumentoFormData,
    ajustarCatalogo?: (falso: CatalogoFalso) => void,
  ): Promise<void> => {
    // Se reinicia a mano porque algunas pruebas arman el diálogo DOS VECES (una de
    // venta y otra de compra) para comparar las dos caras del mismo formulario.
    TestBed.resetTestingModule();
    servicio = new ServicioFalso();
    catalogo = new CatalogoFalso();
    ajustarCatalogo?.(catalogo);
    await TestBed.configureTestingModule({
      imports: [DocumentoReventaFormDialog, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: CatalogoReventaService, useValue: catalogo },
        {
          provide: MatDialogRef,
          useValue: {
            disableClose: false,
            backdropClick: () => EMPTY,
            keydownEvents: () => EMPTY,
            close: jasmine.createSpy('close'),
          },
        },
        { provide: ReventaService, useValue: servicio },
        { provide: MatSnackBar, useValue: { open: () => ({ onAction: () => EMPTY }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DocumentoReventaFormDialog);
    dialogo = fixture.componentInstance;
    await estabilizar();
  };

  const estabilizar = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** Escribe un renglón: producto, cantidad y precio (y su tarifa de gasto). */
  const llenar = (
    i: number,
    producto: string,
    cantidad: number,
    precio: number,
    gasto?: number,
  ): void => {
    while (dialogo.renglones.length <= i) dialogo.agregarRenglon();
    const fila = dialogo.renglones.at(i);
    fila.controls.producto.setValue(producto);
    // Lo que hace el `(selectionChange)` de la plantilla al escoger el producto.
    dialogo.productoCambio(i, producto);
    fila.controls.cantidad.setValue(cantidad);
    fila.controls.precio.setValue(precio);
    if (gasto !== undefined) fila.controls.gasto.setValue(gasto);
    // Tocados, como si los hubiera escrito una persona: Material solo muestra los
    // mensajes de error de un campo que ya se tocó.
    fila.controls.cantidad.markAsTouched();
    fila.controls.precio.markAsTouched();
  };

  /** Los renglones del recibo del pie, tal como se leen: [texto, plata]. */
  const renglonesDelRecibo = (): { texto: string; plata: number }[] =>
    Array.from(
      fixture.nativeElement.querySelectorAll('.cuenta .renglon-cuenta:not(.total-final)'),
    ).map((fila) => {
      const elemento = fila as HTMLElement;
      return {
        texto: comoSeLee(elemento.querySelector('span')?.textContent),
        plata: aNumero(elemento.querySelector('strong')?.textContent ?? ''),
      };
    });

  /** El bloque de gastos del pie: [texto de la cuenta, plata]. */
  const renglonesDeGastos = (): { texto: string; plata: number }[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.bloque-gastos .aparte')).map((fila) => {
      const elemento = fila as HTMLElement;
      return {
        texto: comoSeLee(elemento.querySelector('span')?.textContent),
        plata: aNumero(elemento.querySelector('strong')?.textContent ?? ''),
      };
    });

  /** La cifra grande del pie, como se lee. */
  const totalDelRecibo = (): number =>
    aNumero(
      fixture.nativeElement.querySelector('.cuenta .total-final strong')?.textContent ?? '',
    );

  const textoPantalla = (): string => comoSeLee(fixture.nativeElement.textContent);

  const campos = (): number => fixture.nativeElement.querySelectorAll('mat-form-field').length;

  /** El botón que registra la factura (el del pie, tipo submit). */
  const botonGuardar = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('button[type="submit"]');

  // -------------------------------------------------------- el pie suma exacto
  it('el total es la suma EXACTA de los tres renglones impresos', async () => {
    await armar({ tipo: 'venta' });
    dialogo.form.controls.tercero.setValue('Tienda La 33');
    llenar(0, 'queso', CIFRAS.queso.kilos, CIFRAS.queso.precio);
    llenar(1, 'borona', CIFRAS.borona.kilos, CIFRAS.borona.precio);
    llenar(2, 'mozzarella', CIFRAS.mozzarella.barras, CIFRAS.mozzarella.precio);
    await estabilizar();

    const renglones = renglonesDelRecibo();
    expect(renglones.length).withContext('un renglón impreso por producto').toBe(3);
    // Cada renglón con SU cuenta escrita y en SU unidad: los kilos con dos
    // decimales (99,1 kg × 15.777 daría otra plata) y las barras sin ninguno.
    expect(renglones[0].texto).toBe('Queso · 99,11 kg × $ 15.777');
    expect(renglones[1].texto).toBe('Borona · 12,35 kg × $ 4.333');
    expect(renglones[2].texto).toBe('Mozzarella · 7 barras × $ 21.999');
    expect(renglones[0].plata).toBe(CIFRAS.queso.total);
    expect(renglones[1].plata).toBe(CIFRAS.borona.total);
    expect(renglones[2].plata).toBe(CIFRAS.mozzarella.total);

    // LA CUENTA DEL DUEÑO: se suman las cifras impresas y tiene que dar la grande.
    const aMano = renglones.reduce((suma, r) => suma + r.plata, 0);
    expect(totalDelRecibo()).toBeCloseTo(aMano, 2);
    expect(totalDelRecibo()).toBeCloseTo(CIFRAS.totalFactura, 2);
    expect(textoPantalla()).toContain('Total de la venta');
  });

  it('el pie de la compra también suma exacto, y dice "Total a pagar"', async () => {
    await armar({ tipo: 'compra' });
    dialogo.form.controls.tercero.setValue('Yeferson');
    llenar(0, 'queso', COMPRA.queso.kilos, COMPRA.queso.precio);
    llenar(1, 'mozzarella', COMPRA.mozzarella.barras, COMPRA.mozzarella.precio);
    await estabilizar();

    const renglones = renglonesDelRecibo();
    expect(renglones.map((r) => r.plata)).toEqual([COMPRA.queso.total, COMPRA.mozzarella.total]);
    const aMano = renglones.reduce((suma, r) => suma + r.plata, 0);
    expect(totalDelRecibo()).toBeCloseTo(aMano, 2);
    expect(totalDelRecibo()).toBeCloseTo(COMPRA.total, 2);
    expect(textoPantalla()).toContain('Total a pagar');
    // Al comprar no hay gastos de vender: la sección no existe.
    expect(textoPantalla()).not.toContain('Gastos de vender');
  });

  it('el gasto se descuenta DESPUÉS del total y también suma exacto', async () => {
    await armar({ tipo: 'venta' });
    dialogo.form.controls.tercero.setValue('Tienda La 33');
    dialogo.form.controls.gasto_concepto.setValue('Flete');
    llenar(0, 'queso', CIFRAS.queso.kilos, CIFRAS.queso.precio, CIFRAS.queso.flete);
    llenar(1, 'borona', CIFRAS.borona.kilos, CIFRAS.borona.precio);
    llenar(2, 'mozzarella', CIFRAS.mozzarella.barras, CIFRAS.mozzarella.precio);
    await estabilizar();

    // El total NO cambia: el flete lo paga la quesera, no el cliente.
    expect(totalDelRecibo()).toBeCloseTo(CIFRAS.totalFactura, 2);

    const gastos = renglonesDeGastos();
    // La cuenta del gasto escrita, la resta y lo que le queda. Solo el queso lleva
    // flete: los renglones sin tarifa no aparecen (suman cero).
    expect(gastos.length).toBe(3);
    expect(gastos[0].texto).toBe('Queso: 99,11 kg × $ 317 por kilo');
    expect(gastos[0].plata).toBeCloseTo(CIFRAS.queso.gasto, 2);
    expect(gastos[1].texto).toBe('Flete (lo paga usted)');
    expect(gastos[1].plata).toBeCloseTo(CIFRAS.queso.gasto, 2);
    expect(gastos[2].texto).toBe('Le queda');
    expect(gastos[2].plata).toBeCloseTo(CIFRAS.totalFactura - CIFRAS.queso.gasto, 2);
  });

  // --------------------------------------------- menos campos que el de antes
  it('con un producto se ven SEIS campos, y los gastos arrancan plegados', async () => {
    // El formulario de un solo producto de antes tenía ocho campos siempre a la
    // vista (tipo, fecha, cliente, kilos, precio, concepto del gasto, gasto por
    // kilo y observaciones). Este tiene seis: fecha, cliente, producto, cantidad,
    // precio y observaciones. Los dos del gasto están, pero plegados.
    await armar({ tipo: 'venta' });
    expect(campos()).toBe(6);
    expect(dialogo.gastosAbiertos()).toBeFalse();
    expect(
      fixture.nativeElement.querySelectorAll('input[formcontrolname="gasto"]').length,
    ).toBe(0);
    expect(textoPantalla()).toContain('Gastos de vender (transporte)');
    expect(textoPantalla()).toContain('Ninguno');

    dialogo.alternarGastos();
    await estabilizar();
    expect(
      fixture.nativeElement.querySelectorAll('input[formcontrolname="gasto"]').length,
    ).toBe(1);
  });

  // ------------------------------------------------- la unidad va con el producto
  it('al escoger mozzarella el campo pasa a barras y el precio se limpia', async () => {
    await armar({ tipo: 'venta' });
    // El queso arranca con su precio de siempre sugerido y midiéndose en kilos.
    expect(dialogo.renglones.at(0).controls.precio.value).toBe(19500);
    expect(dialogo.esDeBarras(0)).toBeFalse();
    expect(textoPantalla()).toContain('Precio por kilo');

    dialogo.renglones.at(0).controls.producto.setValue('mozzarella');
    dialogo.productoCambio(0, 'mozzarella');
    await estabilizar();

    expect(dialogo.esDeBarras(0)).toBeTrue();
    // El precio se limpia: "$19.500 por barra" sería otra plata, no la misma.
    expect(dialogo.renglones.at(0).controls.precio.value).toBeNull();
    expect(textoPantalla()).toContain('Precio por barra');
  });

  it('las barras no aceptan medias: el formulario queda inválido y lo dice', async () => {
    await armar({ tipo: 'venta' });
    dialogo.form.controls.tercero.setValue('Tienda La 33');
    llenar(0, 'mozzarella', 2.5, 21999);
    await estabilizar();

    expect(dialogo.renglones.at(0).controls.cantidad.hasError('barrasEnteras')).toBeTrue();
    expect(dialogo.form.invalid).toBeTrue();
    expect(textoPantalla()).toContain('Las barras van completas');

    // Y con barras completas pasa.
    dialogo.renglones.at(0).controls.cantidad.setValue(7);
    await estabilizar();
    expect(dialogo.form.valid).toBeTrue();
  });

  it('un "2,5" válido en kilos se vuelve inválido al pasar a barras', async () => {
    // Es el orden en que aparece el defecto: primero se escribe la cantidad y
    // después se cambia el producto. Si la cantidad no se revalidara, la factura se
    // mandaría con 2,5 barras y el backend la devolvería con un 422.
    await armar({ tipo: 'venta' });
    dialogo.form.controls.tercero.setValue('Tienda La 33');
    llenar(0, 'queso', 2.5, 15777);
    await estabilizar();
    expect(dialogo.form.valid).toBeTrue();

    dialogo.renglones.at(0).controls.producto.setValue('mozzarella');
    dialogo.productoCambio(0, 'mozzarella');
    await estabilizar();

    expect(dialogo.renglones.at(0).controls.cantidad.hasError('barrasEnteras')).toBeTrue();
  });

  // ------------------------------------------------------------- el payload
  it('de cada renglón viaja SOLO el par de campos de su unidad', async () => {
    await armar({ tipo: 'venta' });
    dialogo.form.controls.tercero.setValue('Tienda La 33');
    dialogo.form.controls.gasto_concepto.setValue('Flete');
    llenar(0, 'queso', CIFRAS.queso.kilos, CIFRAS.queso.precio, CIFRAS.queso.flete);
    llenar(1, 'mozzarella', CIFRAS.mozzarella.barras, CIFRAS.mozzarella.precio);
    await estabilizar();

    await dialogo.guardar();

    const payload = servicio.creado;
    expect(payload?.tipo).toBe('venta');
    expect(payload?.tercero).toBe('Tienda La 33');
    // El renglón de kilos NO lleva barras ni precio_barra, ni en cero.
    expect(payload?.renglones[0]).toEqual({
      tipo: 'queso',
      kilos: CIFRAS.queso.kilos,
      precio_kilo: CIFRAS.queso.precio,
      gasto_por_kilo: CIFRAS.queso.flete,
      gasto_concepto: 'Flete',
      observaciones: null,
    });
    // Y el de barras no lleva kilos ni precio_kilo.
    expect(payload?.renglones[1]).toEqual({
      tipo: 'mozzarella',
      barras: CIFRAS.mozzarella.barras,
      precio_barra: CIFRAS.mozzarella.precio,
      gasto_por_barra: 0,
      gasto_concepto: 'Flete',
      observaciones: null,
    });
  });

  it('la coma del precio no se come la plata', async () => {
    await armar({ tipo: 'venta' });
    dialogo.form.controls.tercero.setValue('Tienda La 33');
    llenar(0, 'queso', CIFRAS.queso.kilos, 0);
    await estabilizar();

    // Se escribe en la caja, que es lo que pasa por appMiles.
    const caja = fixture.nativeElement.querySelector(
      'input[formcontrolname="precio"]',
    ) as HTMLInputElement;
    caja.value = '15777,50';
    caja.dispatchEvent(new Event('input'));
    await estabilizar();

    await dialogo.guardar();
    // 15.777,50 y no 1.577.750 (la coma como miles) ni 15.777 (la coma botada).
    expect(servicio.creado?.renglones[0]).toEqual(
      jasmine.objectContaining({ precio_kilo: 15777.5 }),
    );
  });

  it('la nota de una factura de UN producto también le queda al producto', async () => {
    // Es lo mismo que hace la puerta plana del backend, así que una venta de un
    // producto queda guardada igual sin importar por dónde se registró.
    await armar({ tipo: 'venta' });
    dialogo.form.controls.tercero.setValue('Tienda La 33');
    dialogo.form.controls.observaciones.setValue('pedido del sabado');
    llenar(0, 'queso', CIFRAS.queso.kilos, CIFRAS.queso.precio);
    await estabilizar();
    await dialogo.guardar();

    expect(servicio.creado?.observaciones).toBe('pedido del sabado');
    expect(servicio.creado?.renglones[0].observaciones).toBe('pedido del sabado');
  });

  it('con VARIOS productos la nota es de la factura y no se le repite a cada uno', async () => {
    await armar({ tipo: 'venta' });
    dialogo.form.controls.tercero.setValue('Tienda La 33');
    dialogo.form.controls.observaciones.setValue('pedido del sabado');
    llenar(0, 'queso', CIFRAS.queso.kilos, CIFRAS.queso.precio);
    llenar(1, 'borona', CIFRAS.borona.kilos, CIFRAS.borona.precio);
    await estabilizar();
    await dialogo.guardar();

    expect(servicio.creado?.observaciones).toBe('pedido del sabado');
    expect(servicio.creado?.renglones.map((r) => r.observaciones)).toEqual([null, null]);
  });

  it('pagada de contado solo existe al registrar una venta', async () => {
    await armar({ tipo: 'venta' });
    expect(textoPantalla()).toContain('Pagada de contado');
    await armar({ tipo: 'compra' });
    expect(textoPantalla()).not.toContain('Pagada de contado');
  });

  // -------------------------------------------------------- agregar y quitar
  it('no se puede quitar el único producto de la factura', async () => {
    await armar({ tipo: 'venta' });
    dialogo.quitarRenglon(0);
    expect(dialogo.renglones.length).toBe(1);

    dialogo.agregarRenglon();
    await estabilizar();
    expect(dialogo.renglones.length).toBe(2);
    dialogo.quitarRenglon(0);
    expect(dialogo.renglones.length).toBe(1);
  });

  // ------------------------------------------------- el candado de los abonos
  describe('una factura que ya tiene abonos', () => {
    const CON_ABONOS: DocumentoVenta = {
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
      // Los tres productos del día del dueño, con el abono de $1.600.000 ya
      // derramado: entero al queso, el resto a la borona y nada a la mozzarella.
      renglones: [
        renglonVenta({
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
          // Dos fotos de transferencia anexadas: son las que se pierden si se
          // rehacen los productos (ver la prueba de `soportesEnRiesgo`).
          adjuntos_count: 2,
        }),
        renglonVenta({
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
        }),
        renglonVenta({
          id: 'v-3',
          orden: 2,
          tipo: 'mozzarella',
          unidad: 'barra',
          barras: '7',
          precio_barra: '21999',
          valor_total: '153993',
          saldo: '153993',
        }),
      ],
    };

    it('los productos quedan a la vista pero apagados, y se dice por qué', async () => {
      await armar({ tipo: 'venta', item: CON_ABONOS });

      expect(dialogo.conAbonos).toBeTrue();
      expect(dialogo.renglones.disabled).toBeTrue();
      expect(textoPantalla()).toContain('Esta factura ya tiene abonos');
      expect(textoPantalla()).toContain('la fecha, el nombre y la nota');
      // Los productos se siguen viendo, con sus cifras y su recibo cuadrado.
      expect(dialogo.renglones.length).toBe(3);
      const renglones = renglonesDelRecibo();
      expect(renglones.length).toBe(3);
      const aMano = renglones.reduce((suma, r) => suma + r.plata, 0);
      expect(totalDelRecibo()).toBeCloseTo(aMano, 2);
      expect(totalDelRecibo()).toBeCloseTo(CIFRAS.totalFactura, 2);
    });

    it('al guardar NO manda los renglones: eso es "no me toque los productos"', async () => {
      await armar({ tipo: 'venta', item: CON_ABONOS });
      dialogo.form.controls.tercero.setValue('Tienda La 33 (centro)');
      await estabilizar();

      await dialogo.guardar();

      expect(servicio.editado?.id).toBe('d-1');
      expect(servicio.editado?.payload.tipo).toBe('venta');
      expect(servicio.editado?.payload.tercero).toBe('Tienda La 33 (centro)');
      expect(servicio.editado?.payload.renglones).toBeNull();
    });

    it('corregir SOLO la fecha no manda los renglones: rehacerlos borraría los soportes', async () => {
      // Rehacer los productos se lleva sus soportes de pago del almacenamiento. Si
      // la lista viajara siempre, corregirle la fecha a una factura le borraría al
      // dueño las fotos de las transferencias sin que nada se lo dijera.
      await armar({
        tipo: 'venta',
        item: { ...CON_ABONOS, abonado: '0', saldo: '1771164.02', estado_pago: 'pendiente' },
      });
      expect(dialogo.conAbonos).toBeFalse();

      dialogo.form.controls.fecha.setValue(new Date(2026, 6, 11));
      dialogo.form.controls.fecha.markAsDirty();
      await estabilizar();
      await dialogo.guardar();

      expect(servicio.editado?.payload.renglones)
        .withContext('no se tocaron los productos: no se rehacen')
        .toBeNull();
      expect(dialogo.soportesEnRiesgo()).toBe(0);
    });

    it('si SÍ cambia los productos, avisa cuántos soportes se van a borrar', async () => {
      await armar({
        tipo: 'venta',
        item: { ...CON_ABONOS, abonado: '0', saldo: '1771164.02', estado_pago: 'pendiente' },
      });
      // El primer renglón trae dos soportes anexados (ver el renglón de queso).
      dialogo.renglones.at(0).controls.precio.setValue(16000);
      dialogo.renglones.at(0).controls.precio.markAsDirty();
      await estabilizar();

      expect(dialogo.soportesEnRiesgo()).toBe(2);
      expect(textoPantalla()).toContain('borra 2 soportes de pago');
      expect(textoPantalla()).toContain('use el lápiz del producto en la lista');

      await dialogo.guardar();
      expect(servicio.editado?.payload.renglones?.length).toBe(3);
    });

    it('agregar un producto ensucia la factura, si no se perdería al guardar', async () => {
      await armar({
        tipo: 'venta',
        item: { ...CON_ABONOS, abonado: '0', saldo: '1771164.02', estado_pago: 'pendiente' },
      });
      expect(dialogo.renglones.dirty).toBeFalse();

      dialogo.agregarRenglon();
      const nuevo = dialogo.renglones.at(3);
      nuevo.controls.cantidad.setValue(10);
      nuevo.controls.precio.setValue(20000);
      await estabilizar();

      expect(dialogo.renglones.dirty).withContext('push no ensucia solo').toBeTrue();
      await dialogo.guardar();
      expect(servicio.editado?.payload.renglones?.length).toBe(4);
    });

    it('sin abonos sí los rehace, y el flete de la factura se conserva', async () => {
      await armar({
        tipo: 'venta',
        item: { ...CON_ABONOS, abonado: '0', saldo: '1771164.02', estado_pago: 'pendiente' },
      });

      expect(dialogo.conAbonos).toBeFalse();
      expect(dialogo.renglones.enabled).toBeTrue();
      // La sección de gastos se abre sola cuando la factura ya trae flete: si no,
      // el dueño no vería de dónde sale la diferencia con lo que le queda.
      expect(dialogo.gastosAbiertos()).toBeTrue();
      expect(dialogo.form.controls.gasto_concepto.value).toBe('Flete');

      // Se toca un producto: eso es lo que hace que la lista viaje y los rehaga.
      dialogo.renglones.at(1).controls.cantidad.setValue(12.35);
      dialogo.renglones.at(1).controls.cantidad.markAsDirty();
      await estabilizar();
      await dialogo.guardar();

      const renglones = servicio.editado?.payload.renglones;
      expect(renglones?.length).toBe(3);
      expect(renglones?.[0]).toEqual(
        jasmine.objectContaining({ tipo: 'queso', kilos: 99.11, gasto_por_kilo: 317 }),
      );
      // La borona no tenía tarifa de flete y sigue sin tenerla: no se le contagia
      // la del queso por compartir factura.
      expect(renglones?.[1]).toEqual(
        jasmine.objectContaining({ tipo: 'borona', kilos: 12.35, gasto_por_kilo: 0 }),
      );
      expect(renglones?.[2]).toEqual(
        jasmine.objectContaining({ tipo: 'mozzarella', barras: 7, precio_barra: 21999 }),
      );
    });
  });

  // ---------------------------------------------- la borona gratis no se pierde
  it('al rehacer una compra, la borona que llegó gratis viaja de vuelta', async () => {
    // No tiene campo en la pantalla, y si no viajara escondida, rehacer los
    // productos le borraría al negocio borona que ya tiene en la bodega.
    const CON_BORONA: DocumentoCompra = {
      id: 'd-2',
      empresa_id: 'e-1',
      estado: 'activo',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
      tipo: 'compra',
      fecha: '2026-07-01',
      tercero: 'Yeferson Muñoz',
      observaciones: null,
      total: '803597.41',
      abonado: '0',
      saldo: '803597.41',
      total_anulado: '0',
      estado_pago: 'pendiente',
      cantidad_renglones: 1,
      renglones: [
        {
          id: 'c-1',
          empresa_id: 'e-1',
          estado: 'pendiente',
          created_at: '2026-07-01T00:00:00Z',
          updated_at: '2026-07-01T00:00:00Z',
          fecha: '2026-07-01',
          productor: 'Yeferson Muñoz',
          documento_id: 'd-2',
          orden: 0,
          tipo: 'queso',
          unidad: 'kg',
          kilos_brutos: '77.77',
          borona_kilos: '3.33',
          kilos_netos: '77.77',
          precio_kilo: '10333',
          barras: '0',
          precio_barra: '0',
          valor_total: '803597.41',
          abonado: '0',
          saldo: '803597.41',
          observaciones: null,
          abonos: [],
          adjuntos_count: 0,
        },
      ],
    };

    await armar({ tipo: 'compra', item: CON_BORONA });
    // Se corrige el precio, que es lo que hace que los productos se rehagan: es
    // justo ahí donde la borona se podía perder.
    dialogo.renglones.at(0).controls.precio.setValue(10333);
    dialogo.renglones.at(0).controls.precio.markAsDirty();
    await estabilizar();
    await dialogo.guardar();

    expect(servicio.editado?.payload.renglones?.[0]).toEqual({
      tipo: 'queso',
      kilos_brutos: 77.77,
      precio_kilo: 10333,
      borona_kilos: 3.33,
      observaciones: null,
    });
  });
  // ------------------------------------------- el desplegable ES el catálogo
  describe('el desplegable de producto', () => {
    /** Los productos que ofrece el renglón, tal como se leen en el desplegable. */
    const opciones = (): string[] => dialogo.catalogo().map((p) => p.etiqueta);

    it('ofrece el catálogo COMPLETO del dueño, con el producto que él agregó', async () => {
      // ES EL DEFECTO QUE ÉL REPORTÓ: creó "Costeño" en la pestaña de Productos y al
      // registrar una venta no le aparecía, porque esta lista estaba escrita en el
      // código con tres renglones.
      await armar({ tipo: 'venta' });

      expect(opciones()).toEqual(['Queso', 'Borona', 'Mozzarella', 'Costeño', 'Panela']);
      expect(dialogo.catalogoListo()).toBeTrue();
    });

    it('al comprar no ofrece los subproductos: la borona llega gratis con el queso', async () => {
      // Ofrecerla sería ofrecer una compra que el servidor rechaza, y peor: anotarle
      // un costo a algo que por definición no se paga.
      await armar({ tipo: 'compra' });

      expect(opciones()).toEqual(['Queso', 'Mozzarella', 'Costeño', 'Panela']);
    });

    it('un producto desactivado no se ofrece', async () => {
      await armar({ tipo: 'venta' }, (falso) => {
        falso.productos = CATALOGO.map((p) =>
          p.clave === 'costeno' ? ({ ...p, estado: 'inactivo' } as ProductoReventa) : p,
        );
      });

      expect(opciones()).not.toContain('Costeño');
    });

    it('sin catálogo no se puede registrar, y se dice', async () => {
      // Registrar sin saber qué productos hay es anotarle plata al inventario
      // equivocado. Se apaga el botón y se explica, en vez de dejar un desplegable
      // vacío sin razón.
      await armar({ tipo: 'venta' }, (falso) => {
        falso.catalogo = () => throwError(() => new Error('sin señal'));
      });

      expect(dialogo.catalogoListo()).toBeFalse();
      expect(dialogo.errorCatalogo()).toBeTrue();
      expect(textoPantalla()).toContain('No fue posible cargar su lista de productos');
      expect(botonGuardar().disabled).toBeTrue();
    });

    it('el renglón nuevo nace con el primer producto del catálogo, no con "queso"', async () => {
      // Si el dueño quitó el queso de su lista, la factura no puede nacer con él.
      await armar({ tipo: 'venta' }, (falso) => {
        falso.productos = CATALOGO.filter((p) => p.clave !== 'queso');
      });

      expect(dialogo.renglones.at(0).controls.producto.value).toBe('borona');
    });
  });

  // ------------------------------- la cantidad acepta o rechaza según el producto
  describe('la cantidad se mide según el producto escogido', () => {
    it('un producto POR UNIDAD del dueño rechaza decimales, igual que la mozzarella', async () => {
      await armar({ tipo: 'venta' });
      dialogo.form.controls.tercero.setValue('Tienda La 33');
      llenar(0, 'panela', 2.5, 3000);
      await estabilizar();

      expect(dialogo.esDeBarras(0)).withContext('la panela se cuenta').toBeTrue();
      expect(dialogo.renglones.at(0).controls.cantidad.hasError('barrasEnteras')).toBeTrue();
      expect(dialogo.form.invalid).toBeTrue();
      // Y con piezas completas pasa.
      dialogo.renglones.at(0).controls.cantidad.setValue(100);
      await estabilizar();
      expect(dialogo.form.valid).toBeTrue();
    });

    it('un producto POR KILO del dueño sí acepta decimales', async () => {
      await armar({ tipo: 'venta' });
      dialogo.form.controls.tercero.setValue('Tienda La 33');
      llenar(0, 'costeno', 12.45, 14000);
      await estabilizar();

      expect(dialogo.esDeBarras(0)).toBeFalse();
      expect(dialogo.form.valid).toBeTrue();
      expect(textoPantalla()).toContain('Precio por kilo');
    });

    it('la panela se rotula en UNIDADES y la mozzarella en BARRAS', async () => {
      // "100 barras de panela" sería inventarle al dueño una unidad que no usa; y la
      // mozzarella tiene que seguir diciendo barras, que es como están impresos sus
      // comprobantes.
      await armar({ tipo: 'venta' });
      llenar(0, 'panela', 100, 3000);
      await estabilizar();
      expect(dialogo.rotuloCantidad(0)).toBe('unidades');
      expect(textoPantalla()).toContain('Precio por unidad');

      llenar(0, 'mozzarella', 7, 21999);
      await estabilizar();
      expect(dialogo.rotuloCantidad(0)).toBe('barras');
      expect(textoPantalla()).toContain('Precio por barra');
    });

    it('la plata de un producto por unidad viaja en barras/precio_barra, sin kilos', async () => {
      // Es el defecto crítico del backend visto desde la pantalla: si la cantidad
      // viajara en `kilos`, la compra de 100 panelas se guardaba en CEROS.
      await armar({ tipo: 'compra' });
      dialogo.form.controls.tercero.setValue('Patricia');
      llenar(0, 'panela', 100, 2000);
      await estabilizar();
      await dialogo.guardar();

      expect(servicio.creado?.renglones[0]).toEqual({
        tipo: 'panela',
        barras: 100,
        precio_barra: 2000,
        observaciones: null,
      });
    });
  });

  // ------------------------------------- el recibo suma exacto con los productos nuevos
  it('el pie suma EXACTO una factura con el producto nuevo y una panela', async () => {
    // La cuenta del dueño: 12,45 kg de costeño a $14.000 = $174.300, y 100 panelas a
    // $3.000 = $300.000. Total $474.300.
    await armar({ tipo: 'venta' });
    dialogo.form.controls.tercero.setValue('Tienda La 33');
    llenar(0, 'costeno', 12.45, 14000);
    llenar(1, 'panela', 100, 3000);
    await estabilizar();

    const renglones = renglonesDelRecibo();
    expect(renglones.length).toBe(2);
    expect(renglones[0].texto).toBe('Costeño · 12,45 kg × $ 14.000');
    expect(renglones[1].texto).toBe('Panela · 100 unidades × $ 3.000');
    expect(renglones[0].plata).toBe(174300);
    expect(renglones[1].plata).toBe(300000);

    const aMano = renglones.reduce((suma, r) => suma + r.plata, 0);
    expect(totalDelRecibo()).toBeCloseTo(aMano, 2);
    expect(totalDelRecibo()).toBeCloseTo(474300, 2);
  });
});
