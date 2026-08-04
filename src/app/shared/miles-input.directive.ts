import {
  Directive,
  ElementRef,
  HostListener,
  OnInit,
  forwardRef,
  inject,
  input,
  numberAttribute,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Formatea un campo de dinero con separador de miles (1.234.567) MIENTRAS el
 * usuario escribe, manteniendo en el FormControl el valor NUMÉRICO (no el texto),
 * para no romper el contrato con el backend ni las validaciones.
 *
 * Uso:  <input matInput type="text" inputmode="numeric" appMiles formControlName="valor" />
 *
 * DECIMALES (opcional, por defecto NO):
 * De fábrica el campo es de PESOS ENTEROS y se comporta igual que siempre —bota
 * puntos y comas y redondea— porque en plata colombiana los centavos no se usan.
 * Pero hay cifras que no son un total en pesos sino una TARIFA POR UNIDAD, y ahí
 * los decimales sí valen plata: el dueño tiene un transportador a $242,76 por
 * litro. Para esos campos se abre la puerta con [decimales]="2":
 *
 *     <input matInput inputmode="decimal" appMiles [decimales]="2"
 *            formControlName="valor_transporte" />
 *
 * Es opt-in a propósito. Así los otros ~44 campos de plata de la aplicación
 * siguen dando exactamente la misma cifra que hoy sin tener que revisarlos uno
 * por uno, y el que necesite decimales se marca uno por uno a conciencia.
 */
@Directive({
  selector: 'input[appMiles]',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MilesInputDirective), multi: true },
  ],
})
export class MilesInputDirective implements ControlValueAccessor, OnInit {
  /** Cuántos decimales admite el campo. 0 = pesos enteros, o sea lo de siempre. */
  readonly decimales = input(0, { transform: numberAttribute });

  private readonly campo = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private alCambiar: (valor: number | null) => void = () => {};
  private alTocar: () => void = () => {};
  private valorEscrito: number | null = null;

  ngOnInit(): void {
    // Se vuelve a pintar el valor inicial cuando ya se sabe cuántos decimales
    // lleva el campo: writeValue puede correr antes de que Angular haya resuelto
    // el input [decimales], y en ese caso la primera pintada saldría redondeada
    // (una tarifa de 242,76 se vería "243", que es justo lo que hay que evitar).
    this.campo.value = this.formatear(this.valorEscrito);
  }

  writeValue(valor: number | null): void {
    this.valorEscrito = valor === null || valor === undefined ? null : Number(valor);
    this.campo.value = this.formatear(valor);
  }

  registerOnChange(fn: (valor: number | null) => void): void {
    this.alCambiar = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.alTocar = fn;
  }

  setDisabledState(deshabilitado: boolean): void {
    this.campo.disabled = deshabilitado;
  }

  @HostListener('input')
  onInput(): void {
    const decimales = this.decimales();

    if (decimales <= 0) {
      // Pesos enteros: se botan puntos, comas y letras. Comportamiento histórico,
      // intacto para no mover ninguna de las otras pantallas de plata.
      const digitos = this.campo.value.replace(/\D/g, '');
      const numero = digitos ? Number(digitos) : null;
      // Reescribe el campo ya formateado y emite el número puro al FormControl.
      this.campo.value = this.formatear(numero);
      this.alCambiar(numero);
      return;
    }

    const crudo = this.campo.value;
    const corte = this.posicionDelDecimal(crudo, decimales);
    const entero = (corte < 0 ? crudo : crudo.slice(0, corte)).replace(/\D/g, '');
    const parteDecimal =
      corte < 0 ? null : crudo.slice(corte + 1).replace(/\D/g, '').slice(0, decimales);

    if (entero === '' && parteDecimal === null) {
      // Campo vacío: se emite null y NO cero. El cero callado es justo lo que le
      // paga mal a alguien; con null salta el 'required' y se ve el mensaje.
      this.campo.value = '';
      this.alCambiar(null);
      return;
    }

    // Se reescribe conservando el separador y los decimales A MEDIO ESCRIBIR. Si
    // se reformateara con toLocaleString en cada tecla, la coma recién puesta
    // desaparecería y el dueño nunca podría llegar al ",76".
    this.campo.value =
      Number(entero || '0').toLocaleString('es-CO') +
      (parteDecimal === null ? '' : `,${parteDecimal}`);
    this.alCambiar(Number(`${entero || '0'}.${parteDecimal || '0'}`));
  }

