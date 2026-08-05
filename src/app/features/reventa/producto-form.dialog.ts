import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { protegerCambios } from '../../shared/proteger-cambios';
import { ProductoReventa, ReventaService, UnidadProducto } from './reventa.service';

/**
 * Lo mínimo que el selector necesita de un posible padre. No es un
 * `ProductoReventa` porque una de las opciones puede no venir del catálogo
 * consultado: el padre que el producto YA tiene se ofrece siempre (ver `padres`).
 */
interface OpcionPadre {
  id: string;
  nombre: string;
}

/**
 * AGREGAR O CORREGIR UN PRODUCTO DEL CATÁLOGO. SON TRES PREGUNTAS:
 *
 *   1. ¿Cómo se llama?          -> "Cuajada"
 *   2. ¿Cómo lo mide?           -> por kilo / por unidad
 *   3. ¿Es subproducto de otro? -> no, o de cuál
 *
 * Y NADA MÁS, a propósito. La clave (con la que sus compras y sus ventas lo van a
 * nombrar), los decimales de la cantidad y si admite merma NO se preguntan: los
 * deduce el servidor de estas tres respuestas. Un campo deducible que además se
 * pregunta es una segunda fuente para el mismo hecho, y el dueño es de una
 * quesera, no de una tienda de software.
 *
 * DOS COSAS QUE NO SE PUEDEN CAMBIAR DESPUÉS, y por eso al corregir se ven
 * apagadas con su explicación al lado en vez de simplemente no estar:
 *
 *  · LA UNIDAD. Decide la forma de la cantidad: pasar a "por unidad" un producto
 *    con kilos registrados dejaría esos kilos contados como piezas. El servidor no
 *    la acepta en la corrección.
 *  · EL NOMBRE SÍ SE CAMBIA, SIEMPRE Y SIN RIESGO. La identidad del producto es su
 *    clave, que no se mueve al renombrar, así que ninguna compra ni venta ya
 *    registrada se entera. Es la razón de que la clave exista aparte.
 *
 * POR AHORA SOLO SE PUEDEN AGREGAR PRODUCTOS POR KILO. El servidor rechaza los que
 * se cuentan por unidad —exigen antes que las compras y las ventas dejen de
 * guardar las barras en columnas aparte de los kilos—, así que la opción se ve
 * APAGADA con la nota de que llega después. Se deja a la vista y no se quita
 * porque la mozzarella, que ya se cuenta por unidad, está en la lista: si la
 * opción no existiera, esa fila no tendría cómo explicarse.
 */
