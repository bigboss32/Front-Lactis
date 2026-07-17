import { Component, computed, forwardRef, input } from '@angular/core';
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
      @if (control.value) {
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

  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  mostrar = (op: OpcionSelect | string | null): string =>
    op && typeof op === 'object' ? op.nombre : '';

  alSeleccionar(op: OpcionSelect): void {
    this.onChange(op?.id ?? null);
    this.onTouched();
  }

  /** Mientras se teclea aún no hay selección válida. */
  alEscribir(): void {
    if (typeof this.control.value === 'string') this.onChange(null);
  }

  alSalir(): void {
    this.onTouched();
  }

  limpiar(): void {
    this.control.setValue('');
    this.onChange(null);
    this.onTouched();
  }

  writeValue(id: string | null): void {
    const op = id ? (this.opciones().find((o) => o.id === id) ?? null) : null;
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
