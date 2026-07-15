import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { MovimientoInventario } from '../../core/models';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { MovimientosInventarioService, TIPO_MOVIMIENTO_LABELS } from './inventario.service';
import { MovimientoFormDialog } from './movimiento-form.dialog';

/** Pestaña de movimientos de inventario. Los movimientos no se editan: se corrigen con ajustes. */
@Component({
  selector: 'app-movimiento-list-tab',
  imports: [
    DatePipe, MatCardModule, MatTableModule, MatPaginatorModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, CantidadPipe, MoneyPipe, HasPermissionDirective,
  ],
  templateUrl: './movimiento-list.tab.html',
})
export class MovimientoListTab implements OnInit {
  private readonly servicio = inject(MovimientosInventarioService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  readonly columnas = ['fecha', 'producto', 'tipo', 'cantidad', 'costo_unitario', 'referencia'];
  readonly filas = signal<MovimientoInventario[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  ngOnInit(): void {
    this.cargar();
  }

  etiquetaTipo(tipo: string): string {
    return TIPO_MOVIMIENTO_LABELS[tipo] ?? tipo;
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.list({ page: this.page(), page_size: this.pageSize() }),
      );
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    this.cargar();
  }

  registrarMovimiento(): void {
    this.dialog
      .open(MovimientoFormDialog, { width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Movimiento registrado', 'OK', { duration: 3000 });
          this.page.set(1);
          this.cargar();
        }
      });
  }
}
