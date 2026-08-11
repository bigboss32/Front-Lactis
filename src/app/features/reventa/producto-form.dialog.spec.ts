import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { EMPTY, Observable, of } from 'rxjs';

import { Page } from '../../core/models';
import { ReventaProductoFormDialog } from './producto-form.dialog';
import {
  ProductoReventa,
  ProductoReventaPayload,
  ProductoReventaUpdatePayload,
  ReventaService,
} from './reventa.service';

/**
 * EL FORMULARIO DE PRODUCTO: TRES PREGUNTAS Y NADA MÁS.
 *
 * Lo que estas pruebas cuidan:
 *  · que se pregunte SOLO el nombre, cómo se mide y de quién es subproducto — ni la
 *    clave, ni los decimales, ni si admite merma: eso lo deduce el servidor, y un
 *    campo deducible que además se pregunta es una segunda fuente para el mismo
 *    hecho;
 *  · que "Por unidad" se vea APAGADA al agregar, con la nota de que llega después:
 *    el servidor la rechaza en este corte y el dueño no tiene por qué estrellarse
 *    contra un error para averiguarlo;
 *  · que al corregir, cómo se mide quede bajo candado (el servidor no lo acepta) y
 *    el nombre siga siendo libre;
 *  · que la lista de posibles padres no ofrezca lo que va a rebotar: ni el producto
 *    mismo ni uno que ya es subproducto de otro (la cadena llega a un nivel);
 *  · y que lo que se manda al servidor sea exactamente eso y nada más.
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

const QUESO = producto({ id: 'p-1', nombre: 'Queso', clave: 'queso' });
const BORONA = producto({
  id: 'p-2',
  nombre: 'Borona',
  clave: 'borona',
  subproducto_de_id: 'p-1',
  subproducto_de_nombre: 'Queso',
});
const MOZZARELLA = producto({
  id: 'p-3',
  nombre: 'Mozzarella',
  clave: 'mozzarella',
  unidad: 'unidad',
  decimales: 0,
  admite_ajustes: false,
  se_pesa: false,
});

class ServicioFalso {
  catalogo: ProductoReventa[] = [];
  creados: ProductoReventaPayload[] = [];
  editados: { id: string; payload: ProductoReventaUpdatePayload }[] = [];

  listarProductos(): Observable<Page<ProductoReventa>> {
    return of({
      items: this.catalogo,
      total: this.catalogo.length,
      page: 1,
      page_size: 100,
      pages: 1,
    });
  }

  crearProducto(payload: ProductoReventaPayload): Observable<ProductoReventa> {
    this.creados.push(payload);
    return of(producto({ id: 'p-nuevo', nombre: payload.nombre, clave: 'cuajada' }));
  }

  editarProducto(
    id: string,
    payload: ProductoReventaUpdatePayload,
  ): Observable<ProductoReventa> {
    this.editados.push({ id, payload });
    return of(producto({ id, ...payload }));
  }
}

class DialogRefFalso {
  disableClose = false;
  cerradoCon: unknown;
  backdropClick(): Observable<never> {
    return EMPTY;
  }
  keydownEvents(): Observable<never> {
    return EMPTY;
  }
  close(valor?: unknown): void {
    this.cerradoCon = valor;
  }
}

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

describe('ReventaProductoFormDialog: tres preguntas', () => {
  let fixture: ComponentFixture<ReventaProductoFormDialog>;
  let dialogo: ReventaProductoFormDialog;
  let servicio: ServicioFalso;
  let dialogRef: DialogRefFalso;

  const armar = async (
    item: ProductoReventa | undefined,
    catalogo: ProductoReventa[],
  ): Promise<void> => {
    TestBed.resetTestingModule();
    servicio = new ServicioFalso();
    servicio.catalogo = catalogo;
    dialogRef = new DialogRefFalso();
    await TestBed.configureTestingModule({
      imports: [ReventaProductoFormDialog, NoopAnimationsModule],
      providers: [
        { provide: ReventaService, useValue: servicio },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { item } },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ReventaProductoFormDialog);
    dialogo = fixture.componentInstance;
    await estabilizar();
  };

  const estabilizar = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const rotulos = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('mat-label')).map((l) =>
      comoSeLee((l as HTMLElement).textContent),
    );

  const opcionesDeUnidad = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('mat-button-toggle button'));

  const textoPantalla = (): string => comoSeLee(fixture.nativeElement.textContent);

  /** Las opciones del selector de padre, ya desplegado, tal como se leen. */
  const opcionesDelSelector = (): string[] =>
    Array.from(document.querySelectorAll('mat-option')).map((o) =>
      comoSeLee((o as HTMLElement).textContent),
    );

  const escribirNombre = (valor: string): void => {
    const campo: HTMLInputElement = fixture.nativeElement.querySelector('input[matInput]');
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
  };

  // ------------------------------------------------------- las tres preguntas
  it('pregunta el nombre, cómo se mide y si lo paga: nada más', async () => {
    await armar(undefined, [QUESO, BORONA, MOZZARELLA]);

    // DOS campos y un par de botones. Ni clave, ni decimales, ni "admite ajustes":
    // los deduce el servidor de estas respuestas.
    expect(fixture.nativeElement.querySelectorAll('mat-form-field').length).toBe(2);
    // La tercera pregunta NO dice "subproducto": el dueño marcó un queso que él
    // compra como "subproducto de Queso" y eso lo habría dejado con costo cero y
    // una ganancia inflada. Se pregunta lo único que él puede contestar sin
    // equivocarse: si paga por eso o si le llega encima de otra cosa.
    expect(rotulos()).toEqual(['¿Cómo se llama?', '¿Usted paga por este producto?']);
    expect(textoPantalla()).not.toContain('¿Es un subproducto de otro?');
    expect(textoPantalla()).toContain('¿Cómo lo mide?');
    expect(opcionesDeUnidad().length).toBe(2);
    const texto = textoPantalla();
    expect(texto).not.toContain('Clave');
    expect(texto).not.toContain('Decimales');
  });

  it('al agregar, "Por unidad" está apagada y se dice cuándo llega', async () => {
    await armar(undefined, [QUESO]);

    const [porKilo, porUnidad] = opcionesDeUnidad();
    expect(porKilo.disabled).withContext('por kilo se puede').toBeFalse();
    expect(porUnidad.disabled).withContext('por unidad todavía no').toBeTrue();
    expect(textoPantalla()).toContain('Por unidad llega en la siguiente entrega');
    // Y arranca en kilos, que es lo único que este corte deja guardar.
    expect(dialogo.form.getRawValue().unidad).toBe('kg');
  });

  it('al corregir, cómo se mide queda bajo candado y el nombre no', async () => {
    await armar(MOZZARELLA, [QUESO, BORONA, MOZZARELLA]);

    // La unidad decide la forma de la cantidad: pasar a kilos una mozzarella con
    // barras registradas dejaría esas barras contadas como kilos. El servidor no la
    // acepta al corregir, así que aquí se ve apagada con su explicación.
    for (const boton of opcionesDeUnidad()) {
      expect(boton.disabled).withContext('las dos opciones apagadas').toBeTrue();
    }
    expect(textoPantalla()).toContain('Cómo se mide no se cambia');
    const campo: HTMLInputElement = fixture.nativeElement.querySelector('input[matInput]');
    expect(campo.disabled).withContext('el nombre sí se cambia, siempre').toBeFalse();
    expect(campo.value).toBe('Mozzarella');
  });

  // ------------------------------------------------------- los posibles padres
  it('no ofrece como padre ni el producto mismo ni uno que ya es subproducto', async () => {
    // La cadena llega a UN nivel: el reparto de costos sabe calcular queso -> borona
    // y no un tercer escalón. Ofrecer la borona como padre sería ofrecer un rechazo.
    await armar(MOZZARELLA, [QUESO, BORONA, MOZZARELLA]);

    fixture.nativeElement.querySelector('.mat-mdc-select-trigger').click();
    await estabilizar();

    expect(opcionesDelSelector()).toEqual([
      'Sí, este lo compro y lo pago',
      'No, me llega junto con Queso y no lo pago aparte',
    ]);
  });

  it('un producto desactivado no se ofrece como padre de uno nuevo', async () => {
    // Colgar un producto nuevo de uno que el dueño ya no maneja es heredarle el costo
    // a algo que dejó de moverse.
    await armar(undefined, [{ ...QUESO, estado: 'inactivo' }]);

    fixture.nativeElement.querySelector('.mat-mdc-select-trigger').click();
    await estabilizar();

    expect(opcionesDelSelector()).toEqual(['Sí, este lo compro y lo pago']);
  });

  it('el padre que YA tiene se sigue viendo aunque esté desactivado', async () => {
    // Si al desactivar el queso la borona apareciera como "producto por su cuenta",
    // el dueño estaría viendo menos de lo que hay, y es la pantalla que hace que
    // alguien arregle algo que estaba bien.
    await armar(BORONA, [{ ...QUESO, estado: 'inactivo' }, BORONA]);

    fixture.nativeElement.querySelector('.mat-mdc-select-trigger').click();
    await estabilizar();

    expect(opcionesDelSelector()).toEqual([
      'Sí, este lo compro y lo pago',
      'No, me llega junto con Queso y no lo pago aparte',
    ]);
    expect(dialogo.form.getRawValue().subproducto_de_id).toBe('p-1');
  });

  it('un subproducto desactivado sigue siendo subproducto: la pregunta no se hace', async () => {
    await armar(QUESO, [QUESO, { ...BORONA, estado: 'inactivo' }]);

    expect(fixture.nativeElement.querySelectorAll('mat-form-field').length).toBe(1);
    expect(textoPantalla()).toContain('ya tiene subproductos');
  });

  it('el que ya tiene subproductos no puede volverse subproducto de otro', async () => {
    await armar(QUESO, [QUESO, BORONA, MOZZARELLA]);

    // La pregunta no se hace, porque no tiene respuesta válida: el queso ya es padre
    // de la borona. Se explica en vez de dejar un campo que solo puede fallar.
    expect(fixture.nativeElement.querySelectorAll('mat-form-field').length).toBe(1);
    expect(textoPantalla()).toContain('ya tiene subproductos');

    escribirNombre('Queso costeño');
    await dialogo.guardar();

    // Y no se manda `subproducto_de_id`: ese campo no se pintó, así que la corrección
    // no puede mover de padre a nadie sin que el usuario lo haya pedido.
    expect(servicio.editados).toEqual([{ id: 'p-1', payload: { nombre: 'Queso costeño' } }]);
  });

  // ------------------------------------------------------- lo que se manda
  it('al agregar manda el nombre sin espacios de sobra, en kilos y sin padre', async () => {
    await armar(undefined, [QUESO, BORONA]);

    escribirNombre('  Cuajada  ');
    await dialogo.guardar();

    expect(servicio.creados).toEqual([
      { nombre: 'Cuajada', unidad: 'kg', subproducto_de_id: null },
    ]);
  });

  it('devuelve el producto TAL COMO QUEDÓ EN EL SERVIDOR, no lo que se tecleó', async () => {
    await armar(undefined, [QUESO]);

    escribirNombre('Cuajada');
    await dialogo.guardar();

    // Importa porque agregar un producto que se había quitado no crea otro: revive
    // la misma fila con la unidad que ya tenía. La lista lo anuncia leyendo ESTO.
    expect((dialogRef.cerradoCon as ProductoReventa).id).toBe('p-nuevo');
  });

  it('un nombre de una sola letra no se puede guardar', async () => {
    await armar(undefined, [QUESO]);

    escribirNombre('Q');
    await estabilizar();

    expect(dialogo.form.invalid).toBeTrue();
    await dialogo.guardar();
    expect(servicio.creados).toEqual([]);
    expect(dialogRef.cerradoCon).toBeUndefined();
  });
});
