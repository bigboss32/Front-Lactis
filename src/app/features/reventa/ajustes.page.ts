import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Monto } from '../../core/models';
import { CantidadPipe } from '../../shared/pipes';
import { ConversionFormDialog } from './conversion-form.dialog';
import { ConversionListPanel } from './conversion-list.panel';
import { ReventaFiltroService } from './reventa-filtro.service';
import { hoyIso, ReventaService } from './reventa.service';

/**
 * Sub-página de ajustes de inventario del queso de reventa: pasar queso a
 * borona o registrar merma, y el historial de esos ajustes.
 */
@Component({
  selector: 'app-reventa-ajustes',
  imports: [MatButtonModule, MatIconModule, CantidadPipe, HasPermissionDirective, ConversionListPanel],
  template: `
    <div class="panel">
      <div class="acciones">
        <span class="disponible">
          Queso disponible: <strong>{{ disponible() | cantidad: 'kg' }}</strong>
        </span>
        <span class="spacer"></span>
        <button mat-stroked-button *hasPermission="'reventa:crear'" (click)="pasarABorona()">
          <mat-icon>recycling</mat-icon> Pasar queso a borona
        </button>
        <button mat-stroked-button *hasPermission="'reventa:crear'" (click)="registrarMerma()">
          <mat-icon>scale</mat-icon> Registrar merma
        </button>
      </div>

      <p class="ayuda">
        Usa "Pasar a borona" para el queso que se vende como subproducto, y
        "Registrar merma" para el queso que se perdió (baja el disponible sin sumar
        a ningún lado). Ambos dejan el inventario al día para cerrar la temporada.
      </p>

      <app-conversion-list-panel [recargar]="recargaConversiones()" (cambio)="cargarDisponible()" />
    </div>
  `,
  styles: `
    .panel { display: block; padding-top: 8px; }

    .acciones {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .acciones .spacer { flex: 1 1 auto; }
    .acciones .disponible {
      font-size: 0.95rem;
      color: var(--mat-sys-on-surface-variant);
      strong { color: var(--mat-sys-on-surface); font-variant-numeric: tabular-nums; }
    }

    .ayuda {
      margin: 0 0 12px;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class ReventaAjustesPage {
  private readonly servicio = inject(ReventaService);
  private readonly filtro = inject(ReventaFiltroService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  readonly disponible = signal<Monto>(0);
  /** Se incrementa para forzar la recarga del historial de ajustes. */
  readonly recargaConversiones = signal(0);

  constructor() {
    void this.cargarDisponible();
  }

  async cargarDisponible(): Promise<void> {
    // kilos_disponibles es acumulado (no depende del período); cualquier rango sirve.
    const desde = this.filtro.desdeIso() ?? hoyIso();
    const hasta = this.filtro.hastaIso() ?? hoyIso();
    try {
      const r = await firstValueFrom(this.servicio.resumen(desde, hasta));
      this.disponible.set(r.kilos_disponibles);
    } catch {
      // Si falla, se deja el disponible como estaba.
    }
  }

  pasarABorona(): void {
    this.abrir('borona', 'Queso pasado a borona');
  }

  registrarMerma(): void {
    this.abrir('merma', 'Merma registrada');
  }

  private abrir(destino: 'borona' | 'merma', mensaje: string): void {
    this.dialog
      .open(ConversionFormDialog, {
        data: { disponible: this.disponible(), destino },
        width: '480px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.snackbar.open(mensaje, 'OK', { duration: 3000 });
        this.recargaConversiones.update((n) => n + 1);
        void this.cargarDisponible();
      });
  }
}
