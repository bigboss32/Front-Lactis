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
 * De fábrica el campo es de PESOS ENTEROS, porque en plata colombiana los centavos
 * no se usan y ponerle ",00" a un total es ruido. Pero hay cifras que no son un
 * total en pesos sino un PRECIO POR UNIDAD o una TARIFA, y ahí los decimales sí
 * valen plata: el dueño tiene un transportador a $242,76 por litro y compra leche
 * a $1.800,50. Para esos campos se abre la puerta con [decimales]="2":
 *
 *     <input matInput inputmode="decimal" appMiles [decimales]="2"
 *            formControlName="valor_transporte" />
 *
 * Dos decimales y no más, siempre: el backend guarda Numeric(_, 2) y redondea a
 * dos, así que si la caja admitiera tres, la pantalla mostraría una cifra y la
 * base de datos guardaría otra.
 *
 * LA COMA NUNCA VALE CIEN VECES MÁS:
 * En un campo SIN [decimales] la coma NO se bota —botarla convertía "1500,50" en
 * 150.050, cien veces la cifra—. Se honra y se redondea al peso: "1500,50" es
 * 1.501. Ver `aNumero`.
 *
 * EL PUNTO ES DE LOS MILES:
 * Aquí "1.800" son mil ochocientos, no uno con ocho, porque así se escribe en
 * Colombia. Y como este campo pone los puntos de miles él solo, el punto que
 * teclea el usuario casi siempre es eso. Solo en un campo con [decimales] se le
 * deja significar el decimal, y con cuidado: ver `posicionDelDecimal`.
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
  /** Si la edición que se está procesando BORRA. Ver `posicionDelDecimal`. */
  private borrando = false;
  /**
   * Si lo que hay escrito es texto del USUARIO con un punto todavía ambiguo (y no
   * el texto que pinta esta directiva). Ver `onInput`.
   */
  private crudo = false;

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
    this.crudo = false;
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

  /**
   * Se anota si esta edición BORRA caracteres, antes de que el texto cambie.
   *
   * Hace falta para no leerle mal el punto al que corrige una cifra: el campo pinta
   * "1.500" solo, y al darle una vez a borrar queda "1.50", que tiene la misma
   * forma que una tarifa "242.76". Como ese "1.50" salió de un texto que pintó esta
   * directiva —y aquí el decimal se pinta con COMA, nunca con punto—, si la edición
   * es un borrado el punto es de los miles con seguridad. Sin esto, borrarle un
   * dígito a una tarifa de 1.500 la dejaba en 1,50.
   *
   * Si el navegador no manda `beforeinput` se cae al camino normal, que es el
   * bueno para todo lo que no es borrar.
   */
  @HostListener('beforeinput', ['$event'])
  onBeforeInput(evento: Event): void {
    this.borrando = ((evento as InputEvent).inputType ?? '').startsWith('delete');
  }

  @HostListener('input')
  onInput(): void {
    const texto = this.campo.value;
    const corte = this.posicionDelDecimal(texto);
    this.borrando = false;
    const partes = this.partir(texto, corte);

    if (partes.entero === '' && partes.decimal === null) {
      // Campo vacío: se emite null y NO cero. El cero callado es justo lo que le
      // paga mal a alguien; con null salta el 'required' y se ve el mensaje.
      this.campo.value = '';
      this.crudo = false;
      this.alCambiar(null);
      return;
    }

    if (corte >= 0 && texto[corte] === '.') {
      // PUNTO TODAVÍA AMBIGUO: aquí no se toca el texto, se deja tal cual lo está
      // escribiendo el usuario y solo se emite el número.
      //
      // Es lo único que permite las dos costumbres a la vez. Quien escribe
      // "1.800,50" pasa por "1.8" y "1.80" antes de llegar al tercer cero; si en
      // ese momento el campo le cambiara el punto por coma, se quedaría en 1,80
      // —mil veces menos— y no habría forma de llegar a 1.800. Y quien teclea
      // "242.76" con el punto del teclado numérico necesita que ese punto valga
      // como decimal. Al tercer dígito ya no hay duda (son miles, ver
      // `posicionDelDecimal`) y el campo retoma el formateo; y al salir del campo
      // `onBlur` pinta la cifra definitiva, que es la que se guarda.
      this.crudo = true;
      this.alCambiar(this.aNumero(partes));
      return;
    }

    // Se reescribe conservando el separador y los decimales A MEDIO ESCRIBIR. Si
    // se reformateara con toLocaleString en cada tecla, la coma recién puesta
    // desaparecería y el dueño nunca podría llegar al ",76".
    this.crudo = false;
    this.campo.value =
      Number(partes.entero || '0').toLocaleString('es-CO') +
      (partes.decimal === null ? '' : `,${partes.decimal}`);
    this.alCambiar(this.aNumero(partes));
  }

  @HostListener('blur')
  onBlur(): void {
    this.borrando = false;
    this.alTocar();
    // Al salir se normaliza lo que quedó a medio escribir, para que LO QUE SE VE
    // sea exactamente el número que se va a guardar: "242," queda "242" y "242.76"
    // queda "242,76" en una tarifa, y "1.500,50" queda "1.501" en un campo de
    // pesos enteros, que es el valor que ya tiene el formulario.
    if (this.campo.value !== '') {
      this.campo.value = this.formatear(this.leerNumero());
      this.crudo = false;
    }
  }

  /**
   * Parte el texto de la caja en parte entera (solo dígitos) y parte decimal
   * (solo dígitos, o null si no se escribió separador decimal).
   */
  private partir(texto: string, corte: number): { entero: string; decimal: string | null } {
    if (corte < 0) return { entero: texto.replace(/\D/g, ''), decimal: null };

    const entero = texto.slice(0, corte).replace(/\D/g, '');
    const cola = texto.slice(corte + 1).replace(/\D/g, '');
    const decimales = this.decimales();
    // En un campo con decimales se recorta a los que admite —los mismos dos que
    // guarda el backend—, así "242,769" queda "242,76". En uno de PESOS ENTEROS no
    // se recorta nada: se deja ver lo que se teclea y al final se redondea, porque
    // si la tecla no respondiera el campo parecería trabado.
    return { entero, decimal: decimales > 0 ? cola.slice(0, decimales) : cola };
  }

  /**
   * El número que representan esas partes. null si no hay ninguna cifra.
   *
   * PESOS ENTEROS Y LA COMA: se honra y se REDONDEA al peso ("1500,50" -> 1.501),
   * nunca se pega al final del número. Se redondea en vez de cortar por dos
   * razones: es lo mismo que ya hace `formatear` con un valor que llega del backend
   * con decimales (1250.5 se pinta "1.251"), así que la cifra no cambia según si
   * vino del teclado o de la base; y cortar siempre pierde plata para el mismo
   * lado. Lo que se ve se cuadra con lo guardado al salir del campo (ver onBlur).
   */
  private aNumero(partes: { entero: string; decimal: string | null }): number | null {
    if (partes.entero === '' && (partes.decimal === null || partes.decimal === '')) return null;
    const numero = Number(`${partes.entero || '0'}.${partes.decimal || '0'}`);
    if (!Number.isFinite(numero)) return null;
    return this.decimales() > 0 ? numero : Math.round(numero);
  }

  /**
   * Cuál de los separadores que hay en la caja es el DECIMAL. -1 = ninguno.
   *
   * La gente teclea de las dos formas —"242,76" y "242.76"— y ninguna puede fallar
   * en silencio. La maña está en que este campo REESCRIBE el texto en cada tecla y
   * le mete los puntos de miles él mismo, así que después tiene que poder releer su
   * propia letra sin confundirse. Las reglas, en orden:
   *
   *  1. Si hay COMA, manda la última coma, TAMBIÉN en un campo de pesos enteros.
   *     En el formato colombiano —el que pinta este mismo campo— la coma solo puede
   *     ser el decimal, nunca los miles. En un campo de pesos enteros lo que venga
   *     detrás se redondea (ver `aNumero`), pero jamás se pega al número: eso era
   *     lo que convertía "1500,50" en 150.050.
   *  2. En un campo de PESOS ENTEROS el punto es siempre de los miles: "1.800" son
   *     mil ochocientos.
   *  3. En un campo con decimales, el último punto es el decimal solo si detrás
   *     caben los decimales del campo. Con eso "242.76" es la tarifa, mientras
   *     "1.800", "2.427" y "24.276" siguen siendo miles —al tercer dígito ya no hay
   *     duda— y leerlos como decimales dejaba "1,80" o "2,42".
   *  4. Y no vale como decimal si la edición fue un BORRADO sobre texto que pintó
   *     esta directiva: ahí el punto es de los miles que ella misma puso (ver
   *     `onBeforeInput`).
   *
   * Los miles NO hay que teclearlos nunca: el campo los pone solo.
   */
  private posicionDelDecimal(texto: string): number {
    const coma = texto.lastIndexOf(',');
    if (coma >= 0) return coma;

    const decimales = this.decimales();
    if (decimales <= 0) return -1;

    const punto = texto.lastIndexOf('.');
    if (punto < 0) return -1;
    const digitosDetras = texto.slice(punto + 1).replace(/\D/g, '').length;
    if (digitosDetras > decimales) return -1;
    if (this.borrando && !this.crudo) return -1;
    return punto;
  }

  /** El número que hay ahora en la caja, leído con las reglas de arriba. */
  private leerNumero(): number | null {
    const texto = this.campo.value;
    return this.aNumero(this.partir(texto, this.posicionDelDecimal(texto)));
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
