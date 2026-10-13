import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { RangoDeFechas, fechaIlegible, problemaDelRango } from './rango-de-fechas';

/**
 * LAS CASILLAS «DESDE» Y «HASTA»: los mismos controles que usa el selector de quincena.
 *
 * Lo que se mide es lo que la pantalla recibe y lo que el dueño ve: que las casillas muestren
 * lo que ya tienen los controles (restaurado de la sesión, o puesto por un botón de quincena),
 * que elegir una fecha cambie el control, que la X lo quite y deje el rango abierto, y que el
 * aviso de "al revés" salga y se vaya.
 */
@Component({
  imports: [RangoDeFechas],
  template: `<app-rango-de-fechas [desde]="desde" [hasta]="hasta" />`,
})
class Anfitrion {
  readonly desde = new FormControl<Date | null>(null);
  readonly hasta = new FormControl<Date | null>(null);
}

const texto = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('RangoDeFechas', () => {
  let fixture: ComponentFixture<Anfitrion>;
  let anfitrion: Anfitrion;

  const armar = async (desde: Date | null = null, hasta: Date | null = null): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [Anfitrion, NoopAnimationsModule],
      providers: [provideNativeDateAdapter(), { provide: MAT_DATE_LOCALE, useValue: 'es-CO' }],
    }).compileComponents();
    fixture = TestBed.createComponent(Anfitrion);
    anfitrion = fixture.componentInstance;
    anfitrion.desde.setValue(desde, { emitEvent: false });
    anfitrion.hasta.setValue(hasta, { emitEvent: false });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const el = (): HTMLElement => fixture.nativeElement;
  const casilla = (clase: 'fecha-desde' | 'fecha-hasta'): HTMLInputElement =>
    el().querySelector<HTMLInputElement>(`input.${clase}`)!;
  const aviso = (): HTMLElement | null => el().querySelector('.aviso-al-reves');
  const asentar = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('trae las dos casillas rotuladas y sin nada puesto cuando no hay fechas', async () => {
    await armar();

    expect(texto(el())).toContain('Desde');
    expect(texto(el())).toContain('Hasta');
    expect(casilla('fecha-desde').value).toBe('');
    expect(casilla('fecha-hasta').value).toBe('');
    expect(el().querySelector('.quitar')).toBeNull(); // nada que quitar
    expect(aviso()).toBeNull();
  });

  it('muestra las fechas que ya traen los controles (la sesión restaurada, o un botón de quincena)', async () => {
    await armar(new Date(2026, 8, 16), new Date(2026, 8, 30));

    expect(casilla('fecha-desde').value).toBe('16/9/2026');
    expect(casilla('fecha-hasta').value).toBe('30/9/2026');
    expect(el().querySelectorAll('.quitar').length).toBe(2);

    anfitrion.desde.setValue(new Date(2026, 9, 1));
    anfitrion.hasta.setValue(new Date(2026, 9, 15));
    await asentar();
    expect(casilla('fecha-desde').value).toBe('1/10/2026');
    expect(casilla('fecha-hasta').value).toBe('15/10/2026');
  });

  it('escribir una fecha mueve el control', async () => {
    await armar();

    casilla('fecha-desde').value = '5/9/2026';
    casilla('fecha-desde').dispatchEvent(new Event('input'));
    await asentar();

    expect(anfitrion.desde.value).not.toBeNull();
    expect(anfitrion.desde.value!.getFullYear()).toBe(2026);
  });

  it('la X de cada casilla la quita sin tocar la otra, y desaparece', async () => {
    await armar(new Date(2026, 8, 5), new Date(2026, 8, 20));

    (el().querySelector('.quitar-desde') as HTMLButtonElement).click();
    await asentar();

    expect(anfitrion.desde.value).toBeNull();
    expect(anfitrion.hasta.value).toEqual(new Date(2026, 8, 20));
    expect(el().querySelector('.quitar-desde')).toBeNull();
    expect(el().querySelector('.quitar-hasta')).not.toBeNull();
    expect(casilla('fecha-desde').value).toBe('');
  });

  it('las X tienen nombre para quien no las ve', async () => {
    await armar(new Date(2026, 8, 5), new Date(2026, 8, 20));

    expect(el().querySelector('.quitar-desde')!.getAttribute('aria-label')).toBe('Quitar la fecha «Desde»');
    expect(el().querySelector('.quitar-hasta')!.getAttribute('aria-label')).toBe('Quitar la fecha «Hasta»');
  });

  describe('al revés', () => {
    it('«Desde» posterior a «Hasta» dice la frase, como alerta, y al corregir se va', async () => {
      await armar(new Date(2026, 8, 20), new Date(2026, 8, 5));

      expect(texto(aviso())).toBe('«Desde» es posterior a «Hasta»: corrija las fechas.');
      expect(aviso()!.getAttribute('role')).toBe('alert');

      anfitrion.hasta.setValue(new Date(2026, 8, 25));
      await asentar();
      expect(aviso()).toBeNull();
    });

    it('sale también cuando una de las fechas cambia después de armada la pantalla', async () => {
      await armar(new Date(2026, 8, 5), new Date(2026, 8, 20));
      expect(aviso()).toBeNull();

      anfitrion.desde.setValue(new Date(2026, 9, 1));
      await asentar();

      expect(aviso()).not.toBeNull();
    });

    it('con una sola punta no hay aviso, y el mismo día tampoco', async () => {
      await armar(new Date(2026, 8, 20), null);
      expect(aviso()).toBeNull();

      anfitrion.hasta.setValue(new Date(2026, 8, 20));
      await asentar();
      expect(aviso()).toBeNull();
    });
  });

  /** Escribe a mano en la casilla, como lo hace quien teclea (el control se entera por el evento `input`). */
  const escribir = async (clase: 'fecha-desde' | 'fecha-hasta', texto: string): Promise<void> => {
    casilla(clase).value = texto;
    casilla(clase).dispatchEvent(new Event('input'));
    await asentar();
  };

  describe('un texto que no se entiende como fecha', () => {
    it('«Desde»: el control queda en null pero se DICE cuál es la que no se entiende, y la X sale para borrarla', async () => {
      await armar(null, new Date(2026, 8, 20));

      await escribir('fecha-desde', 'hola');

      expect(anfitrion.desde.value).toBeNull();
      expect(anfitrion.desde.hasError('matDatepickerParse')).toBeTrue();
      expect(texto(el().querySelector('.aviso-ilegible'))).toBe(
        'No se entiende la fecha «Desde»: corríjala o elíjala del calendario.',
      );
      expect(el().querySelector('.aviso-ilegible')!.getAttribute('role')).toBe('alert');
      expect(el().querySelectorAll('.aviso-ilegible').length).toBe(1);
      // Sin esto la casilla traía texto y no había cómo borrarlo con un toque (la X solo salía con fecha).
      expect(el().querySelector('.quitar-desde')).not.toBeNull();
      expect(casilla('fecha-desde').value).toBe('hola');
    });

    it('«Hasta»: lo mismo, con su propio nombre', async () => {
      await armar(new Date(2026, 8, 5), null);

      await escribir('fecha-hasta', '31/02/2026');

      expect(texto(el().querySelector('.aviso-ilegible'))).toBe(
        'No se entiende la fecha «Hasta»: corríjala o elíjala del calendario.',
      );
      expect(el().querySelector('.quitar-hasta')).not.toBeNull();
      expect(el().querySelector('.quitar-desde')).not.toBeNull(); // la otra tiene su fecha y su X
    });

    it('la X borra el texto, el aviso se va, la X también, y la otra fecha no se toca', async () => {
      await armar(new Date(2026, 8, 5), null);
      await escribir('fecha-hasta', 'hola');

      (el().querySelector('.quitar-hasta') as HTMLButtonElement).click();
      await asentar();

      expect(casilla('fecha-hasta').value).toBe('');
      expect(anfitrion.hasta.hasError('matDatepickerParse')).toBeFalse();
      expect(el().querySelector('.aviso-ilegible')).toBeNull();
      expect(el().querySelector('.quitar-hasta')).toBeNull();
      expect(anfitrion.desde.value).toEqual(new Date(2026, 8, 5));
    });

    it('elegir una fecha del calendario sobre un texto malo quita el aviso', async () => {
      await armar();
      await escribir('fecha-desde', 'hola');
      expect(el().querySelector('.aviso-ilegible')).not.toBeNull();

      anfitrion.desde.setValue(new Date(2026, 8, 5));
      await asentar();

      expect(el().querySelector('.aviso-ilegible')).toBeNull();
      expect(casilla('fecha-desde').value).toBe('5/9/2026');
    });

    it('las dos casillas malas dan los dos avisos, uno por casilla', async () => {
      await armar();
      await escribir('fecha-desde', 'hola');
      await escribir('fecha-hasta', 'chao');

      expect(Array.from(el().querySelectorAll('.aviso-ilegible')).map(texto)).toEqual([
        'No se entiende la fecha «Desde»: corríjala o elíjala del calendario.',
        'No se entiende la fecha «Hasta»: corríjala o elíjala del calendario.',
      ]);
    });

    it('un texto malo NO se lee como "al revés": son dos avisos distintos', async () => {
      await armar(null, new Date(2026, 8, 5));
      await escribir('fecha-desde', 'hola');

      expect(aviso()).not.toBeNull();
      expect(texto(aviso())).not.toContain('posterior');
    });

    it('un texto malo en «Desde» da UN solo aviso, el de "no se entiende": el de "al revés" no se le suma', async () => {
      await armar(null, new Date(2026, 8, 5));

      await escribir('fecha-desde', 'hola');

      // Los dos avisos comparten la clase `aviso-al-reves`: si salieran ambos, la pantalla diría
      // "no se entiende" Y "«Desde» es posterior a «Hasta»" cuando de «Desde» no hay fecha que comparar.
      expect(el().querySelectorAll('.aviso-al-reves').length).toBe(1);
      expect(texto(el().querySelector('.aviso-al-reves'))).toBe(
        'No se entiende la fecha «Desde»: corríjala o elíjala del calendario.',
      );
      expect(texto(el())).not.toContain('posterior');
    });

    it('lo mismo con un texto malo en «Hasta»: un solo aviso, sin el de "al revés"', async () => {
      await armar(new Date(2026, 8, 5), null);

      await escribir('fecha-hasta', 'chao');

      expect(el().querySelectorAll('.aviso-al-reves').length).toBe(1);
      expect(texto(el().querySelector('.aviso-al-reves'))).toBe(
        'No se entiende la fecha «Hasta»: corríjala o elíjala del calendario.',
      );
      expect(texto(el())).not.toContain('posterior');
    });

    it('el aviso de «Hasta» también es una alerta (role="alert"), como el de «Desde»: quien oye la pantalla se entera', async () => {
      await armar(new Date(2026, 8, 5), null);

      await escribir('fecha-hasta', 'chao');

      const avisoHasta = el().querySelector('.aviso-ilegible');
      expect(texto(avisoHasta)).toContain('«Hasta»');
      expect(avisoHasta!.getAttribute('role')).toBe('alert');
    });

    it('la X solo sale donde hay algo que quitar: el texto malo de una casilla NO le pone X a la otra, que está vacía', async () => {
      await armar();

      await escribir('fecha-hasta', 'chao');
      expect(el().querySelector('.quitar-hasta')).not.toBeNull();
      expect(el().querySelector('.quitar-desde')).toBeNull();

      (el().querySelector('.quitar-hasta') as HTMLButtonElement).click();
      await asentar();
      await escribir('fecha-desde', 'hola');

      expect(el().querySelector('.quitar-desde')).not.toBeNull();
      expect(el().querySelector('.quitar-hasta')).toBeNull();
    });
  });

  describe('el calendario', () => {
    it('un clic sobre la casilla «Desde» abre el calendario: no hace falta buscar el icono', async () => {
      await armar();
      expect(document.querySelector('mat-calendar')).toBeNull();

      casilla('fecha-desde').click();
      await asentar();

      expect(document.querySelector('mat-calendar')).not.toBeNull();
    });

    it('un clic sobre la casilla «Hasta» abre el calendario', async () => {
      await armar();
      expect(document.querySelector('mat-calendar')).toBeNull();

      casilla('fecha-hasta').click();
      await asentar();

      expect(document.querySelector('mat-calendar')).not.toBeNull();
    });
  });

  describe('una fecha que Material lee pero que no sirve (año de 3 o 5 dígitos, fecha que no existe)', () => {
    it('tecleando "5/10/202" (camino a 2026) ya es una fecha del año 202 para el adaptador: se trata como ilegible', async () => {
      await armar();

      await escribir('fecha-desde', '5/10/202');

      expect(anfitrion.desde.value).not.toBeNull(); // Material la dio por buena
      expect(anfitrion.desde.value!.getFullYear()).toBe(202);
      expect(texto(el().querySelector('.aviso-ilegible'))).toBe(
        'No se entiende la fecha «Desde»: corríjala o elíjala del calendario.',
      );
      expect(el().querySelector('.quitar-desde')).not.toBeNull();
      expect(problemaDelRango(anfitrion.desde, anfitrion.hasta)).toBe('ilegible');
    });

    it('con un dígito de más ("20266") lo mismo, y al completar bien el año el aviso se va', async () => {
      await armar(null, new Date(2026, 8, 30));
      anfitrion.desde.setValue(new Date(20266, 4, 10));
      await asentar();
      expect(el().querySelector('.aviso-ilegible')).not.toBeNull();

      anfitrion.desde.setValue(new Date(2026, 4, 10));
      await asentar();

      expect(el().querySelector('.aviso-ilegible')).toBeNull();
      expect(problemaDelRango(anfitrion.desde, anfitrion.hasta)).toBeNull();
    });

    it('una Date inválida (una sesión guardada dañada) tampoco se toma por una fecha buena', async () => {
      await armar();

      anfitrion.hasta.setValue(new Date(NaN));
      await asentar();

      expect(texto(el().querySelector('.aviso-ilegible'))).toContain('«Hasta»');
    });

    it('los límites: 1900 y 2100 sirven; 1899 y 2101 no', () => {
      const con = (anio: number): FormControl<Date | null> => new FormControl<Date | null>(new Date(anio, 5, 15));
      expect(fechaIlegible(con(1900))).toBeFalse();
      expect(fechaIlegible(con(2026))).toBeFalse();
      expect(fechaIlegible(con(2100))).toBeFalse();
      expect(fechaIlegible(con(1899))).toBeTrue();
      expect(fechaIlegible(con(2101))).toBeTrue();
      expect(fechaIlegible(new FormControl<Date | null>(null))).toBeFalse();
    });
  });

  it('los botones del calendario dicen en español de qué casilla son', async () => {
    await armar();

    const nombres = Array.from(el().querySelectorAll('mat-datepicker-toggle button')).map((b) =>
      b.getAttribute('aria-label'),
    );

    expect(nombres).toEqual(['Abrir el calendario de «Desde»', 'Abrir el calendario de «Hasta»']);
  });

  describe('la X y el aviso de "al revés"', () => {
    it('la X de «Hasta» con las fechas al revés quita el aviso y deja el control sucio (la pantalla lo guarda)', async () => {
      await armar(new Date(2026, 8, 20), new Date(2026, 8, 5));
      expect(aviso()).not.toBeNull();

      (el().querySelector('.quitar-hasta') as HTMLButtonElement).click();
      await asentar();

      expect(aviso()).toBeNull();
      expect(anfitrion.hasta.value).toBeNull();
      expect(anfitrion.hasta.dirty).toBeTrue();
      expect(anfitrion.desde.dirty).toBeFalse();
    });
  });

  it('sigue a los controles cuando cambian por fuera (un botón de quincena fija las dos)', async () => {
    await armar();

    anfitrion.desde.setValue(new Date(2026, 8, 16), { emitEvent: false });
    anfitrion.hasta.setValue(new Date(2026, 8, 30));
    await asentar();

    expect(casilla('fecha-hasta').value).toContain('2026');
    expect(aviso()).toBeNull();
  });
});

