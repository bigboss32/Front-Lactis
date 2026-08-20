import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Transportador, TransportadorRuta, esDiaFijo } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { PageHeader } from '../../shared/page-header';
import { TransportadorFormDialog } from './transportador-form.dialog';
import { TransportadoresService, rutasEnOrden, tarifaLegible } from './transportadores.service';

@Component({
  selector: 'app-transportador-list',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    PageHeader, EstadoChip, HasPermissionDirective,
  ],
  templateUrl: './transportador-list.page.html',
  styles: `
    /* Las rutas del transportador, una por renglón con su tarifa al lado. Un
       transportador tiene dos o tres, así que apilarlas se lee mejor que ponerlas
       en fila y que se corten. */
    ul.rutas {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      /* En celular la celda es un flex (etiqueta a la izquierda, valor a la
         derecha) y esta lista es uno de sus hijos. Sin min-width: 0 un hijo flex
         no se puede encoger por debajo de su contenido, y la tarjeta se desbordaba
         ~95px a 375px de ancho. */
      min-width: 0;

      li {
        display: flex;
        gap: 8px;
        align-items: baseline;
        /* Antes iba con white-space: nowrap y era justo lo que desbordaba: el
           nombre y la tarifa no se podían separar. Ahora, cuando no caben, la
           tarifa se baja a su propio renglón. */
        flex-wrap: wrap;
        min-width: 0;
      }
      .nombre {
        min-width: 0;
        /* Un nombre largo parte antes que empujar la tarjeta. break-word y NO
           anywhere: anywhere le cambia el ancho mínimo intrínseco a la celda y con
           eso le movería el reparto de columnas a la tabla del escritorio, que no
           tiene ningún problema que arreglar. */
        overflow-wrap: break-word;
      }
      .tarifa {
        color: var(--mat-sys-on-surface-variant);
        font-variant-numeric: tabular-nums;
        /* La CIFRA no se parte NUNCA: "$ 242," en un renglón y "76/L" en el otro
           se lee como otra plata. Por eso el nowrap se queda acá y solo acá.
           Y por lo mismo "por día" viaja con un espacio duro dentro de la cadena. */
        white-space: nowrap;
      }
      /* "(borrada)": se tiene que ver, pero la tarifa manda. */
      .borrada {
        font-size: 0.75rem;
        color: var(--mat-sys-on-surface-variant);
        white-space: nowrap;
      }
    }
    /*
     * LA TARIFA FIJA SE TIENE QUE RECONOCER DE UN VISTAZO.
     *
     * "$ 150.000 por día" y "$ 242,76/L" son dos cosas que no se parecen en nada y
     * que en una lista se ven igual: dos cifras grises en la misma columna. El fijo
     * es la excepción —casi todo el negocio va por litro—, así que se marca: en el
     * color normal del texto (no en el gris de acompañamiento), con más peso y con
     * el fondo tenue de la marca. Nada de rojo: un fijo no tiene nada de malo, lo
     * que pasa es que hay que verlo.
     *
     * Va en el mismo .tarifa, así que conserva el nowrap: la cifra y "por día" no
     * se pueden separar, porque medio renglón dice otra cosa.
     */
    .tarifa.fija {
      color: var(--mat-sys-on-surface);
      font-weight: 500;
      padding: 1px 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent);
    }

    /* En celular la tabla se vuelve tarjetas y la celda alinea a la derecha: la
       lista se pega a ese borde para que las tarifas queden una debajo de otra y
       se puedan comparar de un vistazo. */
    @media (max-width: 700px) {
      ul.rutas { align-items: flex-end; }
      /* Y lo que se baje de renglón se pega al mismo borde, no al del medio. */
      ul.rutas li { justify-content: flex-end; }
    }
  `,
})
export class TransportadorListPage implements OnInit {
  private readonly servicio = inject(TransportadoresService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly columnas = ['nombre', 'documento', 'telefono', 'ruta', 'valor_transporte', 'estado', 'acciones'];
  readonly filas = signal<Transportador[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly estado = new FormControl<string | null>(null);

  /**
   * Las rutas de una fila, EN EL ORDEN EN QUE SE LEEN (por nombre).
   *
   * El API las manda por id de ruta, que es un UUID: la lista sale barajada y
   * distinta del comprobante en PDF, que sí las imprime por nombre. El dueño
   * compara las dos hojas, así que el orden tiene que ser el mismo.
   */
  rutasDe(fila: Transportador): TransportadorRuta[] {
    return rutasEnOrden(fila.rutas ?? []);
  }

  /**
   * La tarifa como se lee, CON SU UNIDAD: "$ 242,76/L" o "$ 150.000 por día".
   *
   * Sirve para las dos columnas —la general y la de cada ruta— porque las dos son lo
   * mismo: una cifra y un modo. La cadena la arma `tarifaLegible`, que es la misma que
   * usa el formulario, para que la lista y el diálogo de edición no puedan escribir esa
   * plata de dos maneras distintas.
   */
  tarifa(fila: Transportador | TransportadorRuta): string {
    return tarifaLegible(fila);
  }

  /** ¿Es un fijo por día? La lista lo resalta: es la excepción y hay que reconocerla. */
  esFija(fila: Transportador | TransportadorRuta): boolean {
    return esDiaFijo(fila.modo_transporte);
  }

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.estado.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    // Ya NO se pide /rutas: cada transportador trae sus rutas con nombre y tarifa
    // en su propia respuesta, así que el mapa de nombres que había acá sobraba (y
    // con page_size 100 se quedaba corto el día que haya más rutas).
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'transportadores',
      { buscar: this.buscar, estado: this.estado },
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
          search: this.buscar.value || null,
          estado: this.estado.value,
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

  abrirFormulario(item?: Transportador): void {
    this.dialog
      .open(TransportadorFormDialog, { data: { item }, width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Transportador guardado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  eliminar(item: Transportador): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar transportador',
          mensaje: `¿Eliminar a "${item.nombre}"? El registro quedará inactivo.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        await firstValueFrom(this.servicio.remove(item.id));
        this.snackbar.open('Transportador eliminado', 'OK', { duration: 3000 });
        this.cargar();
      });
  }
}
