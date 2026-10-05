import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion, LiquidacionDetalle } from '../../core/models';
import { precioComoSeEscribe, precioTecleado } from './cifras-de-la-quincena';
import {
  ESPERA_DEL_BORDE_MS,
  FRANJA_DEL_BORDE_PX,
  LiquidacionDetailDialog,
  pasoDelDesplazamiento,
} from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * EL MISMO PRECIO PARA VARIOS DÍAS DE UNA VEZ.
 *
 * El caso del dueño: la quincena de 16 días salió a $1.900 y el precio era $2.000. Corregirlo
 * eran 16 lápices, uno por día. Ahora hay un campo "Precio por litro de todos los días" y el
 * cuadrito de cada precio, que se arrastra hacia abajo para copiarlo a los de abajo.
 *
 * Lo que se mide es lo que el dueño ve y lo que se manda: el campo y su botón salen donde sale
 * el lápiz y no donde no; arrancan con el precio que ya comparten los días; mandan UNA llamada
 * al servidor con los días correctos (todos, o los del arrastre); lo que se pinta es lo que el
 * servidor devolvió; si el servidor dice que no, no cambia nada.
 */

type Fixture = ComponentFixture<LiquidacionDetailDialog>;

const comoSeLee = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const LITROS = [166, 170, 173, 176, 165, 164];

const dias = (precio = 1900): LiquidacionDetalle[] =>
  LITROS.map((litros, i) => ({
    id: `d-${i + 1}`,
    fecha: `2026-08-${String(i + 1).padStart(2, '0')}`,
    litros: String(litros),
    precio_litro: String(precio),
    valor: String(litros * precio),
  }));

const total = (detalles: LiquidacionDetalle[]): number =>
  detalles.reduce((suma, d) => suma + Number(d.valor), 0);

const quincena = (cifras: Partial<Liquidacion> = {}): Liquidacion => {
  const detalles = cifras.detalles ?? dias();
  const valor = total(detalles);
  return {
    id: 'l-1',
    empresa_id: 'e-1',
    estado: 'borrador',
    estado_visible: 'borrador',
    created_at: '2026-08-16T00:00:00Z',
    updated_at: '2026-08-16T00:00:00Z',
    tipo: 'proveedor',
    proveedor_id: 'p-1',
    proveedor_nombre: 'Moisés',
    transportador_id: null,
    transportador_nombre: null,
    periodo_inicio: '2026-08-01',
    periodo_fin: '2026-08-15',
    total_litros: String(LITROS.reduce((a, b) => a + b, 0)),
    precio_promedio: '1900',
    valor_bruto: String(valor),
    bonificaciones: '0',
    descuentos: '0',
    valor_transporte: '0',
    anticipos: '0',
    valor_total: String(valor),
    neto_a_pagar: String(valor),
    pagado: '0',
    saldo: String(valor),
    le_queda_debiendo: '0',
    observaciones: null,
    pagos: [],
    ...cifras,
    detalles,
  };
};

interface Pedido {
  id: string;
  precio: number;
  ids: readonly string[] | null;
}

class ServidorFalso {
  pedidos: Pedido[] = [];
  /** Lo que contesta el servidor: la quincena con esos días al nuevo precio (todo o nada). */
  respuesta: Observable<Liquidacion> | null = null;
  constructor(private readonly actual: () => Liquidacion) {}

  getById(): Observable<Liquidacion> {
    return of(this.actual());
  }

  /** Las acciones del pie que llegaron al servidor: si una guardia se cae, aparece aquí. */
  acciones: string[] = [];
  aprobar(id: string): Observable<Liquidacion> {
    this.acciones.push(`aprobar:${id}`);
    return of({ ...this.actual(), estado: 'aprobada', estado_visible: 'aprobada' });
  }
  recalcular(id: string): Observable<Liquidacion> {
    this.acciones.push(`recalcular:${id}`);
    return of(this.actual());
  }

  pedidosDeUnDia: { detalleId: string; precio: number }[] = [];
  /** Lo que contesta el PUT de un día; null = la quincena tal cual. */
  respuestaDeUnDia: Observable<Liquidacion> | null = null;

  actualizarPrecioDetalle(_id: string, detalleId: string, precio: number): Observable<Liquidacion> {
    this.pedidosDeUnDia.push({ detalleId, precio });
    return this.respuestaDeUnDia ?? of(this.actual());
  }

  actualizarPrecios(
    id: string,
    precio: number,
    ids: readonly string[] | null,
  ): Observable<Liquidacion> {
    this.pedidos.push({ id, precio, ids });
    if (this.respuesta) return this.respuesta;
    const base = this.actual();
    const detalles = base.detalles.map((d) =>
      ids === null || ids.includes(d.id)
        ? { ...d, precio_litro: String(precio), valor: String(Number(d.litros) * precio) }
        : d,
    );
    const valor = String(total(detalles));
    return of(
      quincena({ ...base, detalles, valor_bruto: valor, valor_total: valor, neto_a_pagar: valor, saldo: valor }),
    );
  }
}

const COMPRAS = [
  'liquidaciones:consultar',
  'liquidaciones:crear',
  'liquidaciones:editar',
  'liquidaciones:exportar',
  'liquidaciones:imprimir',
];
const CONSULTA = ['liquidaciones:consultar'];

