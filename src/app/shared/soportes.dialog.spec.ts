import { Clipboard } from '@angular/cdk/clipboard';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of } from 'rxjs';

import { AuthService } from '../core/auth/auth.service';
import { SoportesDialog } from './soportes.dialog';
import {
  EnlaceSoporte,
  SoporteArchivo,
  SoportesLista,
  SoportesOrigen,
  SoportesResultado,
} from './soportes.model';

/**
 * LA PANTALLA CON LA QUE EL DUEÑO LE PEGA LA FOTO DE LA TRANSFERENCIA A LO QUE PAGÓ.
 *
 * Es UNA SOLA para los dos módulos que la usan —los soportes de una compra de queso
 * y los del pago de una quincena— y estas pruebas cuidan justo lo que hace posible
 * que sea una sola: que las cuatro llamadas al servidor y los TRES PERMISOS los
 * ponga quien la abre, porque no son los mismos en un lado y en el otro.
 *
 * Y cuidan lo que el dueño pidió que se viera: que la foto pesada se guarda más
 * liviana y que eso SE DIGA con las dos cifras. Quien sube una foto de 3,2 MB y la
 * ve guardada en 220 KB, sin que nadie le avise, piensa que se subió a medias.
 */

const soporte = (
  id: string,
  nombre: string,
  bytes: number,
  esImagen = true,
): SoporteArchivo => ({
  id,
  nombre_archivo: nombre,
  content_type: esImagen ? 'image/jpeg' : 'application/pdf',
  tamano_bytes: bytes,
  es_imagen: esImagen,
  subido_por_nombre: 'Miguel',
  created_at: '2026-09-05T14:00:00Z',
  url: `https://bucket.ejemplo/${id}?firma=abc`,
  url_expira: '2026-09-05T14:15:00Z',
});

const lista = (adjuntos: SoporteArchivo[], cupo = 20): SoportesLista => ({
  disponible: true,
  mensaje: null,
  cupo_restante: cupo - adjuntos.length,
  adjuntos,
});

/**
 * Un archivo del tamaño que se quiera SIN reservar esos megabytes de verdad.
 *
 * `size` es un getter del prototipo de File y no se puede pasar por el constructor;
 * definirlo sobre la instancia es la única forma de probar la cuenta del ahorro con
 * las cifras reales de una foto de celular sin que la prueba aparte 3 MB de memoria
 * cada vez que corre.
 */
const archivoDe = (nombre: string, bytes: number, tipo = 'image/jpeg'): File => {
  const archivo = new File([new Uint8Array(8)], nombre, { type: tipo });
  Object.defineProperty(archivo, 'size', { value: bytes });
  return archivo;
};

