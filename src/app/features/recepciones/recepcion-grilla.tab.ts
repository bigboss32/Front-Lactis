import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Page, Ruta } from '../../core/models';
import { AuthService } from '../../core/auth/auth.service';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { RecepcionDialogData, RecepcionFormDialog } from './recepcion-form.dialog';
import { FilaGrilla, GrillaQuincena, RecepcionesService } from './recepciones.service';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** Quincena identificada por año, mes (0-11) y mitad (1: días 1-15, 2: días 16-fin). */
interface Quincena {
  anio: number;
  mes: number;
  mitad: 1 | 2;
}

function toIso(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

function quincenaDeHoy(): Quincena {
  const hoy = new Date();
  return { anio: hoy.getFullYear(), mes: hoy.getMonth(), mitad: hoy.getDate() <= 15 ? 1 : 2 };
}

/**
 * Grilla proveedores × días de la quincena, equivalente a la hoja de Excel
 * 'LITROS Y TRANSPORTE': cada celda es la recepción de un proveedor en un día.
 */
@Component({
  selector: 'app-recepcion-grilla-tab',
  imports: [
    MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule,
    MatTooltipModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    ReactiveFormsModule, MoneyPipe, CantidadPipe, DatePipe,
  ],
  templateUrl: './recepcion-grilla.tab.html',
  styles: `
    /* ------------------------------------------------- selector de quincena */
    .selector-quincena {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .etiqueta-quincena {
      min-width: 240px;
      text-align: center;
      font-size: 1.25rem;
      font-weight: 600;
    }
    .rango-quincena {
      display: block;
      font-size: 0.8rem;
      font-weight: 400;
      color: var(--mat-sys-on-surface-variant);
    }

    /* --------------------------------------------------- filtros de la grilla */
    .filtros-grilla {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 12px;
    }
    .filtros-grilla mat-form-field { min-width: 220px; }

    /* --------------------------------------------------------------- grilla */
    .grilla-card { padding: 0; overflow: hidden; }
    .grilla-scroll { overflow-x: auto; max-width: 100%; }

    table.grilla {
      width: max-content;
      min-width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 0.85rem;
    }
    .grilla th,
    .grilla td {
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      white-space: nowrap;
    }
    .grilla thead th {
      padding: 8px 6px;
      font-weight: 500;
      vertical-align: bottom;
    }

    /* Primera columna fija (proveedor) */
    .col-proveedor {
      position: sticky;
      left: 0;
      z-index: 2;
      min-width: 170px;
      max-width: 240px;
      padding: 8px 12px;
      text-align: left;
      background: var(--mat-sys-surface-container-low);
      border-right: 1px solid var(--mat-sys-outline-variant);
    }
    .prov { display: flex; flex-direction: column; white-space: normal; }
    .prov-nombre { font-weight: 700; line-height: 1.2; }
    .prov-detalle {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      line-height: 1.3;
    }

    /* Columnas de días */
    th.col-dia { min-width: 56px; text-align: center; }
    .num-dia { display: block; font-size: 1rem; font-weight: 600; }
    .abrev-dia {
      display: block;
      font-size: 0.7rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .hoy { background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent); }
    th.col-dia.hoy .num-dia { color: var(--mat-sys-primary); }

    /* Celdas proveedor × día */
    td.celda { padding: 0; text-align: center; min-width: 56px; }
    .celda-btn,
    .celda-contenido {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2px;
      width: 100%;
      min-height: 46px;
      box-sizing: border-box;
      padding: 4px 6px;
      font: inherit;
      font-variant-numeric: tabular-nums;
      color: inherit;
      border: none;
      background: transparent;
    }
    .celda-btn { cursor: pointer; }
    .celda-btn:hover,
    .celda-btn:focus-visible {
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
    }
    .celda-btn:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: -2px;
    }
    /* Celda vacía: el "+" solo se insinúa al pasar el mouse o enfocar */
    .celda-btn.vacia .mas {
      font-size: 20px;
      width: 20px;
      height: 20px;
      opacity: 0;
      color: var(--mat-sys-primary);
      transition: opacity 120ms ease;
    }
    .celda-btn.vacia:hover .mas,
    .celda-btn.vacia:focus-visible .mas { opacity: 1; }

    /* Celda liquidada: tinte verde + candado */
    .celda-contenido.liquidada {
      background: color-mix(in srgb, #2e7d32 14%, transparent);
      color: #2e7d32;
      font-weight: 500;
    }
    .celda-contenido.liquidada .candado {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    :host-context(html.dark) .celda-contenido.liquidada { color: #81c784; }

    /* Columnas de totales por proveedor */
    .col-total {
      padding: 8px 12px;
      text-align: right;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      border-left: 1px solid var(--mat-sys-outline-variant);
    }
    th.col-total { vertical-align: bottom; border-left: 1px solid var(--mat-sys-outline-variant); }

    /* Columna "Total" (leche + transporte): se resalta en color primario */
    .col-total-final { color: var(--mat-sys-primary); }
    th.col-total-final { font-weight: 700; }

    /* Fila TOTAL DÍA */
    tfoot .fila-total td {
      background: var(--mat-sys-surface-container);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      padding: 10px 6px;
      text-align: center;
      border-bottom: none;
    }
    tfoot .fila-total td.col-proveedor {
      background: var(--mat-sys-surface-container);
      text-align: left;
    }
    tfoot .fila-total td.col-total { text-align: right; }

    /* ---------------------------------------------------------------- leyenda */
    .leyenda {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 20px;
      margin-top: 12px;
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .leyenda-item { display: inline-flex; align-items: center; gap: 6px; }
    .muestra {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 22px;
      border-radius: 4px;
      border: 1px solid var(--mat-sys-outline-variant);
      font-variant-numeric: tabular-nums;
      font-weight: 500;
      color: var(--mat-sys-on-surface);
    }
    .muestra.liquidada {
      background: color-mix(in srgb, #2e7d32 14%, transparent);
      border-color: transparent;
      color: #2e7d32;
    }
    .muestra.liquidada mat-icon { font-size: 14px; width: 14px; height: 14px; }
    :host-context(html.dark) .muestra.liquidada { color: #81c784; }

    .empty-state { padding: 48px 16px; }
  `,
})
export class RecepcionGrillaTab implements OnInit {
  private readonly servicio = inject(RecepcionesService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  /** Se emite tras guardar desde la grilla, para que el listado se recargue. */
  readonly cambio = output<void>();

  readonly hoy = toIso(new Date());
  readonly quincena = signal<Quincena>(quincenaDeHoy());
  readonly grilla = signal<GrillaQuincena | null>(null);
  readonly cargando = signal(false);
  readonly rutas = signal<Ruta[]>([]);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly rutaId = new FormControl<string | null>(null);

  readonly puedeCrear = computed(() => this.auth.hasPermission('recepcion', 'crear'));
  readonly puedeEditar = computed(() => this.auth.hasPermission('recepcion', 'editar'));

  /** Rango ISO de la quincena seleccionada: 1-15 o 16-fin de mes. */
  readonly rango = computed(() => {
    const q = this.quincena();
    const inicio = new Date(q.anio, q.mes, q.mitad === 1 ? 1 : 16);
    const fin = q.mitad === 1 ? new Date(q.anio, q.mes, 15) : new Date(q.anio, q.mes + 1, 0);
    return { desde: toIso(inicio), hasta: toIso(fin) };
  });

  readonly etiqueta = computed(() => {
    const q = this.quincena();
    return `${q.mitad === 1 ? '1ª' : '2ª'} quincena de ${MESES[q.mes]} ${q.anio}`;
  });

  /** Encabezados de columna: día del mes + abreviatura del día de semana. */
  readonly dias = computed(() => {
    const g = this.grilla();
    if (!g) return [];
    return g.fechas.map((iso) => {
      const [anio, mes, dia] = iso.split('-').map(Number);
      return { iso, dia, abrev: DIAS_SEMANA[new Date(anio, mes - 1, dia).getDay()] };
    });
  });

  /** Total pagado a un proveedor en la quincena: leche (valor neto) + transporte. */
  totalFila(fila: FilaGrilla): number {
    return Number(fila.valor_neto) + Number(fila.valor_transporte);
  }

  /** Total general de la quincena: leche (valor neto) + transporte. */
  totalGrilla(g: GrillaQuincena): number {
    return Number(g.total_valor_neto) + Number(g.total_transporte);
  }

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.cargar());
    this.rutaId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.cargar());
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'recepciones-grilla',
      { buscar: this.buscar, rutaId: this.rutaId },
      this.destroyRef,
    );
    this.cargar();
    firstValueFrom(
      this.api.get<Page<Ruta>>('/rutas', { page_size: 100, estado: 'activo' }),
    ).then((r) => this.rutas.set(r.items));
  }

  anterior(): void {
    const q = this.quincena();
    if (q.mitad === 2) {
      this.quincena.set({ ...q, mitad: 1 });
    } else if (q.mes === 0) {
      this.quincena.set({ anio: q.anio - 1, mes: 11, mitad: 2 });
    } else {
      this.quincena.set({ anio: q.anio, mes: q.mes - 1, mitad: 2 });
    }
    this.cargar();
  }

  siguiente(): void {
    const q = this.quincena();
    if (q.mitad === 1) {
      this.quincena.set({ ...q, mitad: 2 });
    } else if (q.mes === 11) {
      this.quincena.set({ anio: q.anio + 1, mes: 0, mitad: 1 });
    } else {
      this.quincena.set({ anio: q.anio, mes: q.mes + 1, mitad: 1 });
    }
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const { desde, hasta } = this.rango();
      this.grilla.set(
        await firstValueFrom(
          this.servicio.grilla(desde, hasta, this.buscar.value || null, this.rutaId.value),
        ),
      );
    } catch (err) {
      this.grilla.set(null);
      this.mostrarError(err, 'No fue posible cargar la grilla');
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Clic en una celda proveedor × día:
   * - sin registro y con permiso de crear → nueva recepción prefijada;
   * - con registro no liquidado y permiso de editar → edición;
   * - liquidada o sin permiso → solo lectura (no hace nada).
   */
  async clickCelda(fila: FilaGrilla, fechaIso: string): Promise<void> {
    const celda = fila.celdas[fechaIso];
    if (!celda) {
      if (!this.puedeCrear()) return;
      this.abrirDialogo({ prefill: { fecha: fechaIso, proveedor_id: fila.proveedor_id } });
      return;
    }
    if (celda.liquidada || !this.puedeEditar()) return;
    try {
      const item = await firstValueFrom(this.servicio.getById(celda.recepcion_id));
      this.abrirDialogo({ item });
    } catch (err) {
      this.mostrarError(err, 'No fue posible abrir la recepción');
    }
  }


  private abrirDialogo(data: RecepcionDialogData): void {
    this.dialog
      .open(RecepcionFormDialog, {
        data,
        width: '640px',
        autoFocus: 'input[formcontrolname="cantidad_litros"]',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Recepción guardada', 'OK', { duration: 3000 });
          this.cargar();
          this.cambio.emit();
        }
      });
  }

  private mostrarError(err: unknown, fallback: string): void {
    const detalle =
      err instanceof HttpErrorResponse ? (err.error?.error?.detail ?? fallback) : fallback;
    this.snackbar.open(detalle, 'OK', { duration: 5000 });
  }
}
