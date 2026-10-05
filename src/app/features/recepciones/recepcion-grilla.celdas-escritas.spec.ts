import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { Recepcion } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { RecepcionFormDialog } from './recepcion-form.dialog';
import { RecepcionGrillaTab } from './recepcion-grilla.tab';
import { CeldaGrilla, GrillaQuincena, RecepcionPayload, RecepcionesService } from './recepciones.service';

/**
 * LA CELDA DE LA GRILLA ES UN CAMPO DE TEXTO: se escribe encima (con el teclado o con el lápiz
 * digital de la tablet) y se guarda al salir. Se mide lo que importa de plata y de verdad:
 * qué se manda al servidor (solo los litros, el número bien leído), qué NO se manda (lo que no
 * se entiende, el cero, el vacío, lo que no cambió), que un día en firme no se escriba, que una
 * liquidación aprobada se confirme antes de devolverla a borrador, y que lo que queda en
 * pantalla sea lo que respondió el servidor.
 */

const D1 = '2026-06-01';
const D2 = '2026-06-02';
const D3 = '2026-06-03';

const AVISO_EN_FIRME =
  'Los litros de este día ya se pagaron: no se pueden cambiar. Sí se puede corregir el transportador.';

interface Modelo {
  /** proveedor -> día -> el día como lo ve el servidor */
  dias: Record<string, Record<string, Partial<Recepcion> & { id: string; litros: string }>>;
}

const celdaDe = (d: Modelo['dias'][string][string]): CeldaGrilla => ({
  recepcion_id: d.id,
  litros: d.litros,
  liquidada: !!d.liquidacion_estado && d.liquidacion_estado !== null,
  pagada: !!d.leche_pagada,
  candado_aviso: d.candado_aviso ?? null,
  leche_pagada: !!d.leche_pagada,
  flete_pagado: !!d.flete_pagado,
  liquidacion_estado: d.liquidacion_estado ?? null,
  con_transporte: !!d.transportador_id,
});

const nuevoModelo = (): Modelo => ({
  dias: {
    'p-a': {
      [D1]: { id: 'r-a1', litros: '100.00', liquidacion_estado: 'borrador', liquidacion_estado_leche: 'borrador' },
      [D2]: { id: 'r-a2', litros: '50.50', transportador_id: 't-1' },
    },
    'p-b': {
      [D1]: {
        id: 'r-b1',
        litros: '70.00',
        liquidacion_estado: 'aprobada',
        liquidacion_estado_leche: 'aprobada',
        leche_pagada: true,
        candado_aviso: AVISO_EN_FIRME,
        campos_bloqueados: ['cantidad_litros'],
      },
      [D3]: { id: 'r-b3', litros: '80.00', liquidacion_estado: 'aprobada', liquidacion_estado_leche: 'aprobada' },
    },
  },
});

const NOMBRES: Record<string, string> = { 'p-a': 'Ana Lechera', 'p-b': 'Beto Cobrada' };

class ServidorFalso {
  modelo = nuevoModelo();
  grillas = 0;
  creadas: RecepcionPayload[] = [];
  actualizadas: { id: string; cuerpo: Partial<RecepcionPayload> }[] = [];
  pedidas: string[] = [];
  /** Lo que el PUT dice que volvió a borrador. */
  devueltas: { id: string; tipo: string }[] = [];
  /** Si no es null, el PUT / POST rebotan con este texto. */
  rechazo: string | null = null;
  /** Si no es null, la grilla se contesta por aquí para controlar el orden de llegada. */
  diferida: Subject<GrillaQuincena>[] | null = null;
  /** Si no es null, el PUT / POST no contestan hasta que la prueba lo diga (un guardado "en camino"). */
  enCamino: Subject<Recepcion> | null = null;
  /** Proveedores retirados: la fila viene con `proveedor_activo: false`. */
  retirados = new Set<string>();
  /** Si no es null, la grilla falla con este error (el pedido de DESPUÉS de guardar). */
  grillaFalla: HttpErrorResponse | null = null;
  /** La grilla no trae los días creados (como con el filtro de transportador, que los excluye). */
  omitirDiasNuevos = false;

  construirGrilla(): GrillaQuincena {
    const filas = Object.keys(NOMBRES).map((pid) => {
      const dias = this.modelo.dias[pid] ?? {};
      const total = Object.values(dias).reduce((t, d) => t + Number(d.litros), 0);
      return {
        proveedor_id: pid,
        proveedor_nombre: NOMBRES[pid],
        vereda: null,
        precio_litro: '1800',
        proveedor_activo: !this.retirados.has(pid),
        celdas: Object.fromEntries(
          Object.entries(dias)
            .filter(([, d]) => !(this.omitirDiasNuevos && d.id === 'r-nuevo'))
            .map(([iso, d]) => [iso, celdaDe(d)]),
        ),
        total_litros: String(total),
        valor_bruto: String(total * 1800),
        descuentos: '0',
        bonificaciones: '0',
        valor_neto: String(total * 1800),
        valor_transporte: '0',
      };
    });
    const totalesDia: Record<string, string> = {};
    for (const iso of [D1, D2, D3]) {
      totalesDia[iso] = String(
        Object.values(this.modelo.dias).reduce((t, dias) => t + Number(dias[iso]?.litros ?? 0), 0),
      );
    }
    const total = Object.values(totalesDia).reduce((t, v) => t + Number(v), 0);
    return {
      desde: D1,
      hasta: '2026-06-15',
      fechas: [D1, D2, D3],
      filas,
      totales_dia: totalesDia,
      total_litros: String(total),
      total_valor_neto: String(total * 1800),
      total_transporte: '0',
    } as unknown as GrillaQuincena;
  }

  grilla(): Observable<GrillaQuincena> {
    this.grillas++;
    if (this.grillaFalla) return throwError(() => this.grillaFalla);
    if (this.diferida) {
      const salida = new Subject<GrillaQuincena>();
      this.diferida.push(salida);
      return salida;
    }
    return of(this.construirGrilla());
  }