@Component({
  selector: 'app-reventa-producto-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatButtonToggleModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ esNuevo() ? 'Nuevo producto' : 'Corregir producto' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" id="form-producto-reventa" (ngSubmit)="guardar()">
        <!-- 1 ——————————————————————————————————————— ¿Cómo se llama? -->
        <mat-form-field class="ancho">
          <mat-label>¿Cómo se llama?</mat-label>
          <input matInput formControlName="nombre" maxlength="80" required
                 placeholder="Cuajada" />
          @if (!esNuevo()) {
            <mat-hint>El nombre se puede cambiar cuando quiera; su historia no se entera.</mat-hint>
          }
        </mat-form-field>

        <!-- 2 —————————————————————————————————————————— ¿Cómo lo mide? -->
        <div class="pregunta">
          <span class="rotulo" id="rotulo-unidad">¿Cómo lo mide?</span>
          <mat-button-toggle-group
            class="opciones"
            formControlName="unidad"
            hideSingleSelectionIndicator
            aria-labelledby="rotulo-unidad"
          >
            <mat-button-toggle value="kg">Por kilo</mat-button-toggle>
            <!-- Apagada al agregar (el servidor la rechaza en este corte) y a la
                 vista al corregir, que es donde explica a la mozzarella. -->
            <mat-button-toggle value="unidad" [disabled]="esNuevo()">
              Por unidad
            </mat-button-toggle>
          </mat-button-toggle-group>

          @if (esNuevo()) {
            <p class="nota" role="note">
              <mat-icon aria-hidden="true">schedule</mat-icon>
              <span>
                <strong>Por unidad llega en la siguiente entrega.</strong> Primero las
                compras y las ventas tienen que dejar de guardar las barras en columnas
                aparte de los kilos. La mozzarella, que ya se cuenta por unidad, sigue
                funcionando igual.
              </span>
            </p>
          } @else {
            <p class="nota" role="note">
              <mat-icon aria-hidden="true">lock</mat-icon>
              <span>
                Cómo se mide no se cambia: es la forma de la cantidad. Si quedó mal y
                todavía no tiene compras ni ventas, quítelo y agréguelo otra vez.
              </span>
            </p>
          }
        </div>

        <!-- 3 ————————————————————————————— ¿Es subproducto de otro? -->
        @if (tieneSubproductos()) {
          <!-- La cadena llega a UN nivel: lo exige el reparto de costos, que sabe
               calcular queso -> borona y no un tercer escalón. Si este producto ya
               es padre, la pregunta no tiene respuesta válida y no se hace. -->
          <p class="nota" role="note">
            <mat-icon aria-hidden="true">account_tree</mat-icon>
            <span>
              «{{ data.item?.nombre }}» ya tiene subproductos, así que no puede ser
              subproducto de otro: la cadena solo llega a un nivel.
            </span>
          </p>
        } @else {
          <mat-form-field class="ancho">
            <mat-label>¿Es un subproducto de otro?</mat-label>
            <mat-select formControlName="subproducto_de_id">
              <mat-option [value]="null">No, es un producto por su cuenta</mat-option>
              @for (padre of padres(); track padre.id) {
                <mat-option [value]="padre.id">Sí, de {{ padre.nombre }}</mat-option>
              }
            </mat-select>
            <mat-hint>
              Como la borona, que sale del queso: hereda su costo y no se paga aparte.
            </mat-hint>
          </mat-form-field>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-producto-reventa"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    form { display: block; padding-top: 4px; }
    .ancho { width: 100%; }

    .pregunta { margin: 4px 0 18px; }
    .pregunta .rotulo {
      display: block;
      margin-bottom: 8px;
      font-size: 0.9rem;
      color: var(--mat-sys-on-surface-variant);
    }
    /* En celular las dos opciones se apilan antes de recortarse: "Por unidad"
       partido en dos renglones no se lee como una opción. */
    .pregunta .opciones { flex-wrap: wrap; }

    .nota {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 10px 0 0;
      font-size: 0.8rem;
      line-height: 1.35;
      color: var(--mat-sys-on-surface-variant);
      mat-icon {
        flex-shrink: 0;
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }
  `,
})
export class ReventaProductoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<ReventaProductoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: ProductoReventa } | null>(MAT_DIALOG_DATA, {
    optional: true,
  }) ?? {};

  readonly guardando = signal(false);
  /** El catálogo, para armar la lista de posibles padres. */
  private readonly catalogo = signal<readonly ProductoReventa[]>([]);

  readonly esNuevo = computed(() => !this.data.item);

  /**
   * Quiénes pueden ser padres: los ACTIVOS que NO son subproducto de nadie, y nunca
   * el producto que se está corrigiendo.
   *
   * Se filtra aquí además de en el servidor —que rechaza la cadena de dos
   * niveles— porque ofrecer una opción que va a rebotar es hacer que el dueño se
   * estrelle contra un error para averiguar una regla.
   */
  readonly padres = computed<OpcionPadre[]>(() => {
    const item = this.data.item;
    const opciones = this.catalogo()
      .filter(
        (p) =>
          p.subproducto_de_id === null && p.estado === 'activo' && p.id !== item?.id,
      )
      .map((p) => ({ id: p.id, nombre: p.nombre }));
    // EL PADRE QUE YA TIENE SE OFRECE SIEMPRE, aunque no haya pasado el filtro de
    // arriba. Si el dueño desactivó el queso, el selector le mostraría a la borona
    // como si no fuera subproducto de nada: la relación no se perdería —al guardar
    // se manda el valor del control, que sigue siendo el padre— pero el dueño
    // dejaría de verla, y una pantalla que muestra menos de lo que hay es la que
    // hace que alguien "arregle" algo que estaba bien.
    const padre = item?.subproducto_de_id;
    if (padre && !opciones.some((o) => o.id === padre)) {
      opciones.unshift({
        id: padre,
        nombre: item?.subproducto_de_nombre ?? 'el producto del que sale',
      });
    }
    return opciones;
  });

  /** Si este producto ya es padre de alguno: entonces no puede volverse hijo. */
  readonly tieneSubproductos = computed(
    () =>
      !!this.data.item &&
      this.catalogo().some((p) => p.subproducto_de_id === this.data.item?.id),
  );

  readonly form = this.fb.group({
    nombre: [
      this.data.item?.nombre ?? '',
      [Validators.required, Validators.minLength(2), Validators.maxLength(80)],
    ],
    // Por kilo por omisión: es lo único que este corte deja agregar.
    unidad: [(this.data.item?.unidad ?? 'kg') as UnidadProducto],
    subproducto_de_id: [this.data.item?.subproducto_de_id ?? null as string | null],
  });

  constructor() {
    protegerCambios(this.dialogRef, () => this.form);
    // La unidad no se corrige: no está en el esquema de edición del servidor.
    if (!this.esNuevo()) this.form.controls.unidad.disable();
    void this.cargarCatalogo();
  }

  /**
   * El catálogo completo (no la página que tenga abierta la lista): la respuesta a
   * "¿de quién es subproducto?" no puede depender de en qué página estaba el
   * usuario.
   *
   * SIN FILTRAR POR ESTADO, y el filtro de activos se aplica después, al armar las
   * opciones. Los inactivos hacen falta para lo otro que se decide con esta lista:
   * si este producto ya es padre de alguno —y un subproducto desactivado sigue
   * siendo su subproducto—, la pregunta 3 no se hace, porque la cadena llega a un
   * solo nivel.
   */
  private async cargarCatalogo(): Promise<void> {
    try {
      const pagina = await firstValueFrom(
        this.servicio.listarProductos({ page: 1, page_size: 100 }),
      );
      this.catalogo.set(pagina.items);
    } catch {
      // Sin la lista, la pregunta 3 se queda con el "No" y las otras dos siguen
      // sirviendo: agregar un producto suelto es el caso normal.
      this.catalogo.set([]);
    }
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    const valores = this.form.getRawValue();
    // El nombre se manda sin espacios de sobra en las puntas; el servidor también
    // los colapsa, y así lo que se ve en el campo es lo que se guarda.
    const nombre = valores.nombre.trim();
    // Si ya es padre no se pregunta, y entonces tampoco se manda: el control no
    // se pintó y su valor es el que traía la fila.
    const subproducto = this.tieneSubproductos() ? undefined : valores.subproducto_de_id;
    try {
      const producto = this.data.item
        ? await firstValueFrom(
            this.servicio.editarProducto(this.data.item.id, {
              nombre,
              ...(subproducto === undefined ? {} : { subproducto_de_id: subproducto }),
            }),
          )
        : await firstValueFrom(
            this.servicio.crearProducto({
              nombre,
              unidad: valores.unidad,
              subproducto_de_id: subproducto ?? null,
            }),
          );
      // Se devuelve el producto tal como quedó EN EL SERVIDOR, no lo que se
      // tecleó: al agregar uno que se había quitado, el servidor revive la misma
      // fila con la unidad que ya tenía, y la lista tiene que anunciar eso.
      this.dialogRef.close(producto);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar el producto');
    } finally {
      this.guardando.set(false);
    }
  }
}
