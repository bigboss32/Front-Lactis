import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EstadoChip } from './estado-chip';

/**
 * EL CHIP DE "PAGADA · QUEDÓ DEBIENDO".
 *
 * Es el primer estado que es una FRASE y no una palabra, y el chip capitaliza: sin
 * cuidarlo, el dueño leía "Pagada · Quedó Debiendo", con mayúsculas de titular de
 * periódico. Y el color tiene que decir lo mismo que una pagada —no hay nada que hacer
 * con esa quincena—, no el azul de "aprobada, falta pagarla".
 */
describe('EstadoChip', () => {
  let fixture: ComponentFixture<EstadoChip>;

  const armar = async (estado: string): Promise<HTMLElement> => {
    await TestBed.configureTestingModule({ imports: [EstadoChip] }).compileComponents();
    fixture = TestBed.createComponent(EstadoChip);
    fixture.componentRef.setInput('estado', estado);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.chip') as HTMLElement;
  };

  it('"pagada · quedó debiendo" va en verde, como una pagada', async () => {
    const chip = await armar('pagada · quedó debiendo');
    expect(chip.classList).toContain('verde');
    expect(chip.textContent).toBe('pagada · quedó debiendo');
  });

  it('se lee como frase: mayúscula solo al arrancar, no en cada palabra', async () => {
    const chip = await armar('pagada · quedó debiendo');
    expect(chip.classList).toContain('frase');
    // Sin 'capitalize' en la frase —era lo que subía la Q y la D—...
    expect(getComputedStyle(chip).textTransform).toBe('none');
    // ...y con la primera letra en mayúscula: "Pagada · quedó debiendo".
    expect(getComputedStyle(chip, '::first-letter').textTransform).toBe('uppercase');
  });

  it('los estados de una palabra (o dos, sin punto medio) siguen capitalizados', async () => {
    const chip = await armar('por vencer');
    expect(chip.classList).not.toContain('frase');
    expect(getComputedStyle(chip).textTransform).toBe('capitalize');
    expect(chip.classList).toContain('ambar');
  });

  it('"aprobada" sigue en azul: el verde es solo para la que ya no tiene nada que pagar', async () => {
    const chip = await armar('aprobada');
    expect(chip.classList).toContain('azul');
  });
});
