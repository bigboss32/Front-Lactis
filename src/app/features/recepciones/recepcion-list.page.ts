import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal, viewChild } from '@angular/core';
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
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Page, Proveedor, Recepcion, ResumenPeriodo } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { PageHeader } from '../../shared/page-header';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { RecepcionFormDialog } from './recepcion-form.dialog';
import { RecepcionGrillaTab } from './recepcion-grilla.tab';
import { RecepcionesService } from './recepciones.service';

function toIso(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/** Quincena actual: del 1 (o del 16) hasta hoy, según el día del mes. */
function quincenaActual(): { desde: string; hasta: string } {
  const hoy = new Date();
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() <= 15 ? 1 : 16);
  return { desde: toIso(inicio), hasta: toIso(hoy) };
}

@Component({
  selector: 'app-recepcion-list',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule, MatTabsModule,
    PageHeader, MoneyPipe, CantidadPipe, DatePipe, HasPermissionDirective,
    RecepcionGrillaTab,
  ],
  templateUrl: './recepcion-list.page.html',
  styles: `
    .tab-panel { padding-top: 16px; }
    .tab-icono { margin-right: 8px; }

    .resumen-card {
      margin-bottom: 16px;
      padding: 16px;
    }
    .resumen-titulo {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 12px;
      font-weight: 500;
    }
    .resumen-rango {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.85rem;
    }
    .resumen-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }
    .stat { display: flex; flex-direction: column; }
    .stat .valor { font-size: 1.15rem; font-weight: 600; }
    .stat .etiqueta { color: var(--mat-sys-on-surface-variant); font-size: 0.8rem; }

    .liq {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.85rem;
      white-space: nowrap;
    }
    .liq mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .liq.liquidada { color: #2e7d32; }
    .liq.pendiente { color: var(--mat-sys-on-surface-variant); }
    :host-context(html.dark) .liq.liquidada { color: #81c784; }
  `,
})
export class RecepcionListPage implements OnInit {
  private readonly servicio = inject(RecepcionesService);
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  /** Pestaña de grilla: se recarga cuando se guarda o elimina desde el listado. */
  private readonly grillaTab = viewChild(RecepcionGrillaTab);

  readonly columnas = [
    'fecha', 'proveedor', 'litros', 'precio_litro', 'valor_bruto',
    'descuentos', 'valor_neto', 'liquidacion', 'acciones',
  ];
  readonly filas = signal<Recepcion[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly resumen = signal<ResumenPeriodo | null>(null);
  readonly proveedores = signal<Proveedor[]>([]);
  readonly exportando = signal(false);

  readonly desde = new FormControl(quincenaActual().desde, { nonNullable: true });
  readonly hasta = new FormControl(quincenaActual().hasta, { nonNullable: true });
  readonly proveedorId = new FormControl<string | null>(null);

  constructor() {
    this.desde.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.hasta.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.proveedorId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
  }

  ngOnInit(): void {
    this.cargar();
    this.cargarResumen();
    firstValueFrom(
      this.api.get<Page<Proveedor>>('/proveedores', { page_size: 100, estado: 'activo' }),
    ).then((respuesta) => this.proveedores.set(respuesta.items));
  }

  recargar(): void {
    this.page.set(1);
    this.cargar();
    this.cargarResumen();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.filtrar({
          page: this.page(),
          page_size: this.pageSize(),
          proveedor_id: this.proveedorId.value,
          desde: this.desde.value || null,
          hasta: this.hasta.value || null,
        }),
      );
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarResumen(): Promise<void> {
    const desde = this.desde.value;
    const hasta = this.hasta.value;
    if (!desde || !hasta) {
      this.resumen.set(null);
      return;
    }
    try {
      this.resumen.set(await firstValueFrom(this.servicio.resumenPeriodo(desde, hasta)));
    } catch {
      this.resumen.set(null);
    }
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    this.cargar();
  }

  /** Al guardar desde la grilla, sincroniza el listado y el resumen. */
  alCambiarGrilla(): void {
    this.cargar();
    this.cargarResumen();
  }

  abrirFormulario(item?: Recepcion): void {
    this.dialog
      .open(RecepcionFormDialog, { data: { item }, width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Recepción guardada', 'OK', { duration: 3000 });
          this.cargar();
          this.cargarResumen();
          this.grillaTab()?.cargar();
        }
      });
  }

  eliminar(item: Recepcion): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar recepción',
          mensaje: `¿Eliminar la recepción de "${item.proveedor_nombre ?? 'proveedor'}" del ${item.fecha}?`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(this.servicio.remove(item.id));
          this.snackbar.open('Recepción eliminada', 'OK', { duration: 3000 });
          this.cargar();
          this.cargarResumen();
          this.grillaTab()?.cargar();
        } catch (err) {
          const detalle =
            err instanceof HttpErrorResponse
              ? (err.error?.error?.detail ?? 'No fue posible eliminar')
              : 'No fue posible eliminar';
          this.snackbar.open(detalle, 'OK', { duration: 5000 });
        }
      });
  }

  async exportar(): Promise<void> {
    this.exportando.set(true);
    try {
      await firstValueFrom(
        this.api.download('/reportes/export/recepciones', 'recepciones.xlsx', {
          desde: this.desde.value || null,
          hasta: this.hasta.value || null,
        }),
      );
    } catch {
      this.snackbar.open('No fue posible exportar el archivo', 'OK', { duration: 5000 });
    } finally {
      this.exportando.set(false);
    }
  }
}
