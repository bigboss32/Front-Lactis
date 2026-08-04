import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Page, Ruta, Transportador, TransportadorRuta } from '../../core/models';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { OpcionSelect, SelectBuscable } from '../../shared/select-buscable';
import {
  TransportadorRutaPayload,
  TransportadoresService,
  rutasEnOrden,
} from './transportadores.service';

@Component({
  selector: 'app-transportador-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatTooltipModule, MilesInputDirective, SelectBuscable,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.item ? 'Editar transportador' : 'Nuevo transportador' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" id="form-transportador" (ngSubmit)="guardar()">
        <div class="form-grid">
          <mat-form-field>
            <mat-label>Nombre</mat-label>
            <input matInput formControlName="nombre" required />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Documento</mat-label>
            <input matInput formControlName="documento" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Teléfono</mat-label>
            <input matInput formControlName="telefono" />
          </mat-form-field>
          <!--
            Tarifa CON DECIMALES ([decimales]="2"): no es un total en pesos, es lo
            que se le paga por cada litro, y hay transportadores a $242,76. Se puede
            teclear con coma o con punto; inputmode="decimal" saca la coma en el
            teclado del celular.
          -->
          <mat-form-field>
            <mat-label>Tarifa general por litro</mat-label>
            <input
              matInput
              type="text"
              inputmode="decimal"
              appMiles
              [decimales]="2"
              formControlName="valor_transporte"
              required
            />
            <span matTextPrefix>$&nbsp;</span>
            <span matTextSuffix>/L</span>
            <mat-hint>Se usa en las rutas que no tengan tarifa propia. Se admite coma: 242,76</mat-hint>
            <!--
              El mensaje es obligatorio: con esta tarifa se le paga al transportador,
              así que si el campo queda vacío o con algo que no es un número hay que
              decirlo, no guardar un cero callado.
            -->
            @if (form.controls.valor_transporte.hasError('required')) {
              <mat-error>Escriba la tarifa por litro (ej: 242,76)</mat-error>
            } @else if (form.controls.valor_transporte.hasError('min')) {
              <mat-error>La tarifa no puede ser negativa</mat-error>
            }
          </mat-form-field>
        </div>

        <!--
          Tarifa general en CERO: se puede guardar —hay quien solo cobra por rutas con
          tarifa propia— pero no puede pasar callado. Con $ 0 acá, un día en una ruta
          que no esté en la lista de abajo se le paga con cero, o sea gratis, y eso no
          se descubre hasta el comprobante de la quincena.
          Va como aviso y no como error a propósito: el cero puede ser a propósito.
        -->
        @if (form.controls.valor_transporte.value === 0) {
          <p class="aviso cero">
            Con $&nbsp;0 de tarifa general, la leche que recoja en una ruta que no esté
            en la lista de abajo no le genera flete.
          </p>
        }

        <h3 class="seccion">Rutas que hace y cuánto le pagan en cada una</h3>
        <!--
          La explicación va en plata y con el caso que el dueño tiene enfrente. Sin
          esto, "tarifa general" y "tarifa de la ruta" se ven como lo mismo y quien
          corrija la de arriba pensando que sube el flete de Nápoles no va a mover
          ni un peso.
        -->
        <p class="ayuda">
          El mismo señor puede hacer <strong>varias rutas</strong> y cobrar distinto en
          cada una: Alex Agudelo hace Nápoles a $&nbsp;242,76 el litro y Mira Valle a
          $&nbsp;300. Agregue acá cada ruta con su tarifa y la leche de cada día se le
          paga con la tarifa <strong>de la ruta de ese día</strong>. Si una ruta no está
          en esta lista, se le paga con la tarifa general de arriba.
        </p>

        <div formArrayName="rutas">
          @for (fila of rutas.controls; track fila; let i = $index) {
            <div class="fila-ruta" [formGroupName]="i">
              <!--
                Las opciones de CADA renglón salen sin las rutas que ya escogieron
                los otros: el backend rechaza la misma ruta dos veces (con dos
                tarifas no sabría cuál es la que vale), y ofrecerla para después
                rebotarla sería mandar al usuario a un error evitable.
              -->
              <app-select-buscable
                formControlName="ruta_id"
                [opciones]="opcionesDeFila(i)"
                label="Ruta"
              />

              <mat-form-field subscriptSizing="dynamic">
                <mat-label>Tarifa por litro</mat-label>
                <input
                  matInput
                  type="text"
                  inputmode="decimal"
                  appMiles
                  [decimales]="2"
                  formControlName="valor_transporte"
                  required
                />
                <span matTextPrefix>$&nbsp;</span>
                <span matTextSuffix>/L</span>
                @if (fila.controls.valor_transporte.hasError('required')) {
                  <mat-error>Escriba la tarifa de esta ruta</mat-error>
                } @else if (fila.controls.valor_transporte.hasError('min')) {
                  <mat-error>La tarifa no puede ser negativa</mat-error>
                }
              </mat-form-field>

              <button
                mat-icon-button
                type="button"
                matTooltip="Quitar esta ruta"
                [attr.aria-label]="'Quitar la ruta del renglón ' + (i + 1)"
                (click)="quitarRuta(i)"
              >
                <mat-icon>delete</mat-icon>
              </button>

              <!--
                Un renglón sin ruta deja el formulario inválido y el botón Guardar
                apagado. Sin decirlo, el usuario ve un botón muerto y no sabe por
                qué; y borrarle el renglón en silencio al guardar sería peor, porque
                la tarifa que ya tecleó se perdería sin avisar.
              -->
              @if (!fila.controls.ruta_id.value) {
                <p class="aviso falta">Escoja la ruta de este renglón, o quítelo con la papelera.</p>
              }
              <!--
                Tarifa en cero: la ruta con tarifa propia MANDA, así que un cero acá
                significa que por esa ruta no se le paga nada, y NO que se caiga a la
                tarifa general (el backend respeta el cero puesto a mano). Es el error
                más fácil de cometer y el más difícil de ver en el comprobante.
              -->
              @if (fila.controls.valor_transporte.value === 0) {
                <p class="aviso cero">
                  Con $&nbsp;0 no se le paga flete por esta ruta. Si quiere que se le pague
                  la tarifa general, quite el renglón.
                </p>
              }
            </div>
          }
        </div>

        @if (rutas.length === 0) {
          <p class="sin-rutas">
            Sin rutas propias: todo lo que recoja se le paga con la tarifa general.
          </p>
        }

        <button
          mat-stroked-button
          type="button"
          class="agregar"
          [disabled]="!hayRutasPorAgregar()"
          (click)="agregarRuta()"
        >
          <mat-icon>add</mat-icon> Agregar ruta
        </button>
        @if (avisoDeAgregar()) {
          <p class="ayuda-corta">{{ avisoDeAgregar() }}</p>
        }
        <!--
          Si la lista de rutas no se pudo traer, el botón de agregar queda apagado
          por algo que no es culpa del usuario y que se arregla reintentando. Sin
          este botón la única salida era cerrar el diálogo y volver a abrirlo
          —perdiendo lo que ya hubiera escrito—.
        -->
        @if (catalogoFallo()) {
          <button mat-stroked-button type="button" class="agregar" (click)="cargarCatalogo()">
            <mat-icon>refresh</mat-icon> Reintentar
          </button>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-transportador"
        [disabled]="form.invalid || guardando()"
      >
        Guardar
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .seccion {
      margin: 20px 0 4px;
      font-size: 1rem;
      font-weight: 500;
    }
    .ayuda {
      margin: 0 0 12px;
      font-size: 0.84rem;
      line-height: 1.45;
      color: var(--mat-sys-on-surface-variant);
    }
    .ayuda-corta {
      margin: 6px 0 0;
      font-size: 0.78rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .sin-rutas {
      margin: 0 0 12px;
      font-size: 0.86rem;
      font-style: italic;
      color: var(--mat-sys-on-surface-variant);
    }

    /* Un renglón = una ruta con su tarifa. La papelera al final, del ancho justo. */
    .fila-ruta {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 150px 40px;
      gap: 4px 8px;
      align-items: center;
      margin-bottom: 8px;
    }
    .aviso {
      grid-column: 1 / -1;
      margin: 0 0 4px;
      font-size: 0.78rem;
      line-height: 1.35;
    }
    .aviso.falta { color: var(--mat-sys-error); }
    /* El cero no es un error de digitación: puede ser a propósito. Va en tono de
       advertencia y no en rojo, pero se ve. */
    .aviso.cero { color: var(--mat-sys-on-surface-variant); }
    .agregar { margin-top: 4px; }

    /* En celular no caben tres columnas: la tarifa se baja a su propio renglón y
       la ruta se queda arriba con la papelera al lado. El recuadro agrupa lo que
       es UNA ruta, para que no se lea como campos sueltos. */
    @media (max-width: 600px) {
      .fila-ruta {
        grid-template-columns: minmax(0, 1fr) 40px;
        padding: 12px;
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 10px;
      }
      .fila-ruta > app-select-buscable { grid-column: 1; grid-row: 1; }
      .fila-ruta > button { grid-column: 2; grid-row: 1; }
      .fila-ruta > mat-form-field { grid-column: 1 / -1; grid-row: 2; }
    }
  `,
})
export class TransportadorFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(TransportadoresService);
  private readonly api = inject(ApiService);
  private readonly dialogRef = inject(MatDialogRef<TransportadorFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ item?: Transportador } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly guardando = signal(false);

  /** Las rutas activas del catálogo (/rutas). Llegan DESPUÉS de armar el formulario. */
  private readonly catalogo = signal<OpcionSelect[]>([]);
  /** ¿Ya respondió /rutas? Sirve para no confundir "cargando" con "no hay rutas". */
  private readonly catalogoListo = signal(false);
  /**
   * /rutas FALLÓ (sin conexión, servidor caído, sesión vencida).
   *
   * Es un tercer estado y no lo mismo que "no hay rutas": con la lista sin traer no
   * se puede afirmar NADA sobre cuántas rutas hay, y decir "ya no quedan rutas por
   * agregar" sería una mentira que además deja al usuario sin qué hacer. La
   * plantilla lo lee para ofrecer el botón de reintentar.
   */
  readonly catalogoFallo = signal(false);

  /**
   * Las rutas que se pueden escoger: el catálogo MÁS las que este transportador
   * ya tiene asignadas.
   *
   * Lo segundo no es adorno. El catálogo trae solo las rutas activas (y las
   * primeras 100), así que una ruta que se desactivó después de asignarla no
   * vendría en la lista y su renglón saldría en blanco —el usuario creería que se
   * perdió la tarifa y la volvería a escoger, o guardaría sin ella—. Como el API
   * del transportador ya manda el NOMBRE de cada ruta suya, se puede mostrar sin
   * pedir nada más.
   */
  readonly opciones = computed<OpcionSelect[]>(() => {
    const delCatalogo = this.catalogo();
    const propias = (this.data?.item?.rutas ?? [])
      .filter((fila) => !delCatalogo.some((op) => op.id === fila.ruta_id))
      .map((fila) => ({ id: fila.ruta_id, nombre: fila.nombre ?? 'Ruta sin nombre' }));
    return [...delCatalogo, ...propias];
  });

  readonly form = this.fb.group({
    nombre: [this.data?.item?.nombre ?? '', [Validators.required, Validators.minLength(2)]],
    documento: [this.data?.item?.documento ?? ''],
    telefono: [this.data?.item?.telefono ?? ''],
    /*
     * En un transportador NUEVO arranca VACÍA, no en cero.
     *
     * Con el cero el formulario nacía válido y se podía guardar de una un
     * transportador con flete general $0 sin que nada lo dijera: flete que no se le
     * paga a nadie y que no se nota hasta la liquidación de la quincena. Con null
     * salta el `required` que ya estaba puesto —y el mensaje que ya estaba escrito—
     * y Guardar queda apagado hasta que alguien escriba la cifra. Es la misma regla
     * que ya seguía cada renglón de ruta (ver `nuevaFila`).
     *
     * Al EDITAR se respeta lo que esté guardado, cero incluido: si ese cero está en
     * la base es un dato, no un descuido del diálogo. Para eso está el aviso de
     * arriba, que sí lo señala.
     */
    valor_transporte: [
      this.data?.item ? Number(this.data.item.valor_transporte ?? 0) : (null as number | null),
      [Validators.required, Validators.min(0)],
    ],
    // Arranca con las rutas que ya tiene, cada una con SU tarifa, y ORDENADAS POR
    // NOMBRE: el API las manda por id de ruta (un UUID) y hay que verlas en el mismo
    // orden que en la lista y que en el PDF. Vacío es válido: un transportador que
    // hace una sola ruta puede seguir con solo la general.
    rutas: this.fb.array(
      rutasEnOrden(this.data?.item?.rutas ?? []).map((fila) => this.nuevaFila(fila)),
    ),
  });

  /** Re-emite en cada cambio del formulario, para recalcular qué rutas quedan libres. */
  private readonly cambios = toSignal(this.form.valueChanges);

  /**
   * Las opciones de cada renglón, sin las rutas que ya escogieron los OTROS
   * renglones (la propia sí se deja: si no, el renglón se quedaría sin poder
   * mostrar lo que tiene puesto).
   */
  readonly opcionesPorFila = computed<OpcionSelect[][]>(() => {
    this.cambios();
    const todas = this.opciones();
    const escogidas = this.rutas.controls.map((fila) => fila.getRawValue().ruta_id);
    return this.rutas.controls.map((_, i) =>
      todas.filter((op) => !escogidas.some((id, j) => j !== i && id === op.id)),
    );
  });

  /**
   * Las de UN renglón, que es lo que consume la plantilla.
   *
   * Va por método y no indexando el computed en la plantilla para poder devolver
   * una lista vacía si alguna vez el índice no existiera: `[opciones]` con
   * `undefined` reventaría el selector, y un renglón sin opciones es preferible a
   * un diálogo que no pinta.
   */
  opcionesDeFila(i: number): OpcionSelect[] {
    return this.opcionesPorFila()[i] ?? [];
  }

  /**
   * ¿Cabe otro renglón? Si no, el botón de agregar no tendría qué ofrecer.
   *
   * Se cuentan RENGLONES contra rutas y no rutas ya escogidas: un renglón vacío ya
   * está esperando la ruta que falta, así que agregar otro dejaría uno de los dos
   * sin nada que escoger —un callejón sin salida en pantalla—.
   */
  readonly hayRutasPorAgregar = computed(() => {
    this.cambios();
    return this.rutas.length < this.opciones().length;
  });

  /**
   * Por qué el botón "Agregar ruta" está apagado, o cadena vacía si no lo está.
   *
   * El orden de los casos ES la corrección: antes, con el catálogo sin llegar (o
   * fallado), un transportador que ya tuviera dos rutas caía en "Ya no quedan rutas
   * por agregar" —porque sus dos propias rutas ya cuentan como opciones— y ese
   * mensaje se quedaba PARA SIEMPRE si /rutas nunca respondía, con el botón apagado.
   * Es la peor clase de mentira: la que suena a que el sistema ya revisó.
   *
   * Ahora, mientras la lista viene en camino se dice que está buscando (el botón
   * está apagado y hay que explicar por qué), si falló se dice que falló —y al lado
   * aparece Reintentar—, y solo con el catálogo EN LA MANO se puede afirmar que ya
   * no quedan rutas o que todavía no hay ninguna creada.
   */
  readonly avisoDeAgregar = computed(() => {
    if (this.hayRutasPorAgregar()) return '';
    if (!this.catalogoListo()) return 'Buscando las rutas disponibles…';
    if (this.catalogoFallo()) {
      return 'No se pudo traer la lista de rutas, así que no hay de dónde escoger otra.';
    }
    if (this.opciones().length > 0) return 'Ya no quedan rutas por agregar.';
    return 'Todavía no hay rutas creadas. Créelas en Rutas y vuelva.';
  });

  constructor() {
    this.cargarCatalogo();
    protegerCambios(this.dialogRef, () => this.form);
  }

  /** Trae el catálogo de rutas. Se reintenta con el botón cuando falla. */
  cargarCatalogo(): void {
    this.catalogoListo.set(false);
    this.catalogoFallo.set(false);
    firstValueFrom(this.api.get<Page<Ruta>>('/rutas', { page_size: 100, estado: 'activo' }))
      .then((page) => this.catalogo.set(page.items.map((r) => ({ id: r.id, nombre: r.nombre }))))
      // El aviso de red ya lo muestra el interceptor; acá se marca el fallo para que
      // el diálogo no siga diciendo cosas que no puede saber, y se suelta la promesa
      // para que no quede un error sin dueño en la consola.
      .catch(() => this.catalogoFallo.set(true))
      .finally(() => this.catalogoListo.set(true));
  }

  get rutas() {
    return this.form.controls.rutas;
  }

  /**
   * Un renglón "ruta + tarifa".
   *
   * La tarifa de un renglón NUEVO arranca vacía y no en cero a propósito: un cero
   * guardado sin darse cuenta es flete que no se le paga a nadie, así que mejor
   * que el formulario quede inválido hasta que alguien escriba la cifra.
   */
  private nuevaFila(datos?: TransportadorRuta) {
    return this.fb.group({
      ruta_id: [datos?.ruta_id ?? (null as string | null), Validators.required],
      valor_transporte: [
        datos ? Number(datos.valor_transporte) : (null as number | null),
        [Validators.required, Validators.min(0)],
      ],
    });
  }

  agregarRuta(): void {
    this.rutas.push(this.nuevaFila());
    // Se marca como cambio a mano: push no ensucia el formulario, y sin esto
    // cerrar el diálogo con un renglón a medio llenar no pediría confirmación.
    this.rutas.markAsDirty();
  }

  quitarRuta(indice: number): void {
    this.rutas.removeAt(indice);
    this.rutas.markAsDirty();
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valor = this.form.getRawValue();
      // La lista va SIEMPRE completa, incluso vacía: en pantalla el usuario ve
      // todas sus rutas, así que dejarla sin ninguna es una decisión suya y no un
      // descuido del diálogo. Los renglones a medio llenar no llegan hasta acá:
      // `required` deja el formulario inválido y el botón apagado.
      const rutas: TransportadorRutaPayload[] = valor.rutas.map((fila) => ({
        ruta_id: fila.ruta_id as string,
        valor_transporte: Number(fila.valor_transporte),
      }));
      const payload = {
        nombre: valor.nombre,
        documento: valor.documento,
        telefono: valor.telefono,
        // Number() y no el valor tal cual: el control admite null para poder nacer
        // vacío, y hasta acá solo llega con el formulario válido (el `required` no
        // deja pasar el null).
        valor_transporte: Number(valor.valor_transporte),
        rutas,
      };
      if (this.data?.item) {
        await firstValueFrom(this.servicio.update(this.data.item.id, payload));
      } else {
        await firstValueFrom(this.servicio.create(payload));
      }
      this.dialogRef.close(true);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar');
    } finally {
      this.guardando.set(false);
    }
  }
}
