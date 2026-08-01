import { Component, input } from '@angular/core';

/** Encabezado estándar de página con espacio para acciones a la derecha. */
@Component({
  selector: 'app-page-header',
  template: `
    <header class="encabezado">
      <div class="titulos">
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

      /* La barrita del color de la categoría. --seccion-viva la pone el layout
         según en qué módulo se esté, con el MISMO color que ese grupo tiene en
         el menú y que su tarjeta en Inicio: así se sabe dónde se está sin leer
         el título. Va en el bloque entero y no solo en el h1, o el subtítulo
         quedaría descolgado a la izquierda. Donde no hay categoría (Inicio,
         Estadísticas, Mi perfil) la variable no existe, el borde queda
         transparente y no se ve nada; el relleno se deja igual para que el
         título no salte de sitio al navegar de una pantalla a otra. */
      .titulos {
        border-left: 4px solid var(--seccion-viva, transparent);
        padding-left: 12px;
      }

      h1 { margin: 0; font-size: 1.45rem; font-weight: 500; }
      p { margin: 2px 0 0; color: var(--mat-sys-on-surface-variant); font-size: 0.9rem; }
    }
  `,
})
export class PageHeader {
  readonly titulo = input.required<string>();
  readonly subtitulo = input<string>();
}
