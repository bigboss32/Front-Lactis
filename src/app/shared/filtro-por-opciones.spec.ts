import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { FiltroPorOpciones, OpcionDeFiltro } from './filtro-por-opciones';

/**
 * EL FILTRO DE BOTONES: "Estado: [Todos] [Borrador] [Aprobada] …".
 *
 * Lo que se mide es lo que el dueño ve y lo que recibe la pantalla: qué botón queda marcado,
 * qué valor queda en el control, cuántas veces se entera la pantalla (una por clic, y ninguna
 * si el clic no cambia nada: recargar la lista para quedar igual es trabajo inútil), y que
 * el botón siga al control cuando lo cambia otro (una tarjeta, la sesión restaurada).
 */
const ESTADOS: readonly OpcionDeFiltro[] = [
  { valor: 'borrador', etiqueta: 'Borrador', ayuda: 'Sin aprobar' },
  { valor: 'aprobada', etiqueta: 'Aprobada' },
  { valor: 'pagada', etiqueta: 'Pagada', ayuda: 'Ya pagadas' },
];

@Component({
  imports: [FiltroPorOpciones],
  template: `<app-filtro-por-opciones etiqueta="Estado" [opciones]="opciones" [control]="control" />`,
})
class Anfitrion {
  opciones = ESTADOS;
  control = new FormControl<string | null>(null);
}

