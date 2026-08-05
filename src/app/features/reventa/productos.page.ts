import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
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
import { detalleDeError } from '../../shared/errores-ui';
import { ReventaProductoFormDialog } from './producto-form.dialog';
import {
  ProductoReventa,
  ReventaService,
  TIPOS_COMPRA,
  TIPOS_VENTA,
} from './reventa.service';

/**
 * Cómo se lee la columna "¿Ya se registra?" de un producto.
 *
 * `ya` en falso no es un defecto del producto: es el estado de la entrega. Ver el
 * comentario de `registro()`.
 */
interface EstadoDeRegistro {
  texto: string;
  ya: boolean;
}

/**
 * LA PESTAÑA DE PRODUCTOS: la lista de lo que la quesera compra y revende.
 *
 * Es una lista corta y a propósito: nombre, cómo se mide, si ya se registra y si
 * está activo. Ni códigos ni banderas — la clave con la que las compras y las
 * ventas nombran al producto existe y es la identidad de todo esto, pero es un
 * detalle del sistema y no se muestra: el dueño renombra "Queso" a "Queso costeño"
 * y no tiene por qué enterarse de que por dentro sigue llamándose 'queso'.
 *
 * DOS COSAS QUE ESTA PANTALLA DICE DE FRENTE, porque callarlas sería dejar al
 * dueño estrellándose:
 *
 *  1. LOS PRODUCTOS NUEVOS TODAVÍA NO SE OFRECEN AL REGISTRAR. En este corte los
 *     renglones de compra y de venta siguen guardando el producto en su columna
 *     `tipo`, y el servidor solo acepta ahí las tres cadenas de siempre (queso,
 *     borona, mozzarella). Un producto que se agregue queda guardado en la lista y
 *     empieza a ofrecerse en la siguiente entrega. Si esto no estuviera escrito, el
 *     dueño agregaría "Cuajada", iría a Ventas, no la encontraría y creería que el
 *     sistema perdió lo que hizo.
 *  2. EL CALENDARIO DE ARRIBA NO RECORTA ESTA LISTA. La pestaña vive dentro de la
 *     cáscara de reventa, que tiene el filtro de días compartido; el catálogo es
 *     completo y no tiene fechas, así que se dice en una línea en vez de dejar que
 *     el dueño crea que le están escondiendo productos.
 *
 * LO QUE NO ESTÁ, Y POR QUÉ: la CUENTA de movimientos de cada producto. El listado
 * del servidor no la trae (`ProductoReventaRead` no tiene ese campo) y no hay
 * ninguna otra consulta que la dé exacta: `/compras` y `/ventas` no filtran por
 * producto, el resumen va por rango de fechas y el panel de lotes deja la
 * mozzarella fuera a propósito. Inventar la cifra sumando lo que se pueda —o
 * pintar un "0" que no se comprobó— es justo el defecto que este módulo evita, así
 * que la columna dice lo que SÍ se sabe con certeza ("¿ya se registra?") y la
 * cuenta exacta la trae el servidor en el momento en que importa: cuando se
 * intenta quitar el producto, el rechazo dice cuántas compras y cuántas ventas
 * tiene. Si algún día `ProductoReventaRead` expone `movimientos`, esta columna
 * pasa a mostrar el número y nada más cambia.
 */
