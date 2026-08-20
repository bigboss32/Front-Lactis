import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import {
  MODO_DIA_FIJO,
  MODO_POR_LITRO,
  ModoTransporte,
  Page,
  Ruta,
  Transportador,
  TransportadorRuta,
  esDiaFijo,
} from '../../core/models';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { protegerCambios } from '../../shared/proteger-cambios';
import { OpcionSelect, SelectBuscable } from '../../shared/select-buscable';
import {
  TransportadorRutaPayload,
  TransportadoresService,
  rutasEnOrden,
} from './transportadores.service';

/**
 * LO QUE SIGNIFICA UN FIJO, dicho donde se escoge y con el caso del dueño.
 *
 * Es EL error que este formulario tiene que hacer imposible: creer que el fijo es por
 * viaje, por proveedor o por recepción. Si ese día recogió de cinco proveedores en la
 * ruta a fábrica, el flete de ese día son $ 150.000 y no $ 750.000, y quien pone la
 * tarifa es quien tiene que entenderlo —después ya no se ve, porque el comprobante
 * muestra la cifra correcta y nadie sabe si era la que se quiso poner—.
 *
 * Van dos textos y no uno porque el general cubre TODAS las rutas que no tengan tarifa
 * propia: ahí hay una segunda cuenta que hacer (dos rutas en un día son dos fijos) que
 * en el renglón de una ruta suelta no aplica igual.
 */
const AVISO_FIJO_DE_LA_RUTA =
  'Es POR DÍA Y POR RUTA: el viaje a fábrica vale $ 150.000, así recoja de uno o de ' +
  'cinco proveedores.';
const AVISO_FIJO_GENERAL =
  `${AVISO_FIJO_DE_LA_RUTA} Si en un mismo día hace dos rutas, se le pagan dos fijos.`;

/**
 * A PARTIR DE CUÁNTO una tarifa POR LITRO deja de ser creíble, en pesos.
 *
 * No es un límite: es una alarma, y existe por un solo camino real. Quien tenía "a
 * fábrica" en $ 150.000 el día y le cambia el modo a POR LITRO deja la MISMA cifra en la
 * caja —la pantalla se ve idéntica— y acaba de convertir el flete de un día de 300 litros
 * en $ 45.000.000. La cifra no se puede prohibir (el backend la acepta y el cero también
 * es legal), pero no puede pasar callada.
 *
 * $ 10.000 por litro es cuarenta veces la tarifa real más alta del negocio ($ 242,76) y
 * casi seis veces lo que cuesta el litro de leche: por debajo de ahí no hay falso positivo
 * posible, y por encima no hay tarifa por litro de verdad.
 */
const TARIFA_POR_LITRO_INCREIBLE = 10000;