const texto = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('FiltroPorOpciones', () => {
  let fixture: ComponentFixture<Anfitrion>;
  let anfitrion: Anfitrion;

  const armar = async (inicial: string | null = null): Promise<void> => {
    await TestBed.configureTestingModule({ imports: [Anfitrion, NoopAnimationsModule] }).compileComponents();
    fixture = TestBed.createComponent(Anfitrion);
    anfitrion = fixture.componentInstance;
    // Como llega de la sesión: ya puesto, sin avisar, antes de que el filtro exista.
    anfitrion.control.setValue(inicial, { emitEvent: false });
    fixture.detectChanges();
  };

  const el = (): HTMLElement => fixture.nativeElement;
  const botones = (): HTMLButtonElement[] => Array.from(el().querySelectorAll<HTMLButtonElement>('.opcion'));
  const nombres = (): string[] => botones().map((b) => texto(b));
  const marcados = (): string[] =>
    botones()
      .filter((b) => b.classList.contains('activa'))
      .map((b) => texto(b));
  const tocar = (nombre: string): void => {
    botones()
      .find((b) => texto(b) === nombre)!
      .click();
    fixture.detectChanges();
  };

  it('muestra su nombre, "Todos" de primero y las opciones en su orden', async () => {
    await armar();

    expect(texto(el().querySelector('.etiqueta'))).toBe('Estado:');
    expect(nombres()).toEqual(['Todos', 'Borrador', 'Aprobada', 'Pagada']);
    expect(el().querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Estado');
  });

  it('sin filtro puesto, el marcado es "Todos"', async () => {
    await armar();
    expect(marcados()).toEqual(['Todos']);
  });

  it('un botón fija su valor en el control y queda marcado, y "Todos" se desmarca', async () => {
    await armar();

    tocar('Aprobada');

    expect(anfitrion.control.value).toBe('aprobada');
    expect(marcados()).toEqual(['Aprobada']);
    const aprobada = botones().find((b) => texto(b) === 'Aprobada')!;
    expect(aprobada.getAttribute('aria-pressed')).toBe('true');
    expect(botones()[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('elegir otro cambia directo de uno a otro, sin pasar por vacío', async () => {
    await armar('borrador');
    const valores: (string | null)[] = [];
    anfitrion.control.valueChanges.subscribe((v) => valores.push(v));

    tocar('Pagada');

    expect(valores).toEqual(['pagada']);
    expect(marcados()).toEqual(['Pagada']);
  });

  it('tocar el botón ya marcado quita el filtro', async () => {
    await armar('pagada');
    expect(marcados()).toEqual(['Pagada']);

    tocar('Pagada');

    expect(anfitrion.control.value).toBeNull();
    expect(marcados()).toEqual(['Todos']);
  });

  it('"Todos" quita el filtro puesto', async () => {
    await armar('borrador');

    tocar('Todos');

    expect(anfitrion.control.value).toBeNull();
    expect(marcados()).toEqual(['Todos']);
  });

  it('"Todos" sin filtro puesto no avisa: la lista no se recarga para quedar igual', async () => {
    await armar();
    let avisos = 0;
    anfitrion.control.valueChanges.subscribe(() => avisos++);

    tocar('Todos');

    expect(avisos).toBe(0);
    expect(marcados()).toEqual(['Todos']);
  });

  it('cada clic que cambia algo avisa UNA vez', async () => {
    await armar();
    let avisos = 0;
    anfitrion.control.valueChanges.subscribe(() => avisos++);

    tocar('Borrador'); // 1
    tocar('Aprobada'); // 2
    tocar('Aprobada'); // 3 (lo quita)
    tocar('Todos'); // nada: ya estaba vacío

    expect(avisos).toBe(3);
  });

  it('el filtro restaurado de la sesión ya llega marcado', async () => {
    await armar('aprobada');
    expect(marcados()).toEqual(['Aprobada']);
  });

  it('si el control cambia por otro lado —una tarjeta—, el botón marcado lo sigue', async () => {
    await armar();

    anfitrion.control.setValue('pagada');
    fixture.detectChanges();
    expect(marcados()).toEqual(['Pagada']);

    anfitrion.control.setValue(null);
    fixture.detectChanges();
    expect(marcados()).toEqual(['Todos']);
  });

  it('un valor que no es ninguna opción no deja nada marcado en falso', async () => {
    await armar('otra-cosa');

    expect(marcados()).toEqual([]);
    expect(botones()[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('la ayuda de cada opción es un tooltip de su botón (sale con el teclado y en celular), y "Todos" no lleva', async () => {
    await armar();

    const tooltipDe = (nombre: string): MatTooltip | null => {
      const boton = fixture.debugElement
        .queryAll(By.css('.opcion'))
        .find((d) => texto(d.nativeElement) === nombre)!;
      return boton.injector.get(MatTooltip, null);
    };
    expect(tooltipDe('Borrador')!.message).toBe('Sin aprobar');
    expect(tooltipDe('Borrador')!.disabled).toBeFalse();
    expect(tooltipDe('Pagada')!.message).toBe('Ya pagadas');
    // Sin ayuda escrita, el tooltip queda apagado: no sale un globo vacío.
    expect(tooltipDe('Aprobada')!.disabled).toBeTrue();
    expect(tooltipDe('Todos')).toBeNull();
  });

  it('si el padre le pasa OTRO control, el botón marcado sigue al nuevo', async () => {
    await armar('borrador');
    expect(marcados()).toEqual(['Borrador']);

    const otro = new FormControl<string | null>('pagada');
    anfitrion.control = otro;
    fixture.detectChanges();
    expect(marcados()).toEqual(['Pagada']);

    tocar('Aprobada');
    expect(otro.value).toBe('aprobada');
    expect(marcados()).toEqual(['Aprobada']);
  });

  it('el clic se decide por lo que de verdad hay puesto, aunque el control cambiara sin avisar', async () => {
    await armar();
    // Un cambio silencioso después de pintar: el control ya dice 'pagada' y el botón no se enteró.
    anfitrion.control.setValue('pagada', { emitEvent: false });

    tocar('Pagada'); // es el valor puesto: lo quita, no lo vuelve a poner

    expect(anfitrion.control.value).toBeNull();
    expect(marcados()).toEqual(['Todos']);
  });

  it('un valor vacío (cadena) se lee como sin filtro', async () => {
    await armar('');

    expect(marcados()).toEqual(['Todos']);
  });
});