describe('LiquidacionDetailDialog: el mismo precio para varios días', () => {
  let fixture: Fixture;
  let servidor: ServidorFalso;
  let avisos: string[];
  let item: Liquidacion;
  let dialogos: { componente: unknown; datos: any }[];
  let respuestaDelDialogo: unknown;

  const abrir = async (inicial: Liquidacion, permisos: string[] = COMPRAS): Promise<void> => {
    TestBed.resetTestingModule();
    item = inicial;
    avisos = [];
    dialogos = [];
    respuestaDelDialogo = null;
    servidor = new ServidorFalso(() => item);
    const tiene = new Set(permisos);
    await TestBed.configureTestingModule({
      imports: [LiquidacionDetailDialog, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { item: inicial } },
        { provide: LiquidacionesService, useValue: servidor },
        { provide: MatSnackBar, useValue: { open: (m: string) => avisos.push(m) } },
        {
          provide: AuthService,
          useValue: {
            hasPermission: (modulo: string, accion = 'consultar') => tiene.has(`${modulo}:${accion}`),
            perfil: () => null,
            esSuperadmin: () => false,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LiquidacionDetailDialog);
    // El MatDialog se intercepta en LA INSTANCIA QUE USA EL COMPONENTE: importa MatDialogModule y su
    // MatDialog sale de su propio inyector, así que un `provide` en TestBed no le llega.
    spyOn(fixture.debugElement.injector.get(MatDialog), 'open').and.callFake(((
      componente: unknown,
      config: { data: unknown },
    ) => {
      dialogos.push({ componente, datos: config?.data });
      return { afterClosed: () => of(respuestaDelDialogo) };
    }) as never);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const el = (): HTMLElement => fixture.nativeElement;
  const dialogo = () => fixture.componentInstance;
  const barra = (): HTMLElement | null => el().querySelector('.precio-masivo');
  const campo = (): HTMLInputElement => el().querySelector('.precio-masivo input')!;
  const boton = (): HTMLButtonElement => el().querySelector('.precio-masivo .aplicar-precios')!;
  /** Apagado pero enfocable (`disabledInteractive`): se lee en `aria-disabled`, no en `disabled`. */
  const apagado = (): boolean => boton().getAttribute('aria-disabled') === 'true';
  const filas = (): HTMLElement[] => Array.from(el().querySelectorAll('tr.mat-mdc-row'));
  const preciosEnPantalla = (): string[] =>
    filas().map((f) => comoSeLee(f.querySelector('td.celda-precio')?.textContent).replace(/edit$/, '').trim());
  const escribir = (texto: string): void => {
    campo().value = texto;
    campo().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const asentar = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  // ------------------------------------------------------------------ quién lo ve
  it('sale en el borrador de un proveedor con permiso de editar, junto al lápiz', async () => {
    await abrir(quincena());

    expect(barra()).not.toBeNull();
    expect(comoSeLee(barra()!.querySelector('.etiqueta')?.textContent)).toBe(
      'Precio por litro de todos los días',
    );
    expect(el().querySelectorAll('.precio-editable').length).toBe(LITROS.length);
  });

  it('no sale donde el lápiz no sale: aprobada, sin permiso, transportador', async () => {
    await abrir(quincena({ estado: 'aprobada', estado_visible: 'aprobada' }));
    expect(barra()).toBeNull();
    expect(el().querySelector('.asa-precio')).toBeNull();

    await abrir(quincena(), CONSULTA);
    expect(barra()).toBeNull();
    expect(el().querySelector('.asa-precio')).toBeNull();

    await abrir(quincena({ tipo: 'transportador', proveedor_id: null, transportador_id: 't-1' }));
    expect(barra()).toBeNull();
  });

  it('con un solo día no hay nada que repartir: no sale', async () => {
    await abrir(quincena({ detalles: dias().slice(0, 1) }));
    expect(barra()).toBeNull();
    // El lápiz del día sí: es lo de siempre.
    expect(el().querySelectorAll('.precio-editable').length).toBe(1);
  });

  // ------------------------------------------------------------------ el campo
  it('arranca con el precio que ya comparten los días', async () => {
    await abrir(quincena());
    expect(campo().value).toBe('1900');
    // Y como ya es ese, no hay nada que poner.
    expect(apagado()).toBeTrue();
  });

  it('si los días tienen precios distintos arranca vacío', async () => {
    const mezclados = dias().map((d, i) => (i < 2 ? { ...d, precio_litro: '1800' } : d));
    await abrir(quincena({ detalles: mezclados }));

    expect(campo().value).toBe('');
    expect(apagado()).toBeTrue();
  });

  it('un precio con decimales arranca escrito a la colombiana, que es como se lee de vuelta', async () => {
    await abrir(quincena({ detalles: dias(1750.5) }));

    expect(campo().value).toBe('1750,5');
    expect(precioTecleado(campo().value)).toBe(1750.5);
  });

  it('el botón dice a cuántos días va a llegar y se enciende con un precio distinto', async () => {
    await abrir(quincena());

    escribir('2000');

    expect(apagado()).toBeFalse();
    expect(comoSeLee(boton().textContent)).toContain('Poner $ 2.000 a los 6 días');
  });

  it('con días que ya tienen ese precio, cuenta solo los que cambian', async () => {
    const mezclados = dias().map((d, i) => (i < 2 ? { ...d, precio_litro: '2000' } : d));
    await abrir(quincena({ detalles: mezclados }));

    escribir('2000');

    expect(comoSeLee(boton().textContent)).toContain('Poner $ 2.000 a 4 días');
  });

  it('un texto que no es un precio no enciende el botón', async () => {
    await abrir(quincena());

    escribir('mucho');
    expect(apagado()).toBeTrue();
    escribir('0');
    expect(apagado()).toBeTrue();
    escribir('');
    expect(apagado()).toBeTrue();
  });

  // ------------------------------------------------------------------ lo que se manda
  it('Poner a todos manda UNA llamada con el precio y SIN lista de días (todos)', async () => {
    await abrir(quincena());
    escribir('2000');

    boton().click();
    await asentar();

    expect(servidor.pedidos).toEqual([{ id: 'l-1', precio: 2000, ids: null }]);
  });

  it('el precio se lee a la colombiana: "1.950" son mil novecientos cincuenta', async () => {
    await abrir(quincena());
    escribir('1.950');

    boton().click();
    await asentar();

    expect(servidor.pedidos[0].precio).toBe(1950);
  });

  it('Enter en el campo hace lo mismo que el botón', async () => {
    await abrir(quincena());
    escribir('2000');

    campo().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await asentar();

    expect(servidor.pedidos.length).toBe(1);
  });

  it('lo que se pinta es lo que el servidor devolvió: los 6 días a $2.000 y el total cuadra', async () => {
    await abrir(quincena());
    escribir('2000');

    boton().click();
    await asentar();

    expect(dialogo().liq().detalles.every((d) => d.precio_litro === '2000')).toBeTrue();
    // 1.014 L × $2.000 = $2.028.000: el total de la pantalla es el del servidor.
    expect(dialogo().liq().valor_total).toBe('2028000');
    expect(comoSeLee(el().querySelector('.resumen')?.textContent)).toContain('2.028.000');
    expect(avisos.length).toBe(1);
    expect(avisos[0]).toContain('6 días');
    expect(avisos[0]).toContain('2.000');
    expect(avisos[0]).toContain('2.028.000');
    // Y el campo vuelve al precio que ahora comparten.
    expect(campo().value).toBe('2000');
    expect(apagado()).toBeTrue();
  });

  it('mientras guarda, el botón y el campo se apagan: no se manda dos veces', async () => {
    const respuesta = new Subject<Liquidacion>();
    await abrir(quincena());
    servidor.respuesta = respuesta;
    escribir('2000');

    boton().click();
    fixture.detectChanges();
    expect(dialogo().aplicandoPrecios()).toBeTrue();
    expect(apagado()).toBeTrue();
    expect(campo().readOnly).toBeTrue(); // solo lectura y no `disabled`: un campo apagado pierde el foco
    boton().click();
    await dialogo().aplicarPrecioATodos();

    expect(servidor.pedidos.length).toBe(1);
    respuesta.next(quincena({ detalles: dias(2000) }));
    await asentar();
    expect(dialogo().aplicandoPrecios()).toBeFalse();
  });

  it('si el servidor dice que no, NO cambia nada en pantalla y se dice por qué', async () => {
    await abrir(quincena());
    servidor.respuesta = throwError(
      () =>
        new HttpErrorResponse({
          status: 422,
          error: {
            error: {
              code: 'regla_de_negocio',
              detail:
                'Con ese precio el valor del día 17/09/2026 queda negativo: revise los descuentos',
            },
          },
        }),
    );
    escribir('1500');

    boton().click();
    await asentar();

    expect(dialogo().liq().detalles.every((d) => d.precio_litro === '1900')).toBeTrue();
    expect(dialogo().liq().valor_total).toBe(String(total(dias())));
    expect(avisos.join(' ')).toContain('día 17/09/2026');
    // El campo se queda con lo escrito, para corregirlo.
    expect(campo().value).toBe('1500');
    expect(dialogo().aplicandoPrecios()).toBeFalse();
  });

  it('con el mismo precio en todos no molesta al servidor', async () => {
    await abrir(quincena());

    await dialogo().aplicarPrecioATodos();

    expect(servidor.pedidos.length).toBe(0);
  });

  it('un precio ilegible avisa y no manda nada', async () => {
    await abrir(quincena());
    escribir('mucho');

    await dialogo().aplicarPrecioATodos();

    expect(servidor.pedidos.length).toBe(0);
    expect(avisos[0]).toContain('Escriba el precio por litro');
  });

  it('cierra un lápiz abierto sin guardar lo que tenía a medias', async () => {
    await abrir(quincena());
    dialogo().editarPrecio(dialogo().liq().detalles[1]);
    dialogo().alEscribirPrecio('1');
    fixture.detectChanges();
    escribir('2000');

    boton().click();
    await asentar();

    expect(dialogo().editandoId()).toBeNull();
    // Se mandó el precio de todos y NO el "1" que había a medias en el lápiz.
    expect(servidor.pedidos.map((p) => p.precio)).toEqual([2000]);
  });

  // ------------------------------------------------------------------ el arrastre
  /** Simula el gesto: se agarra el cuadrito de la fila `origen` y se suelta sobre la fila `destino`. */
  const arrastrar = async (origen: number, destino: number): Promise<void> => {
    const sobre = spyOn<any>(dialogo(), 'filaBajoElPuntero');
    const asa = el().querySelectorAll<HTMLElement>('.asa-precio')[origen];
    asa.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true, clientX: 10, clientY: 10 }));
    fixture.detectChanges();
    sobre.and.returnValue(destino);
    asa.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, isPrimary: true, clientX: 10, clientY: 90 }));
    fixture.detectChanges();
    asa.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, isPrimary: true, clientX: 10, clientY: 90 }));
    await asentar();
  };

  it('cada precio editable trae su cuadrito para arrastrar', async () => {
    await abrir(quincena());
    expect(el().querySelectorAll('.asa-precio').length).toBe(LITROS.length);
  });

  it('arrastrar el precio del día 2 hasta el día 5 lo copia a los días 3, 4 y 5 (no al 1 ni al 6)', async () => {
    const mezclados = dias().map((d, i) => (i === 1 ? { ...d, precio_litro: '2000', valor: String(Number(d.litros) * 2000) } : d));
    await abrir(quincena({ detalles: mezclados }));

    await arrastrar(1, 4);

    expect(servidor.pedidos).toEqual([{ id: 'l-1', precio: 2000, ids: ['d-3', 'd-4', 'd-5'] }]);
    expect(preciosEnPantalla()).toEqual(['$ 1.900', '$ 2.000', '$ 2.000', '$ 2.000', '$ 2.000', '$ 1.900']);
  });

  it('también hacia arriba: del día 4 al día 2 copia a los días 2 y 3', async () => {
    const mezclados = dias().map((d, i) => (i === 3 ? { ...d, precio_litro: '2100', valor: String(Number(d.litros) * 2100) } : d));
    await abrir(quincena({ detalles: mezclados }));

    await arrastrar(3, 1);

    expect(servidor.pedidos).toEqual([{ id: 'l-1', precio: 2100, ids: ['d-2', 'd-3'] }]);
  });

  it('mientras se arrastra, la barra dice qué se copia y a cuántos días, y las filas se marcan', async () => {
    const mezclados = dias().map((d, i) => (i === 0 ? { ...d, precio_litro: '2000', valor: String(Number(d.litros) * 2000) } : d));
    await abrir(quincena({ detalles: mezclados }));
    const sobre = spyOn<any>(dialogo(), 'filaBajoElPuntero').and.returnValue(3);
    const asa = el().querySelectorAll<HTMLElement>('.asa-precio')[0];

    asa.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true, clientX: 0, clientY: 0 }));
    asa.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, isPrimary: true, clientX: 0, clientY: 50 }));
    fixture.detectChanges();

    expect(sobre).toHaveBeenCalled();
    expect(comoSeLee(barra()!.querySelector('.pista-precio')?.textContent)).toBe('Suelte para copiar $ 2.000 a 3 días');
    expect(filas()[0].classList).toContain('fila-origen');
    expect(filas().filter((f) => f.classList.contains('fila-destino')).length).toBe(3);

    asa.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, isPrimary: true }));
    fixture.detectChanges();
    expect(filas().some((f) => f.classList.contains('fila-destino'))).toBeFalse();
    expect(servidor.pedidos.length).toBe(0);
  });

  it('soltar sobre la misma fila no hace nada', async () => {
    await abrir(quincena());

    await arrastrar(2, 2);

    expect(servidor.pedidos.length).toBe(0);
  });

  it('si las filas de destino ya tienen ese precio, no se molesta al servidor', async () => {
    await abrir(quincena());

    await arrastrar(0, 3);

    expect(servidor.pedidos.length).toBe(0);
  });

  it('no hay arrastre sin permiso de editar', async () => {
    await abrir(quincena(), CONSULTA);
    expect(el().querySelector('.asa-precio')).toBeNull();
    dialogo().empezarArrastre(new PointerEvent('pointerdown', { pointerId: 1, isPrimary: true }), 0);
    expect(dialogo().arrastre()).toBeNull();
  });

  // ------------------------------------------------------- el arrastre cerca de los bordes
  /**
   * Las cajas de las filas y del área que se desplaza se inventan (la prueba no tiene una
   * pantalla de verdad): cada fila mide 40, la primera empieza en `primeraFila` y el área
   * visible va de 0 a `alto`.
   */
  const fingirGeometria = (primeraFila = 0, alto = 400): void => {
    filas().forEach((f, i) => {
      const top = primeraFila + i * 40;
      spyOn(f, 'getBoundingClientRect').and.returnValue({ top, bottom: top + 40 } as DOMRect);
    });
    spyOn(el().querySelector('mat-dialog-content')!, 'getBoundingClientRect').and.returnValue({
      top: 0,
      bottom: alto,
    } as DOMRect);
  };
  const filaEn = (x: number, y: number): number | null => (dialogo() as any).filaBajoElPuntero(x, y);

  it('la fila se mide por la altura del puntero, sin importar para qué lado se desvíe', async () => {
    await abrir(quincena());
    fingirGeometria();

    expect(filaEn(10, 5)).toBe(0);
    expect(filaEn(10, 45)).toBe(1);
    expect(filaEn(-9999, 45)).toBe(1);
    expect(filaEn(9999, 85)).toBe(2);
  });

  it('con el puntero fuera del área visible cuenta el borde: la fila de abajo del todo, la de arriba del todo', async () => {
    await abrir(quincena());
    fingirGeometria(0, 100); // solo se ven las filas 0, 1 y 2 (la 2 a medias)

    // Con el mouse capturado el puntero puede salirse del diálogo y hasta de la ventana: antes
    // no había fila ahí y la elegida se quedaba pegada mientras el contenido seguía corriendo.
    expect(filaEn(10, 5000)).toBe(2);
    expect(filaEn(10, -5000)).toBe(0);
  });

  it('por encima de la primera fila cuenta la primera, y por debajo de la última, la última', async () => {
    await abrir(quincena());
    fingirGeometria(60); // la tabla empieza a los 60: arriba hay otras cosas (el resumen, la barra)

    expect(filaEn(10, 30)).toBe(0);
    expect(filaEn(10, 399)).toBe(LITROS.length - 1); // la tabla termina a los 300 y el área sigue
  });

  it('sin tabla no hay fila', async () => {
    await abrir(quincena());
    spyOn(el(), 'querySelectorAll').and.returnValue([] as unknown as NodeListOf<Element>);

    expect(filaEn(10, 10)).toBeNull();
  });

  it('la velocidad del borde: 0 lejos, lenta al entrar, cada vez más rápida y con tope', () => {
    const arriba = 0;
    const abajo = 600;
    const medio = pasoDelDesplazamiento(300, arriba, abajo);
    const entrando = pasoDelDesplazamiento(abajo - FRANJA_DEL_BORDE_PX + 1, arriba, abajo);
    const aMedias = pasoDelDesplazamiento(abajo - FRANJA_DEL_BORDE_PX / 2, arriba, abajo);
    const enElBorde = pasoDelDesplazamiento(abajo, arriba, abajo);
    const pasado = pasoDelDesplazamiento(abajo + 5000, arriba, abajo);

    expect(medio).toBe(0);
    expect(entrando).toBeGreaterThan(0);
    expect(entrando).toBeLessThan(2);
    expect(aMedias).toBeGreaterThan(entrando);
    expect(enElBorde).toBeGreaterThan(aMedias);
    expect(pasado).toBe(enElBorde);
    expect(enElBorde).toBe(18);
  });

  it('hacia arriba es lo mismo con el signo cambiado', () => {
    for (const y of [FRANJA_DEL_BORDE_PX - 1, FRANJA_DEL_BORDE_PX / 2, 0, -300]) {
      expect(pasoDelDesplazamiento(y, 0, 600)).toBe(-pasoDelDesplazamiento(600 - y, 0, 600));
    }
  });

  it('el contenido no corre hasta que el puntero se queda un momento en el borde', async () => {
    await abrir(quincena());
    fingirGeometria();
    const contenido = el().querySelector('mat-dialog-content')!;
    let recorrido = 0;
    Object.defineProperty(contenido, 'scrollTop', {
      configurable: true,
      get: () => recorrido,
      set: (v: number) => (recorrido = v),
    });
    spyOn<any>(dialogo(), 'filaBajoElPuntero').and.returnValue(1);
    const asa = el().querySelectorAll<HTMLElement>('.asa-precio')[0];
    asa.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true, clientX: 0, clientY: 399 }));
    asa.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, isPrimary: true, clientX: 0, clientY: 390 }));
    const cuadro = (ahora: number): void => (dialogo() as any).desplazarSiHaceFalta(ahora);

    cuadro(1000); // el puntero acaba de entrar a la franja de abajo
    cuadro(1000 + ESPERA_DEL_BORDE_MS - 1);
    expect(recorrido).toBe(0);

    cuadro(1000 + ESPERA_DEL_BORDE_MS);
    expect(recorrido).toBeGreaterThan(0);

    asa.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, isPrimary: true }));
  });

  it('si el puntero sale de la franja y vuelve, la espera empieza de nuevo', async () => {
    await abrir(quincena());
    fingirGeometria();
    const contenido = el().querySelector('mat-dialog-content')!;
    let recorrido = 0;
    Object.defineProperty(contenido, 'scrollTop', {
      configurable: true,
      get: () => recorrido,
      set: (v: number) => (recorrido = v),
    });
    spyOn<any>(dialogo(), 'filaBajoElPuntero').and.returnValue(1);
    const asa = el().querySelectorAll<HTMLElement>('.asa-precio')[0];
    asa.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true, clientX: 0, clientY: 399 }));
    asa.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, isPrimary: true, clientX: 0, clientY: 390 }));
    const cuadro = (ahora: number): void => (dialogo() as any).desplazarSiHaceFalta(ahora);

    cuadro(1000);
    asa.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, isPrimary: true, clientX: 0, clientY: 200 }));
    cuadro(1000 + ESPERA_DEL_BORDE_MS); // ya estaba afuera de la franja: no corre y reinicia
    asa.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, isPrimary: true, clientX: 0, clientY: 399 }));
    cuadro(1000 + ESPERA_DEL_BORDE_MS + 10); // vuelve a entrar: empieza a contar de nuevo
    cuadro(1000 + ESPERA_DEL_BORDE_MS + 10 + ESPERA_DEL_BORDE_MS - 1);

    expect(recorrido).toBe(0);

    asa.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, isPrimary: true }));
  });

  // =================================================================== lo que salió de la revisión
  describe('una sola escritura a la vez', () => {
    const botonDelPie = (texto: string): HTMLButtonElement | undefined =>
      Array.from(el().querySelectorAll<HTMLButtonElement>('mat-dialog-actions button')).find((b) =>
        comoSeLee(b.textContent).includes(texto),
      );

    it('mientras se guarda el precio de todos, el lápiz no abre y el pie se apaga', async () => {
      await abrir(quincena(), [...COMPRAS, 'liquidaciones:administrar']);
      servidor.respuesta = new Subject<Liquidacion>();
      escribir('2000');

      boton().click();
      fixture.detectChanges();

      expect(dialogo().ocupado()).toBeTrue();
      const lapices = Array.from(el().querySelectorAll<HTMLButtonElement>('.precio-editable'));
      expect(lapices.length).toBeGreaterThan(0);
      expect(lapices.every((l) => l.disabled)).toBeTrue();
      dialogo().editarPrecio(dialogo().liq().detalles[2]);
      expect(dialogo().editandoId()).toBeNull();
      for (const texto of ['Recalcular', 'Anular', 'Aprobar']) {
        expect(botonDelPie(texto)?.disabled).withContext(texto).toBeTrue();
      }
    });

    it('con el precio de un día en camino, Aprobar y Recalcular no salen (aprobaban con el precio viejo)', async () => {
      await abrir(quincena(), [...COMPRAS, 'liquidaciones:administrar']);
      dialogo().guardandoId.set('d-3');
      fixture.detectChanges();

      await dialogo().aprobar();
      await dialogo().recalcular();
      await asentar();

      // Salen sin hacer nada: el servidor no vio ni una llamada y la quincena sigue en borrador.
      expect(servidor.acciones).toEqual([]);
      expect(dialogo().liq().estado).toBe('borrador');
      expect(dialogo().ocupado()).toBeTrue();
      expect(dialogo().procesando()).toBeFalse();
      expect(botonDelPie('Aprobar')?.disabled).toBeTrue();
    });


    it('mientras una acción del pie está en camino (procesando) el lápiz no abre', async () => {
      await abrir(quincena(), [...COMPRAS, 'liquidaciones:administrar']);
      dialogo().procesando.set(true);
      fixture.detectChanges();

      expect(dialogo().ocupado()).toBeTrue();
      const lapices = Array.from(el().querySelectorAll<HTMLButtonElement>('.precio-editable'));
      expect(lapices.length).toBeGreaterThan(0);
      expect(lapices.every((l) => l.disabled)).toBeTrue();
      dialogo().editarPrecio(dialogo().liq().detalles[2]);
      expect(dialogo().editandoId()).toBeNull();
    });

    it('en una quincena a medio pagar, mientras una acción está en camino, Corregir y Pagar se apagan', async () => {
      const aMedioPagar = quincena({ estado: 'parcial', estado_visible: 'parcial', pagado: '500000', saldo: '500000' });
      await abrir(aMedioPagar, [...COMPRAS, 'liquidaciones:administrar']);
      expect(botonDelPie('Corregir')).toBeDefined();
      expect(botonDelPie('Pagar')).toBeDefined();

      dialogo().procesando.set(true);
      fixture.detectChanges();

      for (const texto of ['Corregir', 'Pagar']) {
        expect(botonDelPie(texto)?.disabled).withContext(texto).toBeTrue();
      }
    });

    it('Recalcular y Aprobar sí salen cuando nada se está guardando (la guardia no los apaga de más)', async () => {
      await abrir(quincena(), [...COMPRAS, 'liquidaciones:administrar']);

      await dialogo().recalcular();

      expect(servidor.acciones).toEqual(['recalcular:l-1']);
    });

    it('en una quincena saldada sin cerrar, mientras una acción está en camino, Marcar pagada se apaga', async () => {
      const saldada = quincena({ estado: 'aprobada', estado_visible: 'aprobada', saldo: '0', neto_a_pagar: '0', pagado: '0' });
      await abrir(saldada, [...COMPRAS, 'liquidaciones:administrar']);
      expect(botonDelPie('Marcar pagada')).toBeDefined();
      expect(botonDelPie('Marcar pagada')?.disabled).toBeFalse();

      dialogo().procesando.set(true);
      fixture.detectChanges();

      expect(botonDelPie('Marcar pagada')?.disabled).toBeTrue();
    });

    it('el lápiz de un día no manda su PUT mientras "Poner a todos" está en camino', async () => {
      await abrir(quincena());
      dialogo().editarPrecio(dialogo().liq().detalles[2]);
      dialogo().alEscribirPrecio('2100');
      dialogo().aplicandoPrecios.set(true);

      await dialogo().guardarPrecio(dialogo().liq().detalles[2]);

      expect(servidor.pedidosDeUnDia).toEqual([]);
    });
  });

  describe('el lápiz abierto y las otras puertas del precio', () => {
    const conDosPrecios = (): Liquidacion =>
      quincena({
        detalles: dias().map((d, i) =>
          i === 2 ? { ...d, precio_litro: '2000', valor: String(Number(d.litros) * 2000) } : d,
        ),
      });

    it('copiar un precio a OTROS días NO cierra ni pierde lo que el lápiz de otro día lleva escrito', async () => {
      await abrir(conDosPrecios());
      dialogo().editarPrecio(dialogo().liq().detalles[0]);
      dialogo().alEscribirPrecio('2100');
      fixture.detectChanges();

      // El día 1 tiene el lápiz abierto y por eso no trae cuadrito: el del día 3 es el segundo de la tabla.
      await arrastrar(1, 3); // el precio del día 3 al día 4: el día 1 no está en el tramo

      expect(servidor.pedidos).toEqual([{ id: 'l-1', precio: 2000, ids: ['d-4'] }]);
      expect(dialogo().editandoId()).toBe('d-1');
      expect(dialogo().textoPrecio()).toBe('2100');
    });


    it('la tabla conserva el campo del lápiz al llegar la respuesta (trackBy por id): no se recrea ni se guarda a medias', async () => {
      await abrir(conDosPrecios());
      dialogo().editarPrecio(dialogo().liq().detalles[0]);
      dialogo().alEscribirPrecio('21');
      fixture.detectChanges();
      const campoDelLapiz = el().querySelector('.precio-edicion input');
      expect(campoDelLapiz).not.toBeNull();

      await arrastrar(1, 3); // copia el precio del día 3 al día 4: llega una respuesta con filas nuevas

      expect(el().querySelector('.precio-edicion input')).toBe(campoDelLapiz); // el MISMO campo
      expect(servidor.pedidosDeUnDia).toEqual([]); // y nada se guardó a medias
      expect(dialogo().textoPrecio()).toBe('21');
    });

    it('si el tramo SÍ incluye el día del lápiz, ese campo se cierra (su precio se sobrescribe)', async () => {
      await abrir(conDosPrecios());
      dialogo().editarPrecio(dialogo().liq().detalles[3]);
      dialogo().alEscribirPrecio('2100');
      fixture.detectChanges();

      await arrastrar(2, 3);

      expect(servidor.pedidos.length).toBe(1);
      expect(dialogo().editandoId()).toBeNull();
    });

    it('la tabla conserva el campo del lápiz aunque el servidor devuelva TODAS las filas como objetos nuevos', async () => {
      await abrir(conDosPrecios());
      dialogo().editarPrecio(dialogo().liq().detalles[0]);
      dialogo().alEscribirPrecio('21');
      fixture.detectChanges();
      const campoDelLapiz = el().querySelector('.precio-edicion input');
      expect(campoDelLapiz).not.toBeNull();

      // Una respuesta HTTP de verdad trae objetos recién leídos del JSON: ninguno es el de antes.
      dialogo().liq.set(JSON.parse(JSON.stringify(dialogo().liq())));
      fixture.detectChanges();

      expect(el().querySelector('.precio-edicion input')).toBe(campoDelLapiz);
      expect(dialogo().editandoId()).toBe('d-1');
      expect(dialogo().textoPrecio()).toBe('21');
      expect(servidor.pedidosDeUnDia).toEqual([]);
    });

    it('la fila es el día y no su posición: si llegan los días en otro orden, el lápiz se queda con su día', async () => {
      await abrir(conDosPrecios());
      dialogo().editarPrecio(dialogo().liq().detalles[2]);
      dialogo().alEscribirPrecio('2100');
      fixture.detectChanges();
      const campoDelLapiz = el().querySelector('.precio-edicion input');
      expect(campoDelLapiz).not.toBeNull();

      const alReves = dialogo().liq().detalles.slice().reverse();
      dialogo().liq.set({ ...dialogo().liq(), detalles: alReves });
      fixture.detectChanges();

      expect(dialogo().editandoId()).toBe('d-3');
      expect(el().querySelectorAll('.precio-edicion input').length).toBe(1);
      expect(el().querySelector('.precio-edicion input')).toBe(campoDelLapiz); // el MISMO campo, ahora en otra fila
      expect(filas()[3].querySelector('.precio-edicion input')).toBe(campoDelLapiz);
    });

    it('oprimir "Poner a todos" no le quita el foco a un lápiz abierto: el mousedown no hace nada', async () => {
      await abrir(quincena());
      escribir('2000');

      const apretar = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      boton().dispatchEvent(apretar);

      // Sin el preventDefault el navegador saca el foco del lápiz, su blur guarda lo que lleva
      // tecleado a medias y el clic se pierde con el botón ya apagado.
      expect(apretar.defaultPrevented).toBeTrue();
    });
  });

  describe('el precio de todos, leído y confirmado', () => {
    it('el botón dice cómo se leyó el precio: "2000.50" del teclado numérico es $ 200.050', async () => {
      await abrir(quincena());

      escribir('2000.50');

      expect(comoSeLee(boton().textContent)).toContain('Poner $ 200.050 a los 6 días');
    });

    it('un precio muy lejos del de hoy se confirma diciendo cómo se leyó; sin confirmar no se manda nada', async () => {
      await abrir(quincena());
      respuestaDelDialogo = false;
      escribir('2000.50');

      await dialogo().aplicarPrecioATodos();

      expect(dialogos.length).toBe(1);
      expect(comoSeLee(dialogos[0].datos.mensaje)).toBe(
        'Lo que escribió se leyó como $ 200.050 por litro, y hoy todos los días están a $ 1.900. ' +
          '¿Poner $ 200.050 a los 6 días?',
      );
      expect(servidor.pedidos).toEqual([]);
    });

    it('confirmado, se manda lo que se leyó', async () => {
      await abrir(quincena());
      respuestaDelDialogo = true;
      escribir('2000.50');

      await dialogo().aplicarPrecioATodos();

      expect(servidor.pedidos.map((p) => p.precio)).toEqual([200050]);
    });


    it('justo 3 veces el precio de hoy NO se confirma (el umbral es "más de 3 veces")', async () => {
      await abrir(quincena()); // $ 1.900
      respuestaDelDialogo = false;

      escribir('5700'); // justo 3 x 1.900
      await dialogo().aplicarPrecioATodos();

      expect(dialogos.length).toBe(0);
      expect(servidor.pedidos.map((p) => p.precio)).toEqual([5700]);
    });

    it('justo la tercera parte del precio de hoy tampoco se confirma', async () => {
      await abrir(quincena({ detalles: dias(1800) }));
      respuestaDelDialogo = false;

      escribir('600'); // justo 1.800 / 3
      await dialogo().aplicarPrecioATodos();

      expect(dialogos.length).toBe(0);
      expect(servidor.pedidos.map((p) => p.precio)).toEqual([600]);
    });

    it('la referencia no cuenta los días en $0: el promedio es el de los que tienen precio', async () => {
      const conDosEnCero = dias(2000).map((d, i) => (i >= 4 ? { ...d, precio_litro: '0', valor: '0' } : d));
      await abrir(quincena({ detalles: conDosEnCero }));
      respuestaDelDialogo = false;

      escribir('5000'); // 2,5 veces los $ 2.000 de los que tienen precio (con los dos en $0 serían 3,75)
      await dialogo().aplicarPrecioATodos();

      expect(dialogos.length).toBe(0);
      expect(servidor.pedidos.map((p) => p.precio)).toEqual([5000]);
    });

    it('con UN solo día por cambiar el botón dice "1 día", en singular', async () => {
      const casiTodos = dias(2000).map((d, i) => (i === 0 ? { ...d, precio_litro: '1900' } : d));
      await abrir(quincena({ detalles: casiTodos }));

      escribir('2000');

      expect(comoSeLee(dialogo().rotuloAplicarATodos())).toBe('Poner $ 2.000 a 1 día');
    });

    it('la confirmación de un solo día dice "al día" (no "a el día")', async () => {
      // Cinco días a $ 2.000 y uno a $ 1.000.000: poner $ 2.000 cambia UN día, y está muy lejos del promedio.
      const unoLejos = dias(2000).map((d, i) =>
        i === 5 ? { ...d, precio_litro: '1000000', valor: String(Number(d.litros) * 1000000) } : d,
      );
      await abrir(quincena({ detalles: unoLejos }));
      respuestaDelDialogo = false;

      escribir('2000');
      await dialogo().aplicarPrecioATodos();

      expect(comoSeLee(dialogos[0].datos.mensaje)).toBe(
        'Lo que escribió se leyó como $ 2.000 por litro, y hoy el promedio de la quincena es $ 168.333. ¿Poner $ 2.000 al día?',
      );
    });

    it('más de $ 1.000.000 por litro (el tope del servidor) no se ofrece: el botón se apaga y dice el máximo', async () => {
      await abrir(quincena());

      escribir('1000001');

      expect(apagado()).toBeTrue();
      expect(comoSeLee(boton().textContent)).toContain('El máximo es $ 1.000.000');
      await dialogo().aplicarPrecioATodos(); // Enter en el campo no pasa por el botón apagado
      expect(dialogos.length).toBe(0); // ni se pregunta
      expect(servidor.pedidos).toEqual([]);
      expect(avisos.at(-1)).toContain('no puede pasar de $');

      escribir('1000000'); // justo el tope sí se puede pedir
      expect(apagado()).toBeFalse();
    });

    it('justo $ 1.000.000 por litro (el tope) se ofrece: el botón lo dice y no habla del máximo', async () => {
      await abrir(quincena());

      escribir('1000000');

      expect(apagado()).toBeFalse();
      expect(comoSeLee(boton().textContent)).toContain('Poner $ 1.000.000 a los 6 días');
      expect(comoSeLee(boton().textContent)).not.toContain('máximo');
    });

    it('justo $ 1.000.000 por litro (el tope) sí se manda, confirmado: solo se pasa del tope con más', async () => {
      await abrir(quincena());
      respuestaDelDialogo = true; // está lejísimos del de hoy: se confirma
      escribir('1000000');

      await dialogo().aplicarPrecioATodos();

      expect(avisos.some((a) => a.includes('no puede pasar de'))).toBeFalse();
      expect(servidor.pedidos.map((p) => p.precio)).toEqual([1000000]);
    });

    it('muy por debajo también se confirma, y uno cercano no pregunta nada', async () => {
      await abrir(quincena());
      respuestaDelDialogo = false;

      escribir('500');
      await dialogo().aplicarPrecioATodos();
      expect(dialogos.length).toBe(1);

      escribir('2000');
      await dialogo().aplicarPrecioATodos();
      expect(dialogos.length).toBe(1); // no volvió a preguntar
      expect(servidor.pedidos.map((p) => p.precio)).toEqual([2000]);
    });

    it('con los días en precios distintos la referencia es el promedio de los que tienen precio', async () => {
      const mezclados = dias().map((d, i) => (i < 3 ? { ...d, precio_litro: '1800' } : { ...d, precio_litro: '2000' }));
      await abrir(quincena({ detalles: mezclados }));
      respuestaDelDialogo = false;

      escribir('6000'); // 3,2 veces el promedio de 1.900
      await dialogo().aplicarPrecioATodos();
      expect(dialogos.length).toBe(1);
      expect(comoSeLee(dialogos[0].datos.mensaje)).toContain('hoy el promedio de la quincena es $ 1.900');

      escribir('1900'); // justo el promedio: ninguno de los días tiene ese precio y no se pregunta
      await dialogo().aplicarPrecioATodos();
      expect(dialogos.length).toBe(1);
      expect(servidor.pedidos.map((p) => p.precio)).toEqual([1900]);
    });
  });

  describe('el cuadrito y los punteros', () => {
    const evento = (tipo: string, extra: PointerEventInit = {}): PointerEvent =>
      new PointerEvent(tipo, { bubbles: true, pointerId: 1, isPrimary: true, clientX: 10, clientY: 10, ...extra });

    it('un día en $0 no trae cuadrito y no se puede arrastrar desde ahí (el servidor rechaza copiar un 0)', async () => {
      const sinPrecio = dias().map((d, i) => (i === 1 ? { ...d, precio_litro: '0', valor: '0' } : d));
      await abrir(quincena({ detalles: sinPrecio }));

      expect(el().querySelectorAll('.asa-precio').length).toBe(LITROS.length - 1);
      dialogo().empezarArrastre(evento('pointerdown'), 1);
      expect(dialogo().arrastre()).toBeNull();
    });

    it('solo el botón principal arranca el arrastre (con el derecho salía el menú del navegador al soltar)', async () => {
      await abrir(quincena());

      dialogo().empezarArrastre(evento('pointerdown', { button: 2 }), 0);
      expect(dialogo().arrastre()).toBeNull();
      dialogo().empezarArrastre(evento('pointerdown', { button: 1 }), 0);
      expect(dialogo().arrastre()).toBeNull();
      dialogo().empezarArrastre(evento('pointerdown', { button: 0 }), 0);
      expect(dialogo().arrastre()).not.toBeNull();
      dialogo().cancelarArrastre();
    });

    it('un segundo dedo (o la palma) no reinicia el arrastre ni lo suelta', async () => {
      const mezclados = dias().map((d, i) => (i === 1 ? { ...d, precio_litro: '2000', valor: String(Number(d.litros) * 2000) } : d));
      await abrir(quincena({ detalles: mezclados }));
      spyOn<any>(dialogo(), 'filaBajoElPuntero').and.returnValue(4);

      dialogo().empezarArrastre(evento('pointerdown', { pointerId: 1 }), 1);
      dialogo().empezarArrastre(evento('pointerdown', { pointerId: 2 }), 3); // otro dedo, otro cuadrito
      expect(dialogo().arrastre()?.origen).toBe(1);

      dialogo().moverArrastre(evento('pointermove', { pointerId: 2, clientY: 400 }));
      expect(dialogo().arrastre()?.hasta).toBe(1); // el otro dedo no mueve el rango
      dialogo().soltarArrastre(evento('pointerup', { pointerId: 2 }));
      expect(dialogo().arrastre()).not.toBeNull(); // ni lo suelta
      expect(servidor.pedidos).toEqual([]);

      dialogo().moverArrastre(evento('pointermove', { pointerId: 1, clientY: 100 }));
      expect(dialogo().arrastre()?.hasta).toBe(4);
      dialogo().cancelarArrastre(evento('pointercancel', { pointerId: 1 }));
      expect(dialogo().arrastre()).toBeNull();
    });

    it('si el cuadrito desaparece a mitad del gesto (lostpointercapture) el arrastre se cancela solo', async () => {
      await abrir(quincena());
      const asa = el().querySelectorAll<HTMLElement>('.asa-precio')[0];
      asa.dispatchEvent(evento('pointerdown'));
      expect(dialogo().arrastre()).not.toBeNull();

      asa.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }));

      expect(dialogo().arrastre()).toBeNull();
    });


    it('un puntero que no es el primario no arranca el arrastre', async () => {
      await abrir(quincena());

      dialogo().empezarArrastre(evento('pointerdown', { isPrimary: false }), 0);

      expect(dialogo().arrastre()).toBeNull();
    });

    it('un temblor de 2 px en la franja del borde no cuenta como mover: la tabla no corre', async () => {
      await abrir(quincena());
      fingirGeometria();
      const contenido = el().querySelector('mat-dialog-content')!;
      let recorrido = 0;
      Object.defineProperty(contenido, 'scrollTop', {
        configurable: true,
        get: () => recorrido,
        set: (v: number) => (recorrido = v),
      });
      spyOn<any>(dialogo(), 'filaBajoElPuntero').and.returnValue(1);
      const asa = el().querySelectorAll<HTMLElement>('.asa-precio')[0];
      asa.dispatchEvent(evento('pointerdown', { clientY: 399 }));
      asa.dispatchEvent(evento('pointermove', { clientY: 397 })); // 2 px
      const cuadro = (ahora: number): void => (dialogo() as any).desplazarSiHaceFalta(ahora);

      cuadro(1000);
      cuadro(1000 + 5 * ESPERA_DEL_BORDE_MS);

      expect(recorrido).toBe(0);
      asa.dispatchEvent(evento('pointercancel'));
    });

    it('si al soltar el día de origen ya quedó en $0 (llegó una recarga), no se manda nada', async () => {
      const mezclados = dias().map((d, i) => (i === 1 ? { ...d, precio_litro: '2000', valor: String(Number(d.litros) * 2000) } : d));
      await abrir(quincena({ detalles: mezclados }));
      spyOn<any>(dialogo(), 'filaBajoElPuntero').and.returnValue(4);
      dialogo().empezarArrastre(evento('pointerdown'), 1);
      dialogo().moverArrastre(evento('pointermove', { clientY: 100 }));
      expect(dialogo().arrastre()?.hasta).toBe(4);

      dialogo().liq.set(quincena({ detalles: dias().map((d, i) => (i === 1 ? { ...d, precio_litro: '0', valor: '0' } : d)) }));
      dialogo().soltarArrastre(evento('pointerup', { clientY: 100 }));
      await asentar();

      expect(servidor.pedidos).toEqual([]);
    });

    it('si el cuadrito desaparece a mitad del gesto, soltar el puntero en CUALQUIER parte (la ventana) termina el arrastre', async () => {
      const mezclados = dias().map((d, i) => (i === 1 ? { ...d, precio_litro: '2000', valor: String(Number(d.litros) * 2000) } : d));
      await abrir(quincena({ detalles: mezclados }));
      spyOn<any>(dialogo(), 'filaBajoElPuntero').and.returnValue(3);
      dialogo().empezarArrastre(evento('pointerdown'), 1);
      dialogo().moverArrastre(evento('pointermove', { clientY: 100 }));

      window.dispatchEvent(evento('pointerup', { clientY: 100 })); // nadie en el cuadrito lo oyó
      await asentar();

      expect(dialogo().arrastre()).toBeNull();
      expect(servidor.pedidos).toEqual([{ id: 'l-1', precio: 2000, ids: ['d-3', 'd-4'] }]);
    });

    it('un pointercancel en la ventana cancela el arrastre sin copiar nada', async () => {
      await abrir(quincena());
      spyOn<any>(dialogo(), 'filaBajoElPuntero').and.returnValue(3);
      dialogo().empezarArrastre(evento('pointerdown'), 1);

      window.dispatchEvent(evento('pointercancel'));

      expect(dialogo().arrastre()).toBeNull();
      expect(servidor.pedidos).toEqual([]);
    });

    it('el pointerup de OTRO puntero en la ventana no suelta el arrastre', async () => {
      await abrir(quincena());
      dialogo().empezarArrastre(evento('pointerdown', { pointerId: 1 }), 1);

      window.dispatchEvent(evento('pointerup', { pointerId: 2 }));

      expect(dialogo().arrastre()).not.toBeNull();
      dialogo().cancelarArrastre();
    });

    it('terminado el arrastre se dejan de escuchar la ventana (no quedan oyentes colgados)', async () => {
      await abrir(quincena());
      const quitar = spyOn(window, 'removeEventListener').and.callThrough();
      dialogo().empezarArrastre(evento('pointerdown'), 1);

      dialogo().cancelarArrastre();

      const tipos = quitar.calls.allArgs().map((a) => a[0]);
      expect(tipos).toContain('pointerup');
      expect(tipos).toContain('pointercancel');
    });

    it('en pantalla táctil la sangría del precio solo está donde hay cuadrito (también en el encabezado)', async () => {
      await abrir(quincena());
      expect(el().querySelector('td.celda-precio')!.classList).toContain('con-asa');
      expect(el().querySelector('th.con-asa')).not.toBeNull();

      await abrir(quincena({ estado: 'aprobada', estado_visible: 'aprobada' }));
      expect(el().querySelector('td.celda-precio')!.classList).not.toContain('con-asa');
      expect(el().querySelector('th.con-asa')).toBeNull();
    });

    it('un movimiento de justo 4 px ya cuenta como mover: en la franja del borde la tabla corre', async () => {
      await abrir(quincena());
      fingirGeometria();
      const contenido = el().querySelector('mat-dialog-content')!;
      let recorrido = 0;
      Object.defineProperty(contenido, 'scrollTop', {
        configurable: true,
        get: () => recorrido,
        set: (v: number) => (recorrido = v),
      });
      spyOn<any>(dialogo(), 'filaBajoElPuntero').and.returnValue(1);
      const asa = el().querySelectorAll<HTMLElement>('.asa-precio')[0];
      asa.dispatchEvent(evento('pointerdown', { clientY: 391 }));
      asa.dispatchEvent(evento('pointermove', { clientY: 395 })); // justo 4 px, hacia adentro de la franja
      const cuadro = (ahora: number): void => (dialogo() as any).desplazarSiHaceFalta(ahora);

      cuadro(1000);
      cuadro(1000 + ESPERA_DEL_BORDE_MS);

      expect(recorrido).toBeGreaterThan(0);
      asa.dispatchEvent(evento('pointercancel'));
    });

    it('el pointercancel o el lostpointercapture de OTRO puntero no cancela el arrastre', async () => {
      await abrir(quincena());
      const asa = el().querySelectorAll<HTMLElement>('.asa-precio')[1];
      asa.dispatchEvent(evento('pointerdown', { pointerId: 1 }));
      expect(dialogo().arrastre()).not.toBeNull();

      dialogo().cancelarArrastre(evento('pointercancel', { pointerId: 2 }));
      expect(dialogo().arrastre()).not.toBeNull();
      asa.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 2 }));
      expect(dialogo().arrastre()).not.toBeNull();

      asa.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }));
      expect(dialogo().arrastre()).toBeNull();
    });

    it('apretar el cuadrito no deja que el navegador arranque su propio gesto', async () => {
      await abrir(quincena());
      const asa = el().querySelectorAll<HTMLElement>('.asa-precio')[0];
      const apretar = new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        isPrimary: true,
        clientX: 10,
        clientY: 10,
      });

      asa.dispatchEvent(apretar);

      expect(dialogo().arrastre()).not.toBeNull();
      expect(apretar.defaultPrevented).toBeTrue();
      dialogo().cancelarArrastre();
    });

    it('apretar el cuadrito en la franja del borde y quedarse quieto NO hace correr la tabla; al moverse, sí', async () => {
      await abrir(quincena());
      fingirGeometria();
      const contenido = el().querySelector('mat-dialog-content')!;
      let recorrido = 0;
      Object.defineProperty(contenido, 'scrollTop', {
        configurable: true,
        get: () => recorrido,
        set: (v: number) => (recorrido = v),
      });
      spyOn<any>(dialogo(), 'filaBajoElPuntero').and.returnValue(1);
      const asa = el().querySelectorAll<HTMLElement>('.asa-precio')[0];
      asa.dispatchEvent(evento('pointerdown', { clientY: 399 }));
      const cuadro = (ahora: number): void => (dialogo() as any).desplazarSiHaceFalta(ahora);

      cuadro(1000);
      cuadro(1000 + 5 * ESPERA_DEL_BORDE_MS); // mucho después, sin mover el puntero
      expect(recorrido).toBe(0);

      asa.dispatchEvent(evento('pointermove', { clientY: 392 }));
      cuadro(5000);
      cuadro(5000 + ESPERA_DEL_BORDE_MS);
      expect(recorrido).toBeGreaterThan(0);

      asa.dispatchEvent(evento('pointercancel'));
    });
  });

  describe('el campo de todos los días', () => {
    it('su nombre es el rótulo visible: no lleva un aria-label distinto', async () => {
      await abrir(quincena());

      expect(campo().getAttribute('aria-label')).toBeNull();
      expect(campo().closest('label')).not.toBeNull();
    });

    it('mientras guarda dice "Guardando…" y no pierde el foco (solo lectura, y el botón sigue enfocable)', async () => {
      await abrir(quincena());
      servidor.respuesta = new Subject<Liquidacion>();
      escribir('2000');

      boton().click();
      fixture.detectChanges();

      expect(comoSeLee(boton().textContent)).toContain('Guardando…');
      expect(campo().getAttribute('aria-busy')).toBe('true');
      expect(campo().disabled).toBeFalse();
      expect(boton().disabled).toBeFalse(); // disabledInteractive: sigue en el orden del teclado
    });
  });
});

