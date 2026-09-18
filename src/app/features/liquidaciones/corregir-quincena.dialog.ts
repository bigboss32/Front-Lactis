import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { Liquidacion, LiquidacionDetalle, Monto } from '../../core/models';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { CantidadPipe, MoneyPipe, pesosExactos } from '../../shared/pipes';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { MENOS, ROTULO_SALDO_ANTERIOR, precioTecleado } from './cifras-de-la-quincena';
import {
  AnticipoDeLaQuincena,
  DiaSuelto,
  LiquidacionesService,
  PrevisualizacionCorreccion,
  ValorDeUnAnticipo,
} from './liquidaciones.service';

/**
 * EL MOTIVO QUE VIAJA MIENTRAS EL DUEÑO NO HA ESCRITO EL SUYO.
 *
 * El avance (`POST /corregir/previsualizar`) exige el campo para poder leer el sobre —es
 * el mismo esquema de la corrección de verdad— pero NO LO USA NI LO GUARDA: solo mira los
 * días marcados y los precios. Sin este relleno la pantalla no podría mostrar el cuadre
 * hasta que se escribiera el motivo, que es justo al revés de como se decide: primero se
 * ve la cifra que va a quedar, y con eso a la vista se escribe por qué.
 *
 * NUNCA llega a guardarse: `corregir()` manda lo que el dueño escribió, y el botón está
 * apagado mientras eso no tenga al menos tres letras.
 */
export const MOTIVO_PROVISIONAL = 'consultando cómo quedaría';

/** Lo mínimo que el servidor acepta como motivo. Es el `min_length` del backend. */
const LARGO_MINIMO_DEL_MOTIVO = 3;

export interface CorregirQuincenaData {
  /** La quincena tal como se ve en el detalle: de ahí salen las cifras del "antes". */
  liquidacion: Liquidacion;
}

/**
 * UN RENGLÓN DEL CUADRE, ya formateado como se lee, con su cifra de antes y la de ahora.
 *
 * Se arma acá y no en la plantilla por la misma razón que el resumen del detalle: TIENE
 * QUE SUMAR DE ARRIBA ABAJO, y en las dos columnas. Con los renglones escritos a mano en
 * la plantilla, un renglón que no entra en la cuenta se cuela y el dueño suma con
 * calculadora y no le da. Armándolo en una lista, el orden y los signos son UNA sola cosa
 * que la plantilla solo pinta, y una prueba puede recorrerla y comprobar la resta.
 */
export interface RenglonDelCuadre {
  /** Cuál cifra es. La plantilla y las pruebas señalan el renglón por acá. */
  clave: string;
  etiqueta: string;
  /** Va restando: la plantilla le pone el signo de resta delante del rótulo. */
  resta: boolean;
  antes: string;
  ahora: string;
  /** La corrección movió esta cifra: se resalta para que salte a la vista. */
  cambio: boolean;
  destacado: boolean;
}

/** La cifra grande de una de las dos columnas, con el rótulo que le corresponde. */
export interface CierreDelCuadre {
  /** "QUEDA POR ENTREGARLE" o "SE LE PAGÓ DE MÁS". Son dos frases, no un signo. */
  rotulo: string;
  cifra: string;
  /** La plata va al revés: la debe el productor, no la quesera. */
  alReves: boolean;
}

/**
 * CORREGIR UNA QUINCENA QUE YA SE PAGÓ, y emitir la versión siguiente del comprobante.
 *
 * Lo pidió el dueño: "que si soy administrador de empresa pueda editar la liquidación que
 * ya está pagada, es que se le olvidó un detalle y tiene que editarla". Y escogió, entre
 * dos opciones, la de UN SOLO COMPROBANTE CORREGIDO (v2) en vez de dos papeles separados.
 *
 * LO QUE ESTA PANTALLA TIENE QUE LOGRAR, que es más que mandar una petición:
 *
 *  · QUE NO SE OLVIDE EL PAPEL VIEJO. El productor ya tiene una hoja con la cifra
 *    anterior. El aviso rojo de arriba está antes que cualquier otra cosa por eso.
 *  · QUE NO ENTRE UN DÍA QUE NADIE MIRÓ. Los días sueltos van con CASILLA, uno por uno,
 *    y no como un "recoger todo lo que esté suelto": si hay dos días olvidados y el dueño
 *    solo quería uno, el otro entraría sin que lo viera y esa es plata que sale.
 *  · QUE LA CIFRA QUE VE SEA LA QUE VA A QUEDAR. El cuadre en vivo SALE DE LA
 *    PREVISUALIZACIÓN DEL SERVIDOR. Acá no se calcula ni un peso del total: dos
 *    calculadoras terminan diciendo cifras distintas, y la que el dueño tiene al lado es
 *    la del papel. Lo único que esta pantalla calcula es la RESTA EXPLICATIVA de un
 *    precio tecleado ("100 L × ($ 1.850 − $ 1.800) = + $ 5.000"), que no es una cifra del
 *    documento sino la cuenta que le muestra al dueño qué acaba de teclear.
 *  · QUE QUEDE ESCRITO POR QUÉ. El motivo es obligatorio, y es lo único que después le
 *    explica a alguien por qué el papel que el productor guardó dice otra cifra.
 *
 * Devuelve la liquidación que respondió el servidor, para que el detalle pinte ESA y no
 * una versión calculada a mano.
 */
