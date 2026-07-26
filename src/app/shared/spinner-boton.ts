import { Component } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

/**
 * Spinner pequeño para poner DENTRO de un botón mientras se está guardando.
 *
 * Por qué existe: el botón deshabilitado, por sí solo, no se distingue de un
 * botón que no recibió el toque. En la finca la señal es mala y el backend de
 * Render arranca en frío (puede tardar 30-60 segundos), así que sin señal visible
 * el usuario no sabe si el abono va en camino o si se colgó, y si decide repetirlo
 * lo registra dos veces. Va acompañado del texto en gerundio («Registrando
 * abono…»), que es lo que de verdad se lee en un celular.
 *
 * El indicador se pinta con `--mat-sys-primary` y NO con `currentColor`.
 * Heredar el color parecía lo elegante, pero el spinner se muestra siempre con
 * el botón DESHABILITADO, y ahí Material baja el texto a un gris translúcido:
 * medido en vivo daba un trazo rgb(148,148,152) sobre fondo rgb(223,222,226),
 * o sea 2,26:1, por debajo del mínimo de 3:1 que pide la WCAG (1.4.11) para
 * componentes no textuales. En un celular al sol simplemente no se veía, que es
 * justo cuando más falta hace. `--mat-sys-primary` es un color de sistema opaco,
 * sigue el tema claro/oscuro y queda muy por encima de 3:1.
 */
@Component({
  selector: 'app-spinner-boton',
  imports: [MatProgressSpinnerModule],
  template: `<mat-spinner diameter="18" aria-hidden="true" />`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      margin-right: 8px;
      --mat-progress-spinner-active-indicator-color: var(--mat-sys-primary);
    }
  `,
})
export class SpinnerBoton {}
