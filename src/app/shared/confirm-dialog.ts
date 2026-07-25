import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

/**
 * Verbos que delatan una acción destructiva sobre datos ya guardados. Solo se
 * consultan cuando quien abre el diálogo no indicó `peligro`, para que las
 * confirmaciones de anular/eliminar salgan en rojo sin tener que tocar las
 * decenas de sitios que ya llaman a este diálogo.
 *
 * A propósito NO incluye «descartar»: descartar los cambios de un formulario no
 * borra nada de lo que ya está guardado y pintarlo de rojo gastaría la señal.
 * El rojo se reserva para lo que toca datos del sistema.
 *
 * OJO: la deducción es una RED DE SEGURIDAD, no la fuente de verdad. Manda lo
 * explícito: `peligro: true` para pintar de rojo y `peligro: false` para forzar
 * el aspecto neutro. Al ser una búsqueda de subcadenas puede equivocarse
 * («borrador» activa «borr», «Quitar filtro» activa «quitar», «Reiniciar el
 * conteo» activa «reinici»); si una confirmación nueva no encaja, decláralo con
 * `peligro` en vez de retocar esta expresión.
 */
const VERBOS_DESTRUCTIVOS =
  /(elimin|anul|borr|desactiv|revert|reinici|cerrar caja|cierre de caja|quitar)/i;

export interface ConfirmData {
  titulo: string;
  mensaje: string;
  accion?: string;
  /**
   * Pinta el botón de confirmar con el color de error del tema (rojo). Si se
   * omite, se deduce del texto de la acción y del título; pásalo en `false`
   * para forzar el aspecto neutro de una confirmación inofensiva.
   */
  peligro?: boolean;
}

/** Diálogo de confirmación genérico: cierra con `true` si el usuario confirma. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.titulo }}</h2>
    <mat-dialog-content>{{ data.mensaje }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button [class.btn-peligro]="peligro" [mat-dialog-close]="true">
        {{ data.accion ?? 'Eliminar' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    /*
      El tema se arma con mat.theme() (Material 3, "version 1") y en esa versión
      Angular Material no emite la clase .mat-warn de los botones, así que el
      color="warn" que había aquí no pintaba nada: el botón de anular salía
      igual de azul que un guardar. Se sobreescriben los tokens del botón
      relleno con los colores de error del sistema, que el tema ya publica con
      light-dark(): el modo oscuro sale solo y el contraste del par
      error / on-error lo garantiza el propio Material 3.
    */
    .btn-peligro {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
      --mat-button-filled-state-layer-color: var(--mat-sys-on-error);
      --mat-button-filled-ripple-color: color-mix(
        in srgb,
        var(--mat-sys-on-error) calc(var(--mat-sys-pressed-state-layer-opacity) * 100%),
        transparent
      );
    }
  `,
})
export class ConfirmDialog {
  readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);

  /** Rojo si quien abrió el diálogo lo pidió o si la acción suena destructiva. */
  readonly peligro = this.data.peligro ?? this.accionEsDestructiva();

  /**
   * Se mira la acción DECLARADA y el título, nunca el «Eliminar» que el botón
   * usa como texto por defecto: si se metiera ese texto en la deducción, una
   * confirmación que no rotula su acción se pintaría de rojo sola, sin que nadie
   * haya dicho que borra algo. El título entra porque hay llamadas que titulan
   * «Anular venta» y rotulan el botón con un verbo más suave.
   */
  private accionEsDestructiva(): boolean {
    return VERBOS_DESTRUCTIVOS.test(`${this.data.accion ?? ''} ${this.data.titulo}`);
  }
}
