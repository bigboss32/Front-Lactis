import { Directive, ElementRef, HostListener, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Formatea un campo de dinero con separador de miles (1.234.567) MIENTRAS el
 * usuario escribe, manteniendo en el FormControl el valor NUMÉRICO (no el texto),
 * para no romper el contrato con el backend ni las validaciones.
 *
 * Uso:  <input matInput type="text" inputmode="numeric" appMiles formControlName="valor" />
 */
@Directive({
  selector: 'input[appMiles]',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MilesInputDirective), multi: true },
  ],
})
export class MilesInputDirective implements ControlValueAccessor {
  private readonly input = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private alCambiar: (valor: number | null) => void = () => {};
  private alTocar: () => void = () => {};

  writeValue(valor: number | null): void {
    this.input.value = this.formatear(valor);
  }

  registerOnChange(fn: (valor: number | null) => void): void {
    this.alCambiar = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.alTocar = fn;
  }

  setDisabledState(deshabilitado: boolean): void {
    this.input.disabled = deshabilitado;
  }

  @HostListener('input')
  onInput(): void {
    const digitos = this.input.value.replace(/\D/g, '');
    const numero = digitos ? Number(digitos) : null;
    // Reescribe el campo ya formateado y emite el número puro al FormControl.
    this.input.value = this.formatear(numero);
    this.alCambiar(numero);
  }

  @HostListener('blur')
  onBlur(): void {
    this.alTocar();
  }

  private formatear(valor: number | null | undefined): string {
    if (valor === null || valor === undefined || Number.isNaN(valor)) return '';
    return Math.round(Number(valor)).toLocaleString('es-CO');
  }
}
