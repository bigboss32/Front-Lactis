import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { ProductoStock } from '../../core/models';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { CantidadPipe } from '../../shared/pipes';
import { CATEGORIA_LABELS, ProductosService } from './inventario.service';
import { KardexDialog } from './kardex.dialog';

@Component({
  selector: 'app-stock-list-tab',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatSlideToggleModule, MatButtonModule, MatIconModule, MatProgressBarModule,
    MatTooltipModule, CantidadPipe, HasPermissionDirective,
  ],
  templateUrl: './stock-list.tab.html',
  styles: `
    .icono-alerta { color: var(--mat-sys-error); vertical-align: middle; }
  `,
})
export class StockListTab implements OnInit {
  private readonly servicio = inject(ProductosService);
  private readonly dialog = inject(MatDialog);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly columnas = ['producto', 'categoria', 'unidad', 'stock_actual', 'stock_minimo', 'alerta', 'acciones'];
  readonly filas = signal<ProductoStock[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  readonly soloBajoMinimo = new FormControl(false, { nonNullable: true });

  constructor() {
    this.soloBajoMinimo.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.recargar());
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'inventario-stock',
      { soloBajoMinimo: this.soloBajoMinimo },
      this.destroyRef,
    );
    this.cargar();
  }

  etiquetaCategoria(categoria: string): string {
    return CATEGORIA_LABELS[categoria] ?? categoria;
  }

  recargar(): void {
    this.page.set(1);
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.stockActual({
          page: this.page(),
          page_size: this.pageSize(),
          solo_bajo_minimo: this.soloBajoMinimo.value,
        }),
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

  verKardex(item: ProductoStock): void {
    this.dialog.open(KardexDialog, {
      data: { productoId: item.id, nombre: item.nombre },
      width: '760px',
    });
  }
}
