import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, ReactiveFormsModule } from '@angular/forms';
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
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Cliente, Page, Venta } from '../../core/models';
import { EstadoChip } from '../../shared/estado-chip';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { PageHeader } from '../../shared/page-header';
import { MoneyPipe } from '../../shared/pipes';
import { RangoFechasRapido } from '../../shared/rango-fechas-rapido';
import { ordenarFilas } from '../../shared/ordenar-tabla';
import { dateToIso } from '../../shared/date-utils';
import { VentaDetailDialog } from './venta-detail.dialog';
import { VentaFormDialog } from './venta-form.dialog';
import { VentasService } from './ventas.service';

@Component({
  selector: 'app-venta-list',
  imports: [
    ReactiveFormsModule, DatePipe, RouterLink,
    MatCardModule, MatTableModule, MatPaginatorModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatIconModule,
    MatProgressBarModule, MatTooltipModule, MatDatepickerModule,
    PageHeader, EstadoChip, MoneyPipe, HasPermissionDirective,
    RangoFechasRapido, MatSortModule,
  ],
  templateUrl: './venta-list.page.html',
  styles: `
    .fila-click { cursor: pointer; }
    .fila-click:hover td { background: color-mix(in srgb, currentColor 5%, transparent); }
  `,
})
export class VentaListPage implements OnInit {
  private readonly servicio = inject(VentasService);
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly columnas = ['numero', 'fecha', 'tipo', 'cliente', 'total', 'pagado', 'saldo', 'estado'];
  readonly filas = signal<Venta[]>([]);
  readonly orden = signal<Sort>({ active: '', direction: '' });
  readonly filasOrdenadas = computed(() =>
    ordenarFilas(this.filas(), this.orden(), {
      cliente: (f) => f.cliente_nombre,
      total: (f) => Number(f.total),
      pagado: (f) => Number(f.pagado),
      saldo: (f) => Number(f.saldo),
    }),
  );
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly clientes = signal<Cliente[]>([]);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  readonly clienteId = new FormControl<string | null>(null);
  readonly tipo = new FormControl<string | null>(null);
  readonly estado = new FormControl<string | null>(null);
  readonly desde = new FormControl<Date | null>(null);
  readonly hasta = new FormControl<Date | null>(null);

  constructor() {
    const filtros: AbstractControl[] = [this.clienteId, this.tipo, this.estado, this.desde, this.hasta];
    for (const control of filtros) {
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    }
    firstValueFrom(
      this.api.get<Page<Cliente>>('/clientes', { page_size: 100, estado: 'activo' }),
    ).then((pagina) => this.clientes.set(pagina.items));
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'ventas',
      {
        clienteId: this.clienteId,
        tipo: this.tipo,
        estado: this.estado,
        desde: this.desde,
        hasta: this.hasta,
      },
      this.destroyRef,
    );
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
        this.servicio.list({
          page: this.page(),
          page_size: this.pageSize(),
          cliente_id: this.clienteId.value,
          tipo: this.tipo.value,
          estado: this.estado.value,
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

  abrirFormulario(): void {
    this.dialog
      .open(VentaFormDialog, { width: '800px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Venta registrada', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  abrirDetalle(venta: Venta): void {
    this.dialog
      .open(VentaDetailDialog, { data: { venta }, width: '760px' })
      .afterClosed()
      .subscribe((huboCambios) => {
        if (huboCambios) this.cargar();
      });
  }

}