@Component({
  selector: 'app-corregir-quincena',
  imports: [
    DatePipe, ReactiveFormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatCheckboxModule, MatProgressBarModule,
    MatTooltipModule, MoneyPipe, CantidadPipe, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>Corregir la quincena — {{ tercero() }}</h2>

    <mat-dialog-content>
      @if (cargando() || guardando()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <!--
        EL AVISO ROJO VA DE PRIMERO Y NO SE PUEDE CERRAR. No es decoración: esta es la
        única pantalla del sistema que le cambia la cifra grande a un comprobante que ya
        se pagó, y del otro lado hay una persona con una hoja impresa en la mano.
      -->
      <div class="aviso-rojo">
        <mat-icon>report</mat-icon>
        <div>
          <strong>{{ tercero() }} ya tiene un papel con la cifra vieja.</strong>
          <p>
            Ese comprobante dice
            <b>{{ liq().valor_total | money: true }}</b> y ya se le entregaron
            <b>{{ liq().pagado | money: true }}</b>. Al corregirlo sale una hoja NUEVA
            (v{{ versionSiguiente() }}) con otra cifra: entréguesela y recójale la
            anterior, o va a quedar con dos papeles de la misma quincena.
          </p>
        </div>
      </div>

      @if (errorAlAbrir(); as problema) {
        <p class="no-se-puede">
          <mat-icon>lock</mat-icon>
          <span>{{ problema }}</span>
        </p>
      }

      @if (previa(); as p) {
        <!-- ---------------------------------------- los días que se quedaron por fuera -->
        <h3>El día que se le olvidó</h3>
        @if (p.dias_sueltos.length === 0) {
          <p class="vacio">
            En este período no quedó ningún día suelto: toda la leche que hay anotada del
            {{ liq().periodo_inicio | date: 'dd/MM/yyyy' }} al
            {{ liq().periodo_fin | date: 'dd/MM/yyyy' }} ya está en el comprobante. Si
            falta un día, primero anótelo en Recepción diaria y vuelva acá.
          </p>
        } @else {
          <p class="ayuda">
            Marque UNO POR UNO los días que hay que meter. Los que deje sin marcar no
            entran, y se quedan disponibles para otra quincena.
          </p>
          <div class="tabla-envuelta">
            <table class="tabla tabla-sueltos">
              <tr>
                <th class="chk"></th>
                <th>Fecha</th>
                <th class="num">Litros</th>
                <th class="num">Precio/L</th>
                <th class="num">Valor</th>
              </tr>
              @for (dia of p.dias_sueltos; track dia.recepcion_id) {
                <tr [class.marcado]="estaMarcado(dia.recepcion_id)">
                  <td class="chk">
                    <mat-checkbox
                      [checked]="estaMarcado(dia.recepcion_id)"
                      [disabled]="guardando()"
                      (change)="marcarDia(dia.recepcion_id, $event.checked)"
                      [attr.aria-label]="'Meter el día ' + (dia.fecha | date: 'dd/MM/yyyy')"
                    />
                  </td>
                  <td>{{ dia.fecha | date: 'dd/MM/yyyy' }}</td>
                  <td class="num">{{ dia.litros | cantidad: 'L' : 2 }}</td>
                  <td class="num">{{ dia.precio_litro | money: true }}</td>
                  <td class="num">{{ dia.valor | money: true }}</td>
                </tr>
                @if (dia.nota_flete) {
                  <!--
                    LA NOTA DEL FLETE ES EL PAPEL DE OTRA PERSONA, y la escribe el
                    servidor. Se muestra tal cual: el dueño que suma a mano va a
                    preguntar por qué ese día no tiene flete, y hay que responderle acá
                    y no en soporte.
                  -->
                  <tr class="nota">
                    <td></td>
                    <td colspan="4">
                      <mat-icon>local_shipping</mat-icon> {{ dia.nota_flete }}
                    </td>
                  </tr>
                }
              }
            </table>
          </div>
        }

        <!-- ---------------------------------------- los días que ya están -->
        <h3>Los días que ya están en el comprobante</h3>
        @if (detalles().length === 0) {
          <p class="vacio">Este comprobante no tiene días anotados.</p>
        } @else {
          <p class="ayuda">
            Si un precio quedó mal, corríjalo con el lápiz. Acá no se puede QUITAR un día:
            esos litros ya se pagaron y su flete ya está cobrado en el comprobante del
            transportador.
          </p>
          <div class="tabla-envuelta">
            <table class="tabla tabla-dias">
              <tr>
                <th>Fecha</th>
                <th class="num">Litros</th>
                <th class="num">Precio/L</th>
                <th class="num">Valor</th>
                <th class="acc"></th>
              </tr>
              @for (dia of detalles(); track dia.id) {
                <tr [class.marcado]="tienePrecioNuevo(dia.id)">
                  <td>{{ dia.fecha | date: 'dd/MM/yyyy' }}</td>
                  <td class="num">{{ dia.litros | cantidad: 'L' : 2 }}</td>
                  <td class="num">
                    @if (editandoId() === dia.id) {
                      <input
                        class="precio"
                        type="text"
                        inputmode="decimal"
                        [value]="textoPrecio()"
                        [attr.aria-label]="'Precio por litro del ' + (dia.fecha | date: 'dd/MM/yyyy')"
                        (input)="alEscribirPrecio($any($event.target).value)"
                        (keydown.enter)="aplicarPrecio(dia)"
                        (keydown.escape)="cancelarPrecio()"
                        (blur)="aplicarPrecio(dia)"
                        autofocus
                      />
                    } @else {
                      {{ precioQueValdria(dia) | money: true }}
                    }
                  </td>
                  <td class="num">{{ dia.valor | money: true }}</td>
                  <td class="acc">
                    @if (tienePrecioNuevo(dia.id)) {
                      <button
                        mat-icon-button
                        type="button"
                        matTooltip="Dejar este día como estaba"
                        aria-label="Dejar este día como estaba"
                        [disabled]="guardando()"
                        (click)="quitarPrecio(dia.id)"
                      >
                        <mat-icon>undo</mat-icon>
                      </button>
                    } @else if (editandoId() !== dia.id) {
                      <button
                        mat-icon-button
                        type="button"
                        matTooltip="Corregir el precio por litro de este día"
                        aria-label="Corregir el precio por litro de este día"
                        [disabled]="guardando()"
                        (click)="editarPrecio(dia)"
                      >
                        <mat-icon>edit</mat-icon>
                      </button>
                    }
                  </td>
                </tr>
                @if (restaDelDia(dia); as resta) {
                  <!--
                    LA RESTA HECHA, que es como el dueño comprueba lo que acaba de
                    teclear: los litros por la diferencia de precio. Es lo único que esta
                    pantalla calcula, y no es una cifra del documento —el total sale del
                    servidor—: es la cuenta que explica de dónde salieron esos pesos.
                  -->
                  <tr class="nota">
                    <td colspan="5"><mat-icon>calculate</mat-icon> {{ resta }}</td>
                  </tr>
                }
              }
            </table>
          </div>
        }

        <!-- ---------------------------------------- los adelantos que ya se le restaron -->
        <h3>Los adelantos que se le descontaron</h3>
        @if (p.anticipos_aplicados.length === 0) {
          <p class="vacio">
            A {{ tercero() }} no se le descontó ningún adelanto en esta quincena.
          </p>
        } @else {
          <!--
            LAS DOS ACCIONES SE EXPLICAN ANTES DE OFRECERLAS, y la de sacar en una línea
            entera: no es obvia y es plata. El dueño tiene que leer, antes de oprimirla,
            que el adelanto NO se borra —esa plata se la entregó en la mano— y que se le
            descuenta en la quincena siguiente.
          -->
          <p class="ayuda">
            Si un adelanto quedó anotado por otra cifra, corríjalo con el lápiz. Y si no
            iba en esta quincena, sáquelo: no se borra —esa plata ya se le entregó—, sube
            lo que hay que entregarle ahora y se le descuenta en la quincena siguiente.
          </p>
          <!--
            LA FRASE QUE DECIDE SI ESA PLATA SE LE DESCUENTA DESPUÉS O NO. Va escrita
            antes de ofrecer los dos botones, porque confundirlos cuesta plata en las dos
            direcciones: anular uno que sí se entregó se la regala al productor, y sacar
            uno que nunca existió se la quita de una quincena que sí es suya.
          -->
          <p class="ayuda distincion">
            <mat-icon>help_outline</mat-icon>
            <span>
              <b>Sacar</b> es decir “no iba aquí”: esa plata sí se le entregó y se le
              descuenta en la quincena siguiente. <b>Anular</b> es decir “ese adelanto no
              existió” —se anotó dos veces, o al productor equivocado—: no se le descuenta
              en ninguna quincena.
            </span>
          </p>
          <div class="tabla-envuelta">
            <table class="tabla tabla-anticipos">
              <tr>
                <th>Fecha</th>
                <th>Para qué fue</th>
                <th class="num">Lo que se le adelantó</th>
                <th class="acc"></th>
              </tr>
              @for (ade of p.anticipos_aplicados; track ade.anticipo_id) {
                <tr
                  [class.marcado]="tieneValorNuevo(ade.anticipo_id)"
                  [class.sacado]="estaSacado(ade.anticipo_id)"
                  [class.anulado]="estaAnulado(ade.anticipo_id)"
                >
                  <td>{{ ade.fecha | date: 'dd/MM/yyyy' }}</td>
                  <td>{{ ade.observaciones || '—' }}</td>
                  <td class="num">
                    @if (editandoAnticipoId() === ade.anticipo_id) {
                      <input
                        class="precio"
                        type="text"
                        inputmode="decimal"
                        [value]="textoValor()"
                        [attr.aria-label]="
                          'Lo que se le adelantó el ' + (ade.fecha | date: 'dd/MM/yyyy')
                        "
                        (input)="alEscribirValor($any($event.target).value)"
                        (keydown.enter)="aplicarValor(ade)"
                        (keydown.escape)="cancelarValor()"
                        (blur)="aplicarValor(ade)"
                        autofocus
                      />
                    } @else {
                      {{ valorQueValdria(ade) | money: true }}
                    }
                  </td>
                  <td class="acc">
                    @if (estaAnulado(ade.anticipo_id)) {
                      <button
                        mat-icon-button
                        type="button"
                        matTooltip="No anularlo: ese adelanto sí existió"
                        aria-label="No anularlo: ese adelanto sí existió"
                        [disabled]="guardando()"
                        (click)="desanularAnticipo(ade.anticipo_id)"
                      >
                        <mat-icon>undo</mat-icon>
                      </button>
                    } @else if (estaSacado(ade.anticipo_id)) {
                      <button
                        mat-icon-button
                        type="button"
                        matTooltip="Volver a descontarlo en esta quincena"
                        aria-label="Volver a descontarlo en esta quincena"
                        [disabled]="guardando()"
                        (click)="devolverAnticipo(ade.anticipo_id)"
                      >
                        <mat-icon>undo</mat-icon>
                      </button>
                    } @else {
                      @if (tieneValorNuevo(ade.anticipo_id)) {
                        <button
                          mat-icon-button
                          type="button"
                          matTooltip="Dejar este adelanto como estaba"
                          aria-label="Dejar este adelanto como estaba"
                          [disabled]="guardando()"
                          (click)="quitarValor(ade.anticipo_id)"
                        >
                          <mat-icon>undo</mat-icon>
                        </button>
                      } @else if (editandoAnticipoId() !== ade.anticipo_id) {
                        <button
                          mat-icon-button
                          type="button"
                          matTooltip="Corregir lo que se le adelantó"
                          aria-label="Corregir lo que se le adelantó"
                          [disabled]="guardando()"
                          (click)="editarValor(ade)"
                        >
                          <mat-icon>edit</mat-icon>
                        </button>
                      }
                      <button
                        mat-icon-button
                        type="button"
                        matTooltip="Sacar este adelanto de esta quincena: sí se le entregó, y se le descuenta en la siguiente"
                        aria-label="Sacar este adelanto de esta quincena"
                        [disabled]="guardando()"
                        (click)="sacarAnticipo(ade)"
                      >
                        <mat-icon>remove_circle_outline</mat-icon>
                      </button>
                      <!--
                        ANULAR NO ES SACAR, y el botón tiene que verse distinto porque la
                        consecuencia es otra: pide confirmación, va en rojo y su tooltip
                        dice la frase entera. Ver el método anularAnticipo.
                      -->
                      <button
                        mat-icon-button
                        type="button"
                        class="anular"
                        matTooltip="Anular este adelanto: nunca existió y no se le descuenta en ninguna quincena"
                        aria-label="Anular este adelanto: nunca existió"
                        [disabled]="guardando()"
                        (click)="anularAnticipo(ade)"
                      >
                        <mat-icon>delete_forever</mat-icon>
                      </button>
                    }
                  </td>
                </tr>
                @if (notaDelAnticipo(ade); as nota) {
                  <!--
                    LO QUE ACABA DE HACER, DICHO EN PLATA. Como la resta de los días: no
                    es una cifra del documento —el total sale del servidor— sino la cuenta
                    que le explica al dueño qué cambió con lo que acaba de oprimir.
                  -->
                  <tr class="nota">
                    <td></td>
                    <td colspan="3"><mat-icon>calculate</mat-icon> {{ nota }}</td>
                  </tr>
                }
              }
            </table>
          </div>
        }

        <!-- ---------------------------------------- los adelantos que quedaron sueltos -->
        <h3>Adelantos que se le dieron y no se le han descontado</h3>
        @if (p.anticipos_sueltos.length === 0) {
          <p class="vacio">
            No hay adelantos sueltos de {{ tercero() }}: todo lo que se le ha adelantado ya
            está descontado en alguna quincena.
          </p>
        } @else {
          <p class="ayuda">
            Marque UNO POR UNO los que haya que descontarle en ESTA quincena: al marcarlos
            baja lo que hay que entregarle. Los que deje sin marcar no se pierden, se
            quedan esperando la quincena siguiente.
          </p>
          <div class="tabla-envuelta">
            <table class="tabla tabla-anticipos-sueltos">
              <tr>
                <th class="chk"></th>
                <th>Fecha</th>
                <th>Para qué fue</th>
                <th class="num">Lo que se le adelantó</th>
              </tr>
              @for (ade of p.anticipos_sueltos; track ade.anticipo_id) {
                <tr [class.marcado]="estaIncluido(ade.anticipo_id)">
                  <td class="chk">
                    <mat-checkbox
                      [checked]="estaIncluido(ade.anticipo_id)"
                      [disabled]="guardando()"
                      (change)="incluirAnticipo(ade.anticipo_id, $event.checked)"
                      [attr.aria-label]="
                        'Descontar el adelanto del ' + (ade.fecha | date: 'dd/MM/yyyy')
                      "
                    />
                  </td>
                  <td>{{ ade.fecha | date: 'dd/MM/yyyy' }}</td>
                  <td>{{ ade.observaciones || '—' }}</td>
                  <td class="num">{{ ade.valor | money: true }}</td>
                </tr>
                @if (ade.aviso; as aviso) {
                  <!--
                    EL ADELANTO VIEJO VA SEÑALADO. El servidor lo manda porque es de ANTES
                    de este período y nunca se le descontó a nadie: si el dueño lo marca
                    sin verlo, le descuenta aquí una plata de hace meses.
                  -->
                  <tr class="nota senalada">
                    <td></td>
                    <td colspan="3"><mat-icon>history</mat-icon> {{ aviso }}</td>
                  </tr>
                }
                @if (notaDelAnticipoSuelto(ade); as nota) {
                  <tr class="nota">
                    <td></td>
                    <td colspan="3"><mat-icon>calculate</mat-icon> {{ nota }}</td>
                  </tr>
                }
              }
            </table>
          </div>
        }

        <!-- ---------------------------------------- los que esta misma quincena sacó
          NO SE PINTA VACÍA, al revés que las otras dos. Las otras dos son preguntas que
          el dueño trae ("¿qué se le descontó?", "¿qué quedó suelto?") y su vacío es una
          respuesta. Esta lista solo existe cuando ESTA quincena ya sacó un adelanto en
          una corrección anterior, que es el caso raro: pintarla vacía en toda corrección
          le pondría delante una sección que no puede entender —y con el único botón que
          borra plata— justo cuando no tiene nada que hacer con ella.
        -->
        @if (soltadosPorEsta().length > 0) {
          <h3>Adelantos que esta quincena sacó</h3>
          <p class="ayuda">
            Estos salieron de esta quincena en una corrección anterior y están esperando
            que la siguiente se los descuente. Si alguno NUNCA EXISTIÓ —se anotó dos
            veces, o al productor equivocado— anúlelo: esta es la única pantalla que
            puede, porque es la que lo imprimió.
          </p>
          <p class="ayuda distincion">
            <mat-icon>help_outline</mat-icon>
            <span>
              <b>Sacar</b> es decir “no iba aquí” y esa plata se le descuenta en la
              quincena siguiente. <b>Anular</b> es decir “ese adelanto no existió” y no se
              le descuenta en ninguna. Si sí se le entregó la plata, no lo anule.
            </span>
          </p>
          <div class="tabla-envuelta">
            <table class="tabla tabla-anticipos-soltados">
              <tr>
                <th>Fecha</th>
                <th>Para qué fue</th>
                <th class="num">Lo que se le adelantó</th>
                <th class="acc"></th>
              </tr>
              @for (ade of soltadosPorEsta(); track ade.anticipo_id) {
                <tr [class.anulado]="estaAnulado(ade.anticipo_id)">
                  <td>{{ ade.fecha | date: 'dd/MM/yyyy' }}</td>
                  <td>{{ ade.observaciones || '—' }}</td>
                  <td class="num">{{ ade.valor | money: true }}</td>
                  <td class="acc">
                    @if (estaAnulado(ade.anticipo_id)) {
                      <button
                        mat-icon-button
                        type="button"
                        matTooltip="No anularlo: ese adelanto sí existió"
                        aria-label="No anularlo: ese adelanto sí existió"
                        [disabled]="guardando()"
                        (click)="desanularAnticipo(ade.anticipo_id)"
                      >
                        <mat-icon>undo</mat-icon>
                      </button>
                    } @else {
                      <button
                        mat-icon-button
                        type="button"
                        class="anular"
                        matTooltip="Anular este adelanto: nunca existió y no se le descuenta en ninguna quincena"
                        aria-label="Anular este adelanto: nunca existió"
                        [disabled]="guardando()"
                        (click)="anularAnticipo(ade)"
                      >
                        <mat-icon>delete_forever</mat-icon>
                      </button>
                    }
                  </td>
                </tr>
                @if (ade.aviso; as aviso) {
                  <!--
                    EL AVISO DEL SERVIDOR, TAL CUAL: dice que el comprobante que el
                    productor tiene en la mano promete descontarle ese adelanto en la
                    siguiente, y que si nunca existió esta es la única pantalla que lo
                    puede anular. Traducirlo acá sería tener dos versiones del mismo
                    aviso, y la de la pantalla quedaría vieja.
                  -->
                  <tr class="nota senalada">
                    <td></td>
                    <td colspan="3"><mat-icon>receipt_long</mat-icon> {{ aviso }}</td>
                  </tr>
                }
                @if (notaDeAnulado(ade); as nota) {
                  <tr class="nota">
                    <td></td>
                    <td colspan="3"><mat-icon>calculate</mat-icon> {{ nota }}</td>
                  </tr>
                }
              }
            </table>
          </div>
        }

        <!-- ---------------------------------------- el motivo -->
        <h3>Por qué se corrige</h3>
        <form [formGroup]="form" id="form-corregir-quincena" (ngSubmit)="corregir()">
          <mat-form-field class="full" subscriptSizing="dynamic">
            <mat-label>Motivo de la corrección</mat-label>
            <textarea
              matInput
              formControlName="motivo"
              rows="2"
              maxlength="500"
              cdkFocusInitial
              placeholder="Ej. se le olvidó anotar la leche del 12 de junio"
            ></textarea>
            <mat-hint>
              Queda escrito en el comprobante corregido: es lo que le explica a cualquiera
              por qué el papel viejo dice otra cifra.
            </mat-hint>
          </mat-form-field>
        </form>

        <!-- ---------------------------------------- el cuadre en vivo -->
        <h3>Cómo queda la cuenta</h3>
        <div class="cuadre">
          <span class="enc"></span>
          <span class="enc num">Antes</span>
          <span class="enc num">Ahora</span>
          @for (fila of renglonesDelCuadre(); track fila.clave) {
            <span class="rotulo" [class.fuerte]="fila.destacado" [attr.data-clave]="fila.clave">
              @if (fila.resta) {
                <span class="menos">{{ MENOS }}</span>
              }
              {{ fila.etiqueta }}
            </span>
            <span class="num" [class.fuerte]="fila.destacado">{{ fila.antes }}</span>
            <span class="num" [class.fuerte]="fila.destacado" [class.movio]="fila.cambio">
              {{ fila.ahora }}
            </span>
          }
        </div>

        <div class="cierres">
          <div class="cierre">
            <span class="cierre-rotulo">Antes: {{ cierreAntes().rotulo }}</span>
            <span class="cierre-cifra" [class.al-reves]="cierreAntes().alReves">
              {{ cierreAntes().cifra }}
            </span>
          </div>
          <div class="cierre ahora">
            <span class="cierre-rotulo">{{ cierreAhora().rotulo }}</span>
            <span class="cierre-cifra" [class.al-reves]="cierreAhora().alReves">
              {{ cierreAhora().cifra }}
            </span>
          </div>
        </div>

        <p class="estado-que-queda">
          La quincena queda en <b>{{ p.estado_despues }}</b> y el comprobante pasa a ser la
          <b>versión {{ versionSiguiente() }}</b>.
        </p>

        <!-- Los avisos del servidor, TAL CUAL: traducirlos acá sería tener dos versiones
             del mismo aviso, y la de la pantalla quedaría vieja el día que el servidor
             agregue una razón nueva. -->
        @for (aviso of p.avisos; track aviso) {
          <p class="aviso-servidor"><mat-icon>info</mat-icon> <span>{{ aviso }}</span></p>
        }

        @if (errorAlPrevisualizar(); as problema) {
          <p class="aviso-servidor error">
            <mat-icon>error_outline</mat-icon>
            <span>{{ problema }} Las cifras de arriba pueden estar viejas.</span>
          </p>
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      @if (motivoNoCorregirYa(); as falta) {
        <span class="falta" [matTooltip]="falta">
          <mat-icon>lock</mat-icon> {{ falta }}
        </span>
      }
      <button
        mat-flat-button
        type="submit"
        form="form-corregir-quincena"
        [disabled]="!sePuedeCorregir() || guardando()"
      >
        @if (guardando()) {
          <app-spinner-boton /> Corrigiendo…
        } @else {
          Corregir la quincena
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    h3 {
      margin: 20px 0 8px;
      font-size: 1rem;
      font-weight: 500;
    }
    .full { width: 100%; }
    .num { text-align: right; }
    .ayuda,
    .vacio {
      margin: 0 0 8px;
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }
    /*
      EL AVISO ROJO. Usa los colores de error del tema (que ya vienen resueltos con
      light-dark()), así que el modo oscuro sale solo y el contraste del par
      error-container / on-error-container lo garantiza Material 3.
    */
    .aviso-rojo {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px 14px;
      margin-bottom: 8px;
      border-radius: 8px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .aviso-rojo p { margin: 4px 0 0; font-size: 0.85rem; }
    .no-se-puede,
    .aviso-servidor {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      margin: 8px 0 0;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .aviso-servidor.error { color: var(--mat-sys-error); }
    .no-se-puede mat-icon,
    .aviso-servidor mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex: none;
    }
    .tabla-envuelta { overflow-x: auto; }
    .tabla {
      width: 100%;
      min-width: 420px;
      border-collapse: collapse;
    }
    .tabla th,
    .tabla td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      font-size: 0.85rem;
    }
    .tabla th {
      font-weight: 500;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
    .tabla .chk { width: 40px; }
    .tabla .acc { width: 48px; text-align: right; }
    /* Tres botones —el lápiz, el de sacarlo y el de anularlo— en el mismo renglón. */
    .tabla-anticipos .acc { width: 144px; white-space: nowrap; }
    .tabla tr.marcado > td { background: var(--mat-sys-secondary-container); }
    /*
      EL ADELANTO QUE SALE se ve tachado y apagado, pero SIGUE AHÍ: es exactamente lo que
      pasa con esa plata. No se borró —se le entregó en la mano—, solo dejó de ir en esta
      quincena.
    */
    .tabla tr.sacado > td { opacity: 0.6; }
    .tabla tr.sacado > td.num { text-decoration: line-through; }
    /*
      EL ADELANTO ANULADO SE VE DISTINTO DEL QUE SALE, y a propósito: el que sale sigue
      vivo —se le descuenta en la siguiente— y solo se apaga; el anulado nunca existió, y
      va tachado ENTERO y en rojo. Son dos consecuencias distintas para la plata del
      productor y no se pueden ver iguales.
    */
    .tabla tr.anulado > td {
      opacity: 0.65;
      text-decoration: line-through;
      text-decoration-color: var(--mat-sys-error);
    }
    /* El botón que sí borra va en rojo: es el único de esta pantalla que lo hace. */
    .tabla button.anular { color: var(--mat-sys-error); }
    /*
      LA FRASE QUE SEPARA SACAR DE ANULAR. Va señalada como un aviso y no como texto de
      ayuda corriente: es la que decide si esa plata se le descuenta después o no.
    */
    .ayuda.distincion {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);
    }
    .ayuda.distincion mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex: none;
    }
    /* El adelanto viejo, el de antes del período: se señala para que no pase de largo. */
    .tabla tr.nota.senalada > td {
      color: var(--mat-sys-on-error-container);
      background: var(--mat-sys-error-container);
      border-radius: 4px;
    }
    .tabla tr.nota > td {
      border-bottom: none;
      padding-top: 0;
      font-size: 0.78rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .tabla tr.nota mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
      vertical-align: -2px;
    }
    .precio {
      width: 96px;
      text-align: right;
      font: inherit;
      color: inherit;
      background: var(--mat-sys-surface);
      border: 1px solid var(--mat-sys-primary);
      border-radius: 4px;
      padding: 2px 6px;
    }
    /*
      EL CUADRE, en tres columnas: rótulo, antes y ahora. Las DOS columnas de cifras
      suman de arriba abajo, que es como el dueño lo verifica con calculadora.
    */
    .cuadre {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 4px 16px;
      align-items: baseline;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
    }
    .cuadre .enc {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--mat-sys-on-surface-variant);
    }
    .cuadre .rotulo { font-size: 0.85rem; }
    .cuadre .num { font-variant-numeric: tabular-nums; font-size: 0.9rem; }
    .cuadre .fuerte { font-weight: 600; }
    .cuadre .menos { color: var(--mat-sys-on-surface-variant); }
    .cuadre .movio { color: var(--mat-sys-primary); font-weight: 600; }
    .cierres {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 12px;
    }
    .cierre {
      flex: 1 1 200px;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
    }
    .cierre.ahora {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .cierre-rotulo {
      display: block;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .cierre-cifra {
      display: block;
      margin-top: 2px;
      font-size: 1.25rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .cierre-cifra.al-reves { color: var(--mat-sys-error); }
    .estado-que-queda {
      margin: 10px 0 0;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .falta {
      display: inline-flex;
      gap: 4px;
      align-items: center;
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .falta mat-icon { font-size: 16px; width: 16px; height: 16px; }
  `,
})
export class CorregirQuincenaDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(LiquidacionesService);
  private readonly dialogRef = inject(MatDialogRef<CorregirQuincenaDialog, Liquidacion>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<CorregirQuincenaData>(MAT_DIALOG_DATA);

  /** El signo de resta, para la plantilla. Ver `MENOS`: es U+2212, no el guion. */
  readonly MENOS = MENOS;

  readonly liq = signal<Liquidacion>(this.data.liquidacion);
  readonly previa = signal<PrevisualizacionCorreccion | null>(null);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  /** El servidor no deja corregir esta quincena: se dice por qué y no se ofrece nada. */
  readonly errorAlAbrir = signal<string | null>(null);
  /** Se cayó un avance posterior: las cifras que quedaron en pantalla son viejas. */
  readonly errorAlPrevisualizar = signal<string | null>(null);

  /** Los días sueltos MARCADOS, por id de recepción. Uno por uno, nunca todos. */
  private readonly marcados = signal<ReadonlySet<string>>(new Set<string>());
  /** El precio nuevo de cada día ya incluido, por id del renglón del detalle. */
  private readonly preciosNuevos = signal<ReadonlyMap<string, number>>(new Map());

  /**
   * LOS ADELANTOS QUE EL DUEÑO MOVIÓ, en cuatro listas separadas y no en una sola con una
   * "acción": son cuatro cosas con consecuencias distintas y la pantalla las pinta
   * distinto. Van con la misma forma que los días —marcados y precios— porque son la
   * misma clase de decisión: uno por uno, y nada se manda hasta el botón.
   *
   *  · `anticiposIncluidos` — sueltos que se le descuentan en ESTA quincena.
   *  · `anticiposSacados` — los que ya estaban y no iban aquí. NO SE BORRAN.
   *  · `valoresDeAnticipos` — el valor corregido de los que se quedan.
   *  · `anticiposAnulados` — los que NUNCA EXISTIERON. Estos sí se borran.
   *
   * LAS DOS ÚLTIMAS PALABRAS NO SON SINÓNIMOS: sacar dice "no iba aquí" y esa plata sigue
   * viva —se le descuenta en la quincena siguiente—; anular dice "no pasó" y no se le
   * descuenta en ninguna. Por eso van en listas distintas y no en un campo "acción":
   * confundirlas cuesta plata en las dos direcciones.
   */
  private readonly anticiposIncluidos = signal<ReadonlySet<string>>(new Set<string>());
  private readonly anticiposSacados = signal<ReadonlySet<string>>(new Set<string>());
  private readonly valoresDeAnticipos = signal<ReadonlyMap<string, number>>(new Map());
  private readonly anticiposAnulados = signal<ReadonlySet<string>>(new Set<string>());

  /** Día cuyo precio se está tecleando (su id), o null si no hay ninguno. */
  readonly editandoId = signal<string | null>(null);
  /** Lo tecleado en el campo abierto, tal cual, sin interpretar todavía. */
  readonly textoPrecio = signal('');
  /** Escape cierra el campo; esta marca evita que el blur guarde lo que se canceló. */
  private cancelando = false;

  /**
   * Adelanto cuyo valor se está tecleando, con su propio campo y su propia marca de
   * cancelar. VA APARTE del de los días a propósito: son dos listas distintas y un solo
   * par de señales dejaría abierto el camino a que un blur de un día escribiera sobre un
   * adelanto, que es plata entregada en la mano.
   */
  readonly editandoAnticipoId = signal<string | null>(null);
  readonly textoValor = signal('');
  private cancelandoValor = false;

  readonly form = this.fb.group({
    motivo: ['', [Validators.required, Validators.minLength(LARGO_MINIMO_DEL_MOTIVO)]],
  });

  readonly tercero = computed(
    () => this.liq().proveedor_nombre ?? this.liq().transportador_nombre ?? '—',
  );

  readonly detalles = computed<LiquidacionDetalle[]>(() => this.liq().detalles ?? []);

  /**
   * LOS ADELANTOS QUE ESTA MISMA QUINCENA SACÓ, y que siguen esperando.
   *
   * Sale del avance como todo lo demás. El `?? []` no sobra: un servidor que todavía no
   * mande la lista dejaría la pantalla reventada en una quincena PAGADA, y lo que se
   * pierde sin ella es solo poder anular —corregir sigue funcionando—.
   */
  readonly soltadosPorEsta = computed<AnticipoDeLaQuincena[]>(
    () => this.previa()?.anticipos_soltados_por_esta ?? [],
  );

  readonly versionSiguiente = computed(() => Number(this.liq().version ?? 1) + 1);

  private readonly litrosPipe = new CantidadPipe();

  constructor() {
    // El avance de entrada va con las dos listas VACÍAS: lo que se pide es la foto del
    // "antes" y cuáles días quedaron sueltos. Nada se escribe.
    void this.refrescarPrevia(true);

    // Cerrar por accidente con días marcados y el motivo escrito es perder el trabajo
    // encima de una quincena pagada. El botón Cancelar sigue cerrando derecho.
    this.dialogRef.disableClose = true;
    const intentarCerrar = (): void => {
      if (this.guardando()) return;
      if (!this.hayCambios() || confirm('Tienes cambios sin guardar. ¿Deseas descartarlos?')) {
        this.dialogRef.close();
      }
    };
    this.dialogRef.backdropClick().subscribe(() => intentarCerrar());
    this.dialogRef.keydownEvents().subscribe((evento) => {
      // Escape con un campo abierto cierra el campo, no el diálogo: son los dos campos
      // que se teclean acá, el precio de un día y lo que se le adelantó.
      if (
        evento.key === 'Escape' &&
        this.editandoId() === null &&
        this.editandoAnticipoId() === null
      ) {
        intentarCerrar();
      }
    });
  }

  // ------------------------------------------------- los días sueltos
  estaMarcado(recepcionId: string): boolean {
    return this.marcados().has(recepcionId);
  }

  marcarDia(recepcionId: string, entra: boolean): void {
    const siguiente = new Set(this.marcados());
    if (entra) siguiente.add(recepcionId);
    else siguiente.delete(recepcionId);
    this.marcados.set(siguiente);
    void this.refrescarPrevia();
  }

  // ------------------------------------------------- el precio de un día que ya está
  tienePrecioNuevo(detalleId: string): boolean {
    return this.preciosNuevos().has(detalleId);
  }

  /** El precio que se va a mandar para ese día: el tecleado, o el que ya tenía. */
  precioQueValdria(detalle: LiquidacionDetalle): Monto {
    return this.preciosNuevos().get(detalle.id) ?? detalle.precio_litro;
  }

  editarPrecio(detalle: LiquidacionDetalle): void {
    if (this.guardando()) return;
    this.cancelando = false;
    this.textoPrecio.set(String(Number(this.precioQueValdria(detalle))));
    this.editandoId.set(detalle.id);
  }

  cancelarPrecio(): void {
    this.cancelando = true;
    this.editandoId.set(null);
  }

  alEscribirPrecio(valor: string): void {
    this.textoPrecio.set(valor);
  }

  /**
   * Al salir del campo se guarda el precio tecleado, como en la hoja de cálculo de la que
   * viene el dueño. Escape sigue siendo la forma de arrepentirse.
   *
   * ACÁ NO SE MANDA NADA AL SERVIDOR TODAVÍA: solo se anota el precio y se vuelve a pedir
   * el avance. La corrección de verdad es un solo botón, una sola petición.
   */
  aplicarPrecio(detalle: LiquidacionDetalle): void {
    if (this.cancelando) {
      this.cancelando = false;
      return;
    }
    if (this.editandoId() !== detalle.id) return;
    const precio = precioTecleado(this.textoPrecio());
    if (precio === null) {
      this.snackbar.open('Escriba el precio por litro en pesos, por ejemplo 1750', 'OK', {
        duration: 4000,
      });
      return; // el campo se queda abierto para corregir lo tecleado
    }
    this.editandoId.set(null);
    // Volver al precio que ya tenía NO es una corrección: se quita de la lista para que
    // el comprobante no suba de versión por un día que quedó igual.
    if (precio === Number(detalle.precio_litro)) {
      this.quitarPrecio(detalle.id);
      return;
    }
    if (precio === this.preciosNuevos().get(detalle.id)) return;
    const siguiente = new Map(this.preciosNuevos());
    siguiente.set(detalle.id, precio);
    this.preciosNuevos.set(siguiente);
    void this.refrescarPrevia();
  }

  quitarPrecio(detalleId: string): void {
    if (!this.preciosNuevos().has(detalleId)) return;
    const siguiente = new Map(this.preciosNuevos());
    siguiente.delete(detalleId);
    this.preciosNuevos.set(siguiente);
    void this.refrescarPrevia();
  }

  /**
   * LA RESTA HECHA, para que el dueño compruebe de dónde salieron esos pesos:
   * "100 L × ($ 1.850 − $ 1.800) = + $ 5.000".
   *
   * Es lo ÚNICO que esta pantalla calcula, y a propósito no es una cifra del documento:
   * el valor total, el neto y el saldo salen todos del servidor. Esto es la explicación
   * de lo que el dueño acaba de teclear, en la misma forma en que él la haría a mano.
   *
   * Null cuando ese día no tiene precio nuevo, para que la plantilla no repita la
   * condición.
   */
  restaDelDia(detalle: LiquidacionDetalle): string | null {
    const nuevo = this.preciosNuevos().get(detalle.id);
    if (nuevo === undefined) return null;
    const viejo = Number(detalle.precio_litro);
    const litros = Number(detalle.litros);
    // A DOS DECIMALES, que es como el backend guarda la plata (Numeric(14,2)). Sin esto
    // la resta de la pantalla se desviaría del total del servidor por fracciones de
    // centavo, y este documento se cuadra al centavo.
    const diferencia = Math.round(litros * (nuevo - viejo) * 100) / 100;
    const signo = diferencia < 0 ? MENOS : '+';
    return (
      `${this.litrosPipe.transform(detalle.litros, 'L', 2)} × ` +
      `(${pesosExactos(nuevo)} ${MENOS} ${pesosExactos(viejo)}) = ` +
      `${signo} ${pesosExactos(Math.abs(diferencia))}`
    );
  }

  // ------------------------------------------------- los adelantos
  /**
   * QUÉ ES UN ADELANTO Y POR QUÉ SE PUEDE TOCAR ACÁ.
   *
   * Es plata que YA SE LE ENTREGÓ EN LA MANO al productor, y el comprobante se la resta:
   * `lo que hay que entregarle = valor total − adelantos − lo que venía debiendo`. Por
   * eso mover un adelanto mueve la cifra grande igual que un día de leche, y por eso
   * entra por esta puerta —con motivo escrito, la cifra a la vista y la versión del
   * comprobante que sube— y no por la pantalla de anticipos, que para una quincena ya
   * pagada está cerrada con candado.
   *
   * LAS CUATRO ACCIONES, dichas en plata:
   *  · MARCAR uno suelto: se le descuenta aquí, baja lo que hay que entregarle.
   *  · SACAR uno que ya estaba: sube lo que hay que entregarle en esta quincena, y ese
   *    adelanto queda libre para que la SIGUIENTE se lo descuente. No se borra.
   *  · CORREGIRLE EL VALOR: quedó mal anotado lo que se le entregó.
   *  · ANULARLO: ese adelanto NUNCA EXISTIÓ, y no se le descuenta en ninguna quincena.
   *    Es la única que sí borra, y la única que pide confirmación. Ver `anularAnticipo`.
   */
  estaIncluido(anticipoId: string): boolean {
    return this.anticiposIncluidos().has(anticipoId);
  }

  incluirAnticipo(anticipoId: string, entra: boolean): void {
    const siguiente = new Set(this.anticiposIncluidos());
    if (entra) siguiente.add(anticipoId);
    else siguiente.delete(anticipoId);
    this.anticiposIncluidos.set(siguiente);
    void this.refrescarPrevia();
  }

  estaSacado(anticipoId: string): boolean {
    return this.anticiposSacados().has(anticipoId);
  }

  /**
   * SACA EL ADELANTO DE ESTA QUINCENA. No lo borra: esa plata se le entregó.
   *
   * Y LE QUITA DE PASO EL VALOR CORREGIDO, si se le había tecleado uno. El servidor
   * rebota mandar las dos cosas juntas —corregirle la cifra a un adelanto que se está
   * sacando no significaría nada, porque se va a descontar en OTRA quincena— y ese rebote
   * llegaría después de oprimir el botón, encima de una quincena pagada. Acá no se puede
   * llegar a armar ese sobre.
   */
  sacarAnticipo(anticipo: AnticipoDeLaQuincena): void {
    if (this.guardando() || this.estaAnulado(anticipo.anticipo_id)) return;
    if (this.editandoAnticipoId() === anticipo.anticipo_id) this.cancelarValor();
    const siguiente = new Set(this.anticiposSacados());
    siguiente.add(anticipo.anticipo_id);
    this.anticiposSacados.set(siguiente);
    if (this.valoresDeAnticipos().has(anticipo.anticipo_id)) {
      const valores = new Map(this.valoresDeAnticipos());
      valores.delete(anticipo.anticipo_id);
      this.valoresDeAnticipos.set(valores);
    }
    void this.refrescarPrevia();
  }

  devolverAnticipo(anticipoId: string): void {
    if (!this.anticiposSacados().has(anticipoId)) return;
    const siguiente = new Set(this.anticiposSacados());
    siguiente.delete(anticipoId);
    this.anticiposSacados.set(siguiente);
    void this.refrescarPrevia();
  }

  // ------------------------------------------------- anular uno que NUNCA EXISTIÓ
  /**
   * ANULA UN ADELANTO PORQUE NO PASÓ: se digitó dos veces, o se le anotó al productor
   * equivocado. ESTE SÍ SE BORRA, y es la única acción de esta pantalla que lo hace.
   *
   * POR QUÉ HACE FALTA, con el caso medido. Al SACAR un adelanto, el comprobante v2 que
   * el productor tiene en la mano imprime "se le descuenta en la siguiente", y por eso la
   * pantalla de Anticipos lo traba: allá no quedaría ni motivo ni versión nueva. Pero eso
   * abría un callejón sin salida: si el adelanto nunca existió y el productor dejó de
   * entregar leche, no había NINGUNA pantalla donde borrarlo, y ese fantasma de $300.000
   * se le iba a descontar de plata que SÍ era suya.
   *
   * PIDE CONFIRMACIÓN, y la pregunta dice la diferencia entera. No es ceremonia: sacar y
   * anular quedan a un botón de distancia el uno del otro y se equivocan en las dos
   * direcciones —anular uno que sí se entregó le regala esa plata al productor; sacar uno
   * que nunca existió se la quita de una quincena que sí es suya—. Y a diferencia de
   * sacar, esto no lo deshace la quincena siguiente.
   *
   * Le quita de paso lo que se le haya hecho antes al mismo adelanto: el servidor rebota
   * anularlo y a la vez sacarlo o incluirlo —el resultado dependería del orden— y ese
   * rebote llegaría DESPUÉS de oprimir el botón, encima de una quincena pagada. Ese sobre
   * no se puede ni armar acá.
   */
  anularAnticipo(anticipo: AnticipoDeLaQuincena): void {
    if (this.guardando() || this.estaAnulado(anticipo.anticipo_id)) return;
    if (!confirm(this.preguntaAlAnular(anticipo))) return;
    if (this.editandoAnticipoId() === anticipo.anticipo_id) this.cancelarValor();

    const anulados = new Set(this.anticiposAnulados());
    anulados.add(anticipo.anticipo_id);
    this.anticiposAnulados.set(anulados);

    if (this.anticiposSacados().has(anticipo.anticipo_id)) {
      const sacados = new Set(this.anticiposSacados());
      sacados.delete(anticipo.anticipo_id);
      this.anticiposSacados.set(sacados);
    }
    if (this.anticiposIncluidos().has(anticipo.anticipo_id)) {
      const incluidos = new Set(this.anticiposIncluidos());
      incluidos.delete(anticipo.anticipo_id);
      this.anticiposIncluidos.set(incluidos);
    }
    if (this.valoresDeAnticipos().has(anticipo.anticipo_id)) {
      const valores = new Map(this.valoresDeAnticipos());
      valores.delete(anticipo.anticipo_id);
      this.valoresDeAnticipos.set(valores);
    }
    void this.refrescarPrevia();
  }

  /**
   * LA PREGUNTA QUE SE LE HACE ANTES DE ANULAR, con la cifra y con la diferencia dicha.
   *
   * Va aparte para poder leerla en una prueba: es el texto que evita el error caro, y un
   * texto que nadie mide se cambia sin darse cuenta.
   */
  preguntaAlAnular(anticipo: AnticipoDeLaQuincena): string {
    return (
      `¿Anular el adelanto de ${pesosExactos(anticipo.valor)}?\n\n` +
      'ANULAR no es lo mismo que SACAR. Sacar dice "no iba en esta quincena": esa plata ' +
      'sí se le entregó y se le descuenta en la siguiente. Anular dice "ese adelanto no ' +
      'existió": no se le descuenta en ninguna quincena.\n\n' +
      'Anúlelo solo si esa plata NUNCA se le entregó.'
    );
  }

  estaAnulado(anticipoId: string): boolean {
    return this.anticiposAnulados().has(anticipoId);
  }

  desanularAnticipo(anticipoId: string): void {
    if (!this.anticiposAnulados().has(anticipoId)) return;
    const siguiente = new Set(this.anticiposAnulados());
    siguiente.delete(anticipoId);
    this.anticiposAnulados.set(siguiente);
    void this.refrescarPrevia();
  }

  /**
   * LO QUE PASA AL ANULARLO, DICHO EN PLATA, y con la cuenta hecha cuando la hay.
   *
   * Hermana de `notaDelAnticipo`: no es una cifra del documento —el total, el neto y el
   * saldo salen todos del servidor— sino la cuenta que le explica al dueño qué acaba de
   * oprimir. Null cuando ese adelanto no se está anulando.
   *
   * SON DOS FRASES PORQUE SON DOS SITUACIONES DE PLATA:
   *
   *  · EL QUE HOY ESTÁ DESCONTADO AQUÍ: al anularlo deja de restarse, y por eso SUBE lo
   *    que hay que entregarle en esta quincena. Se dice con la cifra.
   *  · EL QUE ESTA QUINCENA YA HABÍA SACADO: esta cuenta no se mueve —ya había salido—;
   *    lo que cambia es que la quincena siguiente ya no se lo descuenta. Callarlo dejaría
   *    al dueño buscando en el cuadre un cambio que no está.
   */
  notaDeAnulado(anticipo: AnticipoDeLaQuincena): string | null {
    if (!this.estaAnulado(anticipo.anticipo_id)) return null;
    const base = 'Se anula: ese adelanto no existió y no se le descuenta en ninguna quincena';
    if (anticipo.aplicado) {
      return (
        `${base}. Hoy está descontado en esta quincena, así que por eso sube lo que hay ` +
        `que entregarle: se le entregan ${pesosExactos(anticipo.valor)} más`
      );
    }
    return (
      `${base}. Esta quincena ya lo había sacado, así que su cuenta no cambia: lo que ` +
      `cambia es que ya no se le descuentan esos ${pesosExactos(anticipo.valor)} en la ` +
      `quincena siguiente`
    );
  }

  tieneValorNuevo(anticipoId: string): boolean {
    return this.valoresDeAnticipos().has(anticipoId);
  }

  /** Lo que se va a mandar para ese adelanto: lo tecleado, o lo que ya tenía. */
  valorQueValdria(anticipo: AnticipoDeLaQuincena): Monto {
    return this.valoresDeAnticipos().get(anticipo.anticipo_id) ?? anticipo.valor;
  }

  editarValor(anticipo: AnticipoDeLaQuincena): void {
    if (this.guardando() || this.estaSacado(anticipo.anticipo_id)) return;
    // Corregirle la cifra a un adelanto que se está anulando no significaría nada: se va
    // a borrar. Y el sobre saldría con las dos cosas puestas sobre el mismo adelanto.
    if (this.estaAnulado(anticipo.anticipo_id)) return;
    this.cancelandoValor = false;
    this.textoValor.set(String(Number(this.valorQueValdria(anticipo))));
    this.editandoAnticipoId.set(anticipo.anticipo_id);
  }

  cancelarValor(): void {
    this.cancelandoValor = true;
    this.editandoAnticipoId.set(null);
  }

  alEscribirValor(valor: string): void {
    this.textoValor.set(valor);
  }

  /**
   * Al salir del campo se guarda lo tecleado, igual que con el precio de un día. Acá
   * tampoco se manda nada al servidor todavía: la corrección es un solo botón.
   */
  aplicarValor(anticipo: AnticipoDeLaQuincena): void {
    if (this.cancelandoValor) {
      this.cancelandoValor = false;
      return;
    }
    if (this.editandoAnticipoId() !== anticipo.anticipo_id) return;
    // `precioTecleado` lee la plata a la colombiana ("50.000" son cincuenta mil) y
    // devuelve null si no se entiende o si no es mayor que cero, que es justo lo que el
    // servidor exige de esta cifra.
    const valor = precioTecleado(this.textoValor());
    if (valor === null) {
      this.snackbar.open(
        'Escriba en pesos lo que se le adelantó, por ejemplo 50000',
        'OK',
        { duration: 4000 },
      );
      return; // el campo se queda abierto para corregir lo tecleado
    }
    this.editandoAnticipoId.set(null);
    // Volver a la cifra que ya tenía NO es una corrección: se quita de la lista para que
    // el comprobante no suba de versión por un adelanto que quedó igual.
    if (valor === Number(anticipo.valor)) {
      this.quitarValor(anticipo.anticipo_id);
      return;
    }
    if (valor === this.valoresDeAnticipos().get(anticipo.anticipo_id)) return;
    const siguiente = new Map(this.valoresDeAnticipos());
    siguiente.set(anticipo.anticipo_id, valor);
    this.valoresDeAnticipos.set(siguiente);
    void this.refrescarPrevia();
  }

  quitarValor(anticipoId: string): void {
    if (!this.valoresDeAnticipos().has(anticipoId)) return;
    const siguiente = new Map(this.valoresDeAnticipos());
    siguiente.delete(anticipoId);
    this.valoresDeAnticipos.set(siguiente);
    void this.refrescarPrevia();
  }

  /**
   * LO QUE ACABA DE HACERLE A ESE ADELANTO, dicho en plata y en la dirección que le
   * importa al dueño: cuánto más (o cuánto menos) hay que entregarle ahora.
   *
   * Es la hermana de `restaDelDia` y vale lo mismo: NO es una cifra del documento —el
   * total, el neto y el saldo salen todos del servidor—, es la cuenta que explica lo que
   * acaba de oprimir. Null cuando ese adelanto no se ha tocado.
   */
  notaDelAnticipo(anticipo: AnticipoDeLaQuincena): string | null {
    // Anular va de primero: es la única que borra, y su frase tiene que ganarle a
    // cualquier otra que hubiera quedado escrita sobre el mismo adelanto.
    const anulado = this.notaDeAnulado(anticipo);
    if (anulado !== null) return anulado;
    if (this.estaSacado(anticipo.anticipo_id)) {
      return (
        `Sale de esta quincena: se le entregan ${pesosExactos(anticipo.valor)} más ahora, ` +
        `y ese adelanto se le descuenta en la quincena siguiente. No se borra: esa plata ` +
        `ya se le entregó`
      );
    }
    const nuevo = this.valoresDeAnticipos().get(anticipo.anticipo_id);
    if (nuevo === undefined) return null;
    const viejo = Number(anticipo.valor);
    // A dos decimales, como la plata del backend (Numeric(14,2)): sin esto la cuenta de
    // la pantalla se desviaría del total del servidor por fracciones de centavo.
    const diferencia = Math.round((nuevo - viejo) * 100) / 100;
    const haciaDonde = diferencia > 0 ? 'menos' : 'más';
    return (
      `Estaba anotado por ${pesosExactos(viejo)} y se le adelantaron ` +
      `${pesosExactos(nuevo)}: se le entregan ${pesosExactos(Math.abs(diferencia))} ` +
      `${haciaDonde} en esta quincena`
    );
  }

  /** Lo mismo para un adelanto suelto: marcarlo baja lo que hay que entregarle. */
  notaDelAnticipoSuelto(anticipo: AnticipoDeLaQuincena): string | null {
    if (!this.estaIncluido(anticipo.anticipo_id)) return null;
    return (
      `Se le descuenta en esta quincena: se le entregan ` +
      `${pesosExactos(anticipo.valor)} menos`
    );
  }

  // ------------------------------------------------- el cuadre en vivo
  /**
   * LOS RENGLONES DE LA CUENTA, y las DOS columnas suman de arriba abajo.
   *
   * `valor_total − anticipos − lo que venía debiendo = neto`, y `neto − lo entregado` da
   * la cifra grande de abajo. La deuda vieja sale de la liquidación porque la corrección
   * NO LA TOCA —esa plata la arrastró OTRA quincena—, y el servidor arma el neto con esas
   * mismas dos columnas.
   *
   * LOS ADELANTOS SÍ SE MUEVEN, y por eso su renglón sale del AVANCE y no de la
   * liquidación: `anticipos_antes` y `anticipos_despues`. Hasta que se pudieron corregir,
   * este renglón pintaba la misma cifra en las dos columnas; ahora que marcar un adelanto
   * mueve la cifra grande, repetirla sería un desglose que no suma la columna de "ahora"
   * —la regla de la casa rota justo en el renglón que cambió—.
   *
   * Los renglones que valen cero y no aportan nada (anticipos, deuda vieja) no se pintan:
   * un renglón de "$ 0" en una columna que se suma a mano es ruido que hace perder el
   * hilo. El de "lo que ya se le entregó" SÍ se pinta siempre, aunque fuera cero, porque
   * es el que explica por qué la cifra grande no es el neto.
   */
  readonly renglonesDelCuadre = computed<RenglonDelCuadre[]>(() => {
    const p = this.previa();
    if (!p) return [];
    const l = this.liq();
    const filas: RenglonDelCuadre[] = [];
    const poner = (
      clave: string,
      etiqueta: string,
      antes: Monto,
      ahora: Monto,
      opciones: { resta?: boolean; destacado?: boolean } = {},
    ): void => {
      filas.push({
        clave,
        etiqueta,
        resta: opciones.resta ?? false,
        antes: pesosExactos(antes),
        ahora: pesosExactos(ahora),
        cambio: Number(antes) !== Number(ahora),
        destacado: opciones.destacado ?? false,
      });
    };

    poner('valor_total', 'VALOR TOTAL de la quincena', p.valor_total_antes, p.valor_total_despues, {
      destacado: true,
    });
    // El renglón se pinta si había adelantos O si van a quedar: uno que entra con la
    // corrección tiene que aparecer, y uno que sale tiene que verse bajar hasta cero.
    if (Number(p.anticipos_antes ?? 0) > 0 || Number(p.anticipos_despues ?? 0) > 0) {
      poner('anticipos', 'Anticipos aplicados', p.anticipos_antes, p.anticipos_despues, {
        resta: true,
      });
    }
    if (Number(l.saldo_anterior ?? 0) > 0) {
      poner('saldo_anterior', ROTULO_SALDO_ANTERIOR, l.saldo_anterior ?? 0, l.saldo_anterior ?? 0, {
        resta: true,
      });
    }
    poner('neto', 'Lo que hay que entregarle', p.neto_antes, p.neto_despues);
    poner('pagado', 'Lo que ya se le entregó', p.pagado, p.pagado, { resta: true });
    return filas;
  });

  /**
   * LA CIFRA GRANDE DE LA COLUMNA "ANTES", con su propio rótulo.
   *
   * Va aparte de la tabla y no como un renglón más porque el rótulo NO ES EL MISMO en las
   * dos columnas: una quincena que estaba saldada y termina con plata entregada de más
   * pasa de "queda por entregarle" a "se le pagó de más". Meterlas en un solo renglón
   * obligaría a escoger un rótulo para las dos, y uno de los dos estaría mintiendo.
   */
  readonly cierreAntes = computed<CierreDelCuadre>(() => {
    const saldo = Number(this.previa()?.saldo_antes ?? 0);
    return saldo < 0
      ? { rotulo: 'SE LE PAGÓ DE MÁS', cifra: pesosExactos(-saldo), alReves: true }
      : { rotulo: 'QUEDA POR ENTREGARLE', cifra: pesosExactos(saldo), alReves: false };
  });

  /**
   * LA CIFRA GRANDE DE VERDAD: cómo queda después de corregir.
   *
   * Sale de los dos campos separados que manda el servidor (`queda_por_entregar` y
   * `se_le_pago_de_mas`, los dos en positivo) y no de voltearle el signo al saldo: son
   * dos frases distintas y la pantalla no tiene que deducir cuál decir a partir de un
   * signo. Se cumple exacto: `neto_despues = pagado + saldo_despues`.
   */
  readonly cierreAhora = computed<CierreDelCuadre>(() => {
    const p = this.previa();
    if (!p) return { rotulo: 'QUEDA POR ENTREGARLE', cifra: pesosExactos(0), alReves: false };
    return Number(p.se_le_pago_de_mas ?? 0) > 0
      ? { rotulo: 'SE LE PAGÓ DE MÁS', cifra: pesosExactos(p.se_le_pago_de_mas), alReves: true }
      : {
          rotulo: 'QUEDA POR ENTREGARLE',
          cifra: pesosExactos(p.queda_por_entregar),
          alReves: false,
        };
  });

  // ------------------------------------------------- mandar la corrección
  /**
   * ¿HAY ALGO QUE CORREGIR? Un día marcado, un precio cambiado o un adelanto movido; el
   * motivo escrito no basta.
   *
   * Sin los adelantos en esta cuenta, el dueño que entra SOLO a sacar un adelanto se
   * queda con el botón apagado y sin saber por qué, encima de una quincena que sí se
   * puede corregir.
   */
  readonly hayAlgoQueCorregir = computed(
    () =>
      this.marcados().size > 0 ||
      this.preciosNuevos().size > 0 ||
      this.anticiposIncluidos().size > 0 ||
      this.anticiposSacados().size > 0 ||
      this.valoresDeAnticipos().size > 0 ||
      // Los anulados cuentan igual que todo lo demás. Sin esto, el dueño que entra SOLO
      // a anular un adelanto que nunca existió —que es justo para lo que se hizo esta
      // cuarta operación— se queda con el botón apagado y sin salida.
      this.anticiposAnulados().size > 0,
  );

  private hayCambios(): boolean {
    return this.hayAlgoQueCorregir() || this.form.controls.motivo.value.trim().length > 0;
  }

  readonly sePuedeCorregir = computed(
    () => !this.cargando() && !this.errorAlAbrir() && this.hayAlgoQueCorregir(),
  );

  /**
   * QUÉ LE FALTA PARA PODER OPRIMIR, dicho en vez de dejar el botón muerto sin explicar.
   *
   * Un botón apagado sin razón es lo que hace que el dueño llame a preguntar. Null cuando
   * ya se puede, o cuando el diálogo entero está trabado (ahí manda el candado de arriba,
   * que dice lo que el servidor respondió).
   */
  readonly motivoNoCorregirYa = computed<string | null>(() => {
    if (this.cargando() || this.errorAlAbrir()) return null;
    if (!this.hayAlgoQueCorregir()) {
      return 'Marque un día o corrija un precio, o mueva un adelanto, o anule uno que no existió';
    }
    return null;
  });

  /**
   * Vuelve a pedirle al servidor cómo quedaría la cuenta.
   *
   * `deEntrada` distingue la primera vez —donde un error significa "esta quincena no se
   * puede corregir" y hay que decirlo y no ofrecer nada— de las siguientes, donde el
   * error solo significa que las cifras que quedaron en pantalla son viejas.
   *
   * EL CONTADOR NO SOBRA: marcar tres días seguidos dispara tres avances, y sin él la
   * respuesta más lenta pinta un cuadre que ya no corresponde a las casillas marcadas.
   * Con plata de por medio, esa es la clase de defecto que solo se ve cuando ya se oprimió.
   */
  private avance = 0;

  private async refrescarPrevia(deEntrada = false): Promise<void> {
    const mio = ++this.avance;
    if (deEntrada) this.cargando.set(true);
    try {
      const previa = await firstValueFrom(
        this.servicio.previsualizarCorreccion(this.liq().id, this.payload()),
      );
      if (mio !== this.avance) return;
      this.previa.set(previa);
      this.errorAlPrevisualizar.set(null);
    } catch (err) {
      if (mio !== this.avance) return;
      const texto = detalleDeError(err, 'No fue posible calcular cómo quedaría la quincena');
      if (deEntrada) this.errorAlAbrir.set(texto);
      else this.errorAlPrevisualizar.set(texto);
    } finally {
      if (mio === this.avance && deEntrada) this.cargando.set(false);
    }
  }

  /**
   * El sobre que se manda, el mismo para el avance y para la corrección de verdad.
   *
   * El motivo va provisional mientras el dueño no haya escrito el suyo: el servidor exige
   * el campo para leer el sobre pero el avance no lo usa ni lo guarda. Ver
   * `MOTIVO_PROVISIONAL`.
   */
  private payload(): {
    motivo: string;
    recepciones_a_incluir: string[];
    precios: PrecioEnviado[];
    anticipos_a_incluir: string[];
    anticipos_a_soltar: string[];
    valores_de_anticipos: ValorDeUnAnticipo[];
    anticipos_a_borrar: string[];
  } {
    const motivo = this.form.controls.motivo.value.trim();
    return {
      motivo: motivo.length >= LARGO_MINIMO_DEL_MOTIVO ? motivo : MOTIVO_PROVISIONAL,
      recepciones_a_incluir: [...this.marcados()],
      precios: [...this.preciosNuevos()].map(([detalle_id, precio_litro]) => ({
        detalle_id,
        precio_litro,
      })),
      anticipos_a_incluir: [...this.anticiposIncluidos()],
      // `sacarAnticipo` ya le quita el valor corregido al que sale, así que estas dos
      // listas no se pueden cruzar: el servidor rebota esa mezcla y el rebote llegaría
      // después de oprimir el botón, encima de una quincena pagada.
      anticipos_a_soltar: [...this.anticiposSacados()],
      valores_de_anticipos: [...this.valoresDeAnticipos()].map(([anticipo_id, valor]) => ({
        anticipo_id,
        valor,
      })),
      // LOS QUE NUNCA EXISTIERON. Van SIEMPRE, también en el avance: el cuadre en vivo
      // sale de la previsualización como todo lo demás, y anular uno que hoy está
      // descontado aquí sube lo que hay que entregarle. Acá no se calcula ni un peso.
      //
      // `anularAnticipo` ya le quita al anulado lo que se le hubiera hecho antes, así que
      // esta lista no se cruza con las otras tres: el servidor rebota esa mezcla y el
      // rebote llegaría después de oprimir el botón, encima de una quincena pagada.
      anticipos_a_borrar: [...this.anticiposAnulados()],
    };
  }

  async corregir(): Promise<void> {
    if (!this.sePuedeCorregir() || this.guardando()) return;
    if (this.form.invalid) {
      this.form.controls.motivo.markAsTouched();
      this.snackbar.open(
        'Escriba por qué se corrige esta quincena: queda en el comprobante nuevo',
        'OK',
        { duration: 5000 },
      );
      return;
    }
    this.guardando.set(true);
    try {
      const corregida = await firstValueFrom(
        this.servicio.corregir(this.liq().id, this.payload()),
      );
      // Se devuelve la liquidación que respondió el servidor: quien abrió el diálogo
      // pinta ESA y no una versión calculada a mano, que podría diferir.
      this.dialogRef.close(corregida);
    } catch (err) {
      // Cuando no se sabe si la corrección entró (tiempo agotado, 5xx, señal caída) el
      // aviso dura mucho más y hay que cerrarlo a mano: es el mensaje que evita que el
      // dueño la mande dos veces y le suba dos versiones al comprobante.
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible corregir la quincena');
    } finally {
      this.guardando.set(false);
    }
  }
}

/** El precio de un día, tal como viaja en el sobre. Ver `PrecioDeUnDia` del servicio. */
interface PrecioEnviado {
  detalle_id: string;
  precio_litro: number;
}
