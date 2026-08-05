import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { MilesInputDirective } from './miles-input.directive';

/**
 * El caso del dueño, que es de plata de verdad: "aca en el trapotador necesito la
 * coma para litros 242,76 tengo un caso asi".
 *
 * Esta directiva formatea los miles mientras se teclea, y para eso REESCRIBE el
 * texto de la caja en cada tecla. Ahí estaba el defecto: botaba todo lo que no era
 * dígito, así que la coma desaparecía y "242,76" se guardaba como 24.276 —cien
 * veces más—. Y un total de $1.500.000 escrito "1500,50" acababa en $150.050.
 *
 * Lo que estas pruebas cuidan, campo por campo:
 *  · que la coma NUNCA multiplique por cien, ni en un campo de pesos enteros (ahí
 *    se redondea al peso, que es lo que se guarda y lo que se ve);
 *  · que el punto siga siendo separador de MILES, porque en Colombia "1.800" son
 *    mil ochocientos: se teclea así y se pega así desde WhatsApp o Excel;
 *  · que se pueda teclear con coma Y con punto, porque el teclado numérico del
 *    computador saca punto y el del celular saca coma;
 *  · que lo que se VE al salir del campo sea exactamente el número que se guarda,
 *    porque el productor compara el comprobante contra la pantalla a mano.
 */
@Component({
  imports: [ReactiveFormsModule, MilesInputDirective],
  template: `
    <input id="tarifa" appMiles [decimales]="2" [formControl]="tarifa" />
    <input id="total" appMiles [formControl]="total" />
  `,
})
class Anfitrion {
  /** Un precio por unidad: la tarifa por litro, con centavos. */
  readonly tarifa = new FormControl<number | string | null>(null);
  /** Un total en pesos, sin [decimales]: el caso de los otros ~23 campos. */
  readonly total = new FormControl<number | string | null>(null);
}

