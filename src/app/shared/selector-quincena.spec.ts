import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { dateToIso } from './date-utils';
import { etiquetaDelMes } from './quincena';
import { SelectorQuincena } from './selector-quincena';

/**
 * EL FILTRO POR QUINCENA: el mismo mes con flechas y los mismos dos botones de "Generar
 * liquidaciones", pero fijando las casillas Desde y Hasta de la pantalla.
 *
 * Lo que se mide es lo que el dueño ve y lo que la pantalla recibe: qué botón queda marcado,
 * qué mes dice la etiqueta, qué fechas quedan en las casillas, y CUÁNTAS VECES se entera la
 * pantalla (una sola: dos avisos eran dos consultas, y la última en llegar se quedaba la lista).
 */
@Component({
  imports: [SelectorQuincena],
  template: `<app-selector-quincena [desde]="desde" [hasta]="hasta" />`,
})
class Anfitrion {
  readonly desde = new FormControl<Date | null>(null);
  readonly hasta = new FormControl<Date | null>(null);
}

const dia = (anio: number, mes: number, d: number): Date => new Date(anio, mes, d);
const texto = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('SelectorQuincena', () => {
  let fixture: ComponentFixture<Anfitrion>;
  let anfitrion: Anfitrion;

  const armar = async (desde: Date | null = null, hasta: Date | null = null): Promise<void> => {
    await TestBed.configureTestingModule({ imports: [Anfitrion, NoopAnimationsModule] }).compileComponents();
    fixture = TestBed.createComponent(Anfitrion);
    anfitrion = fixture.componentInstance;
    // Como llegan de la sesión: ya puestas, sin avisar, antes de que el selector exista.
    anfitrion.desde.setValue(desde, { emitEvent: false });
    anfitrion.hasta.setValue(hasta, { emitEvent: false });
    fixture.detectChanges();
  };

  const el = (): HTMLElement => fixture.nativeElement;
  const etiqueta = (): string => texto(el().querySelector('.mes'));
  const botones = (): HTMLButtonElement[] => Array.from(el().querySelectorAll<HTMLButtonElement>('.q-btn'));
  const flechas = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('.selector-mes button'));
  const marcada = (): number | null => {
    const i = botones().findIndex((b) => b.classList.contains('activa'));
    return i === -1 ? null : i + 1;
  };
  const tocar = (boton: HTMLButtonElement): void => {
    boton.click();
    fixture.detectChanges();
  };
  const fechasPuestas = (): [string | null, string | null] => [
    dateToIso(anfitrion.desde.value),
    dateToIso(anfitrion.hasta.value),
  ];

  it('sin fechas: dice el mes de hoy y no marca ninguna quincena', async () => {
    await armar();
    const hoy = new Date();

    expect(etiqueta()).toBe(etiquetaDelMes({ anio: hoy.getFullYear(), mes: hoy.getMonth() }));
    expect(marcada()).toBeNull();
    expect(texto(botones()[0])).toContain('1.ª quincena');
    expect(texto(botones()[0])).toContain('días 1 al 15');
    expect(texto(botones()[1])).toContain('2.ª quincena');
  });

  it('la 2.ª dice hasta qué día llega ese mes: 30, 31, 28 o 29', async () => {
    await armar(dia(2026, 8, 5), dia(2026, 8, 20));
    expect(texto(botones()[1])).toContain('días 16 al 30');

    tocar(flechas()[1]); // octubre
    expect(etiqueta()).toBe('octubre 2026');
    expect(texto(botones()[1])).toContain('días 16 al 31');

    await TestBed.resetTestingModule();
    await armar(dia(2026, 1, 3), dia(2026, 1, 9));
    expect(texto(botones()[1])).toContain('días 16 al 28');

    await TestBed.resetTestingModule();
    await armar(dia(2028, 1, 3), dia(2028, 1, 9));
    expect(texto(botones()[1])).toContain('días 16 al 29');
  });

  it('tocar la 1.ª fija del 1 al 15 del mes que se ve y la marca', async () => {
    await armar(dia(2026, 8, 5), dia(2026, 8, 20)); // un rango suelto de septiembre
    expect(etiqueta()).toBe('septiembre 2026');
    expect(marcada()).toBeNull();

    tocar(botones()[0]);

    expect(fechasPuestas()).toEqual(['2026-09-01', '2026-09-15']);
    expect(marcada()).toBe(1);
    expect(botones()[0].getAttribute('aria-pressed')).toBe('true');
    expect(botones()[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('tocar la 2.ª fija del 16 a fin de mes', async () => {
    await armar(dia(2026, 8, 5), dia(2026, 8, 20));

    tocar(botones()[1]);

    expect(fechasPuestas()).toEqual(['2026-09-16', '2026-09-30']);
    expect(marcada()).toBe(2);
    expect(botones()[1].getAttribute('aria-pressed')).toBe('true');
    expect(botones()[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('LA PANTALLA SE ENTERA UNA SOLA VEZ: Hasta avisa, Desde no', async () => {
    await armar(dia(2026, 8, 5), dia(2026, 8, 20));
    let avisosDeDesde = 0;
    let avisosDeHasta = 0;
    anfitrion.desde.valueChanges.subscribe(() => avisosDeDesde++);
    anfitrion.hasta.valueChanges.subscribe(() => avisosDeHasta++);

    tocar(botones()[0]);

    expect(avisosDeDesde).toBe(0);
    expect(avisosDeHasta).toBe(1);
    // Y cuando avisa, las dos fechas ya son las nuevas.
    let alAvisar: [string | null, string | null] | null = null;
    anfitrion.hasta.valueChanges.subscribe(() => (alAvisar = fechasPuestas()));
    tocar(botones()[1]);
    expect(alAvisar as unknown).toEqual(['2026-09-16', '2026-09-30']);
  });

  it('tocar la quincena ya marcada quita el filtro y la etiqueta se queda en ese mes', async () => {
    await armar(dia(2026, 8, 1), dia(2026, 8, 15));
    expect(marcada()).toBe(1);

    tocar(botones()[0]);

    expect(fechasPuestas()).toEqual([null, null]);
    expect(marcada()).toBeNull();
    expect(etiqueta()).toBe('septiembre 2026');
    expect(botones().every((b) => b.getAttribute('aria-pressed') === 'false')).toBeTrue();
  });

  it('con una quincena marcada, las flechas la llevan al mes de al lado', async () => {
    await armar(dia(2026, 8, 16), dia(2026, 8, 30)); // 2.ª de septiembre
    expect(marcada()).toBe(2);

    tocar(flechas()[0]); // ‹
    expect(etiqueta()).toBe('agosto 2026');
    expect(fechasPuestas()).toEqual(['2026-08-16', '2026-08-31']);
    expect(marcada()).toBe(2);

    tocar(flechas()[1]); // ›
    tocar(flechas()[1]);
    expect(etiqueta()).toBe('octubre 2026');
    expect(fechasPuestas()).toEqual(['2026-10-16', '2026-10-31']);
  });

  it('las flechas cruzan el año con la quincena puesta', async () => {
    await armar(dia(2026, 0, 1), dia(2026, 0, 15)); // 1.ª de enero

    tocar(flechas()[0]);
    expect(etiqueta()).toBe('diciembre 2025');
    expect(fechasPuestas()).toEqual(['2025-12-01', '2025-12-15']);

    tocar(flechas()[1]);
    expect(etiqueta()).toBe('enero 2026');
    expect(fechasPuestas()).toEqual(['2026-01-01', '2026-01-15']);
    tocar(flechas()[1]);
    expect(etiqueta()).toBe('febrero 2026');
    expect(fechasPuestas()).toEqual(['2026-02-01', '2026-02-15']);
  });

  it('SIN quincena marcada las flechas solo mueven la etiqueta: las fechas no se tocan', async () => {
    await armar(dia(2026, 8, 5), dia(2026, 8, 20));
    let avisos = 0;
    anfitrion.desde.valueChanges.subscribe(() => avisos++);
    anfitrion.hasta.valueChanges.subscribe(() => avisos++);

    tocar(flechas()[1]);
    tocar(flechas()[1]);

    expect(etiqueta()).toBe('noviembre 2026');
    expect(fechasPuestas()).toEqual(['2026-09-05', '2026-09-20']);
    expect(avisos).toBe(0);
    expect(marcada()).toBeNull();

    // Y el botón se aplica al mes que se ve.
    tocar(botones()[1]);
    expect(fechasPuestas()).toEqual(['2026-11-16', '2026-11-30']);
    expect(marcada()).toBe(2);
  });

  it('las flechas sin quincena y luego un botón: las flechas siguientes mueven la quincena desde ESE mes, no desde el que dejaron antes', async () => {
    await armar(dia(2026, 8, 5), dia(2026, 8, 20));
    tocar(flechas()[1]);
    tocar(flechas()[1]); // noviembre, sin quincena marcada
    tocar(botones()[0]); // 1.ª de noviembre
    expect(etiqueta()).toBe('noviembre 2026');

    tocar(flechas()[0]); // ‹

    expect(etiqueta()).toBe('octubre 2026');
    expect(fechasPuestas()).toEqual(['2026-10-01', '2026-10-15']);
    expect(marcada()).toBe(1);
  });

  it('un rango que cruza de mes (1 de septiembre al 15 de octubre) NO marca ninguna quincena', async () => {
    await armar(dia(2026, 8, 1), dia(2026, 9, 15));

    expect(marcada()).toBeNull();
    expect(etiqueta()).toBe('septiembre 2026');
  });

  it('unas fechas escritas a mano que son justo una quincena la marcan y mueven el mes', async () => {
    await armar();

    anfitrion.desde.setValue(dia(2026, 1, 16));
    anfitrion.hasta.setValue(dia(2026, 1, 28));
    fixture.detectChanges();

    expect(marcada()).toBe(2);
    expect(etiqueta()).toBe('febrero 2026');
    expect(texto(botones()[1])).toContain('días 16 al 28');
  });

  it('las fechas que vienen restauradas de la sesión ya llegan marcadas', async () => {
    await armar(dia(2026, 5, 16), dia(2026, 5, 30));

    expect(marcada()).toBe(2);
    expect(etiqueta()).toBe('junio 2026');
  });

  it('un rango suelto no marca nada y la etiqueta sigue a Desde', async () => {
    await armar(dia(2026, 5, 3), dia(2026, 6, 9));

    expect(marcada()).toBeNull();
    expect(etiqueta()).toBe('junio 2026');
  });

  it('un cambio de afuera desecha lo que dejaron las flechas: el mes vuelve a seguir a las fechas', async () => {
    await armar();
    tocar(flechas()[0]);
    tocar(flechas()[0]);

    anfitrion.desde.setValue(dia(2026, 7, 5));
    anfitrion.hasta.setValue(dia(2026, 7, 20));
    fixture.detectChanges();

    expect(etiqueta()).toBe('agosto 2026');
  });

  it('quitar el filtro desde afuera (casillas vacías) no deja una quincena marcada', async () => {
    await armar(dia(2026, 8, 1), dia(2026, 8, 15));
    expect(marcada()).toBe(1);

    anfitrion.desde.setValue(null);
    anfitrion.hasta.setValue(null);
    fixture.detectChanges();

    expect(marcada()).toBeNull();
  });

  it('una fecha ilegible en Desde no deja la etiqueta en "undefined NaN": cae al mes de hoy', async () => {
    await armar(new Date(NaN), dia(2026, 8, 15));
    const hoy = new Date();

    expect(etiqueta()).toBe(etiquetaDelMes({ anio: hoy.getFullYear(), mes: hoy.getMonth() }));
    expect(etiqueta()).not.toContain('undefined');
    expect(etiqueta()).not.toContain('NaN');
    expect(marcada()).toBeNull();
    expect(texto(botones()[0])).toContain('días 1 al 15');
  });

  it('se llama "Quincena:" y, sin ninguna marcada, el mes se ve atenuado y dice que no es un filtro', async () => {
    await armar();

    expect(texto(el().querySelector('.etiqueta'))).toBe('Quincena:');
    const mes = el().querySelector('.mes')!;
    expect(mes.classList).toContain('sin-marcar');
    expect(mes.getAttribute('title')).toBe('Sin filtro de fechas: elija una quincena');

    tocar(botones()[0]);

    expect(el().querySelector('.mes')!.classList).not.toContain('sin-marcar');
    expect(el().querySelector('.mes')!.getAttribute('title')).toBeNull();
  });

  it('las flechas tienen nombre para quien no las ve', async () => {
    await armar();
    expect(flechas().map((f) => f.getAttribute('aria-label'))).toEqual(['Mes anterior', 'Mes siguiente']);
  });
});
