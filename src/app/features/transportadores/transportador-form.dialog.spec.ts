import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { EMPTY, Observable, Subject, of } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Page, Ruta, Transportador } from '../../core/models';
import { TransportadorFormDialog } from './transportador-form.dialog';
import { TransportadorPayload, TransportadoresService } from './transportadores.service';

/**
 * El caso del dueño, tal cual: Alex Agudelo hace DOS rutas y le pagan distinto el
 * litro en cada una (Nápoles a $242,76 y Mira Valle a $300).
 *
 * Lo que estas pruebas cuidan es la plata:
 *  · que al abrir a editar salgan las DOS rutas con su tarifa —y que salgan aunque
 *    el catálogo de /rutas todavía no haya llegado, que es el defecto que ya pasó
 *    en este proyecto (ver shared/select-buscable.spec.ts)—;
 *  · que guardar sin tocar las rutas NO se las borre ni le mueva las tarifas;
 *  · que la coma de "242,76" llegue como 242,76 y no como 24.276 ni como 242.
 */

/**
 * El catálogo de /rutas se emite A MANO, para poder guardar el orden real.
 *
 * Cada llamada estrena Subject: un Subject que ya erroró queda muerto y le vuelve a
 * errar a todo el que se suscriba, y el diálogo REINTENTA la carga. Sin esto el
 * reintento no se podría probar. `rutas` siempre apunta al de la última llamada.
 */
class ApiFalsa {
  rutas = new Subject<Page<Ruta>>();
  llamadas = 0;

  get<T>(): Observable<T> {
    this.llamadas += 1;
    this.rutas = new Subject<Page<Ruta>>();
    return this.rutas as unknown as Observable<T>;
  }
}

class ServicioFalso {
  creado: TransportadorPayload | null = null;
  actualizado: { id: string; payload: Partial<TransportadorPayload> } | null = null;

  create(payload: TransportadorPayload): Observable<Transportador> {
    this.creado = payload;
    return of({} as Transportador);
  }

  update(id: string, payload: Partial<TransportadorPayload>): Observable<Transportador> {
    this.actualizado = { id, payload };
    return of({} as Transportador);
  }
}

