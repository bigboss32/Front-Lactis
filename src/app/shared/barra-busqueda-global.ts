import { Component, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, map, of, startWith, switchMap } from 'rxjs';

import { BuscadorGlobalService, ResultadoBusqueda } from './buscador-global.service';

const PREFIJO_FILTROS = 'qe.filtros.';

/** Barra de búsqueda global de la barra superior: secciones + registros. */
@Component({
  selector: 'app-barra-busqueda-global',
  imports: [
    ReactiveFormsModule, MatFormFieldModule, MatInputModule,
    MatAutocompleteModule, MatIconModule,
  ],
  template: `
    <mat-form-field class="buscador" subscriptSizing="dynamic" appearance="outline">
      <mat-icon matPrefix>search</mat-icon>
      <input
        #entrada
        matInput
        [formControl]="control"
        [matAutocomplete]="auto"
        placeholder="Buscar… (Ctrl+K)"
        aria-label="Búsqueda global"
        autocomplete="off"
      />
      <mat-autocomplete
        #auto="matAutocomplete"
        (optionSelected)="seleccionar($event.option.value)"
      >
        @for (g of grupos(); track g.grupo) {
          <mat-optgroup [label]="g.grupo">
            @for (r of g.items; track r.route + r.label) {
              <mat-option [value]="r">
                <mat-icon class="op-icono">{{ r.icono }}</mat-icon>
                <span class="op-label">{{ r.label }}</span>
                @if (r.sublabel) {
                  <small class="op-sub">{{ r.sublabel }}</small>
                }
              </mat-option>
            }
          </mat-optgroup>
        }
        @if (sinResultados()) {
          <mat-option [disabled]="true">Sin resultados</mat-option>
        }
      </mat-autocomplete>
    </mat-form-field>
  `,
  styles: `
    .buscador {
      width: 100%;
      max-width: 360px;
    }
    // Compacta el campo dentro de la barra superior.
    .buscador ::ng-deep .mat-mdc-form-field-infix { min-height: 40px; padding: 6px 0; }
    .buscador ::ng-deep .mat-mdc-text-field-wrapper { background: var(--mat-sys-surface-container-high); }
    .op-icono {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 6px;
      vertical-align: middle;
      color: var(--mat-sys-on-surface-variant);
    }
    .op-label { vertical-align: middle; }
    .op-sub { margin-left: 8px; color: var(--mat-sys-on-surface-variant); }
  `,
})
export class BarraBusquedaGlobal {
  private readonly buscador = inject(BuscadorGlobalService);
  private readonly router = inject(Router);

  readonly control = new FormControl('');
  readonly resultados = signal<ResultadoBusqueda[]>([]);
  private readonly entrada = viewChild.required<ElementRef<HTMLInputElement>>('entrada');

  private readonly ORDEN = ['Ir a', 'Proveedores', 'Clientes', 'Productos'];

  readonly grupos = computed(() => {
    const mapa = new Map<string, ResultadoBusqueda[]>();
    for (const r of this.resultados()) {
      const lista = mapa.get(r.grupo) ?? [];
      lista.push(r);
      mapa.set(r.grupo, lista);
    }
    return this.ORDEN.filter((g) => mapa.has(g)).map((g) => ({ grupo: g, items: mapa.get(g)! }));
  });

  readonly sinResultados = computed(
    () => (this.control.value ?? '').trim().length >= 2 && this.resultados().length === 0,
  );

  constructor() {
    this.control.valueChanges
      .pipe(
        debounceTime(250),
        map((v) => (typeof v === 'string' ? v : '').trim()),
        switchMap((q) => {
          if (q.length < 2) return of<ResultadoBusqueda[]>([]);
          const secciones = this.buscador.secciones(q);
          return this.buscador.registros(q).pipe(
            map((regs) => [...secciones, ...regs]),
            startWith(secciones),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((r) => this.resultados.set(r));
  }

  seleccionar(r: ResultadoBusqueda): void {
    // Prefiltra el listado destino reutilizando la persistencia de filtros.
    if (r.claveFiltro && r.termino) {
      sessionStorage.setItem(PREFIJO_FILTROS + r.claveFiltro, JSON.stringify({ buscar: r.termino }));
    }
    this.control.setValue('', { emitEvent: false });
    this.resultados.set([]);
    this.entrada().nativeElement.blur();
    this.router.navigateByUrl(r.route);
  }

  @HostListener('document:keydown', ['$event'])
  alTeclado(evento: KeyboardEvent): void {
    const esK = (evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k';
    const esSlash = evento.key === '/' && !this.enCampo(evento.target);
    if (esK || esSlash) {
      evento.preventDefault();
      this.entrada().nativeElement.focus();
    }
  }

  private enCampo(objetivo: EventTarget | null): boolean {
    const el = objetivo as HTMLElement | null;
    if (!el) return false;
    return (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable
    );
  }
}
