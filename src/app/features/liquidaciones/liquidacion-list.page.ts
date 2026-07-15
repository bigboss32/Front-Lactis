import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Liquidacion } from '../../core/models';
import { EstadoChip } from '../../shared/estado-chip';
import { PageHeader } from '../../shared/page-header';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { GenerarQuincenaDialog } from './generar-quincena.dialog';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/** Conteos y saldos por estado para las tarjetas resumen. */
interface ResumenEstados {
  borradores: number;
  aprobadas: number;
  saldoAprobadas: number;
  pagadas: number;
}

@Component({
  selector: 'app-liquidacion-list',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    PageHeader, EstadoChip, MoneyPipe, CantidadPipe, HasPermissionDirective,
  ],
  templateUrl: './liquidacion-list.page.html',
  styles: `
    // ------------------------------------------------- tarjetas resumen
    .resumen-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }

    .tarjeta {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      min-height: 76px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;

      &:hover { background: var(--mat-sys-surface-container); }

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }

      &.activa {
        border-color: var(--color-tarjeta);
        box-shadow: inset 0 0 0 1px var(--color-tarjeta);
        background: color-mix(in srgb, var(--color-tarjeta) 8%, transparent);
      }

      .icono {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        flex-shrink: 0;
        background: color-mix(in srgb, var(--color-tarjeta) 15%, transparent);
        color: var(--color-tarjeta);
      }

      .textos {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .cifra { font-size: 1.4rem; font-weight: 600; line-height: 1.2; }
      .titulo { font-size: 0.85rem; color: var(--mat-sys-on-surface-variant); }
      .detalle { font-size: 0.8rem; font-weight: 500; color: var(--color-tarjeta); }
    }

    // Mismos tonos que estado-chip: ámbar/azul/verde.
    .tarjeta.ambar { --color-tarjeta: #b26a00; }
    .tarjeta.azul  { --color-tarjeta: #1565c0; }
    .tarjeta.verde { --color-tarjeta: #2e7d32; }

    :host-context(html.dark) {
      .tarjeta.ambar { --color-tarjeta: #ffb74d; }
      .tarjeta.azul  { --color-tarjeta: #64b5f6; }
      .tarjeta.verde { --color-tarjeta: #81c784; }
    }

    // -------------------------------------- borde de fila según estado
    tr.fila-borrador td:first-child { border-left: 4px solid color-mix(in srgb, #b26a00 75%, transparent); }
    tr.fila-aprobada td:first-child { border-left: 4px solid color-mix(in srgb, #1565c0 75%, transparent); }
    tr.fila-pagada td:first-child   { border-left: 4px solid color-mix(in srgb, #2e7d32 75%, transparent); }
    tr.fila-anulada td:first-child  { border-left: 4px solid color-mix(in srgb, #c62828 60%, transparent); }

    :host-context(html.dark) {
      tr.fila-borrador td:first-child { border-left-color: color-mix(in srgb, #ffb74d 75%, transparent); }
      tr.fila-aprobada td:first-child { border-left-color: color-mix(in srgb, #64b5f6 75%, transparent); }
      tr.fila-pagada td:first-child   { border-left-color: color-mix(in srgb, #81c784 75%, transparent); }
      tr.fila-anulada td:first-child  { border-left-color: color-mix(in srgb, #e57373 60%, transparent); }
    }

    // ------------------------------------------- mini-badge "por pagar"
    .badge-por-pagar {
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

    :host-context(html.dark) .badge-por-pagar { color: #64b5f6; }
  `,
})
export class LiquidacionListPage implements OnInit {
  private readonly servicio = inject(LiquidacionesService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  readonly columnas = [
    'tipo', 'tercero', 'periodo', 'litros', 'valor_total', 'anticipos', 'saldo', 'estado', 'acciones',
  ];
  readonly filas = signal<Liquidacion[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly exportando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly resumen = signal<ResumenEstados | null>(null);

  readonly tipo = new FormControl<string | null>(null);
  readonly estado = new FormControl<string | null>(null);
  readonly desde = new FormControl<string | null>(null);
  readonly hasta = new FormControl<string | null>(null);

  constructor() {
    for (const control of [this.tipo, this.estado, this.desde, this.hasta]) {
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    }
  }

  ngOnInit(): void {
    this.cargar();
    void this.cargarResumen();
  }

  recargar(): void {
    this.page.set(1);
    this.cargar();
    void this.cargarResumen();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.list({
          page: this.page(),
          page_size: this.pageSize(),
          tipo: this.tipo.value,
          estado: this.estado.value,
          desde: this.desde.value,
          hasta: this.hasta.value,
        }),
      );
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Carga los conteos por estado para las tarjetas resumen respetando los
   * filtros de tipo y fechas (no el de estado, que es el que las tarjetas
   * controlan). Usa `total` de páginas de tamaño 1 para contar; para las
   * aprobadas trae hasta 200 filas (máximo del backend) y suma los saldos.
   */
  async cargarResumen(): Promise<void> {
    const filtros = {
      tipo: this.tipo.value,
      desde: this.desde.value,
      hasta: this.hasta.value,
    };
    try {
      const [borradores, aprobadas, pagadas] = await Promise.all([
        firstValueFrom(this.servicio.list({ ...filtros, estado: 'borrador', page: 1, page_size: 1 })),
        firstValueFrom(this.servicio.list({ ...filtros, estado: 'aprobada', page: 1, page_size: 200 })),
        firstValueFrom(this.servicio.list({ ...filtros, estado: 'pagada', page: 1, page_size: 1 })),
      ]);
      this.resumen.set({
        borradores: borradores.total,
        aprobadas: aprobadas.total,
        saldoAprobadas: aprobadas.items.reduce((suma, liq) => suma + Number(liq.saldo), 0),
        pagadas: pagadas.total,
      });
    } catch {
      this.resumen.set(null);
    }
  }

  /** Clic en una tarjeta resumen: aplica (o quita) el filtro de estado. */
  filtrarPorEstado(estado: string): void {
    this.estado.setValue(this.estado.value === estado ? null : estado);
  }

  /** Saldo pendiente real: liquidación aprobada con saldo mayor a cero. */
  esPorPagar(fila: Liquidacion): boolean {
    return fila.estado === 'aprobada' && Number(fila.saldo) > 0;
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    this.cargar();
  }

  abrirGenerar(): void {
    this.dialog
      .open(GenerarQuincenaDialog, { width: '520px' })
      .afterClosed()
      .subscribe((generadas) => {
        if (typeof generadas !== 'number') return;
        const mensaje =
          generadas === 0
            ? 'No había recepciones pendientes por liquidar en el período'
            : `Se generaron ${generadas} liquidaciones`;
        this.snackbar.open(mensaje, 'OK', { duration: 4000 });
        if (generadas > 0) this.recargar();
      });
  }

  verDetalle(fila: Liquidacion): void {
    this.dialog
      .open(LiquidacionDetailDialog, { data: { item: fila }, width: '760px' })
      .afterClosed()
      .subscribe(() => {
        this.cargar();
        void this.cargarResumen();
      });
  }

  async exportarExcel(): Promise<void> {
    const desde = this.desde.value;
    const hasta = this.hasta.value;
    if (!desde || !hasta) {
      this.snackbar.open('Selecciona el rango de fechas (desde y hasta) para exportar', 'OK', {
        duration: 4000,
      });
      return;
    }
    this.exportando.set(true);
    try {
      await firstValueFrom(this.servicio.exportarExcel(desde, hasta));
    } catch {
      this.snackbar.open('No fue posible exportar: verifica que existan liquidaciones en el período', 'OK', {
        duration: 5000,
      });
    } finally {
      this.exportando.set(false);
    }
  }
}
