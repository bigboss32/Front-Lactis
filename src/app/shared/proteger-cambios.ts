import { MatDialogRef } from '@angular/material/dialog';
import { FormGroup } from '@angular/forms';

/**
 * Evita perder lo tecleado al cerrar un diálogo por accidente.
 * Intercepta el clic fuera del diálogo (backdrop) y la tecla Escape: si el
 * formulario tiene cambios sin guardar, pide confirmación antes de cerrar.
 * El botón "Cancelar" sigue cerrando directo (es una acción intencional).
 *
 * Uso (una vez en el constructor del diálogo):
 *   protegerCambios(this.dialogRef, () => this.form);
 */
export function protegerCambios(
  dialogRef: MatDialogRef<unknown>,
  form: () => FormGroup,
): void {
  dialogRef.disableClose = true;

  const intentarCerrar = (): void => {
    if (!form().dirty || confirm('Tienes cambios sin guardar. ¿Deseas descartarlos?')) {
      dialogRef.close();
    }
  };

  dialogRef.backdropClick().subscribe(() => intentarCerrar());
  dialogRef.keydownEvents().subscribe((evento) => {
    if (evento.key === 'Escape') intentarCerrar();
  });
}
