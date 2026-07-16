import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService, UPLOADS_BASE } from '../../core/api.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { CategoriaGasto, Gasto, Page } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { MoneyPipe } from '../../shared/pipes';
import { dateToIso } from '../../shared/date-utils';
import { GastoFormDialog } from './gasto-form.dialog';
import { GastosService } from './gastos.service';

@Component({
  selector: 'app-gasto-list',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule, MatDatepickerModule,
    EstadoChip, MoneyPipe, DatePipe, HasPermissionDirective,
  ],
  templateUrl: './gasto-list.page.html',
})
export class GastoListPage implements OnInit {
  private readonly servicio = inject(GastosService);
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  readonly uploadsBase = UPLOADS_BASE;
  readonly columnas = [
    'fecha', 'categoria', 'concepto', 'proveedor', 'numero_factura',
    'valor', 'adjunto', 'estado', 'acciones',
  ];
  readonly filas = signal<Gasto[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly categorias = signal<CategoriaGasto[]>([]);
  readonly exportando = signal(false);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly categoria = new FormControl<string | null>(null);
  readonly desde = new FormControl<Date | null>(null);
  readonly hasta = new FormControl<Date | null>(null);

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.categoria.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    this.desde.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    this.hasta.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());

    firstValueFrom(
      this.api.get<Page<CategoriaGasto>>('/categorias-gasto', { page_size: 100, estado: 'activo' }),
    ).then((pagina) => this.categorias.set(pagina.items));
  }

  ngOnInit(): void {
    this.cargar();
  }

  recargar(): void {
    this.page.set(1);
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.filtrar({
          page: this.page(),
          page_size: this.pageSize(),
          search: this.buscar.value || null,
          categoria_id: this.categoria.value,
          desde: dateToIso(this.desde.value),
          hasta: dateToIso(this.hasta.value),
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

  abrirFormulario(item?: Gasto): void {
    this.dialog
      .open(GastoFormDialog, { data: { item }, width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Gasto guardado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  eliminar(item: Gasto): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar gasto',
          mensaje: `¿Eliminar el gasto "${item.concepto}"? El registro quedará inactivo.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        await firstValueFrom(this.servicio.remove(item.id));
        this.snackbar.open('Gasto eliminado', 'OK', { duration: 3000 });
        this.cargar();
      });
  }

  async exportarExcel(): Promise<void> {
    this.exportando.set(true);
    try {
      await firstValueFrom(
        this.api.download('/reportes/export/gastos', 'gastos.xlsx', {
          desde: dateToIso(this.desde.value),
          hasta: dateToIso(this.hasta.value),
        }),
      );
    } catch {
      this.snackbar.open('No fue posible exportar el archivo', 'OK', { duration: 5000 });
    } finally {
      this.exportando.set(false);
    }
  }
}
