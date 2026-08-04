import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { OpcionSelect, SelectBuscable } from './select-buscable';

/**
 * El caso del dueño: abre a editar una recepción del 18/07 que YA tiene
 * transportador anotado y el campo sale en blanco.
 *
 * La causa no era la recepción: las opciones del selector llegan de la API
 * DESPUÉS de que el formulario escribe el id, así que `writeValue` buscaba ese id
 * en una lista todavía vacía. Estas pruebas reproducen ese orden a propósito
 * —primero el valor, después las opciones— porque es el único orden en que el
 * defecto aparece; con las opciones ya cargadas siempre funcionó.
 */
@Component({
  imports: [ReactiveFormsModule, SelectBuscable],
  template: `<app-select-buscable [formControl]="control" [opciones]="opciones()"
                                  label="Transportador" />`,
})
class Anfitrion {
  readonly control = new FormControl<string | null>(null);
  readonly opciones = signal<OpcionSelect[]>([]);
}

const TRANSPORTADORES: OpcionSelect[] = [
  { id: 't-1', nombre: 'Henry Salazar' },
  { id: 't-2', nombre: 'Patricia Laguna' },
];

describe('SelectBuscable', () => {
  let fixture: ComponentFixture<Anfitrion>;
  let anfitrion: Anfitrion;

  /**
   * Lo que se ve escrito en el campo, que es de lo que se queja el dueño.
   *
   * Con await y no de una: MatAutocomplete pinta el texto en una microtarea
   * (`Promise.resolve().then(...)` dentro de su writeValue), así que leerlo en el
   * mismo tic de detectChanges siempre devuelve vacío y la prueba mentiría.
   */
  const textoVisible = async (): Promise<string> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return (fixture.nativeElement.querySelector('input') as HTMLInputElement).value;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Anfitrion, NoopAnimationsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(Anfitrion);
    anfitrion = fixture.componentInstance;
  });

  it('muestra el nombre cuando las opciones llegan DESPUÉS del valor', async () => {
    // El diálogo se construye con el id ya puesto…
    anfitrion.control.setValue('t-1');
    fixture.detectChanges();
    // …y en ese momento la lista todavía viene en camino: el campo está vacío.
    expect(await textoVisible()).toBe('');

    // Llega la respuesta de /transportadores.
    anfitrion.opciones.set(TRANSPORTADORES);
    fixture.detectChanges();

    expect(await textoVisible()).toBe('Henry Salazar');
    // Y sin haberle avisado al formulario: el id es el mismo, no un cambio del
    // usuario. Si lo marcara como cambio, cerrar el diálogo pediría confirmar.
    expect(anfitrion.control.value).toBe('t-1');
    expect(anfitrion.control.dirty).toBeFalse();
  });

  it('deja el campo vacío si el id ya no está en la lista', async () => {
    // Un transportador desactivado no viene en la lista de activos. Mejor vacío
    // que mostrando un nombre inventado.
    anfitrion.control.setValue('t-borrado');
    anfitrion.opciones.set(TRANSPORTADORES);
    fixture.detectChanges();

    expect(await textoVisible()).toBe('');
  });

  it('no le devuelve el valor viejo encima de lo que está escribiendo', async () => {
    anfitrion.control.setValue('t-1');
    anfitrion.opciones.set(TRANSPORTADORES);
    fixture.detectChanges();
    expect(await textoVisible()).toBe('Henry Salazar');

    // El usuario borra y empieza a teclear otro nombre.
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'Patri';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // Y en ese momento la lista se recarga (otra pestaña, un reintento…).
    anfitrion.opciones.set([...TRANSPORTADORES]);
    fixture.detectChanges();

    expect(await textoVisible()).toBe('Patri');
    expect(anfitrion.control.value).toBeNull();
  });

  it('el valor que se limpió no vuelve solo', async () => {
    anfitrion.control.setValue('t-1');
    anfitrion.opciones.set(TRANSPORTADORES);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button[aria-label="Limpiar"]') as HTMLButtonElement)
      .click();
    fixture.detectChanges();
    expect(anfitrion.control.value).toBeNull();

    anfitrion.opciones.set([...TRANSPORTADORES]);
    fixture.detectChanges();

    expect(await textoVisible()).toBe('');
    expect(anfitrion.control.value).toBeNull();
  });

  it('no ofrece la "×" en un campo apagado', async () => {
    // El transportador de un día cuyo flete ya se pagó: se ve quién fue, pero no
    // se puede vaciar de un clic.
    anfitrion.control.setValue('t-2');
    anfitrion.opciones.set(TRANSPORTADORES);
    anfitrion.control.disable();
    fixture.detectChanges();

    expect(await textoVisible()).toBe('Patricia Laguna');
    expect(fixture.nativeElement.querySelector('button[aria-label="Limpiar"]')).toBeNull();
  });
});
