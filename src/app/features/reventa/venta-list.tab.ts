import { DatePipe } from '@angular/common';
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
import { EnUnidadPipe, MoneyPipe } from '../../shared/pipes';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { AbonoFormDialog } from './abono-form.dialog';
import { AbonosListDialog } from './abonos-list.dialog';
import { AdjuntosDialog } from './adjuntos.dialog';
import { ReventaEstadoCuentaDialog } from './estado-cuenta.dialog';
import { ReventaService, VentaQueso } from './reventa.service';
import { VentaQuesoFormDialog } from './venta-form.dialog';

/**
 * Pestaña de ventas de reventa, con abonos de los clientes.
 *
 * La lista mezcla los tres productos: queso y borona en KILOS y mozzarella en
 * BARRAS. La cantidad y el precio se rotulan con la unidad de CADA FILA (ver
 * `| enUnidad`) y cada producto distinto del queso lleva su distintivo.
 */
@Component({
  selector: 'app-venta-queso-list-tab',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    EstadoChip, MoneyPipe, EnUnidadPipe, HasPermissionDirective,
  ],
  templateUrl: './venta-list.tab.html',
  styles: `
    .spacer { flex: 1; }

    // Siete iconos en la fila (estado de cuenta, abonar, ver abonos, soportes,
    // editar, anular, eliminar): el ancho tiene que alcanzar para todos.
    .table-card .col-acciones { width: 315px; }

    // En celular la tabla se vuelve tarjetas y los iconos envuelven: la celda
    // toma el ancho de la tarjeta. Con un ancho fijo mayor que la pantalla el
    // primer icono quedaría recortado (ya pasó con el icono de abonos).
    @media (max-width: 700px) {
      .table-card.tarjetas .col-acciones { width: auto; }
    }

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

    // Chip verde para la mozzarella: distinto del ámbar de la borona, porque lo
    // que hay que poder distinguir de un vistazo es la UNIDAD (barras contra
    // kilos), no solo que "no es queso". Mismo color en la lista de compras.
    .badge-mozzarella {
      display: inline-block;
      margin-left: 8px;
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 500;
      white-space: nowrap;
      background: color-mix(in srgb, #2e7d32 16%, transparent);
      color: #2e7d32;
    }

    :host-context(html.dark) .badge-mozzarella { color: #81c784; }

    // La unidad del precio, en pequeño y al lado de la cifra: "$15.000 /barra".
    .por-unidad { font-size: 0.72rem; color: var(--mat-sys-on-surface-variant); }

    // Contador sobre el clip: cuántos soportes tiene la venta.
    .con-badge { position: relative; display: inline-flex; }
    .badge-adjuntos {
      position: absolute;
      top: -4px;
      right: -6px;
      min-width: 14px;
      height: 14px;
      padding: 0 3px;
      border-radius: 7px;
      font-size: 0.62rem;
      line-height: 14px;
      font-weight: 600;
      text-align: center;
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
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
  /**
   * Mensaje de la consulta fallida. Mientras esté puesto NO se muestra el estado
   * vacío: si el listado no cargó después de registrar un abono, decir que no
   * hay ventas hace que el abono se registre otra vez.
   */
  readonly errorCarga = signal<string | null>(null);
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
    this.errorCarga.set(null);
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
    } catch (err) {
      // Se limpia lo anterior: si la consulta falló, los saldos que quedaran en
      // pantalla ya no se pueden confirmar y se leerían como si fueran de hoy.
      this.filas.set([]);
      this.total.set(0);
      this.errorCarga.set(
        detalleDeError(
          err,
          'No se pudieron cargar las ventas. Revise la conexión e intente de nuevo.',
        ),
      );
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

  /**
   * "Transporte · $700/barra". La unidad del gasto es la de la VENTA: un "/kg"
   * debajo de una venta de barras sería una cifra que no significa nada, y sumar
   * mentalmente dos gastos "por unidad" de unidades distintas es justo el error
   * que hay que hacer imposible.
   */
  gastoTooltip(fila: VentaQueso): string {
    const concepto = fila.gasto_concepto || 'Gasto de la venta';
    const deBarras = fila.unidad === 'barra';
    const unitario = Number(deBarras ? fila.gasto_por_barra : fila.gasto_por_kilo);
    if (unitario <= 0) return concepto;
    const unidad = deBarras ? 'barra' : 'kg';
    return `${concepto} · $${unitario.toLocaleString('es-CO')}/${unidad}`;
  }

  puedeAbonar(fila: VentaQueso): boolean {
    return fila.estado !== 'pagada' && fila.estado !== 'anulada';
  }

  nueva(): void {
    this.dialog
      .open(VentaQuesoFormDialog, { width: '560px' })
      .afterClosed()
      .subscribe((guardada: VentaQueso | undefined) => {
        if (!guardada) return;
        this.notificar();
        // El momento de anexar la foto de la transferencia del cliente es JUSTO
        // AHORA, con el comprobante todavía en pantalla. Se ofrece desde el
        // mismo aviso: quien no va a adjuntar nada no tiene que cerrar nada.
        this.snackbar
          .open('Venta registrada', 'Anexar soporte', { duration: 8000 })
          .onAction()
          .subscribe(() => this.soportes(guardada));
      });
  }

  /** Los soportes de pago (fotos de las transferencias) de esta venta. */
  soportes(fila: VentaQueso): void {
    this.dialog
      .open(AdjuntosDialog, {
        data: {
          tipo: 'venta',
          id: fila.id,
          titulo: `Venta a ${fila.cliente} · ${fila.fecha}`,
        },
        width: '720px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((cambiado) => {
        // Solo si cambió algo: el contador del clip sale del listado.
        if (cambiado) this.notificar();
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

  /**
   * Estado de cuenta del cliente de la fila: junta TODAS sus ventas (no solo
   * esta) para poder compartírselo en PDF o por WhatsApp.
   */
  estadoCuenta(fila: VentaQueso): void {
    this.dialog.open(ReventaEstadoCuentaDialog, {
      data: { cliente: fila.cliente, desde: this.desde(), hasta: this.hasta() },
      width: '720px',
      maxWidth: '95vw',
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
      // Anular/registrar SÍ guardan: si el resultado quedó en duda, el aviso se
      // queda hasta que el usuario lo cierre (ver shared/errores-ui.ts).
      avisarErrorAlGuardar(this.snackbar, err, porDefecto);
    }
  }
}
