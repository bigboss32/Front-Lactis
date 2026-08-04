import { Component, computed, effect, forwardRef, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ControlValueAccessor,
  FormControl,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
} from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

export interface OpcionSelect {
  id: string;
  nombre: string;
}

/**
 * Selector con búsqueda: se escribe para filtrar dentro del desplegable.
 * Se comporta como un control normal (guarda el id seleccionado), así que
 * funciona con formControlName igual que un <mat-select>.
 *
 * Uso:
 *   <app-select-buscable formControlName="proveedor_id"
 *     [opciones]="proveedores()" label="Proveedor" />
 * donde cada opción es { id, nombre }.
 */
@Component({
  selector: 'app-select-buscable',
  imports: [
    ReactiveFormsModule, MatFormFieldModule, MatInputModule,
    MatAutocompleteModule, MatIconModule, MatButtonModule,
  ],
  template: `
    <mat-form-field subscriptSizing="dynamic" class="campo">
      <mat-label>{{ label() }}</mat-label>
      <input
        matInput
        [formControl]="control"
        [matAutocomplete]="auto"
        [placeholder]="placeholder()"
        (input)="alEscribir()"
        (blur)="alSalir()"
      />
      <mat-autocomplete
        #auto="matAutocomplete"
        [displayWith]="mostrar"
        (optionSelected)="alSeleccionar($event.option.value)"
      >
        @for (op of filtradas(); track op.id) {
          <mat-option [value]="op">{{ op.nombre }}</mat-option>
        }
        @if (filtradas().length === 0) {
          <mat-option [disabled]="true">Sin resultados</mat-option>
        }
      </mat-autocomplete>
      <!-- La "×" solo cuando el campo está habilitado. Deshabilitado seguía
           saliendo y seguía funcionando, así que un campo apagado a propósito
           —por ejemplo el transportador de un día cuyo flete ya se pagó— se
           podía vaciar de todas formas con un clic. -->
      @if (control.value && !control.disabled) {
        <button matSuffix mat-icon-button type="button" aria-label="Limpiar" (click)="limpiar()">
          <mat-icon>close</mat-icon>
        </button>
      } @else {
        <mat-icon matSuffix>arrow_drop_down</mat-icon>
      }
    </mat-form-field>
  `,
  styles: `.campo { width: 100%; }`,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectBuscable), multi: true },
  ],
})
export class SelectBuscable implements ControlValueAccessor {
  readonly opciones = input<OpcionSelect[]>([]);
  readonly label = input('');
  readonly placeholder = input('Escribe para buscar…');

  /** El control interno guarda un string (mientras se teclea) o la opción elegida. */
  readonly control = new FormControl<string | OpcionSelect | null>('');
  private readonly valor = toSignal(this.control.valueChanges, { initialValue: this.control.value });

  readonly filtradas = computed(() => {
    const v = this.valor();
    const ops = this.opciones();
    if (typeof v !== 'string' || !v.trim()) return ops;
    const f = v.toLowerCase().trim();
    return ops.filter((o) => o.nombre.toLowerCase().includes(f));
  });

  /**
   * El id que nos escribió el formulario, guardado aparte.
   *
   * Hace falta porque las opciones llegan de la API DESPUÉS de que el formulario
   * escribe el valor: al abrir un diálogo de edición, `writeValue` buscaba el id
   * en una lista todavía vacía, no lo encontraba, dejaba el campo en null y nadie
   * lo volvía a intentar cuando la lista llegaba. Resultado: el transportador (y
   * el proveedor, y el cliente…) que YA estaban puestos salían en blanco. El
   * dato guardado no se perdía —`writeValue` no avisa hacia afuera, así que el
   * formulario conservaba el id—, pero el usuario veía un campo vacío y no tenía
   * forma de saber a quién tenía anotado.
   */
  private readonly idEscrito = signal<string | null>(null);

  constructor() {
    // Reintenta la resolución cada vez que cambian las opciones. Es la carga
    // asíncrona la que dispara esto, no un cambio del usuario.
    effect(() => {
      const id = this.idEscrito();
      const opciones = this.opciones();
      if (!id) return;
      const actual = this.control.value;
      if (actual && typeof actual === 'object' && actual.id === id) return;
      const op = opciones.find((o) => o.id === id);
      // emitEvent: false — es la misma selección que ya tenía el formulario,
      // solo que recién ahora se puede mostrar con nombre. Marcar el campo como
      // sucio aquí haría que el diálogo pidiera confirmación al cerrar sin que
      // el usuario hubiera cambiado nada (ver protegerCambios).
      if (op) this.control.setValue(op, { emitEvent: false });
    });
  }

  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  mostrar = (op: OpcionSelect | string | null): string =>
    op && typeof op === 'object' ? op.nombre : '';

  alSeleccionar(op: OpcionSelect): void {
    this.idEscrito.set(op?.id ?? null);
    this.onChange(op?.id ?? null);
    this.onTouched();
  }

  /** Mientras se teclea aún no hay selección válida. */
  alEscribir(): void {
    if (typeof this.control.value === 'string') {
      // Se olvida el id pendiente: si no, una recarga de las opciones mientras
      // el usuario teclea le devolvería el valor viejo encima de lo que escribe.
      this.idEscrito.set(null);
      this.onChange(null);
    }
  }

  alSalir(): void {
    this.onTouched();
  }

  limpiar(): void {
    this.idEscrito.set(null);
    this.control.setValue('');
    this.onChange(null);
    this.onTouched();
  }

  writeValue(id: string | null): void {
    this.idEscrito.set(id ?? null);
    const op = id ? (this.opciones().find((o) => o.id === id) ?? null) : null;
    // Puede quedar en null: las opciones todavía no han llegado. El effect de
    // arriba lo pone en cuanto lleguen.
    this.control.setValue(op, { emitEvent: false });
  }
  registerOnChange(fn: (v: string | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(deshabilitado: boolean): void {
    if (deshabilitado) this.control.disable();
    else this.control.enable();
  }
}
