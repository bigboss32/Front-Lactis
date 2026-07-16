import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { CajaDiaria, Page, Sucursal } from '../../core/models';
import { EstadoChip } from '../../shared/estado-chip';
import { PageHeader } from '../../shared/page-header';
import { MoneyPipe } from '../../shared/pipes';
import { dateToIso } from '../../shared/date-utils';
import { AbrirCajaDialog } from './abrir-caja.dialog';
import { CajaDetalleDialog } from './caja-detalle.dialog';
import { CajaService } from './caja.service';

@Component({
  selector: 'app-caja-list',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatDatepickerModule,
    PageHeader, EstadoChip, MoneyPipe, HasPermissionDirective,
  ],
  templateUrl: './caja-list.page.html',
  styles: `
    .fila-caja { cursor: pointer; }
    .negativo { color: var(--mat-sys-error); }
  `,
})
export class CajaListPage implements OnInit {
  private readonly servicio = inject(CajaService);
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  readonly columnas = [
    'fecha', 'sucursal', 'saldo_inicial', 'total_ingresos', 'total_egresos',
    'saldo_final', 'estado', 'diferencia',
  ];
  readonly filas = signal<CajaDiaria[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly sucursales = signal<Map<string, string>>(new Map());

  readonly estado = new FormControl<string | null>(null);
  readonly desde = new FormControl<Date | null>(null);
  readonly hasta = new FormControl<Date | null>(null);

  constructor() {
    this.estado.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    this.desde.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    this.hasta.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
  }

  ngOnInit(): void {
    this.cargar();
    // Catálogo para mostrar el nombre de la sucursal; se ignora si el usuario no tiene acceso.
    firstValueFrom(this.api.get<Page<Sucursal>>('/sucursales', { page_size: 100 }))
      .then((pagina) =>
        this.sucursales.set(new Map(pagina.items.map((s) => [s.id, s.nombre]))),
      )
      .catch(() => this.sucursales.set(new Map()));
  }

  sucursalNombre(id: string | null): string {
    if (!id) return '—';
    return this.sucursales().get(id) ?? '—';
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

  abrirCaja(): void {
    this.dialog
      .open(AbrirCajaDialog, { width: '480px' })
      .afterClosed()
      .subscribe((abierta) => {
        if (abierta) {
          this.snackbar.open('Caja abierta', 'OK', { duration: 3000 });
          this.recargar();
        }
      });
  }

  verDetalle(item: CajaDiaria): void {
    this.dialog
      .open(CajaDetalleDialog, { data: { cajaId: item.id }, width: '760px' })
      .afterClosed()
      .subscribe((cambios) => {
        if (cambios) this.cargar();
      });
  }
}