describe('MilesInputDirective', () => {
  let fixture: ComponentFixture<Anfitrion>;
  let anfitrion: Anfitrion;

  const caja = (id: 'tarifa' | 'total'): HTMLInputElement =>
    fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;

  /**
   * Teclea LETRA POR LETRA, que es la única forma de reproducir el defecto: el
   * campo se reescribe en cada tecla, así que lo que decide la cifra es lo que hay
   * escrito en cada paso intermedio y no el texto completo. `beforeinput` va porque
   * el navegador también lo manda, y la directiva lo usa para saber si se borró.
   */
  const teclear = (input: HTMLInputElement, texto: string): void => {
    for (const letra of texto) {
      input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: letra }));
      input.value += letra;
      input.dispatchEvent(new Event('input'));
    }
  };

  /** Pegar de un golpe, como cuando llega el precio por WhatsApp o sale de Excel. */
  const pegar = (input: HTMLInputElement, texto: string): void => {
    input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste' }));
    input.value = texto;
    input.dispatchEvent(new Event('input'));
  };

  /** Una tecla de borrar. */
  const borrar = (input: HTMLInputElement): void => {
    input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward' }));
    input.value = input.value.slice(0, -1);
    input.dispatchEvent(new Event('input'));
  };

  /** Salir del campo, que es cuando la cifra queda en limpio. */
  const salir = (input: HTMLInputElement): void => {
    input.dispatchEvent(new Event('blur'));
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Anfitrion] }).compileComponents();
    fixture = TestBed.createComponent(Anfitrion);
    anfitrion = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('un precio por unidad ([decimales]="2")', () => {
    it('escrito con coma guarda los centavos: 242,76', () => {
      const input = caja('tarifa');
      teclear(input, '242,76');

      expect(anfitrion.tarifa.value).toBe(242.76);
      // Y se ve la coma mientras se escribe: si el campo la borrara al reformatear,
      // el dueño nunca podría llegar al ",76".
      expect(input.value).toBe('242,76');
      salir(input);
      expect(input.value).toBe('242,76');
    });

    it('escrito con el punto del teclado numérico también: 242.76', () => {
      // En el computador el punto del teclado numérico es la tecla que uno alcanza.
      const input = caja('tarifa');
      teclear(input, '242.76');

      expect(anfitrion.tarifa.value).toBe(242.76);
      // Al salir se pinta con coma, que es como se lee la plata en Colombia y como
      // sale en el comprobante.
      salir(input);
      expect(input.value).toBe('242,76');
    });

    it('deja escribir a la colombiana: 1.800,50 con el punto de los miles', () => {
      // El precio de la leche está en miles, y el dueño teclea el punto por
      // costumbre. Pasa por "1.8" y "1.80" antes del tercer cero: si en ese momento
      // el campo le cambiara el punto por coma, se quedaría en 1,80 —mil veces
      // menos— y no habría forma de llegar a 1.800,50.
      const input = caja('tarifa');
      teclear(input, '1.800,50');

      expect(anfitrion.tarifa.value).toBe(1800.5);
      expect(input.value).toBe('1.800,50');
    });

    it('los miles los pone solo: 1800 se ve 1.800', () => {
      const input = caja('tarifa');
      teclear(input, '1800');

      expect(anfitrion.tarifa.value).toBe(1800);
      expect(input.value).toBe('1.800');
    });

    it('pegar "1.800,50" de Excel o de WhatsApp da 1.800,50', () => {
      const input = caja('tarifa');
      pegar(input, '1.800,50');

      expect(anfitrion.tarifa.value).toBe(1800.5);
      expect(input.value).toBe('1.800,50');
    });

    it('pegar "242,76" da 242,76 y no 24.276', () => {
      const input = caja('tarifa');
      pegar(input, '$ 242,76');

      // Con el "$ " pegado por delante: se ignora lo que no es cifra.
      expect(anfitrion.tarifa.value).toBe(242.76);
      expect(input.value).toBe('242,76');
    });

    it('no admite un tercer decimal, porque el backend no lo guarda', () => {
      // La columna es Numeric(12,2) y el schema valida decimal_places=2: un tercer
      // decimal se devolvería con 422 o se recortaría en silencio, y entonces la
      // pantalla mostraría una cifra y la base otra.
      const input = caja('tarifa');
      teclear(input, '242,769');

      expect(anfitrion.tarifa.value).toBe(242.76);
      expect(input.value).toBe('242,76');
    });

    it('borrarle un dígito a una tarifa de 1.500 la deja en 150, no en 1,50', () => {
      // El campo pinta "1.500" solo; al borrar queda "1.50", que tiene la misma
      // forma que la tarifa "242.76". Como ese texto lo pintó la directiva —y aquí
      // el decimal se pinta con COMA, nunca con punto—, ese punto es de los miles.
      const input = caja('tarifa');
      teclear(input, '1500');
      expect(input.value).toBe('1.500');

      borrar(input);

      expect(anfitrion.tarifa.value).toBe(150);
      expect(input.value).toBe('150');
    });

    it('pero borrar dentro de lo que se escribió con punto no cambia la cifra de sitio', () => {
      // Al revés del caso anterior: "242.76" lo escribió el usuario con punto, así
      // que al corregir el último dígito sigue siendo una tarifa con centavos.
      const input = caja('tarifa');
      teclear(input, '242.76');

      borrar(input);

      expect(anfitrion.tarifa.value).toBe(242.7);
      salir(input);
      expect(input.value).toBe('242,70');
    });

    it('un valor que llega del backend se muestra con sus centavos', () => {
      // El API manda los montos como texto JSON ("1250.50") y los diálogos los
      // pasan por Number(). Si se pintara redondeado, la caja diría 1.251 y el
      // comprobante 1.250,50.
      anfitrion.tarifa.setValue(Number('1250.50'));
      fixture.detectChanges();

      expect(caja('tarifa').value).toBe('1.250,50');
    });

    it('una tarifa redonda no se ensucia con ",00"', () => {
      // 300 el litro se sigue viendo "300", como siempre. El ",00" solo aparece
      // cuando hay centavos de verdad.
      anfitrion.tarifa.setValue(Number('300.00'));
      fixture.detectChanges();

      expect(caja('tarifa').value).toBe('300');
    });

    it('el campo vacío emite null y no cero', () => {
      // Un cero callado es justo lo que le paga mal a alguien: con null salta el
      // 'required' y se ve el mensaje.
      const input = caja('tarifa');
      teclear(input, '242,76');
      input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward' }));
      input.value = '';
      input.dispatchEvent(new Event('input'));

      expect(anfitrion.tarifa.value).toBeNull();
      expect(input.value).toBe('');
    });
  });

  describe('un total en pesos enteros (sin [decimales])', () => {
    it('la coma se honra y se redondea al peso: 1500,50 son 1.501, nunca 150.050', () => {
      // ESTE es el defecto grande: al botar la coma, "1500,50" quedaba 150050, cien
      // veces la cifra. Ahora la coma vale lo que dice y se redondea al peso.
      const input = caja('total');
      teclear(input, '1500,50');

      expect(anfitrion.total.value).toBe(1501);
      salir(input);
      // Y lo que queda en pantalla es la cifra que se guarda, no la que se tecleó.
      expect(input.value).toBe('1.501');
    });

    it('una coma nunca infla la cifra: 242,76 son 243', () => {
      const input = caja('total');
      teclear(input, '242,76');

      expect(anfitrion.total.value).toBe(243);
      salir(input);
      expect(input.value).toBe('243');
    });

    it('el punto sigue siendo de los miles: 1.800 son mil ochocientos', () => {
      const input = caja('total');
      teclear(input, '1.800');

      expect(anfitrion.total.value).toBe(1800);
      expect(input.value).toBe('1.800');
    });

    it('pegar "1.800,50" de Excel da 1.801 y no 180.050', () => {
      const input = caja('total');
      pegar(input, '1.800,50');

      expect(anfitrion.total.value).toBe(1801);
      salir(input);
      expect(input.value).toBe('1.801');
    });

    it('un total sin comas se sigue viendo igual que siempre', () => {
      // Los ~23 campos de totales no cambian en nada: es la misma cifra de hoy.
      const input = caja('total');
      teclear(input, '1500000');

      expect(anfitrion.total.value).toBe(1500000);
      expect(input.value).toBe('1.500.000');
    });
  });
});