describe('el precio tecleado a la colombiana y de vuelta', () => {
  it('un número con decimales se escribe con coma y se lee igual', () => {
    for (const n of [1900, 1750.5, 242.76, 2000, 0.5]) {
      expect(precioTecleado(precioComoSeEscribe(n))).toBe(n);
    }
  });

  it('"1750.5" a secas se leía 17.505: por eso el campo ya no se prellena así', () => {
    expect(precioTecleado('1750.5')).toBe(17505);
    expect(precioComoSeEscribe(1750.5)).toBe('1750,5');
  });
});

describe('LiquidacionDetailDialog: el lápiz de un día con un precio con decimales', () => {
  it('abrirlo y salir sin tocar nada NO cambia el precio a diez veces más', async () => {
    TestBed.resetTestingModule();
    const detallesConDecimales = dias(1750.5);
    const inicial = quincena({ detalles: detallesConDecimales });
    const pedidos: unknown[] = [];
    await TestBed.configureTestingModule({
      imports: [LiquidacionDetailDialog, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { item: inicial } },
        {
          provide: LiquidacionesService,
          useValue: {
            getById: () => of(inicial),
            actualizarPrecioDetalle: (...args: unknown[]) => {
              pedidos.push(args);
              return of(inicial);
            },
          },
        },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        {
          provide: AuthService,
          useValue: {
            hasPermission: (m: string, a = 'consultar') => COMPRAS.includes(`${m}:${a}`),
            perfil: () => null,
            esSuperadmin: () => false,
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LiquidacionDetailDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    const dialogo = fixture.componentInstance;

    dialogo.editarPrecio(dialogo.liq().detalles[0]);
    expect(dialogo.textoPrecio()).toBe('1750,5');
    await dialogo.guardarPrecio(dialogo.liq().detalles[0]); // salir del campo sin tocar nada

    expect(pedidos.length).toBe(0);
  });
});
