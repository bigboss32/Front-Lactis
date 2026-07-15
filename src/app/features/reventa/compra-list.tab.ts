import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
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
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { AbonoFormDialog } from './abono-form.dialog';
import { AbonosListDialog } from './abonos-list.dialog';
import { CompraFormDialog } from './compra-form.dialog';
import { CompraQueso, ReventaService } from './reventa.service';

/** Pestaña de compras de queso a productores, con abonos por compra. */
@Component({
  selector: 'app-compra-list-tab',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    EstadoChip, MoneyPipe, CantidadPipe, HasPermissionDirective,
  ],
  templateUrl: './compra-list.tab.html',
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
      background: color-mix(in srgb, #b26a00 15%, transparent);
      color: #b26a00;
    }

    :host-context(html.dark) .badge-saldo { color: #ffb74d; }
  `,
})
export class CompraListTab {
  private readonly servicio = inject(ReventaService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  /** Rango de fechas que controla la página (filtro del período). */
  readonly desde = input<string | null>(null);
  readonly hasta = input<string | null>(null);
  /** Avisa a la página que hubo cambios para recargar el resumen. */
  readonly cambio = output<void>();

  readonly columnas = [
    'fecha', 'productor', 'kilos_brutos', 'merma', 'kilos_netos',
    'precio_kilo', 'valor_total', 'abonado', 'saldo', 'estado', 'acciones',
  ];
  readonly filas = signal<CompraQueso[]>([]);
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
        this.servicio.listarCompras({
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

  tieneAbonos(fila: CompraQueso): boolean {
    return Number(fila.abonado) > 0;
  }

  conSaldo(fila: CompraQueso): boolean {
    return Number(fila.saldo) > 0 && fila.estado !== 'anulada';
  }

  puedeAbonar(fila: CompraQueso): boolean {
    return fila.estado !== 'pagada' && fila.estado !== 'anulada';
  }

  nueva(): void {
    this.dialog
      .open(CompraFormDialog, { width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.snackbar.open('Compra registrada', 'OK', { duration: 3000 });
        this.notificar();
      });
  }

  editar(fila: CompraQueso): void {
    this.dialog
      .open(CompraFormDialog, { data: { item: fila }, width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.snackbar.open('Compra actualizada', 'OK', { duration: 3000 });
        this.notificar();
      });
  }

  abonar(fila: CompraQueso): void {
    this.dialog
      .open(AbonoFormDialog, {
        data: { tipo: 'compra', id: fila.id, titulo: `Abonar a ${fila.productor}`, saldo: fila.saldo },
        width: '480px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.snackbar.open('Abono registrado', 'OK', { duration: 3000 });
        this.notificar();
      });
  }

  verAbonos(fila: CompraQueso): void {
    this.dialog.open(AbonosListDialog, {
      data: { titulo: `Abonos a ${fila.productor}`, abonos: fila.abonos },
      width: '560px',
    });
  }

  anular(fila: CompraQueso): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Anular compra',
          mensaje: `¿Anular la compra a ${fila.productor}? Quedará marcada como anulada y saldrá de los saldos por pagar.`,
          accion: 'Anular',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.anularCompra(fila.id)),
          'Compra anulada',
          'No fue posible anular la compra',
        );
      });
  }

  eliminar(fila: CompraQueso): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar compra',
          mensaje: `¿Eliminar la compra a ${fila.productor}? Esta acción no se puede deshacer.`,
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.eliminarCompra(fila.id)),
          'Compra eliminada',
          'No fue posible eliminar la compra',
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