  @HostListener('blur')
  onBlur(): void {
    this.alTocar();
    // Al salir se normaliza lo que quedó a medio escribir ("242," -> "242"), para
    // que lo que se ve sea exactamente el número que se va a guardar.
    if (this.decimales() > 0 && this.campo.value !== '') {
      this.campo.value = this.formatear(this.leerNumero());
    }
  }

  /**
   * Cuál de los separadores que hay en la caja es el DECIMAL. -1 = ninguno.
   *
   * La gente teclea de las dos formas —"242,76" y "242.76"— y ninguna puede
   * fallar en silencio. La maña está en que este campo REESCRIBE el texto en cada
   * tecla y le mete los puntos de miles él mismo, así que después tiene que poder
   * releer su propia letra sin confundirse. Las reglas, en orden:
   *
   *  1. Si hay COMA, manda la última coma. En el formato colombiano —el que pinta
   *     este mismo campo— la coma solo puede ser el decimal, nunca los miles. Los
   *     dígitos que sobren se recortan a la vista: "242,769" queda "242,76".
   *  2. Si NO hay coma pero hay punto, el último punto es decimal solo si detrás
   *     caben los decimales del campo. Con eso "242.76" es la tarifa, mientras
   *     "2.427" y "24.276" siguen siendo miles: son los puntos que puso el campo
   *     solo al teclear 2427 y 24276, y leerlos como decimales dejaba "2,42".
   *
   * Los miles NO hay que teclearlos nunca: el campo los pone solo.
   */
  private posicionDelDecimal(texto: string, decimales: number): number {
    if (decimales <= 0) return -1;

    const coma = texto.lastIndexOf(',');
    if (coma >= 0) return coma;

    const punto = texto.lastIndexOf('.');
    if (punto < 0) return -1;
    const digitosDetras = texto.slice(punto + 1).replace(/\D/g, '').length;
    return digitosDetras <= decimales ? punto : -1;
  }

  /** El número que hay ahora en la caja, leído con las reglas de arriba. */
  private leerNumero(): number | null {
    const crudo = this.campo.value;
    const corte = this.posicionDelDecimal(crudo, this.decimales());
    const entero = (corte < 0 ? crudo : crudo.slice(0, corte)).replace(/\D/g, '');
    const parteDecimal =
      corte < 0 ? '' : crudo.slice(corte + 1).replace(/\D/g, '').slice(0, this.decimales());
    if (entero === '' && parteDecimal === '') return null;
    return Number(`${entero || '0'}.${parteDecimal || '0'}`);
  }

  private formatear(valor: number | null | undefined): string {
    if (valor === null || valor === undefined || Number.isNaN(Number(valor))) return '';
    const decimales = this.decimales();
    if (decimales <= 0) return Math.round(Number(valor)).toLocaleString('es-CO');
    const numero = Number(valor);
    // NINGUNO o TODOS, nunca uno solo: una tarifa de 238 se sigue viendo "238"
    // igual que hoy, pero una de 1.250,50 se ve "1.250,50" y no "1.250,5", que en
    // plata se lee como si se hubiera perdido un centavo. Es la misma regla del
    // pipe `money: true` y del `pesos()` del backend, y tiene que ser la misma:
    // esta caja y la tabla de al lado muestran LA MISMA tarifa.
    return numero.toLocaleString(
      'es-CO',
      Number.isInteger(numero)
        ? { maximumFractionDigits: 0 }
        : { minimumFractionDigits: decimales, maximumFractionDigits: decimales },
    );
  }
}
