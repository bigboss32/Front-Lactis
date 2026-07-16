import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Empresa } from '../../core/models';
import { EmpresasService } from './empresas.service';

/**
 * Diálogo para reiniciar (borrar) los datos transaccionales de una empresa.
 * Acción irreversible: exige escribir el nombre exacto de la empresa para
 * habilitar el botón. Cierra con `true` si el reinicio fue exitoso.
 */
@Component({
  selector: 'app-reiniciar-empresa',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>Reiniciar datos de {{ data.empresa.nombre }}</h2>
    <mat-dialog-content>
      <div class="advertencia">
        <mat-icon>warning</mat-icon>
        <p>
          Esta acción borra permanentemente TODOS los movimientos (ventas, pagos,
          recepciones, liquidaciones, producción, inventario, gastos, caja, bancos,
          reventa y nómina) de esta empresa. Se conservan los catálogos y usuarios.
          NO se puede deshacer.
        </p>
      </div>
      <mat-form-field class="campo-nombre">
        <mat-label>Escribe el nombre de la empresa para confirmar</mat-label>
        <input
          matInput
          [formControl]="confirmacion"
          autocomplete="off"
          (keyup.enter)="confirmar()"
        />
        <mat-hint>Escribe exactamente: <strong>{{ data.empresa.nombre }}</strong></mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        color="warn"
        type="button"
        [disabled]="!coincide() || guardando()"
        (click)="confirmar()"
      >
        Reiniciar
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .advertencia {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        padding: 12px 16px;
        margin-bottom: 16px;
        border-radius: 8px;
        color: var(--mat-sys-error);
        background: color-mix(in srgb, var(--mat-sys-error) 12%, transparent);
      }
      .advertencia mat-icon {
        flex: 0 0 auto;
      }
      .advertencia p {
        margin: 0;
      }
      .campo-nombre {
        width: 100%;
      }
    `,
  ],
})
export class ReiniciarEmpresaDialog {
  private readonly servicio = inject(EmpresasService);
  private readonly dialogRef = inject(MatDialogRef<ReiniciarEmpresaDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ empresa: Empresa }>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  readonly confirmacion = new FormControl('', { nonNullable: true });
  private readonly valor = toSignal(this.confirmacion.valueChanges, {
    initialValue: this.confirmacion.value,
  });

  /** El botón se habilita solo si el texto coincide exactamente (sin espacios extremos). */
  readonly coincide = computed(() => this.valor().trim() === this.data.empresa.nombre.trim());

  async confirmar(): Promise<void> {
    if (!this.coincide() || this.guardando()) return;
    this.guardando.set(true);
    try {
      await firstValueFrom(
        this.servicio.reiniciar(this.data.empresa.id, this.confirmacion.value.trim()),
      );
      this.snackbar.open('Datos reiniciados', 'OK', { duration: 3000 });
      this.dialogRef.close(true);
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible reiniciar')
          : 'No fue posible reiniciar';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
