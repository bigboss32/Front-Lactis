import { Component, input } from '@angular/core';

/** Encabezado estándar de página con espacio para acciones a la derecha. */
@Component({
  selector: 'app-page-header',
  template: `
    <header class="encabezado">
      <div>
        <h1>{{ titulo() }}</h1>
        @if (subtitulo()) {
          <p>{{ subtitulo() }}</p>
        }
      </div>
      <span class="spacer"></span>
      <ng-content />
    </header>
  `,
  styles: `
    .encabezado {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;

      h1 { margin: 0; font-size: 1.45rem; font-weight: 500; }
      p { margin: 2px 0 0; color: var(--mat-sys-on-surface-variant); font-size: 0.9rem; }
    }
  `,
})
export class PageHeader {
  readonly titulo = input.required<string>();
  readonly subtitulo = input<string>();
}