  private dia(id: string): { proveedor: string; iso: string } {
    for (const [proveedor, dias] of Object.entries(this.modelo.dias)) {
      for (const [iso, d] of Object.entries(dias)) if (d.id === id) return { proveedor, iso };
    }
    throw new Error('no existe ' + id);
  }

  getById(id: string): Observable<Recepcion> {
    this.pedidas.push(id);
    const { proveedor, iso } = this.dia(id);
    const d = this.modelo.dias[proveedor][iso];
    return of({
      campos_bloqueados: [],
      campos_editables: [],
      candado_aviso: null,
      leche_pagada: false,
      flete_pagado: false,
      liquidacion_estado: null,
      liquidacion_estado_leche: null,
      liquidacion_estado_flete: null,
      liquidacion_id: d.liquidacion_estado ? 'liq-' + id : null,
      liquidacion_transporte_id: null,
      ...d,
      id,
      fecha: iso,
      proveedor_id: proveedor,
      proveedor_nombre: NOMBRES[proveedor],
      cantidad_litros: d.litros,
    } as unknown as Recepcion);
  }

  update(id: string, cuerpo: Partial<RecepcionPayload>): Observable<Recepcion> {
    if (this.rechazo) return throwError(() => errorDelServidor(this.rechazo!));
    this.actualizadas.push({ id, cuerpo });
    const { proveedor, iso } = this.dia(id);
    this.modelo.dias[proveedor][iso].litros = String(cuerpo.cantidad_litros);
    if (this.enCamino) return this.enCamino;
    let respuesta!: Recepcion;
    this.getById(id).subscribe((r) => (respuesta = r));
    this.pedidas.pop();
    return of({
      ...respuesta,
      liquidaciones_devueltas_a_borrador: this.devueltas,
    } as unknown as Recepcion);
  }

  create(cuerpo: RecepcionPayload): Observable<Recepcion> {
    if (this.rechazo) return throwError(() => errorDelServidor(this.rechazo!));
    this.creadas.push(cuerpo);
    const proveedor = cuerpo.proveedor_id!;
    this.modelo.dias[proveedor] ??= {};
    this.modelo.dias[proveedor][cuerpo.fecha] = { id: 'r-nuevo', litros: String(cuerpo.cantidad_litros) };
    if (this.enCamino) return this.enCamino;
    return of({ id: 'r-nuevo', liquidaciones_devueltas_a_borrador: [] } as unknown as Recepcion);
  }
}

const errorDelServidor = (detalle: string): HttpErrorResponse =>
  new HttpErrorResponse({ status: 422, error: { error: { detail: detalle } } });