@Component({
  selector: 'app-reventa-productos',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    EstadoChip, HasPermissionDirective,
  ],
  templateUrl: './productos.page.html',
  styles: `
    .panel { display: block; padding-top: 8px; }

    .ayuda {
      margin: 0 0 12px;
      font-size: 0.85rem;
      line-height: 1.45;
      color: var(--mat-sys-on-surface-variant);
    }
    .ayuda.fina { font-size: 0.8rem; opacity: 0.9; }

    /* El renglón del producto: el nombre, y debajo de quién es subproducto. */
    .nombre { font-weight: 500; }
    .fina {
      display: block;
      font-size: 0.78rem;
      color: var(--mat-sys-on-surface-variant);
    }

    /* "Todavía no se registra" no es un error ni una alarma: es el estado de la
       entrega, y se pinta apagado para que no compita con los datos. */
    .aun-no { color: var(--mat-sys-on-surface-variant); }

    /* El rechazo del servidor al quitar un producto. NO es un snackbar: trae la
       cuenta exacta de compras y ventas y la salida (desactivarlo), es el texto
       más largo de la pantalla y desaparecerse a los 5 segundos lo dejaría sin
       leer. Se queda hasta que el dueño lo cierre. */
    .aviso-quitar {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 8px 10px 0;
      padding: 8px 12px;
      border-radius: 10px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font-size: 0.82rem;
      line-height: 1.45;

      mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; }
      span { flex: 1 1 auto; }
    }
  `,
})
export class ReventaProductosPage implements OnInit {
  private readonly servicio = inject(ReventaService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly columnas = ['producto', 'medida', 'registro', 'estado', 'acciones'];
  readonly filas = signal<readonly ProductoReventa[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly errorCarga = signal<string | null>(null);
  /** El mensaje del servidor cuando un producto no se puede quitar. */
  readonly avisoQuitar = signal<string | null>(null);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly estado = new FormControl<string | null>(null);

  /** Si hay algún producto que todavía no se ofrece al registrar. */
  readonly hayProductosNuevos = computed(() =>
    this.filas().some((p) => !this.registro(p).ya),
  );

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.estado.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'reventa-productos',
      { buscar: this.buscar, estado: this.estado },
      this.destroyRef,
    );
    void this.cargar();
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
        this.servicio.listarProductos({
          page: this.page(),
          page_size: this.pageSize(),
          search: this.buscar.value || null,
          estado: this.estado.value,
        }),
      );
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
    } catch (err) {
      this.errorCarga.set(
        detalleDeError(
          err,
          'No se pudo cargar la lista de productos. Revise la conexión e intente de nuevo.',
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

  /** "Por kilo" o "Por unidad", como se lee en el negocio. */
  medida(producto: ProductoReventa): string {
    return producto.se_pesa ? 'Por kilo' : 'Por unidad';
  }

  /**
   * Si el producto YA se ofrece al registrar una compra o una venta.
   *
   * Se responde con las listas de tipos que el servidor acepta hoy en los
   * renglones (`TIPOS_COMPRA` / `TIPOS_VENTA`, espejo de sus Literal), comparadas
   * contra la CLAVE del producto —que es justamente la cadena que la fila guarda—
   * y no contra el nombre, que el dueño puede cambiar cuando quiera.
   *
   * De aquí sale también la única certeza que se tiene sobre los movimientos: un
   * producto que no se puede registrar no puede tener ni una compra ni una venta.
   */
  registro(producto: ProductoReventa): EstadoDeRegistro {
    const claves = (lista: readonly string[]): boolean => lista.includes(producto.clave);
    const seCompra = claves(TIPOS_COMPRA);
    const seVende = claves(TIPOS_VENTA);
    if (seCompra && seVende) return { texto: 'Sí: se compra y se vende', ya: true };
    if (seVende) return { texto: 'Sí: se vende', ya: true };
    if (seCompra) return { texto: 'Sí: se compra', ya: true };
    return { texto: 'Todavía no', ya: false };
  }

  nuevo(): void {
    this.abrirFormulario();
  }

  corregir(producto: ProductoReventa): void {
    this.abrirFormulario(producto);
  }

  private abrirFormulario(item?: ProductoReventa): void {
    this.dialog
      .open(ReventaProductoFormDialog, { data: { item }, width: '520px' })
      .afterClosed()
      .subscribe((guardado: ProductoReventa | undefined) => {
        if (!guardado) return;
        this.avisoQuitar.set(null);
        this.snackbar.open(this.mensajeGuardado(guardado, !item), 'OK', {
          duration: 6000,
        });
        void this.cargar();
      });
  }

  /**
   * Qué se le dice al dueño después de guardar.
   *
   * EL CASO RARO QUE SÍ HAY QUE CONTAR: agregar un producto que se había quitado
   * no crea otro, REVIVE el mismo —con su mismo id y su misma clave, que es lo que
   * deja que sus movimientos viejos sigan cuadrando con él— y no lo redefine:
   * vuelve con la unidad que tenía. Como este corte no deja crear nada por unidad,
   * un producto recién agregado que llega medido por unidad SOLO puede ser uno
   * revivido, y hay que decírselo: pidió "por kilo" y quedó por unidad.
   */
  private mensajeGuardado(producto: ProductoReventa, esNuevo: boolean): string {
    if (esNuevo && !producto.se_pesa) {
      return `«${producto.nombre}» ya estaba en la lista y volvió tal como estaba: se cuenta por unidad, no por kilo.`;
    }
    return esNuevo ? `«${producto.nombre}» quedó en la lista` : 'Producto guardado';
  }

  /**
   * Desactivar es LA SALIDA de un producto que ya se movió: deja de ofrecerse al
   * registrar y su historia se queda completa. Se confirma porque cambia lo que el
   * dueño va a ver al registrar; activar no, que no quita nada.
   */
  desactivar(producto: ProductoReventa): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Desactivar producto',
          mensaje:
            `«${producto.nombre}» deja de ofrecerse al registrar compras y ventas. ` +
            'Lo que ya esté registrado con él no se toca, y se puede volver a activar cuando quiera.',
          accion: 'Desactivar',
        },
      })
      .afterClosed()
      .subscribe((confirmado: boolean) => {
        if (confirmado) void this.cambiarEstado(producto, 'inactivo');
      });
  }

  activar(producto: ProductoReventa): void {
    void this.cambiarEstado(producto, 'activo');
  }

  private async cambiarEstado(
    producto: ProductoReventa,
    estado: 'activo' | 'inactivo',
  ): Promise<void> {
    try {
      await firstValueFrom(this.servicio.editarProducto(producto.id, { estado }));
      this.avisoQuitar.set(null);
      this.snackbar.open(
        estado === 'activo'
          ? `«${producto.nombre}» vuelve a ofrecerse`
          : `«${producto.nombre}» deja de ofrecerse`,
        'OK',
        { duration: 4000 },
      );
      void this.cargar();
    } catch (err) {
      this.snackbar.open(
        detalleDeError(err, 'No fue posible cambiar el estado del producto'),
        'OK',
        { duration: 5000 },
      );
    }
  }

  /**
   * Quitar solo se puede si el producto nunca se movió, y esa cuenta la tiene el
   * servidor: si la rechaza, el mensaje trae cuántas compras y cuántas ventas
   * tiene, y la salida (desactivarlo). Se muestra TAL CUAL y en una caja que se
   * queda hasta que el dueño la cierre — es el texto más importante de la pantalla
   * y no puede irse solo mientras se lee.
   */
  quitar(producto: ProductoReventa): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Quitar producto',
          mensaje:
            `¿Quitar «${producto.nombre}» de la lista? Solo se puede si nunca se ha ` +
            'comprado ni vendido; si ya tiene movimientos, el sistema lo dice y se ' +
            'desactiva en vez de quitarlo.',
          accion: 'Quitar',
        },
      })
      .afterClosed()
      .subscribe(async (confirmado: boolean) => {
        if (!confirmado) return;
        this.avisoQuitar.set(null);
        try {
          await firstValueFrom(this.servicio.eliminarProducto(producto.id));
          this.snackbar.open(`«${producto.nombre}» salió de la lista`, 'OK', {
            duration: 4000,
          });
          void this.cargar();
        } catch (err) {
          this.avisoQuitar.set(
            detalleDeError(err, `No fue posible quitar «${producto.nombre}»`),
          );
        }
      });
  }
}