const ruta = (id: string, nombre: string): Ruta => ({
  id,
  nombre,
  municipio: null,
  descripcion: null,
  empresa_id: 'e-1',
  estado: 'activo',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const pagina = (items: Ruta[]): Page<Ruta> => ({
  items,
  total: items.length,
  page: 1,
  page_size: 100,
  pages: 1,
});

/**
 * Alex, con sus dos rutas a tarifas distintas. Los montos llegan como string, como
 * en JSON.
 *
 * OJO con el ORDEN: así las manda el API —por id de ruta, que es un UUID— y NO es
 * el orden en que el diálogo las pinta. En pantalla van por nombre (Mira Valle
 * antes que Nápoles), que es el mismo orden del PDF del comprobante; el dueño
 * compara las dos hojas. Por eso los índices de más abajo salen "al revés" de esta
 * lista: es a propósito.
 */
const ALEX: Transportador = {
  id: 't-1',
  empresa_id: 'e-1',
  estado: 'activo',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  nombre: 'Alex Agudelo',
  documento: '1094',
  telefono: '3115550000',
  valor_transporte: '238.00',
  rutas: [
    { ruta_id: 'r-nap', nombre: 'Nápoles', valor_transporte: '242.76' },
    { ruta_id: 'r-mir', nombre: 'Mira Valle', valor_transporte: '300.00' },
  ],
};

/**
 * EL CASO NUEVO DEL DUEÑO, textual: "el transporte de leche a fábrica vale 150k
 * independientemente de los litros".
 *
 * El mismo señor, con las dos formas de cobrar a la vez: Nápoles por litro a $242,76 y
 * el viaje a fábrica a $150.000 EL DÍA. Es la razón de ser de este campo.
 */
const ALEX_CON_FIJO: Transportador = {
  ...ALEX,
  rutas: [
    { ruta_id: 'r-nap', nombre: 'Nápoles', valor_transporte: '242.76', modo_transporte: 'litro' },
    {
      ruta_id: 'r-fab',
      nombre: 'A fábrica',
      valor_transporte: '150000.00',
      modo_transporte: 'dia_fijo',
    },
  ],
};

describe('TransportadorFormDialog', () => {
  let fixture: ComponentFixture<TransportadorFormDialog>;
  let dialogo: TransportadorFormDialog;
  let api: ApiFalsa;
  let servicio: ServicioFalso;

  const armar = async (item?: Transportador): Promise<void> => {
    api = new ApiFalsa();
    servicio = new ServicioFalso();
    await TestBed.configureTestingModule({
      imports: [TransportadorFormDialog, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: item ? { item } : null },
        {
          provide: MatDialogRef,
          useValue: {
            disableClose: false,
            backdropClick: () => EMPTY,
            keydownEvents: () => EMPTY,
            close: jasmine.createSpy('close'),
          },
        },
        { provide: ApiService, useValue: api },
        { provide: TransportadoresService, useValue: servicio },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TransportadorFormDialog);
    dialogo = fixture.componentInstance;
    fixture.detectChanges();
  };

  /**
   * Con await y no de una: MatAutocomplete pinta el texto del selector en una
   * microtarea, así que leerlo en el mismo tic de detectChanges siempre devolvería
   * vacío y la prueba mentiría (misma maña que en select-buscable.spec.ts).
   */
  const estabilizar = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const filas = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.fila-ruta'));

  /** Lo que se LEE en el selector de ruta de un renglón. */
  const rutaVisible = (i: number): string =>
    (filas()[i].querySelector('app-select-buscable input') as HTMLInputElement).value;

  /** Y lo que se lee en su campo de tarifa, ya formateado por appMiles. */
  const campoTarifa = (i: number): HTMLInputElement =>
    filas()[i].querySelector('input[formcontrolname="valor_transporte"]') as HTMLInputElement;

  it('al editar muestra las dos rutas con su tarifa, aunque /rutas no haya llegado', async () => {
    await armar(ALEX);
    // A propósito NO se emite el catálogo: es el orden en que aparece el defecto.
    await estabilizar();

    expect(filas().length).toBe(2);
    // Por nombre: Mira Valle antes que Nápoles, aunque el API las mande al revés.
    expect(rutaVisible(0)).toBe('Mira Valle');
    expect(rutaVisible(1)).toBe('Nápoles');
    // La tarifa con centavos: "243" sería la cifra equivocada.
    expect(campoTarifa(0).value).toBe('300');
    expect(campoTarifa(1).value).toBe('242,76');
    // Y sin ensuciar el formulario: cerrar no debería pedir confirmar nada.
    expect(dialogo.form.dirty).toBeFalse();
  });

  it('las rutas siguen ahí cuando el catálogo llega después', async () => {
    await armar(ALEX);
    api.rutas.next(pagina([ruta('r-nap', 'Nápoles'), ruta('r-mir', 'Mira Valle')]));
    await estabilizar();

    expect(rutaVisible(0)).toBe('Mira Valle');
    expect(rutaVisible(1)).toBe('Nápoles');
    expect(campoTarifa(1).value).toBe('242,76');
  });

  it('guardar sin tocar las rutas no las borra ni les mueve la tarifa', async () => {
    await armar(ALEX);
    await estabilizar();

    await dialogo.guardar();

    expect(servicio.actualizado?.id).toBe('t-1');
    // Cada ruta con SU tarifa. El orden es el de la pantalla (por nombre) y al
    // backend le da igual: reemplaza la lista completa y la vuelve a leer ordenada.
    expect(servicio.actualizado?.payload.rutas).toEqual([
      { ruta_id: 'r-mir', valor_transporte: 300, modo_transporte: 'litro' },
      { ruta_id: 'r-nap', valor_transporte: 242.76, modo_transporte: 'litro' },
    ]);
    // Y la tarifa general se queda como estaba: es la de las rutas sin tarifa propia.
    expect(Number(servicio.actualizado?.payload.valor_transporte)).toBe(238);
    // EL MODO VIAJA SIEMPRE, incluso en un transportador que llegó sin el campo (una
    // respuesta vieja): 'litro' es lo que esa tarifa significaba el día que se guardó,
    // así que reenviarlo no le mueve un peso a nadie.
    expect(servicio.actualizado?.payload.modo_transporte).toBe('litro');
  });

  it('una ruta que ya no está en el catálogo se sigue viendo con su nombre', async () => {
    // Ruta desactivada después de asignarla: /rutas?estado=activo no la trae. Si el
    // renglón saliera en blanco, el usuario creería que perdió la tarifa.
    await armar({
      ...ALEX,
      rutas: [{ ruta_id: 'r-viejo', nombre: 'Ruta vieja', valor_transporte: '250.50' }],
    });
    api.rutas.next(pagina([ruta('r-nap', 'Nápoles')]));
    await estabilizar();

    expect(rutaVisible(0)).toBe('Ruta vieja');
    // "250,50" y no "250,5": los centavos van los dos o ninguno. Un solo decimal en
    // plata se lee como si se hubiera perdido un centavo, y esta caja tiene que
    // decir lo mismo que la tabla de la lista y que el PDF.
    expect(campoTarifa(0).value).toBe('250,50');
  });

  it('no ofrece dos veces la misma ruta', async () => {
    await armar(ALEX);
    api.rutas.next(
      pagina([
        ruta('r-nap', 'Nápoles'),
        ruta('r-mir', 'Mira Valle'),
        ruta('r-san', 'San Vicente'),
      ]),
    );
    await estabilizar();

    dialogo.agregarRuta();
    await estabilizar();

    // El renglón nuevo solo puede escoger la que nadie tiene…
    expect(dialogo.opcionesDeFila(2).map((op) => op.id)).toEqual(['r-san']);
    // …y cada renglón conserva LA SUYA (si no, no podría ni mostrar lo que tiene).
    // El renglón 0 es Mira Valle (los renglones van por nombre), así que la que le
    // falta es Nápoles, la del otro renglón.
    expect(dialogo.opcionesDeFila(0).map((op) => op.id)).toEqual(['r-mir', 'r-san']);
    expect(dialogo.hayRutasPorAgregar()).toBeFalse();
  });

  it('un renglón sin ruta deja el formulario inválido (Guardar apagado)', async () => {
    await armar(ALEX);
    await estabilizar();
    expect(dialogo.form.valid).toBeTrue();

    dialogo.agregarRuta();
    await estabilizar();

    expect(dialogo.form.invalid).toBeTrue();
    // Y se dice por qué, en vez de dejar un botón muerto sin explicación.
    expect(fixture.nativeElement.textContent).toContain('Escoja la ruta de este renglón');
  });

  it('quitar una ruta la manda fuera y deja la otra intacta', async () => {
    await armar(ALEX);
    await estabilizar();

    // El renglón 0 es Mira Valle (van por nombre): se va esa y queda Nápoles.
    dialogo.quitarRuta(0);
    await estabilizar();
    await dialogo.guardar();

    expect(servicio.actualizado?.payload.rutas).toEqual([
      { ruta_id: 'r-nap', valor_transporte: 242.76, modo_transporte: 'litro' },
    ]);
  });

  it('quitarle todas manda la lista vacía, que es lo que las borra', async () => {
    await armar(ALEX);
    await estabilizar();

    dialogo.quitarRuta(1);
    dialogo.quitarRuta(0);
    await estabilizar();
    await dialogo.guardar();

    expect(servicio.actualizado?.payload.rutas).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('se le paga con la tarifa general');
  });

  it('la coma de la tarifa no se come el valor', async () => {
    await armar();
    api.rutas.next(pagina([ruta('r-nap', 'Nápoles')]));
    await estabilizar();

    dialogo.form.controls.nombre.setValue('Alex Agudelo');
    // La tarifa general hay que escribirla: en un transportador nuevo nace vacía a
    // propósito (ver la prueba de abajo), así que sin esto no se podría guardar.
    dialogo.form.controls.valor_transporte.setValue(238);
    dialogo.agregarRuta();
    await estabilizar();
    dialogo.rutas.at(0).controls.ruta_id.setValue('r-nap');

    const campo = campoTarifa(0);
    campo.value = '242,76';
    campo.dispatchEvent(new Event('input'));
    await estabilizar();

    await dialogo.guardar();

    // 242,76 y no 24276 (la coma como miles) ni 242 (la coma botada).
    expect(servicio.creado?.rutas).toEqual([
      { ruta_id: 'r-nap', valor_transporte: 242.76, modo_transporte: 'litro' },
    ]);
  });

  it('el renglón nuevo arranca con la tarifa vacía, no en cero', async () => {
    // Un cero guardado sin darse cuenta es flete que no se le paga a nadie.
    await armar(ALEX);
    dialogo.agregarRuta();
    await estabilizar();

    expect(dialogo.rutas.at(2).controls.valor_transporte.value).toBeNull();
    expect(campoTarifa(2).value).toBe('');
  });

  // ------------------------------------------- la tarifa GENERAL no nace en cero
  it('un transportador nuevo no se puede guardar con la tarifa general en cero callado', async () => {
    // Antes el campo arrancaba en 0 y el formulario nacía VÁLIDO: se guardaba un
    // transportador con flete general $0 sin que nada lo dijera, y eso es flete que
    // no se le paga a nadie hasta que aparece la liquidación de la quincena.
    await armar();
    api.rutas.next(pagina([ruta('r-nap', 'Nápoles')]));
    await estabilizar();

    expect(dialogo.form.controls.valor_transporte.value).toBeNull();

    dialogo.form.controls.nombre.setValue('Nuevo Señor');
    await estabilizar();
    expect(dialogo.form.invalid).toBeTrue();
    expect(dialogo.form.controls.valor_transporte.hasError('required')).toBeTrue();

    await dialogo.guardar();
    expect(servicio.creado).toBeNull();
  });

  it('un cero puesto A MANO se puede guardar, pero avisado', async () => {
    // El cero puede ser a propósito (quien solo cobra por rutas con tarifa propia),
    // así que no se prohíbe: se dice lo que significa.
    await armar();
    api.rutas.next(pagina([ruta('r-nap', 'Nápoles')]));
    dialogo.form.controls.nombre.setValue('Nuevo Señor');
    dialogo.form.controls.valor_transporte.setValue(0);
    await estabilizar();

    expect(dialogo.form.valid).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('no le genera flete');
  });

  // --------------------------------------- lo que se dice cuando /rutas no llega
  it('mientras /rutas viene en camino NO dice que ya no quedan rutas', async () => {
    // Con las dos rutas de Alex ya puestas, sus propias rutas son las únicas
    // "opciones" que se conocen, y el diálogo concluía "Ya no quedan rutas por
    // agregar" antes de haber visto el catálogo. Es una mentira que suena a que el
    // sistema ya revisó.
    await armar(ALEX);
    await estabilizar();

    expect(dialogo.avisoDeAgregar()).toBe('Buscando las rutas disponibles…');
    expect(fixture.nativeElement.textContent).not.toContain('Ya no quedan rutas');
  });

  it('si /rutas falla lo dice y deja reintentar, en vez de mentir para siempre', async () => {
    await armar(ALEX);
    api.rutas.error(new Error('sin conexión'));
    await estabilizar();

    expect(dialogo.avisoDeAgregar()).toContain('No se pudo traer la lista de rutas');
    expect(fixture.nativeElement.textContent).not.toContain('Ya no quedan rutas');

    // Y el reintento de verdad vuelve a pedirlas: con el catálogo en la mano ya
    // sobra una ruta libre, así que se puede agregar otro renglón.
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((b) => ((b as HTMLElement).textContent ?? '').includes('Reintentar')) as HTMLButtonElement;
    expect(boton).withContext('el botón Reintentar tiene que estar').toBeTruthy();

    const antes = api.llamadas;
    boton.click();
    expect(api.llamadas).withContext('el reintento vuelve a pedir /rutas').toBe(antes + 1);
    api.rutas.next(
      pagina([ruta('r-nap', 'Nápoles'), ruta('r-mir', 'Mira Valle'), ruta('r-san', 'San Vicente')]),
    );
    await estabilizar();

    expect(dialogo.hayRutasPorAgregar()).toBeTrue();
    expect(dialogo.avisoDeAgregar()).toBe('');
  });

  it('con el catálogo en la mano sí puede decir que ya no quedan rutas', async () => {
    await armar(ALEX);
    api.rutas.next(pagina([ruta('r-nap', 'Nápoles'), ruta('r-mir', 'Mira Valle')]));
    await estabilizar();

    expect(dialogo.avisoDeAgregar()).toBe('Ya no quedan rutas por agregar.');
  });

  // ==========================================================================
  // POR LITRO O UN FIJO POR DÍA
  // ==========================================================================
  // "El transporte de leche a fábrica vale 150k independientemente de los litros".
  //
  // Lo que estas pruebas cuidan es que la pantalla no pueda mentir sobre CUÁL de las
  // dos cosas es una cifra: los mismos "$ 150.000" son un día de trabajo o —leídos por
  // litro— cuarenta y cinco millones de flete en un día de 300 litros, y en la caja se
  // ven exactamente igual. Lo único que los distingue es el modo, así que el modo tiene
  // que verse, tiene que viajar pegado a la cifra y tiene que estar explicado.

  /** Lo que se lee en el rótulo del campo de tarifa de un renglón. */
  const rotuloTarifa = (i: number): string =>
    (filas()[i].querySelector('.campo-tarifa mat-label')?.textContent ?? '').trim();

  /** Y la unidad que va pegada a la caja: "/L" o "por día". */
  const sufijoTarifa = (i: number): string =>
    (filas()[i].querySelector('.campo-tarifa .mat-mdc-form-field-text-suffix')?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  const textoPantalla = (): string =>
    (fixture.nativeElement.textContent ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

  it('al editar, cada ruta abre con SU modo: Nápoles por litro y a fábrica por día', async () => {
    await armar(ALEX_CON_FIJO);
    await estabilizar();

    // Van por nombre: "A fábrica" primero, Nápoles después.
    expect(rutaVisible(0)).toBe('A fábrica');
    expect(dialogo.rutas.at(0).controls.modo_transporte.value).toBe('dia_fijo');
    expect(dialogo.fijoDeLaFila(0)).toBeTrue();
    expect(campoTarifa(0).value).toBe('150.000');

    expect(rutaVisible(1)).toBe('Nápoles');
    expect(dialogo.rutas.at(1).controls.modo_transporte.value).toBe('litro');
    expect(dialogo.fijoDeLaFila(1)).toBeFalse();
    expect(campoTarifa(1).value).toBe('242,76');
  });

  it('el campo del fijo cambia de rótulo y de unidad: no dice "por litro"', async () => {
    await armar(ALEX_CON_FIJO);
    await estabilizar();

    // "Tarifa por litro" encima de $ 150.000 es la frase que hace la equivocación.
    expect(rotuloTarifa(0)).toBe('Cuánto vale el día');
    expect(rotuloTarifa(1)).toBe('Tarifa por litro');
    // Y la unidad al lado de la caja, que es lo que se lee mientras se teclea.
    expect(sufijoTarifa(0)).toBe('/día');
    expect(sufijoTarifa(1)).toBe('/L');
  });

  it('en el ancho del diálogo la cifra del fijo se ve COMPLETA, sin recortarse', async () => {
    // Cuatro columnas en un diálogo de 640px es justo donde una caja de plata se queda
    // sin espacio y el navegador empieza a esconder dígitos: "150.00" con el resto
    // desplazado fuera de la vista. Se mide EN EL NAVEGADOR y en el ancho real del
    // contenido del diálogo (640 menos los 24 de cada lado), porque esto no se puede
    // razonar de memoria; y el ancho se le pone al CONTENEDOR de las rutas, que es
    // contra el que se decide el reparto de columnas.
    await armar(ALEX_CON_FIJO);
    const lista = fixture.nativeElement.querySelector('.lista-de-rutas') as HTMLElement;
    lista.style.width = '592px';
    await estabilizar();

    // A ese ancho el renglón va en CUATRO columnas: ruta, cómo le paga, cuánto, quitar.
    expect(getComputedStyle(filas()[0]).gridTemplateColumns.split(' ').length).toBe(4);
    const caja = campoTarifa(0);
    expect(caja.value).toBe('150.000');
    // Si el texto no cupiera, el navegador lo dejaría desplazable dentro de la caja.
    expect(caja.scrollWidth).toBeLessThanOrEqual(caja.clientWidth);
  });

  it('cuando el diálogo se encoge, el renglón se apila en vez de recortar la plata', async () => {
    // El caso que obliga a medir el CONTENEDOR y no la pantalla: en un equipo de 620px
    // el diálogo mide 496 —no es "un celular" y ninguna consulta de pantalla de celular
    // se activaría—, y con cuatro columnas a la ruta le quedaban 74px.
    await armar(ALEX_CON_FIJO);
    const lista = fixture.nativeElement.querySelector('.lista-de-rutas') as HTMLElement;
    lista.style.width = '448px';
    await estabilizar();

    // Dos columnas: la ruta con su papelera arriba, y debajo el modo y la tarifa.
    expect(getComputedStyle(filas()[0]).gridTemplateColumns.split(' ').length).toBe(2);
    const caja = campoTarifa(0);
    expect(caja.value).toBe('150.000');
    expect(caja.scrollWidth).toBeLessThanOrEqual(caja.clientWidth);
  });

  it('dice qué significa el fijo, con el caso real: uno o cinco proveedores', async () => {
    // ES EL ERROR QUE HAY QUE HACER IMPOSIBLE: creer que el fijo es por proveedor o por
    // recepción. Cinco proveedores ese día en esa ruta son $150.000, no $750.000.
    await armar(ALEX_CON_FIJO);
    await estabilizar();

    const texto = textoPantalla();
    expect(texto).toContain('Es POR DÍA Y POR RUTA');
    expect(texto).toContain('el viaje a fábrica vale $ 150.000');
    expect(texto).toContain('así recoja de uno o de cinco proveedores');
  });

  it('la explicación del fijo NO sale cuando todo va por litro', async () => {
    await armar(ALEX);
    await estabilizar();

    expect(textoPantalla()).not.toContain('POR DÍA Y POR RUTA');
  });

  it('guardar manda el modo PEGADO a la cifra de cada ruta y de la general', async () => {
    // Sin esto el backend deja el modo como estaba ("no me toque el modo") y la
    // pantalla podría mostrar una cosa mientras la base guarda otra.
    await armar(ALEX_CON_FIJO);
    await estabilizar();

    await dialogo.guardar();

    expect(servicio.actualizado?.payload.rutas).toEqual([
      { ruta_id: 'r-fab', valor_transporte: 150000, modo_transporte: 'dia_fijo' },
      { ruta_id: 'r-nap', valor_transporte: 242.76, modo_transporte: 'litro' },
    ]);
    expect(servicio.actualizado?.payload.modo_transporte).toBe('litro');
  });

  it('cambiar el modo de una ruta se guarda con su cifra, sin tocar la de las otras', async () => {
    await armar(ALEX);
    await estabilizar();

    // El renglón 0 es Mira Valle: pasa a cobrarse por día completo, a $ 180.000.
    dialogo.rutas.at(0).controls.modo_transporte.setValue('dia_fijo');
    dialogo.rutas.at(0).controls.valor_transporte.setValue(180000);
    await estabilizar();

    expect(dialogo.fijoDeLaFila(0)).toBeTrue();
    expect(rotuloTarifa(0)).toBe('Cuánto vale el día');
    await dialogo.guardar();

    expect(servicio.actualizado?.payload.rutas).toEqual([
      { ruta_id: 'r-mir', valor_transporte: 180000, modo_transporte: 'dia_fijo' },
      { ruta_id: 'r-nap', valor_transporte: 242.76, modo_transporte: 'litro' },
    ]);
  });

  it('la tarifa general también se puede volver un fijo por día', async () => {
    await armar(ALEX);
    await estabilizar();

    dialogo.form.controls.modo_transporte.setValue('dia_fijo');
    dialogo.form.controls.valor_transporte.setValue(150000);
    await estabilizar();

    expect(dialogo.fijoGeneral()).toBeTrue();
    // Y el aviso general agrega la otra mitad de la regla: dos rutas en un día son
    // dos fijos, que es justo lo que el general puede cobrar sin que nadie lo note.
    expect(textoPantalla()).toContain('Si en un mismo día hace dos rutas, se le pagan dos fijos');

    await dialogo.guardar();
    expect(servicio.actualizado?.payload.modo_transporte).toBe('dia_fijo');
    expect(Number(servicio.actualizado?.payload.valor_transporte)).toBe(150000);
  });

  it('un fijo que se quedó cobrándose POR LITRO se avisa con la cuenta hecha', async () => {
    // EL CAMINO PELIGROSO, y el único que esta pantalla puede autorizar sin que se
    // note: se cambia el modo de "por día" a "por litro" y la cifra se queda igual.
    // $ 150.000 el litro son $ 45.000.000 en un día de 300 litros, y en la caja se ve
    // exactamente lo mismo que antes.
    await armar(ALEX_CON_FIJO);
    await estabilizar();
    expect(textoPantalla()).not.toContain('POR LITRO son');

    dialogo.rutas.at(0).controls.modo_transporte.setValue('litro');
    await estabilizar();

    expect(dialogo.tarifaIncreibleDeLaFila(0)).toBeTrue();
    const texto = textoPantalla();
    expect(texto).toContain('$ 150.000 POR LITRO son $ 45.000.000 de flete en un día de 300 litros');
    // Y no bloquea: la pantalla avisa, no decide. El backend acepta la cifra.
    expect(dialogo.form.valid).toBeTrue();
  });

  it('una tarifa por litro de verdad no dispara ninguna alarma', async () => {
    await armar(ALEX);
    await estabilizar();

    expect(dialogo.tarifaIncreibleDeLaFila(0)).toBeFalse();
    expect(dialogo.tarifaIncreibleDeLaFila(1)).toBeFalse();
    expect(dialogo.tarifaGeneralIncreible()).toBeFalse();
    expect(textoPantalla()).not.toContain('POR LITRO son');
  });

  it('un transportador nuevo nace POR LITRO: nada cambia si nadie toca el modo', async () => {
    await armar();
    api.rutas.next(pagina([ruta('r-nap', 'Nápoles')]));
    await estabilizar();

    expect(dialogo.form.controls.modo_transporte.value).toBe('litro');
    dialogo.agregarRuta();
    await estabilizar();
    expect(dialogo.rutas.at(0).controls.modo_transporte.value).toBe('litro');
  });

  it('el selector se lee como lo diría el dueño, no con jerga', async () => {
    await armar(ALEX);
    await estabilizar();

    // La pregunta, tal cual, y las dos únicas respuestas posibles.
    expect(textoPantalla()).toContain('¿Cómo le paga?');
    fixture.nativeElement.querySelector('.mat-mdc-select-trigger').click();
    await estabilizar();

    const opciones = Array.from(document.querySelectorAll('mat-option')).map((o) =>
      ((o as HTMLElement).textContent ?? '').trim(),
    );
    expect(opciones).toEqual(['Por litro', 'Un fijo por día']);
  });
});