const comoSeLee = (t: string | null | undefined): string =>
  (t ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

describe('RecepcionGrillaTab: los litros se escriben en la celda', () => {
  let fixture: ComponentFixture<RecepcionGrillaTab>;
  let servidor: ServidorFalso;
  let mensajes: { texto: string; accion: string }[];
  let dialogos: { componente: unknown; datos: unknown }[];
  let respuestaDelDialogo: unknown;
  let abiertos: unknown[];
  let cambios: number;

  beforeEach(() => sessionStorage.clear());

  const armar = async (
    permisos: string[] = ['recepcion:crear', 'recepcion:editar', 'recepcion:eliminar'],
  ): Promise<void> => {
    servidor = new ServidorFalso();
    mensajes = [];
    dialogos = [];
    abiertos = [];
    respuestaDelDialogo = true;
    cambios = 0;
    const tiene = new Set(permisos);
    await TestBed.configureTestingModule({
      imports: [RecepcionGrillaTab, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        {
          provide: MatSnackBar,
          useValue: { open: (texto: string, accion: string) => mensajes.push({ texto, accion }) },
        },
        {
          provide: MatDialog,
          useValue: {
            // `openDialogs` es lo que mira confirmarLitros para no guardar mientras un diálogo tiene el foco.
            get openDialogs() {
              return abiertos;
            },
            open: (componente: unknown, config: { data: unknown }) => {
              dialogos.push({ componente, datos: config?.data });
              return { afterClosed: () => of(respuestaDelDialogo) };
            },
          },
        },
        {
          provide: AuthService,
          useValue: {
            hasPermission: (modulo: string, accion = 'consultar') => tiene.has(`${modulo}:${accion}`),
            perfil: () => null,
            esSuperadmin: () => false,
          },
        },
        { provide: ApiService, useValue: { get: () => of({ items: [], total: 0, page: 1, page_size: 100, pages: 1 }) } },
        { provide: RecepcionesService, useValue: servidor },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RecepcionGrillaTab);
    fixture.componentInstance.cambio.subscribe(() => cambios++);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const el = (): HTMLElement => fixture.nativeElement;
  const campo = (proveedor: string, iso: string): HTMLInputElement => {
    const fila = Object.keys(NOMBRES).indexOf(proveedor);
    const columna = [D1, D2, D3].indexOf(iso);
    return el().querySelectorAll<HTMLTableRowElement>('tbody tr')[fila].querySelectorAll<HTMLTableCellElement>('td.celda')[columna]
      .querySelector('input.celda-input') as HTMLInputElement;
  };
  const celdaTd = (proveedor: string, iso: string): HTMLTableCellElement => {
    const fila = Object.keys(NOMBRES).indexOf(proveedor);
    const columna = [D1, D2, D3].indexOf(iso);
    return el().querySelectorAll<HTMLTableRowElement>('tbody tr')[fila].querySelectorAll<HTMLTableCellElement>('td.celda')[columna];
  };
  const asentar = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const escribir = (c: HTMLInputElement, texto: string): void => {
    c.value = texto;
    c.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const salir = async (c: HTMLInputElement): Promise<void> => {
    c.dispatchEvent(new FocusEvent('blur'));
    await asentar();
  };
  /** Escribir y salir del campo: el gesto completo. */
  const anotar = async (c: HTMLInputElement, texto: string): Promise<void> => {
    escribir(c, texto);
    await salir(c);
  };
  const ultimoAviso = (): string => mensajes.at(-1)?.texto ?? '';

  // ------------------------------------------------------------------ cómo se ve
  describe('cómo se ve', () => {
    it('los días con y sin registro son campos de texto de cifras, con los litros ya escritos', async () => {
      await armar();

      const a1 = campo('p-a', D1);
      expect(a1.type).toBe('text');
      expect(a1.getAttribute('inputmode')).toBe('decimal');
      expect(a1.value).toBe('100');
      expect(campo('p-a', D2).value).toBe('50,5');
      // El día sin registro es el mismo campo, vacío y a trazos.
      expect(campo('p-a', D3).value).toBe('');
      expect(campo('p-a', D3).classList).toContain('vacia');
      expect(campo('p-a', D1).classList).not.toContain('vacia');
    });

    it('el día que ya está en una liquidación sin pagar lleva su franja ámbar', async () => {
      await armar();

      expect(campo('p-a', D1).classList).toContain('en-liquidacion');
      expect(campo('p-a', D2).classList).not.toContain('en-liquidacion');
    });

    it('el lector de pantalla oye de quién y de qué día es el campo', async () => {
      await armar();

      expect(campo('p-a', D1).getAttribute('aria-label')).toBe(
        'Litros de Ana Lechera del 01/06/2026 (ya está en una liquidación sin pagar)',
      );
      expect(campo('p-a', D2).getAttribute('aria-label')).toBe(
        'Litros de Ana Lechera del 02/06/2026, con transporte',
      );
      expect(campo('p-a', D3).getAttribute('aria-label')).toBe('Anotar los litros de Ana Lechera del 03/06/2026');
    });

    it('un día con cifras en firme NO es campo: sigue siendo el botón que abre el día', async () => {
      await armar();

      const td = celdaTd('p-b', D1);
      expect(td.querySelector('input')).toBeNull();
      const boton = td.querySelector('button.celda-btn.pagada') as HTMLButtonElement;
      expect(boton).not.toBeNull();
      boton.click();
      await asentar();
      expect(dialogos.length).toBe(1);
      expect(dialogos[0].componente).toBe(RecepcionFormDialog);
    });

    it('sin permiso de editar los días con registro son texto; sin permiso de crear, los vacíos también', async () => {
      await armar(['recepcion:crear']);
      expect(celdaTd('p-a', D1).querySelector('input')).toBeNull();
      expect(comoSeLee(celdaTd('p-a', D1).textContent)).toContain('100');
      expect(campo('p-a', D3)).not.toBeNull(); // crear sí puede

      TestBed.resetTestingModule();
      await armar(['recepcion:editar']);
      expect(campo('p-a', D1)).not.toBeNull(); // editar sí puede
      expect(celdaTd('p-a', D3).querySelector('input')).toBeNull();

      TestBed.resetTestingModule();
      await armar([]);
      expect(el().querySelectorAll('input.celda-input').length).toBe(0);
    });

    it('el ícono de la esquina abre el día completo, y está fuera del orden del teclado', async () => {
      await armar();

      const abrir = celdaTd('p-a', D2).querySelector('button.abrir-dia') as HTMLButtonElement;
      expect(abrir.getAttribute('tabindex')).toBe('-1');
      abrir.click();
      await asentar();

      expect(dialogos.length).toBe(1);
      expect(dialogos[0].componente).toBe(RecepcionFormDialog);
      expect((dialogos[0].datos as { item: Recepcion }).item.id).toBe('r-a2');
    });

    it('el ícono de un día sin registro abre "nueva recepción" con la fecha y el proveedor de la celda', async () => {
      await armar();

      (celdaTd('p-a', D3).querySelector('button.abrir-dia') as HTMLButtonElement).click();
      await asentar();

      expect(dialogos[0].datos).toEqual({ prefill: { fecha: D3, proveedor_id: 'p-a' } });
    });

    it('Alt+Enter y F2 también abren el día', async () => {
      await armar();

      campo('p-a', D2).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true }));
      campo('p-a', D2).dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
      await asentar();

      expect(dialogos.length).toBe(2);
    });


    it('con el filtro de transportador las celdas SIN registro no son campos: ahí el servidor rebota o el día no se ve', async () => {
      await armar();
      expect(campo('p-a', D3)).not.toBeNull();

      fixture.componentInstance.transportadorId.setValue('t-1');
      await asentar();

      expect(celdaTd('p-a', D3).querySelector('input')).toBeNull();
      expect(celdaTd('p-a', D3).querySelector('button.abrir-dia')).toBeNull();
      // Los días que sí vienen siguen siendo campos.
      expect(campo('p-a', D1)).not.toBeNull();

      fixture.componentInstance.transportadorId.setValue(null);
      await asentar();
      expect(campo('p-a', D3)).not.toBeNull();
    });

    it('en un proveedor retirado las celdas sin registro no son campos; las que tienen día, sí', async () => {
      await armar();
      servidor.retirados.add('p-a');

      await fixture.componentInstance.cargar();
      await asentar();

      expect(celdaTd('p-a', D3).querySelector('input')).toBeNull();
      expect(campo('p-a', D1)).not.toBeNull();
      expect(campo('p-b', D2)).not.toBeNull(); // otro proveedor, activo
    });

    it('sin permiso de escribir la leyenda y la ayuda no le dicen "escriba"', async () => {
      await armar([]);

      const leyenda = comoSeLee(el().querySelector('.leyenda')?.textContent);
      expect(leyenda).not.toContain('escriba');
      expect(leyenda).not.toContain('Escrito sin guardar');
      expect(leyenda).toContain('Sin registro');
      expect(el().querySelector('.ayuda-celdas')).toBeNull();
    });

    it('la ayuda no habla de "eliminar" a quien no puede eliminar', async () => {
      await armar(['recepcion:crear', 'recepcion:editar']);

      expect(comoSeLee(el().querySelector('.ayuda-celdas')?.textContent)).not.toContain('eliminar');
    });

    it('el número completo está en el title del campo (si no cabe en la celda se corta con puntos suspensivos)', async () => {
      await armar();

      expect(campo('p-a', D2).getAttribute('title')).toBe('50,5');
      expect(campo('p-a', D3).getAttribute('title')).toBeNull();
      expect(getComputedStyle(campo('p-a', D2)).textOverflow).toBe('ellipsis');
    });

    it('el teclado de la tablet cierra con "Listo" y no con "Siguiente" (que saltaría a la celda de la derecha)', async () => {
      await armar();

      expect(campo('p-a', D1).getAttribute('enterkeyhint')).toBe('done');
    });

    it('la leyenda dice "escriba" solo de lo que ese rol puede escribir: crear, el día sin registro; editar, el día con litros', async () => {
      await armar(['recepcion:crear']);
      let leyenda = comoSeLee(el().querySelector('.leyenda')?.textContent);
      expect(leyenda).toContain('Sin registro: escriba los litros en el cuadro');
      expect(leyenda).not.toContain('escriba el número nuevo encima');

      TestBed.resetTestingModule();
      await armar(['recepcion:editar']);
      leyenda = comoSeLee(el().querySelector('.leyenda')?.textContent);
      expect(leyenda).not.toContain('escriba los litros en el cuadro');
      expect(leyenda).toContain('Litros del día: escriba el número nuevo encima');
    });

    it('con solo uno de los dos permisos (crear o editar) ya se escribe en alguna celda, y la leyenda y la ayuda lo dicen', async () => {
      for (const permiso of ['recepcion:crear', 'recepcion:editar']) {
        TestBed.resetTestingModule();
        await armar([permiso]);

        expect(el().querySelectorAll('input.celda-input').length).toBeGreaterThan(0);
        expect(comoSeLee(el().querySelector('.ayuda-celdas')?.textContent)).toContain('lápiz digital');
        expect(comoSeLee(el().querySelector('.leyenda')?.textContent)).toContain('Escrito sin guardar');
      }
    });

    it('la leyenda explica el campo sin decir nada falso del candado', async () => {
      await armar();

      const leyenda = comoSeLee(el().querySelector('.leyenda')?.textContent);
      expect(leyenda).toContain('Sin registro: escriba los litros en el cuadro');
      expect(leyenda).toContain('Escrito sin guardar');
      expect(leyenda).toContain('Cifras en firme — la celda dice por qué; lo demás se corrige');
      expect(leyenda).not.toContain('Ya se pagó');
      expect(comoSeLee(el().querySelector('.ayuda-celdas')?.textContent)).toContain('lápiz digital');
    });
  });

  // ------------------------------------------------------------------ guardar un día que existe
  describe('corregir los litros de un día', () => {
    it('escribe el número nuevo y al salir manda SOLO los litros', async () => {
      await armar();

      await anotar(campo('p-a', D2), '60');

      expect(servidor.actualizadas).toEqual([{ id: 'r-a2', cuerpo: { cantidad_litros: 60 } }]);
      expect(servidor.creadas).toEqual([]);
      expect(ultimoAviso()).toBe('Ana Lechera, 02/06: 60 L guardados');
    });

    it('lo que se pinta después es lo que dice el servidor: el campo, el total del proveedor y el del día', async () => {
      await armar();
      const totalesAntes = comoSeLee(el().querySelectorAll('tbody tr')[0].querySelector('td.col-total-litros')?.textContent);
      expect(totalesAntes).toContain('150,5');

      await anotar(campo('p-a', D2), '60');

      expect(campo('p-a', D2).value).toBe('60');
      expect(comoSeLee(el().querySelectorAll('tbody tr')[0].querySelector('td.col-total-litros')?.textContent)).toContain('160');
      expect(servidor.grillas).toBe(2); // la de entrada y la de después de guardar
      expect(cambios).toBe(1); // el listado se entera
    });

    it('se lee a la colombiana: "52,5" y "52.5" son 52 litros y medio; "1.500" son mil quinientos', async () => {
      await armar();

      await anotar(campo('p-a', D2), '52,5');
      await anotar(campo('p-a', D1), '1.500');

      expect(servidor.actualizadas.map((u) => u.cuerpo.cantidad_litros)).toEqual([52.5, 1500]);
    });

    it('con la unidad que mete el reconocedor del lápiz ("60 L") también', async () => {
      await armar();

      await anotar(campo('p-a', D2), '60 L');

      expect(servidor.actualizadas[0].cuerpo).toEqual({ cantidad_litros: 60 });
    });

    it('lo que no cambió no se manda: ni "50,5", ni "50.50", ni "050,5"', async () => {
      await armar();

      for (const texto of ['50,5', '50.50', '050,5', ' 50,50 L ']) {
        await anotar(campo('p-a', D2), texto);
        expect(campo('p-a', D2).value).toBe('50,5'); // vuelve a escribirse como siempre
      }

      expect(servidor.actualizadas).toEqual([]);
      expect(servidor.pedidas).toEqual([]);
      expect(servidor.grillas).toBe(1);
    });

    it('el día se pide entero ANTES de tocarlo (se le pregunta al servidor, no se cree lo que la grilla recuerda)', async () => {
      await armar();

      await anotar(campo('p-a', D2), '60');

      expect(servidor.pedidas).toEqual(['r-a2']);
    });


    it('si entre que se cargó la grilla y ahora alguien ya lo dejó así, no se manda nada y se vuelve a pedir la grilla', async () => {
      await armar();
      servidor.modelo.dias['p-a'][D2].litros = '60.00'; // otro lo cambió; la grilla en pantalla aún dice 50,5

      await anotar(campo('p-a', D2), '60');

      expect(servidor.pedidas).toEqual(['r-a2']);
      expect(servidor.actualizadas).toEqual([]);
      expect(servidor.grillas).toBe(2); // se refresca para mostrar lo que hay
      expect(campo('p-a', D2).value).toBe('60');
      expect(mensajes).toEqual([]);
      expect(cambios).toBe(0);
    });

    it('después de guardar el campo muestra lo que dice la grilla nueva, aunque no sea lo tecleado', async () => {
      await armar();
      servidor.omitirDiasNuevos = true; // como con un filtro que excluye el día recién creado

      await anotar(campo('p-a', D3), '40');

      expect(servidor.creadas.length).toBe(1);
      expect(campo('p-a', D3).value).toBe(''); // la grilla no lo trae: no se queda un 40 que nadie suma
    });

    it('si falla la grilla DESPUÉS de guardar se dice que SÍ se guardó, con ese texto y no con el del error', async () => {
      await armar();
      servidor.grillaFalla = new HttpErrorResponse({
        status: 500,
        error: { error: { detail: 'No se pudieron cargar los datos' } },
      });

      await anotar(campo('p-a', D2), '60');

      expect(servidor.actualizadas.length).toBe(1);
      expect(ultimoAviso()).toBe(
        'Se guardó, pero no se pudo actualizar la grilla: cambie de quincena o recargue para verla al día',
      );
    });

    it('si el guardado falla y la grilla también, no se dice que se guardó', async () => {
      await armar();
      servidor.rechazo = 'No se pudo guardar';
      servidor.grillaFalla = new HttpErrorResponse({ status: 500 });

      await anotar(campo('p-a', D2), '60');

      expect(ultimoAviso()).toBe('No se pudo guardar');
      expect(mensajes.some((m) => m.texto.includes('Se guardó'))).toBeFalse();
    });

    it('un 409 (ya existe ese día, alguien lo anotó mientras tanto): la grilla se vuelve a pedir y el campo muestra lo que hay', async () => {
      await armar();
      servidor.rechazo = 'Ya existe una recepción de este proveedor en esa fecha';
      servidor.modelo.dias['p-a'][D3] = { id: 'r-otro', litros: '30.00' }; // lo anotó otra persona

      await anotar(campo('p-a', D3), '40');

      expect(ultimoAviso()).toBe('Ya existe una recepción de este proveedor en esa fecha');
      expect(campo('p-a', D3).value).toBe('30');
      expect(campo('p-a', D3).classList).not.toContain('vacia');
    });

    it('después de guardar la celda deja de estar marcada como "escrito sin guardar"', async () => {
      await armar();
      const c = campo('p-a', D2);
      escribir(c, '60');
      expect(c.classList).toContain('pendiente');

      await salir(c);

      expect(servidor.actualizadas.length).toBe(1);
      expect(c.classList).not.toContain('pendiente');
    });

    it('terminado el guardado el campo vuelve a poder escribirse y la misma celda se puede guardar otra vez', async () => {
      await armar();
      const c = campo('p-a', D2);

      await anotar(c, '60');

      expect(c.readOnly).toBeFalse();
      expect(c.classList).not.toContain('guardando');
      await anotar(c, '70');
      expect(servidor.actualizadas.map((u) => u.cuerpo.cantidad_litros)).toEqual([60, 70]);
    });

    it('el aviso "Se guardó, pero..." dura 9 segundos: son dos renglones y hay que alcanzar a leerlos', async () => {
      await armar();
      const abrirAviso = spyOn(TestBed.inject(MatSnackBar), 'open').and.callThrough();
      servidor.grillaFalla = new HttpErrorResponse({ status: 500 });

      await anotar(campo('p-a', D2), '60');

      const llamadas = abrirAviso.calls.allArgs() as unknown as unknown[][];
      const aviso = llamadas.find(([texto]) => String(texto).startsWith('Se guardó, pero'));
      expect(aviso).toBeDefined();
      expect(aviso![2]).toEqual({ duration: 9000 });
    });

    it('en una liquidación en borrador no se pregunta, y después se dice que se recalculó', async () => {
      await armar();

      await anotar(campo('p-a', D1), '120');

      expect(dialogos).toEqual([]);
      expect(servidor.actualizadas).toEqual([{ id: 'r-a1', cuerpo: { cantidad_litros: 120 } }]);
      expect(ultimoAviso()).toBe('Ana Lechera, 01/06: 120 L guardados. Se recalculó la liquidación de este día.');
    });
  });

  // ------------------------------------------------------------------ guardar un día nuevo
  describe('anotar un día que no existía', () => {
    it('crea el día con la fecha y el proveedor de la celda y los litros: nada más', async () => {
      await armar();

      await anotar(campo('p-a', D3), '75,5');

      expect(servidor.creadas).toEqual([{ fecha: D3, proveedor_id: 'p-a', cantidad_litros: 75.5 }]);
      expect(servidor.actualizadas).toEqual([]);
      expect(ultimoAviso()).toBe('Ana Lechera, 03/06: 75,5 L guardados');
    });

    it('después el mismo campo es el del día creado, con sus litros y ya sin los trazos', async () => {
      await armar();
      const mismo = campo('p-a', D3);

      await anotar(mismo, '75');

      expect(campo('p-a', D3)).toBe(mismo); // el campo NO se cambió por otro: no se pierde el foco
      expect(mismo.value).toBe('75');
      expect(mismo.classList).not.toContain('vacia');
      expect(cambios).toBe(1);
    });

    it('dejar una celda vacía en blanco no hace nada ni dice nada', async () => {
      await armar();

      await anotar(campo('p-a', D3), '   ');

      expect(servidor.creadas).toEqual([]);
      expect(mensajes).toEqual([]);
      expect(campo('p-a', D3).value).toBe('');
    });
  });

  // ------------------------------------------------------------------ lo que no se guarda
  describe('lo que no se guarda', () => {
    it('texto que no son litros: no se manda, el campo vuelve a lo guardado y se dice por qué', async () => {
      await armar();

      await anotar(campo('p-a', D2), 'abc');

      expect(servidor.actualizadas).toEqual([]);
      expect(campo('p-a', D2).value).toBe('50,5');
      expect(ultimoAviso()).toBe('«abc» no son litros: escriba solo el número, por ejemplo 52 o 52,5');
    });

    it('lo ambiguo no se adivina: "1,500" no se lee ni como 1,5 ni como 1500', async () => {
      await armar();

      await anotar(campo('p-a', D2), '1,500');

      expect(servidor.actualizadas).toEqual([]);
      expect(ultimoAviso()).toContain('llevan máximo 2 decimales');
    });

    it('cero no es una recepción', async () => {
      await armar();

      await anotar(campo('p-a', D2), '0');

      expect(servidor.actualizadas).toEqual([]);
      expect(ultimoAviso()).toBe('Los litros tienen que ser más de 0');
      expect(campo('p-a', D2).value).toBe('50,5');
    });

    it('dejar un día con registro en blanco NO lo borra: vuelve el valor y se dice cómo se quita', async () => {
      await armar();

      await anotar(campo('p-a', D2), '');

      expect(servidor.actualizadas).toEqual([]);
      expect(campo('p-a', D2).value).toBe('50,5');
      expect(ultimoAviso()).toContain('no borra el día');
      expect(ultimoAviso()).toContain('Eliminar');
    });


    it('el consejo de la celda en blanco no manda a Eliminar a quien no puede eliminar', async () => {
      await armar(['recepcion:crear', 'recepcion:editar']);

      await anotar(campo('p-a', D2), '');

      expect(ultimoAviso()).toBe(
        'Dejar la celda en blanco no borra el día. Quitarlo le toca a un Administrador de la empresa.',
      );
      expect(ultimoAviso()).not.toContain('Eliminar');
    });

    it('si el servidor dice que están en firme y no trae su aviso, se dice el de siempre', async () => {
      await armar();
      Object.assign(servidor.modelo.dias['p-a'][D2], {
        leche_pagada: true,
        campos_bloqueados: ['cantidad_litros'],
        candado_aviso: null,
        liquidacion_estado: 'pagada',
      });

      await anotar(campo('p-a', D2), '60');

      expect(servidor.actualizadas).toEqual([]);
      expect(ultimoAviso()).toBe(
        'Los litros de este día quedaron en firme: ábralo para ver qué se puede corregir',
      );
    });

    it('un día cuyo FLETE está en una liquidación aprobada también se confirma antes (cuenta cualquiera de los tres estados)', async () => {
      await armar();
      respuestaDelDialogo = false;
      Object.assign(servidor.modelo.dias['p-a'][D2], { liquidacion_estado_flete: 'aprobada' });

      await anotar(campo('p-a', D2), '60');

      expect(dialogos.length).toBe(1);
      expect(dialogos[0].componente).toBe(ConfirmDialog);
      expect(servidor.actualizadas).toEqual([]);
      expect(campo('p-a', D2).value).toBe('50,5');
    });

    it('cerrar el diálogo de confirmación sin elegir (clic fuera, Esc) NO confirma', async () => {
      await armar();
      respuestaDelDialogo = undefined; // afterClosed() sin resultado

      await anotar(campo('p-b', D3), '90');

      expect(dialogos.length).toBe(1);
      expect(servidor.actualizadas).toEqual([]);
      expect(campo('p-b', D3).value).toBe('80'); // vuelve a lo guardado
      expect(cambios).toBe(0);
    });

    it('si la ventana pierde el foco con el campo a medias, NO se guarda: al volver se sigue escribiendo', async () => {
      await armar();
      const c = campo('p-a', D2);
      c.focus();
      expect(document.activeElement).toBe(c);
      const hasFocus = spyOn(document, 'hasFocus').and.returnValue(false);
      escribir(c, '5');

      await salir(c); // el blur de la ventana (cambio de app)

      expect(servidor.actualizadas).toEqual([]);
      expect(servidor.creadas).toEqual([]);
      expect(c.classList).toContain('pendiente');

      hasFocus.and.returnValue(true);
      escribir(c, '52');
      await salir(c);
      expect(servidor.actualizadas.map((u) => u.cuerpo.cantidad_litros)).toEqual([52]);
      c.blur();
    });

    it('si un diálogo tiene el foco (la confirmación de otra celda) el campo que se quedó sin foco NO guarda su "5" a medias', async () => {
      await armar();
      const c = campo('p-a', D2);
      escribir(c, '5');
      abiertos.push({}); // hay un diálogo abierto

      await salir(c);

      expect(servidor.actualizadas).toEqual([]);
      expect(c.classList).toContain('pendiente');

      abiertos.length = 0; // se cierra, el foco vuelve al campo y se termina de escribir
      escribir(c, '52');
      await salir(c);
      expect(servidor.actualizadas.map((u) => u.cuerpo.cantidad_litros)).toEqual([52]);
    });

    it('Esc deshace lo escrito y no guarda nada', async () => {
      await armar();
      const c = campo('p-a', D2);
      escribir(c, '999');
      expect(c.classList).toContain('pendiente');

      c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await asentar();

      expect(c.value).toBe('50,5');
      expect(c.classList).not.toContain('pendiente');
      expect(servidor.actualizadas).toEqual([]);
    });

    it('un error del servidor se muestra tal cual, el campo vuelve a lo guardado y no hay "guardado"', async () => {
      await armar();
      servidor.rechazo = 'Ya existe una recepción de este proveedor en esa fecha';

      await anotar(campo('p-a', D2), '60');

      expect(campo('p-a', D2).value).toBe('50,5');
      expect(ultimoAviso()).toBe('Ya existe una recepción de este proveedor en esa fecha');
      expect(mensajes.some((m) => m.texto.includes('guardados'))).toBeFalse();
      // Tras un fallo se vuelve a pedir la grilla y el listado se entera: con un 409 lo que se
      // veía estaba viejo, y con un tiempo agotado no se sabe si se guardó.
      expect(servidor.grillas).toBe(2);
      expect(cambios).toBe(1);
    });

    it('un error al crear tampoco deja el día a medias en la pantalla', async () => {
      await armar();
      servidor.rechazo = 'Ese proveedor está retirado';

      await anotar(campo('p-a', D3), '40');

      expect(campo('p-a', D3).value).toBe('');
      expect(campo('p-a', D3).classList).toContain('vacia');
      expect(ultimoAviso()).toBe('Ese proveedor está retirado');
    });
  });

  // ------------------------------------------------------------------ los candados
  describe('el candado del servidor y la liquidación aprobada', () => {
    it('si el servidor dice que los litros están en firme (la grilla estaba vieja), no se escribe y se muestra SU aviso', async () => {
      await armar();
      // Entre que se cargó la grilla y ahora alguien pagó la leche de ese día.
      Object.assign(servidor.modelo.dias['p-a'][D2], {
        leche_pagada: true,
        campos_bloqueados: ['cantidad_litros'],
        candado_aviso: AVISO_EN_FIRME,
        liquidacion_estado: 'pagada',
      });

      await anotar(campo('p-a', D2), '60');

      expect(servidor.actualizadas).toEqual([]);
      expect(ultimoAviso()).toBe(AVISO_EN_FIRME);
      expect(campo('p-a', D2)).toBeNull(); // al refrescar, la celda ya es el botón con candado
      expect(celdaTd('p-a', D2).querySelector('button.celda-btn.pagada')).not.toBeNull();
    });

    it('en una liquidación APROBADA se confirma antes, con lo que va a pasar, y sin confirmar no se guarda', async () => {
      await armar();
      respuestaDelDialogo = false;

      await anotar(campo('p-b', D3), '90');

      expect(dialogos.length).toBe(1);
      expect(dialogos[0].componente).toBe(ConfirmDialog);
      const datos = dialogos[0].datos as { mensaje: string; accion: string; peligro: boolean };
      expect(datos.mensaje).toBe(
        'Los litros de Beto Cobrada del 03/06/2026 pasarían de 80 L a 90 L. ' +
          'Este día ya está en una liquidación aprobada. Si lo cambia, esa liquidación vuelve a ' +
          'borrador y se recalcula: tendrá que revisarla y aprobarla otra vez.',
      );
      expect(datos.accion).toBe('Cambiar los litros');
      expect(servidor.actualizadas).toEqual([]);
      expect(campo('p-b', D3).value).toBe('80'); // vuelve a lo guardado
      expect(cambios).toBe(0);
    });

    it('confirmada, se guarda y se dice que la liquidación volvió a borrador (lo que dice el servidor)', async () => {
      await armar();
      respuestaDelDialogo = true;
      servidor.devueltas = [{ id: 'liq-r-b3', tipo: 'proveedor' }];

      await anotar(campo('p-b', D3), '90');

      expect(servidor.actualizadas).toEqual([{ id: 'r-b3', cuerpo: { cantidad_litros: 90 } }]);
      expect(ultimoAviso()).toBe(
        'Beto Cobrada, 03/06: 90 L guardados. La liquidación de la leche de este día volvió a borrador: ' +
          'revísela y apruébela otra vez.',
      );
      expect(campo('p-b', D3).value).toBe('90');
    });

    it('un día nuevo no pregunta nada: no entra a ninguna liquidación', async () => {
      await armar();

      await anotar(campo('p-b', D2), '30');

      expect(dialogos).toEqual([]);
      expect(servidor.creadas.length).toBe(1);
    });
  });

  // ------------------------------------------------------------------ con teclado
  describe('con el teclado', () => {
    const tecla = (c: HTMLInputElement, key: string, extra: KeyboardEventInit = {}): KeyboardEvent => {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
      c.dispatchEvent(e);
      return e;
    };

    it('Enter pasa al campo de abajo (el de la misma columna) y por eso guarda el de arriba', async () => {
      await armar();
      const arriba = campo('p-a', D3);
      const abajo = campo('p-b', D3);
      const foco = spyOn(abajo, 'focus');
      escribir(arriba, '45');

      const e = tecla(arriba, 'Enter');
      expect(e.defaultPrevented).toBeTrue();
      expect(foco).toHaveBeenCalled();
      await salir(arriba); // el navegador quita el foco del de arriba al pasar al de abajo

      expect(servidor.creadas).toEqual([{ fecha: D3, proveedor_id: 'p-a', cantidad_litros: 45 }]);
    });

    it('Mayús+Enter y las flechas se mueven en la misma columna, y en el último suelta el foco', async () => {
      await armar();
      const arriba = campo('p-a', D2);
      const abajo = campo('p-b', D2);
      const focoAbajo = spyOn(abajo, 'focus');
      const focoArriba = spyOn(arriba, 'focus');
      const soltar = spyOn(abajo, 'blur');

      tecla(arriba, 'ArrowDown');
      expect(focoAbajo).toHaveBeenCalledTimes(1);
      tecla(abajo, 'ArrowUp');
      expect(focoArriba).toHaveBeenCalledTimes(1);
      tecla(abajo, 'Enter', { shiftKey: true });
      expect(focoArriba).toHaveBeenCalledTimes(2);
      tecla(abajo, 'ArrowDown');
      expect(soltar).toHaveBeenCalled();
    });

    it('mientras el lápiz o el teclado arman una palabra (composición) el Enter no se toca', async () => {
      await armar();
      const c = campo('p-a', D2);
      const foco = spyOn(campo('p-b', D2), 'focus');

      const e = tecla(c, 'Enter', { isComposing: true });

      expect(e.defaultPrevented).toBeFalse();
      expect(foco).not.toHaveBeenCalled();
    });


    it('las flechas, Esc y F2 no dejan que el navegador haga lo suyo (preventDefault)', async () => {
      await armar();
      const arriba = campo('p-a', D2);
      const abajo = campo('p-b', D2);
      spyOn(arriba, 'focus');
      spyOn(abajo, 'focus');
      spyOn(arriba, 'blur');

      expect(tecla(arriba, 'ArrowDown').defaultPrevented).toBeTrue();
      expect(tecla(abajo, 'ArrowUp').defaultPrevented).toBeTrue();
      expect(tecla(arriba, 'Escape').defaultPrevented).toBeTrue();
      expect(tecla(arriba, 'F2').defaultPrevented).toBeTrue();
      await asentar();
    });

    it('Esc, además de deshacer lo escrito, suelta el foco del campo', async () => {
      await armar();
      const c = campo('p-a', D2);
      const soltar = spyOn(c, 'blur');
      escribir(c, '999');

      tecla(c, 'Escape');

      expect(soltar).toHaveBeenCalledTimes(1);
    });

    const abrirConLitrosPendientes = async (tecleo: string, extra: KeyboardEventInit): Promise<void> => {
      await armar();
      const c = campo('p-a', D2);
      escribir(c, '61');

      tecla(c, tecleo, extra);
      await asentar();

      // Primero se guardó lo escrito y DESPUÉS se abrió el día, ya con los litros nuevos.
      expect(servidor.actualizadas.map((u) => u.cuerpo.cantidad_litros)).toEqual([61]);
      expect(dialogos.length).toBe(1);
      expect((dialogos[0].datos as { item: Recepcion }).item.cantidad_litros).toBe('61');
    };

    it('F2 con litros escritos y sin guardar los GUARDA primero y abre el día con los litros nuevos', async () => {
      await abrirConLitrosPendientes('F2', {});
    });

    it('Alt+Enter con litros escritos y sin guardar los GUARDA primero y abre el día con los litros nuevos', async () => {
      await abrirConLitrosPendientes('Enter', { altKey: true });
    });

    it('al enfocar un campo con algo escrito sin guardar NO se selecciona todo (lo que sigue se suma)', async () => {
      await armar();
      const c = campo('p-a', D2);
      escribir(c, '5'); // pendiente
      const seleccionar = spyOn(c, 'select');

      c.dispatchEvent(new FocusEvent('focus'));
      await new Promise((r) => setTimeout(r, 5));

      expect(seleccionar).not.toHaveBeenCalled();
    });

    it('al llegar al campo la selección espera un turno: en el celular el toque coloca el cursor DESPUÉS de enfocar', async () => {
      await armar();
      const c = campo('p-a', D1);
      const seleccionar = spyOn(c, 'select');

      c.dispatchEvent(new FocusEvent('focus'));
      expect(seleccionar).not.toHaveBeenCalled(); // no en el mismo turno que el foco

      await new Promise((r) => setTimeout(r, 5));
      expect(seleccionar).toHaveBeenCalledTimes(1);
    });

    it('lo escrito sin guardar se marca en ámbar y se desmarca al volver a lo guardado', async () => {
      await armar();
      const c = campo('p-a', D2);

      escribir(c, '51');
      expect(c.classList).toContain('pendiente');
      escribir(c, '50,5');
      expect(c.classList).not.toContain('pendiente');
    });

    it('al llegar al campo se selecciona lo que tiene, para que lo escrito lo reemplace', async () => {
      await armar();
      const c = campo('p-a', D1);
      const seleccionar = spyOn(c, 'select');

      c.dispatchEvent(new FocusEvent('focus'));
      await new Promise((r) => setTimeout(r, 5));

      expect(seleccionar).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------ carreras
  describe('carreras', () => {
    it('el clic del ícono justo después de escribir ESPERA al guardado y abre el día con los litros nuevos', async () => {
      await armar();
      servidor.enCamino = new Subject<Recepcion>();
      const c = campo('p-a', D2);
      escribir(c, '60');
      c.dispatchEvent(new FocusEvent('blur')); // salir del campo: empieza a guardar
      await asentar();
      expect(servidor.actualizadas.length).toBe(1);

      (celdaTd('p-a', D2).querySelector('button.abrir-dia') as HTMLButtonElement).click(); // el clic viene detrás
      await asentar();
      expect(dialogos.length).toBe(0); // todavía no: el guardado no ha terminado

      servidor.enCamino.next({ id: 'r-a2', liquidaciones_devueltas_a_borrador: [] } as unknown as Recepcion);
      servidor.enCamino.complete();
      await asentar();

      expect(dialogos.length).toBe(1);
      expect((dialogos[0].datos as { item: Recepcion }).item.cantidad_litros).toBe('60');
    });

    it('lo mismo con un día que se acaba de crear: abre ESE día, no "nueva recepción" encima', async () => {
      await armar();
      servidor.enCamino = new Subject<Recepcion>();
      const c = campo('p-a', D3);
      escribir(c, '45');
      c.dispatchEvent(new FocusEvent('blur'));
      await asentar();

      (celdaTd('p-a', D3).querySelector('button.abrir-dia') as HTMLButtonElement).click();
      await asentar();
      servidor.enCamino.next({ id: 'r-nuevo', liquidaciones_devueltas_a_borrador: [] } as unknown as Recepcion);
      servidor.enCamino.complete();
      await asentar();

      expect(dialogos.length).toBe(1);
      const datos = dialogos[0].datos as { item?: Recepcion; prefill?: unknown };
      expect(datos.prefill).toBeUndefined();
      expect(datos.item?.id).toBe('r-nuevo');
    });

    it('un campo con un guardado en camino ignora un segundo "salir" y no manda dos veces', async () => {
      await armar();
      const c = campo('p-a', D2);
      escribir(c, '60');

      const primero = fixture.componentInstance.confirmarLitros(
        fixture.componentInstance.grilla()!.filas[0],
        D2,
        c,
      );
      const segundo = fixture.componentInstance.confirmarLitros(
        fixture.componentInstance.grilla()!.filas[0],
        D2,
        c,
      );
      await Promise.all([primero, segundo]);
      await asentar();

      expect(servidor.actualizadas.length).toBe(1);
    });


    it('una respuesta vieja que llega primero no apaga la barra de carga mientras la nueva sigue en camino', async () => {
      await armar();
      servidor.diferida = [];
      const vieja = servidor.construirGrilla();
      const nueva = servidor.construirGrilla();

      void fixture.componentInstance.cargar();
      void fixture.componentInstance.cargar();
      expect(servidor.diferida.length).toBe(2);
      servidor.diferida[0].next(vieja); // la de la quincena anterior llega primero
      await asentar();

      expect(fixture.componentInstance.cargando()).toBeTrue(); // la nueva todavía no llega

      servidor.diferida[1].next(nueva);
      await asentar();
      expect(fixture.componentInstance.cargando()).toBeFalse();
    });

    it('la grilla que llega de última manda: una respuesta vieja no pisa a la nueva', async () => {
      await armar();
      servidor.diferida = [];
      const antes = servidor.construirGrilla();
      const despues = servidor.construirGrilla();
      (despues as unknown as { total_litros: string }).total_litros = '999';

      void fixture.componentInstance.cargar();
      void fixture.componentInstance.cargar();
      expect(servidor.diferida.length).toBe(2);
      servidor.diferida[1].next(despues);
      await asentar();
      servidor.diferida[0].next(antes);
      await asentar();

      expect(fixture.componentInstance.grilla()?.total_litros).toBe('999');
      expect(fixture.componentInstance.cargando()).toBeFalse();
    });
  });
});