@Component({
  selector: 'app-transportador-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatTooltipModule, MilesInputDirective,
    SelectBuscable,
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
            LA TARIFA GENERAL, QUE AHORA SON DOS COSAS: cómo se le paga y cuánto.
            Van juntas y en ese orden (el recuadro .tarifa-general las agrupa) porque
            la cifra NO SE PUEDE LEER SIN EL MODO: los mismos "150.000" son un día de
            trabajo o una tarifa por litro que multiplicada por 300 litros da cuarenta
            y cinco millones. Sueltas en la rejilla, el auto-fit las podía dejar en
            renglones distintos y se leerían como dos campos que no se hablan.
          -->
          <div class="tarifa-general full">
            <mat-form-field>
              <mat-label>¿Cómo le paga?</mat-label>
              <mat-select formControlName="modo_transporte">
                <mat-option [value]="POR_LITRO">Por litro</mat-option>
                <mat-option [value]="DIA_FIJO">Un fijo por día</mat-option>
              </mat-select>
              <mat-hint>Se usa en las rutas que no tengan tarifa propia</mat-hint>
            </mat-form-field>

            <!--
              Tarifa CON DECIMALES ([decimales]="2"): por litro no es un total en pesos
              sino lo que se le paga por cada litro, y hay transportadores a $242,76. Se
              puede teclear con coma o con punto; inputmode="decimal" saca la coma en el
              teclado del celular. Los dos decimales se quedan puestos también en día
              fijo —la columna del backend es la misma Numeric(12,2)— y no estorban: una
              cifra redonda como 150.000 se sigue viendo "150.000".
            -->
            <mat-form-field>
              <mat-label>{{ fijoGeneral() ? 'Cuánto vale el día' : 'Tarifa general por litro' }}</mat-label>
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
              <!-- La unidad al lado de la caja, que es lo que se lee MIENTRAS se
                   teclea: "/día" y no "por día" para que la cifra completa quepa en
                   la caja (una plata recortada es lo peor que puede pasar acá). El
                   rótulo de arriba dice la frase entera. -->
              <span matTextSuffix>{{ fijoGeneral() ? '/día' : '/L' }}</span>
              @if (!fijoGeneral()) {
                <mat-hint>Se admite coma: 242,76</mat-hint>
              }
              <!--
                El mensaje es obligatorio: con esta tarifa se le paga al transportador,
                así que si el campo queda vacío o con algo que no es un número hay que
                decirlo, no guardar un cero callado. Y el ejemplo cambia con el modo: en
                día fijo, "242,76" sería el peor ejemplo posible.
              -->
              @if (form.controls.valor_transporte.hasError('required')) {
                <mat-error>
                  {{
                    fijoGeneral()
                      ? 'Escriba cuánto vale el día completo (ej: 150.000)'
                      : 'Escriba la tarifa por litro (ej: 242,76)'
                  }}
                </mat-error>
              } @else if (form.controls.valor_transporte.hasError('min')) {
                <mat-error>La tarifa no puede ser negativa</mat-error>
              }
            </mat-form-field>
          </div>
        </div>

        <!-- QUÉ ES UN FIJO, dicho donde se acaba de escoger y con el caso real. -->
        @if (fijoGeneral()) {
          <p class="aviso fijo">{{ AVISO_FIJO_GENERAL }}</p>
        }
        <!--
          Y LA VUELTA: una cifra de fijo que quedó cobrándose POR LITRO. Es el único
          camino por el que esta pantalla puede autorizar una plata absurda sin que se
          note, porque al cambiar el modo la cifra se queda igual y se ve igual.
        -->
        @if (tarifaGeneralIncreible()) {
          <p class="aviso increible">{{ avisoTarifaIncreible(form.controls.valor_transporte.value) }}</p>
        }

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
          ni un peso. Y el ejemplo lleva LAS DOS FORMAS de cobrar en el mismo señor,
          porque es literal lo que pidió el dueño: Nápoles por litro y a fábrica por día.
        -->
        <p class="ayuda">
          El mismo señor puede hacer <strong>varias rutas</strong> y cobrar distinto en
          cada una: Alex Agudelo hace Nápoles a $&nbsp;242,76 el litro y el viaje a
          fábrica a $&nbsp;150.000 <strong>el día</strong>, así recoja de uno o de cinco
          proveedores. Agregue acá cada ruta con su tarifa y la leche de cada día se le
          paga con la tarifa <strong>de la ruta de ese día</strong>. Si una ruta no está
          en esta lista, se le paga con la tarifa general de arriba.
        </p>

        <!-- .lista-de-rutas es el CONTENEDOR contra el que se mide cada renglón: lo
             que decide si caben cuatro columnas es el ancho del diálogo, no el de la
             pantalla (ver los estilos). -->
        <div class="lista-de-rutas" formArrayName="rutas">
          @for (fila of rutas.controls; track fila; let i = $index) {
            <div class="fila-ruta" [formGroupName]="i">
              <!--
                Las opciones de CADA renglón salen sin las rutas que ya escogieron
                los otros: el backend rechaza la misma ruta dos veces (con dos
                tarifas no sabría cuál es la que vale), y ofrecerla para después
                rebotarla sería mandar al usuario a un error evitable.
              -->
              <app-select-buscable
                class="campo-ruta"
                formControlName="ruta_id"
                [opciones]="opcionesDeFila(i)"
                label="Ruta"
              />

              <!-- La papelera va pegada a la ruta —es lo que quita ESA ruta— y por eso
                   viene aquí y no de última: en celular la fila se apila y las dos
                   tienen que quedar en el mismo renglón. -->
              <button
                mat-icon-button
                type="button"
                class="quitar"
                matTooltip="Quitar esta ruta"
                [attr.aria-label]="'Quitar la ruta del renglón ' + (i + 1)"
                (click)="quitarRuta(i)"
              >
                <mat-icon>delete</mat-icon>
              </button>

              <!-- El modo ANTES de la cifra, como se dice: "a Nápoles le pago por
                   litro, $ 242,76". Cada ruta tiene el suyo, que es justo lo que el
                   dueño pidió: el mismo señor con una ruta por litro y otra por día. -->
              <mat-form-field class="campo-modo" subscriptSizing="dynamic">
                <mat-label>¿Cómo le paga?</mat-label>
                <mat-select formControlName="modo_transporte">
                  <mat-option [value]="POR_LITRO">Por litro</mat-option>
                  <mat-option [value]="DIA_FIJO">Fijo por día</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field class="campo-tarifa" subscriptSizing="dynamic">
                <mat-label>{{ fijoDeLaFila(i) ? 'Cuánto vale el día' : 'Tarifa por litro' }}</mat-label>
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
                <span matTextSuffix>{{ fijoDeLaFila(i) ? '/día' : '/L' }}</span>
                @if (fila.controls.valor_transporte.hasError('required')) {
                  <mat-error>
                    {{
                      fijoDeLaFila(i)
                        ? 'Escriba cuánto vale el día en esta ruta'
                        : 'Escriba la tarifa de esta ruta'
                    }}
                  </mat-error>
                } @else if (fila.controls.valor_transporte.hasError('min')) {
                  <mat-error>La tarifa no puede ser negativa</mat-error>
                }
              </mat-form-field>

              <!--
                Un renglón sin ruta deja el formulario inválido y el botón Guardar
                apagado. Sin decirlo, el usuario ve un botón muerto y no sabe por
                qué; y borrarle el renglón en silencio al guardar sería peor, porque
                la tarifa que ya tecleó se perdería sin avisar.
              -->
              @if (!fila.controls.ruta_id.value) {
                <p class="aviso falta">Escoja la ruta de este renglón, o quítelo con la papelera.</p>
              }
              <!-- Lo que significa el fijo, en el renglón donde se acaba de escoger. -->
              @if (fijoDeLaFila(i)) {
                <p class="aviso fijo">{{ AVISO_FIJO_DE_LA_RUTA }}</p>
              }
              <!-- Y la cifra de fijo que quedó cobrándose por litro. -->
              @if (tarifaIncreibleDeLaFila(i)) {
                <p class="aviso increible">
                  {{ avisoTarifaIncreible(fila.controls.valor_transporte.value) }}
                </p>
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

    /* La tarifa general: el modo y la cifra, uno al lado del otro y SIEMPRE juntos.
       Ocupa el ancho completo de la rejilla del formulario para que el auto-fit no
       los separe en dos renglones distintos: la cifra sin el modo no significa nada. */
    .tarifa-general {
      display: grid;
      grid-template-columns: minmax(0, 220px) minmax(0, 1fr);
      gap: 12px 16px;
      align-items: start;
    }

    /*
     * Un renglón = una ruta con su modo y su tarifa. La papelera del ancho justo.
     *
     * Los anchos no son a ojo: en el diálogo (640px, o sea 592 de contenido) le quedan
     * 218px a la ruta, y la caja de la tarifa tiene que poder mostrar "150.000" COMPLETO
     * con su "$" y su "/día" —una cifra de plata recortada es exactamente lo que esta
     * pantalla no se puede permitir—. Por debajo de 760px de pantalla el renglón se
     * apila (ver el @media): con cuatro columnas la ruta se quedaba en 74px.
     */
    .fila-ruta {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 150px 160px 40px;
      gap: 4px 8px;
      align-items: center;
      margin-bottom: 8px;
    }
    /* Las posiciones van escritas: el orden del HTML pone la papelera pegada a la
       ruta (así el celular la puede subir a su mismo renglón), pero en pantalla
       grande se lee ruta → cómo → cuánto → quitar. */
    .fila-ruta > .campo-ruta { grid-column: 1; grid-row: 1; }
    .fila-ruta > .campo-modo { grid-column: 2; grid-row: 1; }
    .fila-ruta > .campo-tarifa { grid-column: 3; grid-row: 1; }
    .fila-ruta > .quitar { grid-column: 4; grid-row: 1; }
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
    /*
     * Lo que significa el fijo: no es una alarma —es la explicación de lo que se
     * acaba de escoger— así que va en el color de la marca y no en rojo, con un
     * filete a la izquierda para que se lea como una nota pegada al campo.
     */
    .aviso.fijo {
      padding: 6px 10px;
      border-left: 3px solid var(--mat-sys-primary);
      border-radius: 0 6px 6px 0;
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent);
      color: var(--mat-sys-on-surface);
    }
    /* Y la cifra imposible SÍ es una alarma: son millones de flete en un día. En el
       color de error del tema, aunque no bloquee el guardado. */
    .aviso.increible {
      padding: 6px 10px;
      border-left: 3px solid var(--mat-sys-error);
      border-radius: 0 6px 6px 0;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font-weight: 500;
    }
    .agregar { margin-top: 4px; }

    @media (max-width: 600px) {
      .tarifa-general { grid-template-columns: minmax(0, 1fr); }
    }

    /*
     * EL RENGLÓN SE APILA SEGÚN EL ANCHO DEL DIÁLOGO, NO DEL CELULAR.
     *
     * La diferencia es real y se ve: el diálogo mide 640px o el 80% de la pantalla, lo
     * que sea menor, así que en una pantalla de 620px mide 496 y las cuatro columnas le
     * dejaban 74px a la ruta —el nombre partido en tres líneas y la tarifa recortada—
     * aunque la pantalla no sea "de celular". Con la consulta de CONTENEDOR el renglón
     * mide el espacio que de verdad tiene. (Es la misma familia de CSS moderno que este
     * proyecto ya usa en todas partes con color-mix.)
     */
    .lista-de-rutas { container-type: inline-size; }

    /* Cuando no caben las cuatro columnas: la ruta arriba con la papelera al lado, y
       el modo y la tarifa cada uno en su renglón —en ese orden, que es el de la frase:
       primero cómo le paga, después cuánto—. El recuadro agrupa lo que es UNA ruta,
       para que no se lea como campos sueltos.

       560px es la cuenta: 150 del modo + 160 de la tarifa + 40 de la papelera + 24 de
       separaciones dejan 186 para el nombre de la ruta, que es lo mínimo con lo que
       "San Vicente" se lee de un tirón. */
    @container (max-width: 560px) {
      .fila-ruta {
        grid-template-columns: minmax(0, 1fr) 40px;
        padding: 12px;
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 10px;
      }
      .fila-ruta > .campo-ruta { grid-column: 1; grid-row: 1; }
      .fila-ruta > .quitar { grid-column: 2; grid-row: 1; }
      .fila-ruta > .campo-modo { grid-column: 1 / -1; grid-row: 2; }
      .fila-ruta > .campo-tarifa { grid-column: 1 / -1; grid-row: 3; }
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

  // Los dos modos y los dos textos, para la plantilla. Los valores salen de
  // core/models.ts —son los del API, tal cual— y no se escriben a mano en el HTML:
  // un 'DIA_FIJO' de más rebotaría con un 422 después de que el usuario oprimió Guardar.
  readonly POR_LITRO = MODO_POR_LITRO;
  readonly DIA_FIJO = MODO_DIA_FIJO;
  readonly AVISO_FIJO_GENERAL = AVISO_FIJO_GENERAL;
  readonly AVISO_FIJO_DE_LA_RUTA = AVISO_FIJO_DE_LA_RUTA;

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
    /*
     * El modo de la tarifa general. Uno NUEVO nace POR LITRO —que es como se ha
     * cobrado siempre y la única forma que no cobra de más si nadie lo toca—; al
     * editar se respeta el guardado, y una respuesta vieja sin el campo se lee por
     * litro, que es lo que esa tarifa significaba el día que se escribió.
     *
     * Sin `required`: siempre tiene uno de los dos valores, nunca vacío. Un modo sin
     * escoger dejaría el botón Guardar apagado sin nada rojo que lo explique.
     */
    modo_transporte: [
      (this.data?.item?.modo_transporte ?? MODO_POR_LITRO) as ModoTransporte,
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
      // Cada ruta con SU modo: es lo que permite Nápoles por litro y a fábrica por
      // día en el mismo señor. Una ruta nueva arranca por litro, igual que la general.
      modo_transporte: [(datos?.modo_transporte ?? MODO_POR_LITRO) as ModoTransporte],
    });
  }

  // ------------------------------------------------- qué modo tiene cada tarifa
  /**
   * Se leen del control y no de una copia en una señal: el `mat-select` escribe en el
   * formulario y la plantilla se repinta con la detección de cambios, así que una
   * segunda fuente de la verdad solo podría desincronizarse del campo que está al lado.
   */
  fijoGeneral(): boolean {
    return esDiaFijo(this.form.controls.modo_transporte.value);
  }

  fijoDeLaFila(i: number): boolean {
    return esDiaFijo(this.rutas.at(i)?.controls.modo_transporte.value);
  }

  /**
   * UNA TARIFA POR LITRO QUE NO PUEDE SER UNA TARIFA POR LITRO.
   *
   * Solo mira las que están en modo POR LITRO: en día fijo, $ 150.000 es exactamente lo
   * que debe decir. Ver `TARIFA_POR_LITRO_INCREIBLE`.
   */
  private increible(modo: ModoTransporte, valor: number | null): boolean {
    return !esDiaFijo(modo) && Number(valor ?? 0) >= TARIFA_POR_LITRO_INCREIBLE;
  }

  tarifaGeneralIncreible(): boolean {
    const control = this.form.controls;
    return this.increible(control.modo_transporte.value, control.valor_transporte.value);
  }

  tarifaIncreibleDeLaFila(i: number): boolean {
    const fila = this.rutas.at(i);
    return !!fila && this.increible(
      fila.controls.modo_transporte.value,
      fila.controls.valor_transporte.value,
    );
  }

  /**
   * El aviso, CON LA CUENTA HECHA: no basta decir "es mucho", hay que mostrar en qué
   * se convierte. Se toman 300 litros porque es un día normal de una de las rutas y
   * porque la cifra que sale —millones— es imposible de confundir con algo correcto.
   */
  avisoTarifaIncreible(valor: number | null): string {
    const pesos = (cifra: number): string =>
      cifra.toLocaleString('es-CO', { maximumFractionDigits: 0 });
    const tarifa = Number(valor ?? 0);
    return (
      `Ojo: $ ${pesos(tarifa)} POR LITRO son $ ${pesos(tarifa * 300)} de flete en un día ` +
      'de 300 litros. Si lo que vale es el día completo, escoja «por día» acá al lado.'
    );
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
      //
      // EL MODO VIAJA SIEMPRE Y PEGADO A SU CIFRA, en las rutas y en la general. El
      // backend deja mandar la cifra sin el modo ("no me toque el modo") para que una
      // pantalla vieja no le vuelva 'litro' una ruta que estaba en día fijo dejándole
      // los $150.000 puestos —$45.000.000 de flete en un día de 300 litros, con la
      // cifra viéndose idéntica—. Este diálogo no usa esa red y manda los dos: acá el
      // usuario ve el modo de cada ruta en pantalla, así que lo que ve es lo que queda.
      const rutas: TransportadorRutaPayload[] = valor.rutas.map((fila) => ({
        ruta_id: fila.ruta_id as string,
        valor_transporte: Number(fila.valor_transporte),
        modo_transporte: fila.modo_transporte,
      }));
      const payload = {
        nombre: valor.nombre,
        documento: valor.documento,
        telefono: valor.telefono,
        // Number() y no el valor tal cual: el control admite null para poder nacer
        // vacío, y hasta acá solo llega con el formulario válido (el `required` no
        // deja pasar el null).
        valor_transporte: Number(valor.valor_transporte),
        modo_transporte: valor.modo_transporte,
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
