import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
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
import { MatSortModule, Sort } from '@angular/material/sort';
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
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { MoneyPipe } from '../../shared/pipes';
import { ordenarFilas } from '../../shared/ordenar-tabla';
import { comoFecha, dateToIso } from '../../shared/date-utils';
import { RangoFechasRapido } from '../../shared/rango-fechas-rapido';
import { SoportesDialog } from '../../shared/soportes.dialog';
import { SoportesResultado } from '../../shared/soportes.model';
import { GastoFormDialog } from './gasto-form.dialog';
import { GastosService } from './gastos.service';

@Component({
  selector: 'app-gasto-list',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule, MatDatepickerModule,
    EstadoChip, MoneyPipe, DatePipe, HasPermissionDirective, RangoFechasRapido,
    MatSortModule,
  ],
  templateUrl: './gasto-list.page.html',
  styles: [
    `
      /* Contador sobre el clip: cuántas facturas tiene el gasto. */
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
      /* La factura vieja, la que quedó en la carpeta del servidor. */
      .factura-vieja { color: var(--mat-sys-on-surface-variant); }
      .total-filtrado {
        margin-right: 16px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .total-filtrado .rotulo { color: var(--mat-sys-on-surface-variant); }
      .total-filtrado .cifra { font-weight: 500; }
    `,
  ],
})
export class GastoListPage implements OnInit {
  private readonly servicio = inject(GastosService);
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly uploadsBase = UPLOADS_BASE;
  readonly columnas = [
    'fecha', 'categoria', 'concepto', 'proveedor', 'numero_factura',
    'valor', 'adjunto', 'estado', 'acciones',
  ];
  /**
   * Cuánto suman TODOS los gastos filtrados, no los de la página.
   *
   * Es lo mismo que ya se hace en anticipos y lo pidió el dueño con esas palabras:
   * él filtra "combustible de julio", ve tres páginas y lo que necesita saber es
   * cuánto se le fue ese mes, no cuánto suman las veinte filas que alcanza a ver.
   */
  readonly sumaTotal = signal(0);
  readonly filas = signal<Gasto[]>([]);
  readonly orden = signal<Sort>({ active: '', direction: '' });
  readonly filasOrdenadas = computed(() =>
    ordenarFilas(this.filas(), this.orden(), {
      categoria: (f) => f.categoria_nombre,
      valor: (f) => Number(f.valor),
    }),
  );
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly categorias = signal<CategoriaGasto[]>([]);

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
    this.estadoFiltros.vincular(
      'gastos',
      { buscar: this.buscar, categoria: this.categoria, desde: this.desde, hasta: this.hasta },
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
      // LOS DOS FILTROS SON EL MISMO OBJETO, no dos copias parecidas: la tabla y
      // el total tienen que estar mirando lo mismo, porque el dueño suma los
      // renglones a mano para comprobar la cifra.
      const filtros = {
        search: this.buscar.value || null,
        categoria_id: this.categoria.value,
        desde: dateToIso(this.desde.value),
        hasta: dateToIso(this.hasta.value),
      };
      const [respuesta, suma] = await Promise.all([
        firstValueFrom(
          this.servicio.filtrar({
            ...filtros,
            page: this.page(),
            page_size: this.pageSize(),
          }),
        ),
        firstValueFrom(this.servicio.sumaTotales(filtros)),
      ]);
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
      this.sumaTotal.set(suma ?? 0);
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

  /**
   * EL RÓTULO DEL CLIP DICE SI YA TIENE FACTURA Y CUÁNTAS.
   *
   * Va en el tooltip y en el aria-label, que es el mismo texto: quien no ve el
   * número tampoco puede adivinarlo por el color del punto.
   */
  rotuloFacturas(fila: Gasto): string {
    const cuantas = fila.adjuntos_count ?? 0;
    if (cuantas === 0) return 'Sin factura · toque para subirla';
    if (cuantas === 1) return 'Ver la factura (1)';
    return `Ver las facturas (${cuantas})`;
  }

  /**
   * Abre las facturas del gasto.
   *
   * EL CLIP SALE SIEMPRE, también cuando no hay ninguna: si solo apareciera con
   * factura ya subida, no habría por dónde subir la primera. Basta
   * 'gastos:consultar' para abrirlo —es lo mismo que ver el gasto— y adentro cada
   * botón pide lo suyo.
   */
  facturasDel(fila: Gasto): void {
    this.dialog
      .open(SoportesDialog, {
        data: {
          // "Soportes de pago" —el encabezado por defecto— diría que este gasto
          // ya se pagó, y una factura es justo lo contrario: lo que hay que pagar.
          encabezado: 'Factura del gasto',
          vacio: 'Todavía no hay factura. Anéxela como foto o PDF.',
          titulo: `${fila.concepto} · ${comoFecha(fila.fecha)}`,
          ayuda:
            'La factura queda guardada dentro del sistema, no en una dirección ' +
            'pública: se abre desde aquí y el enlace caduca solo. Caben varias ' +
            '(las hojas de una misma factura) o el PDF.',
          permisos: {
            subir: 'gastos:editar',
            compartir: 'gastos:exportar',
            eliminar: 'gastos:eliminar',
          },
          listar: () => this.servicio.adjuntos(fila.id),
          subir: (archivos: File[]) => this.servicio.subirAdjuntos(fila.id, archivos),
          compartir: (adjuntoId: string) => this.servicio.compartirAdjunto(adjuntoId),
          eliminar: (adjuntoId: string) => this.servicio.eliminarAdjunto(adjuntoId),
        },
        width: '720px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((resultado?: SoportesResultado) => {
        if (!resultado?.cambiado) return;
        // Se corrige el número del clip en la fila que se tocó y no se vuelve a
        // pedir la página entera: el diálogo trae el dato de primera mano, y una
        // recarga movería la tabla debajo del dedo de quien acaba de subir.
        this.filas.update((filas) =>
          filas.map((f) =>
            f.id === fila.id ? { ...f, adjuntos_count: resultado.cuantos } : f,
          ),
        );
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

}