/**
 * QUÉ LE PASA AL RANGO, dicho por la función que usan las dos listas para decidir si consultan.
 * Las listas la prueban con la pantalla entera; aquí se mide sola, con controles a secas, para que
 * un cambio en ella se note aunque nadie toque las pantallas.
 */
describe('problemaDelRango: qué le pasa al rango que muestran las casillas', () => {
  const dia = (d: number): Date => new Date(2026, 8, d);
  const control = (fecha: Date | null = null): FormControl<Date | null> => new FormControl<Date | null>(fecha);
  /** Una casilla con texto que no se entiende: Material deja el control en null y le pone este error. */
  const conTextoMalo = (): FormControl<Date | null> => {
    const c = control();
    c.setErrors({ matDatepickerParse: { text: 'hola' } });
    return c;
  };

  it('fechas en orden, el mismo día, abiertas de un lado o sin fechas: no hay problema', () => {
    expect(problemaDelRango(control(dia(5)), control(dia(20)))).toBeNull();
    expect(problemaDelRango(control(dia(5)), control(dia(5)))).toBeNull();
    expect(problemaDelRango(control(dia(5)), control())).toBeNull();
    expect(problemaDelRango(control(), control(dia(20)))).toBeNull();
    expect(problemaDelRango(control(), control())).toBeNull();
  });

  it('«Desde» después de «Hasta» es "al-reves"', () => {
    expect(problemaDelRango(control(dia(20)), control(dia(5)))).toBe('al-reves');
  });

  it('un texto que no se entiende, en cualquiera de las dos casillas, es "ilegible" (no "al-reves" ni null)', () => {
    expect(problemaDelRango(conTextoMalo(), control(dia(5)))).toBe('ilegible');
    expect(problemaDelRango(control(dia(5)), conTextoMalo())).toBe('ilegible');
    expect(problemaDelRango(conTextoMalo(), conTextoMalo())).toBe('ilegible');
  });

  it('si una casilla trae un texto malo, eso es lo que se dice: gana sobre "al revés"', () => {
    // En pantalla un texto malo deja el control en null, así que las dos cosas a la vez no pasan;
    // se arma a mano para dejar escrito cuál manda si algún día pasaran.
    const desde = control(dia(20));
    desde.setErrors({ matDatepickerParse: { text: 'hola' } });

    expect(problemaDelRango(desde, control(dia(5)))).toBe('ilegible');
  });
});
