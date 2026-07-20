import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
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

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { AbonoFormDialog } from './abono-form.dialog';
import { AbonosListDialog } from './abonos-list.dialog';
import { ReventaService, VentaQueso } from './reventa.service';
import { VentaQuesoFormDialog } from './venta-form.dialog';

/** Pestaña de ventas de queso de reventa, con abonos de los clientes. */
@Component({
  selector: 'app-venta-queso-list-tab',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    EstadoChip, MoneyPipe, CantidadPipe, HasPermissionDirective,
  ],
  templateUrl: './venta-list.tab.html',
  styles: `
    .spacer { flex: 1; }

    .table-card .col-acciones { width: 230px; }

    .badge-saldo {
      display: inline-block;
      margin-left: 8px;
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 500;
      white-space: nowrap;
      background: color-mix(in srgb, #1565c0 15%, transparent);
      color: #1565c0;
    }

    :host-context(html.dark) .badge-saldo { color: #64b5f6; }

    // Chip ámbar para distinguir las ventas de borona del queso.
    .badge-borona {
      display: inline-block;
      margin-left: 8px;
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 500;
      white-space: nowrap;
      background: color-mix(in srgb, #b26a00 18%, transparent);
      color: #b26a00;
    }

    :host-context(html.dark) .badge-borona { color: #ffb74d; }
  `,
})
export class VentaQuesoListTab {
  private readonly servicio = inject(ReventaService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  /** Rango de fechas que controla la página (filtro del período). */
  readonly desde = input<string | null>(null);
  readonly hasta = input<string | null>(null);
  /** Avisa a la página que hubo cambios para recargar el resumen. */
  readonly cambio = output<void>();

  readonly columnas = [
    'fecha', 'cliente', 'kilos', 'precio_kilo', 'valor_total', 'gastos', 'venta_libre',
    'abonado', 'saldo', 'estado', 'acciones',
  ];
  readonly filas = signal<VentaQueso[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly estado = new FormControl<string | null>(null);

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.estado.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    // Recuerda los filtros de esta pestaña durante la sesión. Restaura sin
    // disparar eventos; la carga inicial del effect ya usará esos valores.
    this.estadoFiltros.vincular(
      'reventa-ventas',
      { buscar: this.buscar, estado: this.estado },
      this.destroyRef,
    );
    // Carga inicial y recarga cuando la página cambia el rango de fechas.
    effect(() => {
      this.desde();
      this.hasta();
      untracked(() => this.recargar());
    });
  }

  recargar(): void {
    this.page.set(1);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.listarVentas({
          page: this.page(),
          page_size: this.pageSize(),
          search: this.buscar.value || null,
          estado: this.estado.value,
          desde: this.desde(),
          hasta: this.hasta(),
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
    void this.cargar();
  }

  tieneAbonos(fila: VentaQueso): boolean {
    return Number(fila.abonado) > 0;
  }

  conSaldo(fila: VentaQueso): boolean {
    return Number(fila.saldo) > 0 && fila.estado !== 'anulada';
  }

  tieneGasto(fila: VentaQueso): boolean {
    return Number(fila.gasto_monto) > 0;
  }

  /** Venta libre = total de la venta menos los gastos de vender. */
  ventaLibre(fila: VentaQueso): number {
    return Number(fila.valor_total) - Number(fila.gasto_monto);
  }

  gastoTooltip(fila: VentaQueso): string {
    const concepto = fila.gasto_concepto || 'Gasto de la venta';
    const porKilo = Number(fila.gasto_por_kilo);
    return porKilo > 0 ? `${concepto} · $${porKilo.toLocaleString('es-CO')}/kg` : concepto;
  }

  puedeAbonar(fila: VentaQueso): boolean {
    return fila.estado !== 'pagada' && fila.estado !== 'anulada';
  }

  nueva(): void {
    this.dialog
      .open(VentaQuesoFormDialog, { width: '560px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.snackbar.open('Venta registrada', 'OK', { duration: 3000 });
        this.notificar();
      });
  }

  editar(fila: VentaQueso): void {
    this.dialog
      .open(VentaQuesoFormDialog, { data: { item: fila }, width: '560px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.snackbar.open('Venta actualizada', 'OK', { duration: 3000 });
        this.notificar();
      });
  }

  abonar(fila: VentaQueso): void {
    this.dialog
      .open(AbonoFormDialog, {
        data: { tipo: 'venta', id: fila.id, titulo: `Abono de ${fila.cliente}`, saldo: fila.saldo },
        width: '480px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.snackbar.open('Abono registrado', 'OK', { duration: 3000 });
        this.notificar();
      });
  }

  verAbonos(fila: VentaQueso): void {
    this.dialog
      .open(AbonosListDialog, {
        data: { titulo: `Abonos de ${fila.cliente}`, abonos: fila.abonos, tipo: 'venta', id: fila.id },
        width: '560px',
      })
      .afterClosed()
      .subscribe((cambiado) => {
        if (cambiado) this.notificar();
      });
  }

  anular(fila: VentaQueso): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Anular venta',
          mensaje: `¿Anular la venta a ${fila.cliente}? Quedará marcada como anulada y saldrá de los saldos por cobrar.`,
          accion: 'Anular',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.anularVenta(fila.id)),
          'Venta anulada',
          'No fue posible anular la venta',
        );
      });
  }

  eliminar(fila: VentaQueso): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar venta',
          mensaje: `¿Eliminar la venta a ${fila.cliente}? Esta acción no se puede deshacer.`,
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.eliminarVenta(fila.id)),
          'Venta eliminada',
          'No fue posible eliminar la venta',
        );
      });
  }

  private notificar(): void {
    void this.cargar();
    this.cambio.emit();
  }

  private async ejecutar(
    accion: () => Promise<unknown>,
    mensaje: string,
    porDefecto: string,
  ): Promise<void> {
    try {
      await accion();
      this.snackbar.open(mensaje, 'OK', { duration: 3000 });
      this.notificar();
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse ? (err.error?.error?.detail ?? porDefecto) : porDefecto;
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    }
  }
}