describe('SoportesDialog — la pantalla de los soportes de pago', () => {
  let fixture: ComponentFixture<SoportesDialog>;
  let componente: SoportesDialog;
  let cerradoCon: SoportesResultado | undefined;
  let permitidos: string[];
  let backdrop: Subject<MouseEvent>;
  let teclas: Subject<KeyboardEvent>;

  /** Lo que el origen le respondió al diálogo, para poder ver qué se pidió. */
  let llamadas: string[];

  const armar = async (parcial: Partial<SoportesOrigen> = {}): Promise<void> => {
    llamadas = [];
    cerradoCon = undefined;
    backdrop = new Subject<MouseEvent>();
    teclas = new Subject<KeyboardEvent>();

    const origen: SoportesOrigen = {
      titulo: 'Pago del 05/09/2026 · $ 1.200.000',
      permisos: {
        subir: 'liquidaciones:administrar',
        compartir: 'liquidaciones:exportar',
        eliminar: 'liquidaciones:eliminar',
      },
      listar: () => {
        llamadas.push('listar');
        return of(lista([soporte('a-1', 'transferencia.jpg', 225280)]));
      },
      subir: () => of({ progreso: 100, cuerpo: lista([]) }),
      compartir: () =>
        of<EnlaceSoporte>({
          url: 'https://bucket.ejemplo/a-1?largo=1',
          nombre_archivo: 'transferencia.jpg',
          expira: '2026-09-12T20:00:00Z',
          expira_texto: 'hasta el sábado 12 de septiembre a las 3:00 p. m.',
          dias: 7,
        }),
      eliminar: () => of(void 0),
      ...parcial,
    };

    const dialogRef = {
      disableClose: false,
      close: (resultado?: SoportesResultado) => (cerradoCon = resultado),
      backdropClick: () => backdrop.asObservable(),
      keydownEvents: () => teclas.asObservable(),
    };

    await TestBed.configureTestingModule({
      imports: [SoportesDialog, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: origen },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
        { provide: Clipboard, useValue: { copy: () => true } },
        {
          provide: AuthService,
          useValue: {
            perfil: () => null,
            esSuperadmin: () => false,
            hasPermission: (modulo: string, accion: string) =>
              permitidos.includes(`${modulo}:${accion}`),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SoportesDialog);
    componente = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /**
   * Lo último con que se cerró el diálogo, leído a través de una función.
   *
   * A propósito y no `cerradoCon` pelado: cuando una prueba lo pone en `undefined`
   * para medir el SEGUNDO cierre, TypeScript da por sentado que ahí se quedó y
   * rechaza compararlo con un resultado. Leerlo desde acá conserva su tipo.
   */
  const resultado = (): SoportesResultado | undefined => cerradoCon;

  const texto = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const boton = (rotulo: string): HTMLButtonElement | undefined =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => (b.textContent ?? '').includes(rotulo));

  beforeEach(() => {
    permitidos = [
      'liquidaciones:administrar',
      'liquidaciones:exportar',
      'liquidaciones:eliminar',
    ];
    TestBed.resetTestingModule();
  });

  it('pinta el soporte que ya está, con su nombre y su peso', async () => {
    await armar();

    expect(llamadas).toEqual(['listar']);
    expect(texto()).toContain('transferencia.jpg');
    // 225.280 bytes son 220 KB exactos. La cifra la lee el dueño al lado del nombre.
    expect(texto()).toContain('220 KB');
    expect(texto()).toContain('Pago del 05/09/2026 · $ 1.200.000');
  });

  it('dice desde el principio que la foto pesada se reduce sola, sin jerga', async () => {
    await armar();

    // La frase va SIEMPRE visible, no escondida en un tooltip: es la única
    // explicación que va a tener el dueño cuando vea su foto de 4 MB en 300 KB.
    expect(texto()).toContain('el sistema la reduce solo para que ocupe menos');
    expect(texto()).toContain('Los PDF del banco se guardan tal como llegan');
  });

  it('aclara a qué se le está pegando la foto cuando quien abre lo dice', async () => {
    await armar({ ayuda: 'Estas fotos quedan pegadas a este pago, no a la liquidación entera.' });

    expect(texto()).toContain('no a la liquidación entera');
  });

  // ------------------------------------------------------------------ permisos
  it('los tres permisos son los que trajo quien la abrió, no unos escritos adentro', async () => {
    // Un usuario que puede VER la liquidación pero no administrarla: los permisos que
    // se le niegan son los de LIQUIDACIONES, y si la pantalla preguntara por los de
    // reventa —que es de donde salió este diálogo— le mostraría los tres botones.
    permitidos = ['liquidaciones:consultar', 'reventa:crear', 'reventa:eliminar'];
    await armar();

    expect(boton('Anexar imágenes')).toBeUndefined();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.acciones button'),
    ).toBeNull();
  });

  it('con los permisos del módulo que la abrió sí se puede anexar, compartir y quitar', async () => {
    await armar();

    expect(boton('Anexar imágenes')).toBeDefined();
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.acciones button').length,
    ).toBe(2);
  });

  // -------------------------------------------------------------------- subida
  it('después de subir dice CUÁNTO adelgazó, con las dos cifras', async () => {
    const guardado = lista([
      soporte('a-1', 'transferencia.jpg', 225280),
      soporte('a-2', 'IMG_4417.jpg', 225280),
    ]);
    await armar({ subir: () => of({ progreso: 100, cuerpo: guardado }) });

    // Una foto de celular de 3,2 MB. El servidor la guarda en 220 KB.
    componente.seleccionar({
      target: { files: [archivoDe('IMG_4417.jpg', 3_400_000)], value: 'c:\\fake' },
    } as unknown as Event);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(componente.adelgazo()).toBe(
      'Se guardaron más livianas: 3,2 MB → 220 KB. Se ven igual de bien.',
    );
    expect(texto()).toContain('Se guardaron más livianas: 3,2 MB → 220 KB');
  });

  it('NO habla de ahorro cuando el archivo pasó derecho (el PDF del banco)', async () => {
    // El backend guarda los PDF byte por byte. Decir "0 % menos" haría dudar de la
    // cifra de al lado, y decir algo cuando no pasó nada es ruido.
    const guardado = lista([soporte('a-1', 'transferencia.jpg', 225280), soporte('p-1', 'comprobante.pdf', 98_000, false)]);
    await armar({ subir: () => of({ progreso: 100, cuerpo: guardado }) });

    componente.seleccionar({
      target: { files: [archivoDe('comprobante.pdf', 98_000, 'application/pdf')], value: '' },
    } as unknown as Event);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(componente.adelgazo()).toBeNull();
    expect(texto()).not.toContain('Se guardaron más livianas');
  });

  it('el selector ofrece lo mismo que el servidor acepta, fotos de iPhone incluidas', async () => {
    await armar();

    const selector = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[type=file]',
    );
    // Es la copia de TIPOS_SOPORTE_PERMITIDOS del backend, y que se separen es el
    // defecto: ofrecer de más termina en una subida que espera y rebota, y ofrecer
    // de menos esconde un formato que sí servía — que fue justo lo que pasó con las
    // HEIC mientras el servidor no las sabía abrir.
    expect(selector?.getAttribute('accept')).toBe(
      'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf',
    );
    // El dueño fotografía las transferencias con el celular y el iPhone graba en
    // HEIC de fábrica: con `pillow-heif` el servidor las abre, las encoge y las
    // guarda como JPEG, así que escoger la foto tal como salió del teléfono tiene
    // que funcionar sin ir a cambiarle el formato a la cámara.
    expect(selector?.getAttribute('accept')).toContain('image/heic');
    expect(selector?.multiple).toBeTrue();
  });

  // ------------------------------------------------------------- lo que devuelve
  it('al cerrar devuelve si cambió algo y CUÁNTOS quedaron', async () => {
    const guardado = lista([
      soporte('a-1', 'transferencia.jpg', 225280),
      soporte('a-2', 'segunda.jpg', 200000),
    ]);
    await armar({ subir: () => of({ progreso: 100, cuerpo: guardado }) });

    componente.seleccionar({
      target: { files: [archivoDe('segunda.jpg', 900_000)], value: '' },
    } as unknown as Event);
    await fixture.whenStable();

    componente.cerrar();

    // `cuantos` es lo que la pantalla de atrás pinta en el clip: sin él tendría que
    // volver a pedir el documento entero solo para saber que ahora hay dos.
    expect(resultado()).toEqual({ cambiado: true, cuantos: 2 });
  });

  it('sin tocar nada devuelve que no cambió, y el clip de atrás no se mueve', async () => {
    await armar();

    componente.cerrar();

    expect(resultado()).toEqual({ cambiado: false, cuantos: 1 });
  });

  it('Escape y el clic en el fondo también devuelven el resultado', async () => {
    const guardado = lista([soporte('a-1', 'transferencia.jpg', 225280), soporte('a-2', 'dos.jpg', 1000)]);
    await armar({ subir: () => of({ progreso: 100, cuerpo: guardado }) });

    componente.seleccionar({
      target: { files: [archivoDe('dos.jpg', 900_000)], value: '' },
    } as unknown as Event);
    await fixture.whenStable();

    // Sin esto cierran solos con `undefined` y el clip de la pantalla de atrás se
    // queda con el número viejo: la foto SÍ quedó guardada, pero parece que no.
    teclas.next({ key: 'Escape' } as KeyboardEvent);
    expect(resultado()).toEqual({ cambiado: true, cuantos: 2 });

    cerradoCon = undefined;
    backdrop.next({} as MouseEvent);
    expect(resultado()).toEqual({ cambiado: true, cuantos: 2 });
  });

  // --------------------------------------------------- almacenamiento apagado
  it('sin almacenamiento configurado lo explica y no ofrece anexar', async () => {
    await armar({
      listar: () =>
        of<SoportesLista>({
          disponible: false,
          mensaje: 'El almacenamiento de imágenes no está configurado en este servidor.',
          cupo_restante: 0,
          adjuntos: [],
        }),
    });

    // No es culpa de quien mira: se explica y el resto de la pantalla queda usable,
    // en vez de un error rojo.
    expect(texto()).toContain('no está configurado en este servidor');
    expect(boton('Anexar imágenes')?.disabled).toBeTrue();
  });

  it('cuando ya no caben más, el botón lo dice en vez de dejar intentarlo', async () => {
    await armar({ listar: () => of(lista([soporte('a-1', 'una.jpg', 1000)], 1)) });

    const anexar = boton('Anexar imágenes');
    expect(anexar?.disabled).toBeTrue();
    expect(anexar?.getAttribute('ng-reflect-message') ?? componente.sinCupo()).toBeTruthy();
  });

  it('si la lista no carga, se puede reintentar sin cerrar el diálogo', async () => {
    let intentos = 0;
    await armar({
      listar: () =>
        new Observable<SoportesLista>((observador) => {
          intentos += 1;
          if (intentos === 1) observador.error(new Error('sin red'));
          else {
            observador.next(lista([soporte('a-1', 'transferencia.jpg', 225280)]));
            observador.complete();
          }
        }),
    });

    expect(componente.errorCarga()).toBeTruthy();
    boton('Reintentar')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(componente.errorCarga()).toBeNull();
    expect(texto()).toContain('transferencia.jpg');
  });
});
