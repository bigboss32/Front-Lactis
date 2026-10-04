import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, firstValueFrom } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import {
  DeudaCobrada,
  Liquidacion,
  LiquidacionDetalle,
  Monto,
  PagoLiquidacion,
} from '../../core/models';
import { compartirArchivo, compartirWhatsApp } from '../../shared/compartir';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { fechaEnHoraDeColombia } from '../../shared/date-utils';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { EstadoChip } from '../../shared/estado-chip';
import { CantidadPipe, MoneyPipe, pesosExactos } from '../../shared/pipes';
import { SoportesDialog } from '../../shared/soportes.dialog';
import { SoportesResultado } from '../../shared/soportes.model';
import { SpinnerBoton } from '../../shared/spinner-boton';
import {
  MENOS,
  ROTULO_DEUDA_BORRADA,
  ROTULO_SALDO_ANTERIOR,
  causaDeLaDeuda,
  conAbonos,
  deudaBorradaPorReparar,
  laDeudaViejaSeLlevoElNeto,
  porQueSeLePagoDeMas,
  precioTecleado,
} from './cifras-de-la-quincena';
import {
  RenglonDeCorreccion,
  renglonesDeCorrecciones,
} from './correcciones-en-palabras';
import { CorregirQuincenaDialog } from './corregir-quincena.dialog';
import { PAGADA_QUEDO_DEBIENDO, estadoComoSeLee } from './estado-como-se-lee';
import { LiquidacionEstadoStepper } from './liquidacion-estado-stepper';
import { comoFecha, periodoDe } from './periodo-liquidacion';
import {
  ROTULO_DIA_FIJO_YA_COBRADO,
  notasDelDiaFijo,
  precioDelRenglon,
  renglonDeDiaFijo,
} from './renglon-transporte';
import { Correccion, LiquidacionesService } from './liquidaciones.service';
import { PagoLiquidacionFormDialog } from './pago-form.dialog';

/**
 * Los estados en los que EL SERVIDOR acepta recalcular.
 *
 * Hoy solo el borrador: `LiquidacionService.recalcular` rebota cualquier otro, y la
 * pantalla no puede ofrecer un botón que el servidor va a negar (es la misma regla
 * del candado de Recepción diaria, donde el aviso lo escribe el backend).
 *
 * Está aparte y con nombre porque es LA FRONTERA con el backend, no un gusto de la
 * pantalla. El día en que el servidor acepte recalcular una APROBADA —devolviéndola
 * a borrador, que es lo que ya hace `recuadrar` cuando se corrige una recepción de
 * una aprobada— basta agregar 'aprobada' a esta lista: el botón aparece, la ayuda
 * avisa que vuelve a borrador y la confirmación de `confirmarVolverABorrador` se
 * encarga de preguntar ANTES de oprimir. Todo eso ya está escrito y probado.
 */
const ESTADOS_QUE_ACEPTAN_RECALCULO: readonly string[] = ['borrador'];

/**
 * UNA FRASE DEL SERVIDOR, LISTA PARA IR EN UN PÁRRAFO: sin espacios de sobra y con su punto.
 *
 * Los textos del backend salen como los de sus 422, sin punto final ("…se llevó el neto"),
 * y acá van seguidos de otra oración o como la línea de ayuda, que siempre lo lleva. Las
 * palabras no se tocan. Null si no vino nada que decir.
 */
function comoFrase(texto: string | null | undefined): string | null {
  const limpio = texto?.trim();
  if (!limpio) return null;
  return /[.!?]$/.test(limpio) ? limpio : `${limpio}.`;
}

/**
 * El rótulo del renglón de la deuda vieja BAJÓ a `cifras-de-la-quincena.ts` cuando el
 * diálogo de corregir una quincena pagada necesitó el mismo texto para su cuadre: este
 * archivo abre a ese diálogo, así que importarlo de vuelta desde allá los habría dejado
 * importándose en círculo. Se re-exporta para no tocar a quien ya lo pedía de acá.
 */
export { ROTULO_SALDO_ANTERIOR };

/**
 * UN RENGLÓN DEL RESUMEN, ya formateado como se lee en pantalla.
 *
 * El resumen se arma acá y no en la plantilla por una razón concreta: TIENE QUE SUMAR
 * DE ARRIBA ABAJO y los renglones no son los mismos en las dos clases de comprobante
 * (en la del transportador el valor bruto y los descuentos son cero, y en la del
 * proveedor el flete NO se le descuenta a él). Con los renglones escritos a mano en la
 * plantilla, la columna incluía cifras que no entran en la cuenta y el dueño sumaba y
 * no le cuadraba. Armándolo en una lista, el orden y los signos son UNA sola cosa que
 * la plantilla solo pinta, y una prueba puede recorrerla y comprobar la resta.
 */
export interface RenglonResumen {
  /** Cuál cifra es. La plantilla y las pruebas señalan el renglón por acá. */
  clave: string;
  etiqueta: string;
  /** La cifra formateada CON su signo cuando lo lleva: "− $ 49.462,09". */
  texto: string;
  signo: '' | '+' | '−';
  /** Entra en la columna que suma de arriba abajo (los litros y el promedio no). */
  cuenta: boolean;
  destacado: boolean;
  /** La plata va al revés: la debe el tercero, no la quesera. */
  alReves: boolean;
}

/** Un renglón del resumen que el recálculo movió, ya formateado como se lee. */
export interface CambioDeCifra {
  /** El MISMO rótulo del resumen de abajo, para poder cruzar las dos sin traducir. */
  etiqueta: string;
  antes: string;
  despues: string;
}

/** Lo que movió el último recálculo, listo para mostrar. */
export interface CambioDelRecalculo {
  /** La frase de arriba: "El flete pasó de $ 19.906,32 a $ 24.600". */
  titulo: string;
  filas: CambioDeCifra[];
  /** Lo que además hay que hacer (volver a aprobarla). Null si no hay nada. */
  aviso: string | null;
}

/**
 * Una cifra del resumen que se compara antes y después de recalcular.
 *
 * `etiqueta` es el rótulo del resumen y `frase` la forma de decirlo en una
 * oración: el aviso de arriba dice "El flete pasó de … a …", que es como lo dice
 * el dueño, y la tabla dice "Valor transporte", que es como lo dice la pantalla.
 */
interface RenglonComparable {
  etiqueta: string;
  frase: string;
  leer: (liq: Liquidacion) => Monto;
  /** Litros en vez de pesos: se formatea con la unidad y dos decimales. */
  litros?: boolean;
}

@Component({
  selector: 'app-liquidacion-detail',
  imports: [
    DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule,
    MatTableModule, MatTooltipModule, EstadoChip, MoneyPipe, CantidadPipe, HasPermissionDirective,
    LiquidacionEstadoStepper, SpinnerBoton,
  ],
  templateUrl: './liquidacion-detail.dialog.html',
  styles: `
    .info {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 32px;
      margin-bottom: 8px;
    }
    .etiqueta {
      display: block;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }
    h3 {
      margin: 16px 0 8px;
      font-size: 1rem;
      font-weight: 500;
    }
    table { width: 100%; }
    .num { text-align: right; }
    /*
      LA BANDA DEL COMPROBANTE CORREGIDO. Pegada arriba (sticky) a propósito: este
      comprobante tiene un gemelo con otra cifra en la mano del productor, y esa
      advertencia no se puede ir con el scroll mientras se lee el desglose.

      Va con los colores de "tertiary" del tema —que ya vienen resueltos con
      light-dark(), así que el modo oscuro sale solo— y no con los de error: no hay nada
      malo con este documento, es el bueno; el rojo está reservado para lo que hay que
      arreglar y gastarlo acá le quitaría fuerza donde sí importa.
    */
    .banda-corregida {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px 12px;
      margin-bottom: 8px;
      border-radius: 8px;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }
    .banda-motivo { margin: 2px 0 0; font-size: 0.8rem; }
    /*
      LA QUINCENA CON LA DEUDA BORRADA POR LA MIGRACIÓN. En los colores de error del tema
      —que traen su modo oscuro— porque este sí es el caso para el que está guardado el
      rojo: hay algo que arreglar antes de tocarla, y su saldo no es lo que de verdad queda.
    */
    .aviso-deuda-borrada {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      max-width: 620px;
      padding: 10px 12px;
      margin: 0 0 12px;
      border-radius: 8px;
      font-size: 0.85rem;
      line-height: 1.45;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .aviso-deuda-borrada mat-icon { flex: none; }
    /*
     * EL ENLACE QUE ABRE EL HISTORIAL, dentro de la misma banda.
     *
     * Se ve como un enlace y no como un botón de Material a propósito: la banda tiene
     * que seguir leyéndose como una advertencia de tres líneas, y un botón con relieve
     * ahí adentro compite con el "Corregido el …" que es lo que hay que leer primero.
     * Lleva subrayado —no solo color— porque en la banda todo el texto ya va con el
     * color del contenedor, y sin el subrayado no se ve que se puede tocar.
     */
    .ver-historial {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 4px;
      padding: 2px 0;
      font: inherit;
      font-size: 0.8rem;
      font-weight: 600;
      color: inherit;
      background: none;
      border: none;
      text-decoration: underline;
      cursor: pointer;
    }
    .ver-historial mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    /*
     * EL HISTORIAL COMPLETO. Va DEBAJO de la banda y dentro del flujo de la pantalla
     * (no es sticky): la advertencia se queda arriba, y esta lista se lee y se desplaza
     * contra el resumen de más abajo, que es con el que se cuadran sus cifras.
     */
    .historial {
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--mat-sys-tertiary) 10%, transparent);
    }
    .historial-titulo {
      margin: 0 0 8px;
      font-size: 0.8125rem;
      color: var(--mat-sys-on-surface-variant);
    }
    /* Una corrección por bloque, separadas por una línea: el dueño empareja UNA hoja
       con UN renglón, y sin la separación los renglones se leen corridos. */
    .correccion {
      padding: 8px 0;
      border-top: 1px solid color-mix(in srgb, var(--mat-sys-on-surface) 12%, transparent);
    }
    .correccion:first-of-type { border-top: none; }
    .correccion-cuando {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 8px;
      font-size: 0.8125rem;
    }
    /* La versión es el número que aparece en el folio del papel ("A3F2B1C9-v2"): se
       marca para que el ojo la encuentre sin leer el renglón entero. */
    .correccion-version {
      padding: 1px 8px;
      border-radius: 999px;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
      font-weight: 600;
      white-space: nowrap;
    }
    .correccion-quien { color: var(--mat-sys-on-surface-variant); }
    /* Qué cambió, una frase por renglón: son hechos distintos (un día, un precio, un
       adelanto) y en un párrafo corrido se leen como uno solo. */
    .correccion-cambios {
      margin: 6px 0 0;
      padding-left: 20px;
      font-size: 0.8125rem;
      line-height: 1.45;
    }
    /* Las cifras, antes y ahora: el mismo "rótulo … cifra → cifra" del aviso del
       recálculo, porque es la misma pregunta y el dueño ya sabe leerla. */
    .correccion-cifras { margin-top: 6px; font-size: 0.8125rem; }
    .correccion-cifra {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 2px 8px;
    }
    /*
     * Las dos puntas y la flecha van en un solo bloque que NO se parte: en un celular,
     * "$ 500.000 →" arriba y "$ 680.000" abajo se lee como dos cifras sueltas. Lo que sí
     * puede bajar de línea es el rótulo largo ("Lo que hay que entregarle").
     */
    .correccion-movida {
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      white-space: nowrap;
    }
    .correccion-cifras .num {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .correccion-cifras .flecha { color: var(--mat-sys-on-surface-variant); }
    .correccion-motivo {
      margin: 6px 0 0;
      font-size: 0.8125rem;
      line-height: 1.4;
    }
    /* Las notas del renglón —"las cifras no se movieron", "no quedó anotado cuánto
       sumaban los adelantos"— en el tono discreto de las demás aclaraciones: explican
       una ausencia, no avisan de un problema. */
    .correccion-nota {
      margin: 6px 0 0;
      font-size: 0.78rem;
      line-height: 1.35;
      color: var(--mat-sys-on-surface-variant);
    }
    /*
     * EL CLIP DE LOS SOPORTES, con el número encima. Es el mismo dibujo que en la
     * lista de reventa —donde el dueño ya lo conoce— y no otro: el clip con la
     * burbujita significa "acá hay fotos anexas" en las dos pantallas.
     *
     * La columna se queda angosta para no robarle espacio a Observaciones, que es
     * la que dice de qué fue el pago.
     */
    .col-soportes { width: 72px; text-align: center; }
    /*
     * En celular la tabla de pagos se desplaza a lo ancho en vez de apretarse. Los
     * 520px de mínimo son lo que necesitan sus seis columnas para que la fecha no se
     * parta y el clip no quede pegado al borde; por encima de ese ancho manda el
     * "width: 100%" de la tabla y no se ve ninguna barra.
     */
    .tabla-pagos { overflow-x: auto; }
    .tabla-pagos table { min-width: 520px; }
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
    /* El candado que queda en el lugar de la papelera cuando el pago no se puede borrar:
       del mismo ancho que el botón, para que la fila no cambie de forma, y en el tono
       discreto de las notas porque no hay nada que arreglar en ese pago. */
    .candado-pago {
      vertical-align: middle;
      margin: 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .sin-datos {
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
      margin: 8px 0;
    }
    /*
     * "Día completo" / "Ya cobrado" en la columna Precio/L.
     *
     * NO va con tabular-nums ni alineado como una cifra: es una palabra, y lo que tiene
     * que quedar claro de un vistazo es que ese renglón NO se multiplica. Se marca con
     * el fondo tenue de la marca —igual que la tarifa fija en la lista de
     * transportadores, para que sea el mismo idioma en las dos pantallas— y sin rojo:
     * no hay nada malo en un día fijo.
     */
    .dia-completo {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent);
      font-size: 0.8rem;
      font-weight: 500;
      white-space: nowrap;
    }
    /*
     * La nota que explica esos renglones: las mismas palabras del PDF. En el tono
     * discreto de las demás notas del diálogo —no es una alarma, es la instrucción de
     * cómo se lee la línea de arriba— y con el ancho de la columna de texto para que
     * no se lea como parte de la tabla.
     */
    .nota-dia-fijo {
      max-width: 620px;
      margin: 8px 0 0;
      font-size: 0.8125rem;
      line-height: 1.35;
      color: var(--mat-sys-on-surface-variant);
    }

    /* "(borrada)" al lado del nombre de la ruta: se tiene que ver, pero no puede
       competir con las cifras del renglón. */
    .borrada {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
    .resumen {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 32px;
      max-width: 420px;
    }
    /* Las cifras NO se parten nunca: "− $ 120.000" cortado entre el signo y la plata se
       lee como dos cosas distintas. El rótulo sí puede envolver —"Lo que quedó debiendo
       de la quincena pasada" no cabe en una línea en un celular— y para eso está el
       1fr de la primera columna. */
    .resumen .num { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .resumen .destacado { font-weight: 600; }
    /* En celular el diálogo va a lo ancho de la pantalla: 32px entre el rótulo y la
       cifra le roban el espacio al rótulo largo y lo parten en cuatro líneas. */
    @media (max-width: 560px) {
      .resumen {
        gap: 4px 12px;
        max-width: none;
      }
    }
    /* El renglón "Le queda debiendo": la plata va al revés de lo normal (la debe el
       tercero, no la quesera), así que se marca en el color de error del tema. No es
       una alarma de sistema; es que el dueño no puede confundirlo con algo por pagar. */
    .resumen .al-reves { color: var(--mat-sys-error); }
    /*
     * La frase que explica el saldo negativo, debajo del resumen y no dentro: el
     * resumen es una rejilla de rótulo + cifra, y una explicación de dos líneas no es
     * ninguna de las dos. Mismo tratamiento que la nota del estado de cuenta cuando al
     * cliente se le cobró de más.
     */
    .nota-le-debe {
      max-width: 420px;
      margin: 10px 0 0;
      font-size: 0.8125rem;
      line-height: 1.35;
      color: var(--mat-sys-error);
    }
    /*
     * DE DÓNDE VINO EL DESCUENTO DE LA QUINCENA PASADA, y —con el mismo aire— por qué el
     * saldo quedó en cero.
     *
     * En el color normal del texto y NO en el rojo de .nota-le-debe: acá no hay nada
     * mal ni nadie debiendo, es la explicación de un renglón que sí se cobró. Pintarla
     * de rojo la haría leer como una alarma sobre un descuento correcto.
     */
    .nota-saldo-anterior,
    .nota-saldo-cero {
      max-width: 420px;
      margin: 10px 0 0;
      font-size: 0.8125rem;
      line-height: 1.35;
      color: var(--mat-sys-on-surface-variant);
    }
    /* Las quincenas que dejaron la deuda, cuando fueron varias: sus cifras suman el
       renglón del resumen y el dueño las cuadra a mano, así que van una por línea. */
    .origenes-deuda {
      max-width: 420px;
      margin: 4px 0 0;
      padding-left: 20px;
      font-size: 0.8125rem;
      line-height: 1.5;
      color: var(--mat-sys-on-surface-variant);
    }
    /* El flete de la leche del proveedor: un dato, no un descuento suyo. Mismo tono
       discreto que la nota de arriba, porque tampoco es una alerta. */
    .nota-flete {
      max-width: 420px;
      margin: 10px 0 0;
      font-size: 0.8125rem;
      line-height: 1.35;
      color: var(--mat-sys-on-surface-variant);
    }

    .ayuda-precio {
      margin: 6px 0 0;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }

    /* ---------------------------------------- precio por litro editable */
    /*
     * El botón se ve como texto normal: la fila no debe parecer un formulario.
     * La pista de que se puede tocar aparece al pasar el mouse o al enfocar, que
     * es cuando el usuario ya está preguntándose si se puede.
     */
    .precio-editable {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      margin: -2px -6px;
      font: inherit;
      color: inherit;
      background: transparent;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-variant-numeric: tabular-nums;
    }
    .precio-editable:hover,
    .precio-editable:focus-visible {
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
    }
    .precio-editable .lapiz {
      font-size: 16px;
      width: 16px;
      height: 16px;
      opacity: 0;
      color: var(--mat-sys-primary);
      transition: opacity 120ms ease;
    }
    .precio-editable:hover .lapiz,
    .precio-editable:focus-visible .lapiz { opacity: 1; }
    /* En pantalla táctil no hay hover: si el lápiz nunca se ve, nadie descubre
       que la cifra se puede corregir. */
    @media (hover: none) {
      .precio-editable .lapiz { opacity: 0.6; }
    }

    .precio-edicion {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      justify-content: flex-end;
    }
    .precio-edicion input {
      width: 96px;
      padding: 4px 6px;
      font: inherit;
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--mat-sys-on-surface);
      background: var(--mat-sys-surface);
      border: 1px solid var(--mat-sys-primary);
      border-radius: 4px;
    }
    .precio-edicion input:disabled { opacity: 0.7; }

    /* ------------------------------------------ lo que movió el recálculo */
    /*
     * Se queda en pantalla hasta que el usuario lo cierre, y arriba del desglose
     * nuevo: el dueño cuadra estas cifras a mano y un aviso de tres segundos no
     * le alcanza para anotar de cuánto a cuánto se movió el flete.
     */
    .cambio-recalculo {
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      color: var(--mat-sys-primary);
      font-size: 0.85rem;
    }
    .cambio-titulo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
      line-height: 1.4;
    }
    .cambio-titulo mat-icon {
      flex: none;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .cambio-titulo button {
      flex: none;
      margin-left: auto;
    }
    .cambio-cifras {
      display: grid;
      grid-template-columns: 1fr auto auto auto;
      gap: 2px 10px;
      margin: 8px 0 0;
      font-variant-numeric: tabular-nums;
    }
    /* display: contents deja cada renglón como UN elemento del DOM —así se lee
       entero, en pantalla y en las pruebas— sin romper la alineación de la
       grilla, que es la que pone las dos columnas de cifras a la derecha. */
    .cambio-fila { display: contents; }
    .cambio-encabezado {
      font-size: 0.7rem;
      opacity: 0.75;
    }
    .cambio-cifras .flecha { opacity: 0.7; }
    .cambio-aviso {
      margin: 8px 0 0;
      font-weight: 500;
    }

    /* El candado de "ya salió plata", con el mismo aire que el aviso del candado
       de Recepción diaria: es un texto largo y se tiene que leer de un tirón. */
    .ayuda-precio.con-candado {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      line-height: 1.45;
    }
    .ayuda-precio.con-candado mat-icon {
      flex: none;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    /* Se dice POR QUÉ no se puede recalcular en vez de que el botón desaparezca
       sin explicación, igual que el "No se puede eliminar" del día ya pagado. */
    .nota-recalcular {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      opacity: 0.75;
    }
    .nota-recalcular mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
  `,
})
export class LiquidacionDetailDialog {
  private readonly servicio = inject(LiquidacionesService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly auth = inject(AuthService);

  readonly data = inject<{ item: Liquidacion }>(MAT_DIALOG_DATA);

  readonly liq = signal<Liquidacion>(this.data.item);
  /** SOLO para el chip y la línea de estados: los botones siguen leyendo `liq().estado`. */
  readonly estadoComoSeLee = estadoComoSeLee;
  readonly procesando = signal(false);
  readonly descargando = signal(false);
  readonly compartiendo = signal(false);

  /** Día cuyo precio se está editando (su id), o null si no hay ninguno. */
  readonly editandoId = signal<string | null>(null);
  /** Día cuyo precio se está guardando: mientras tanto el campo queda quieto. */
  readonly guardandoId = signal<string | null>(null);
  /** Lo tecleado en el campo abierto, tal cual, sin interpretar todavía. */
  readonly textoPrecio = signal('');

  readonly tercero = computed(
    () => this.liq().proveedor_nombre ?? this.liq().transportador_nombre ?? '—',
  );

  /**
   * El precio solo se corrige en BORRADOR y solo en liquidaciones de proveedor.
   *
   * Aprobada o pagada quiere decir que ese precio ya se le pagó a alguien, y en
   * la del transportador la cifra de esa columna es la tarifa del flete del día
   * —otra cosa—. El backend rechaza los dos casos igual: esto es para que el
   * campo ni siquiera se ofrezca.
   *
   * Ni en el borrador cuya deuda ya se cobró en otra quincena: en el borrador de leche,
   * `actualizar_precio_detalle` rebota eso (`_razon_para_no_cambiar_el_precio`: estado,
   * tipo y después la deuda), con cualquier precio. Medido: Henri, 100 L × $1.800 contra $300.000 de adelanto, debe $120.000 y la
   * quincena siguiente ya se los cobró; el lápiz salía, "Toque el precio…" invitaba a
   * corregirlo y el PUT daba 422 siempre. Es la misma pregunta de `puedeRecalcular`, y el
   * candado de Recalcular es el que dice por qué y qué hacer.
   */
  readonly puedeEditarPrecio = computed(
    () =>
      this.liq().estado === 'borrador' &&
      this.liq().tipo === 'proveedor' &&
      !this.deudaYaCobrada() &&
      this.auth.hasPermission('liquidaciones', 'editar'),
  );

  /**
   * La columna "Ruta" solo aparece cuando los renglones de verdad traen ruta.
   *
   * En el comprobante del transportador los renglones son por DÍA Y RUTA: si hizo
   * Nápoles y Mira Valle el mismo martes, ese martes trae DOS renglones a tarifas
   * distintas (cada uno cuadra litros × precio = valor, que es lo que el dueño
   * revisa a mano). Sin esta columna se verían dos veces el mismo día sin
   * explicación y parecería un renglón repetido.
   *
   * Se agrega según los datos y no según el tipo: el comprobante del proveedor no
   * trae ruta, y uno viejo del transportador —generado antes de este cambio—
   * tampoco, así que en esos la columna no estorba.
   */
  readonly columnasDetalle = computed(() =>
    this.hayRutas()
      ? ['fecha', 'ruta', 'litros', 'precio_litro', 'valor']
      : ['fecha', 'litros', 'precio_litro', 'valor'],
  );
  /**
   * 'soportes' va ANTES de 'acciones' a propósito: la papelera es lo último de la
   * fila en todas las tablas del sistema, y meterle algo después la movería de
   * sitio justo en la columna donde un clic de más borra un pago.
   */
  readonly columnasPagos = [
    'fecha', 'valor', 'destinatario', 'observaciones', 'soportes', 'acciones',
  ];

  private readonly hayRutas = computed(() =>
    this.liq().detalles.some((detalle) => !!detalle.ruta_id || !!detalle.ruta_nombre),
  );

  /**
   * ¿ESTE RENGLÓN SE COBRÓ POR DÍA COMPLETO? Lo dice el renglón, no las cifras.
   *
   * Adivinarlo ("litros × precio no da el valor") es lo que hace imprimir un comprobante
   * que no cuadra: eso también le pasa a una fila corregida a mano en la base, y las dos
   * hay que mostrarlas al revés.
   */
  esDiaCompleto(detalle: LiquidacionDetalle): boolean {
    return renglonDeDiaFijo(detalle);
  }

  /** Lo que va en la columna Precio/L: la tarifa, o la palabra del día fijo. */
  precioDelDia(detalle: LiquidacionDetalle): string {
    return precioDelRenglon(detalle);
  }

  /**
   * La explicación de esa palabra, al pasar por encima.
   *
   * Se decide POR LA PALABRA QUE SE ESTÁ MOSTRANDO y no volviendo a mirar las cifras:
   * dos cuentas para lo mismo terminan diciendo cosas distintas, y acá la de abajo
   * afirmaría "ya se cobró" sobre un renglón que dice "Día completo".
   */
  explicacionDelDia(detalle: LiquidacionDetalle): string {
    return this.precioDelDia(detalle) === ROTULO_DIA_FIJO_YA_COBRADO
      ? 'Ese día completo ya se le pagó en otro comprobante: esta leche se anotó ' +
          'después y recogerla no costó más'
      : 'Ese día completo vale lo que dice la columna Valor, así haya recogido de uno ' +
          'o de cinco proveedores';
  }

  /**
   * LA LETRA CHICA DE LOS DÍAS FIJOS, con las MISMAS palabras del PDF. Vacía casi siempre.
   *
   * Sale de los renglones que se están mostrando y no de la bandera `tiene_dias_fijos`
   * del comprobante: esta nota explica UNAS LÍNEAS que están en pantalla, y una nota sin
   * las líneas que explica es peor que ninguna. La bandera dice otra cosa —que el
   * promedio por litro del encabezado no se puede afirmar— y esta pantalla no imprime
   * ese promedio en la del transportador, igual que su PDF.
   */
  readonly notasDiaFijo = computed(() => notasDelDiaFijo(this.liq().detalles));

  /** Si hay pagos en la lista: manda el historial, no el estado. */
  readonly tienePagos = computed(() => this.liq().pagos.length > 0);

  /**
   * ¿SALIÓ PLATA POR PAGOS? La pregunta de cada texto que dice "abono" u "otro pago". No es
   * lo mismo que `tienePagos`: la 'pagada' de antes de los pagos parciales tiene la plata
   * en `pagado` y la lista vacía. Ver `conAbonos` en cifras-de-la-quincena.
   */
  readonly conAbonos = computed(() => conAbonos(this.liq()));

  /**
   * EL SALDO QUEDÓ POR DEBAJO DE CERO: el tercero le quedó debiendo AL NEGOCIO.
   *
   * Pasa cuando los anticipos que ya se le entregaron suman más que lo que produjo la
   * quincena, y pasa de verdad: $180.000 de leche contra $300.000 de anticipo, o una
   * tarifa de flete que se corrige hacia abajo después de haberle adelantado la
   * gasolina.
   *
   * La cifra la manda el backend en positivo (`le_queda_debiendo`) y no se recalcula
   * acá: es la MISMA que imprime el comprobante en PDF bajo el rótulo "LE QUEDA
   * DEBIENDO", y dos restas para el mismo hecho terminan mostrando cifras distintas.
   * Se compara con `Number` porque los montos llegan como texto (Decimal del backend).
   */
  readonly leQuedaDebiendo = computed(() => Number(this.liq().le_queda_debiendo ?? 0) > 0);

  /**
   * LO QUE SE LE COBRA EN ESTA QUINCENA DE LO QUE QUEDÓ DEBIENDO EN LAS PASADAS.
   *
   * Cero (y el renglón no sale) en la inmensa mayoría de los comprobantes: quedar
   * debiendo es la excepción. Mientras el backend no mande el campo llega en
   * `undefined` y esto da cero, así que la pantalla se ve igual que hoy.
   */
  readonly saldoAnterior = computed(() => Number(this.liq().saldo_anterior ?? 0));
  readonly cobraSaldoAnterior = computed(() => this.saldoAnterior() > 0);

  /**
   * LA DEUDA QUE BORRÓ LA MIGRACIÓN DE LOS ABONOS, en positivo (cero en casi todas).
   *
   * Es el campo del backend (Σ pagos − pagado) y no una cuenta hecha acá. Una respuesta
   * vieja no lo trae: ahí da cero y todo se ve como antes.
   */
  readonly deudaBorrada = computed(() => Number(this.liq().deuda_borrada_por_la_migracion ?? 0));

  /**
   * ¿HAY QUE REPARARLA? La misma pregunta del `por_reparar` del backend: deuda borrada
   * y NO anulada. Mientras sea sí, el servidor rebota Corregir, Pagar, los abonos, Anular
   * y mover sus anticipos (`_exigir_sin_deuda_borrada`), y esta pantalla no los ofrece.
   * Tampoco ofrece mandársela al tercero (WhatsApp y Compartir PDF): le llegaría el
   * renglón «+ Deuda borrada» suelto, que se lee como un abono. Sobre una anulada no hay nada que reparar ni que ofrecer: no lleva aviso ni marca.
   */
  readonly tieneDeudaBorrada = computed(() => deudaBorradaPorReparar(this.liq()));

  /**
   * LO QUE SUMA LA TABLA DE PAGOS, en centavos enteros y de vuelta a pesos: "0,1 + 0,2"
   * en coma flotante no da 0,3, y el renglón "Pagado" tiene que ser EXACTO lo de la tabla.
   */
  private readonly entregadoEnPagos = computed(
    () =>
      this.liq().pagos.reduce((total, pago) => total + Math.round(Number(pago.valor) * 100), 0) /
      100,
  );

  /**
   * LO QUE DE VERDAD FALTA POR ENTREGARLE con la deuda borrada, EN CENTAVOS: saldo − borrada
   * (el backend lo dice así en `deuda_borrada_por_la_migracion`). Negativo = es el tercero
   * el que debe. En centavos para que la resta de dos Decimal no deje un 0,000001.
   */
  private readonly faltaPorEntregar = computed(
    () =>
      Math.round(Number(this.liq().saldo ?? 0) * 100) - Math.round(this.deudaBorrada() * 100),
  );

  /**
   * EL AVISO DE ARRIBA para esa quincena, con la cifra. Null en todas las demás.
   *
   * El resumen ya cuadra —la deuda borrada lleva su renglón—, así que el aviso no dice
   * que no cuadre: nombra ese renglón y dice lo que DE VERDAD queda, que no es el saldo.
   * Lo que falta entregar es saldo − borrada (ver `Liquidacion.deuda_borrada_por_la_migracion`
   * en el backend); si da negativo, es el tercero el que debe. Medido: la de $180.000
   * contra $300.000 de adelanto dice "Saldo a pagar $ 0" y Henri debe $120.000; la que se
   * corrigió con $200.000 más sin pagarse dice "$ 200.000" y lo que falta son $80.000.
   */
  readonly avisoDeLaDeudaBorrada = computed<string | null>(() => {
    if (!this.tieneDeudaBorrada()) return null;
    const reparar =
      'Hay que repararla antes de cualquier otra cosa: mientras tanto no se puede corregir, ' +
      'pagar, abonar ni anular.';
    // LA POSICIÓN DE HOY LA ESCRIBE EL SERVIDOR (`aviso_deuda_borrada`), con la misma
    // función que arma el 422 de Pagar o Corregir esta fila y la nota del PDF: si la
    // pantalla hiciera la cuenta por su lado, el aviso rojo y el papel podrían decir dos
    // cifras distintas para lo que Henri debe. Se pinta tal cual.
    //
    // Y CON ELLA, EL MARCO DE ACÁ NO REPITE NI LA CIFRA BORRADA NI EL NOMBRE. La frase del
    // servidor ya dice lo que hace falta para la calculadora, con su formato y su "el
    // tercero": medido con la corregida a $380.000 (saldo $200.000), el aviso decía "le
    // borró los $ 120.000 que Henri Castaño quedaba debiendo" y enseguida "los otros
    // $120.000 son la deuda que borró la migración" —la misma plata dos veces, con dos
    // formatos y dos nombres—, y en la de saldo $120.000 la cifra salía tres veces. El
    // marco nombra solo el renglón del resumen, donde está la cifra, y lo que falta hacer.
    const delServidor = comoFrase(this.liq().aviso_deuda_borrada);
    if (delServidor) {
      return (
        'Esta quincena viene de antes de que existieran los abonos, y en el resumen lleva el ' +
        `renglón «${ROTULO_DEUDA_BORRADA}». ${delServidor} ${reparar}`
      );
    }
    // Una respuesta vieja no la trae: ahí el marco dice la cifra y el nombre una vez, y la
    // posición de hoy sale de la cuenta de acá con el mismo formato y el mismo nombre.
    return (
      'Esta quincena viene de antes de que existieran los abonos, y el sistema de esa época ' +
      `le borró los ${this.enPesos(this.deudaBorrada())} que ${this.tercero()} quedaba ` +
      `debiendo. En el resumen van en el renglón «${ROTULO_DEUDA_BORRADA}». ` +
      `${this.posicionDeHoyEscritaAca()} ${reparar}`
    );
  });

  /**
   * Lo que de verdad queda con la deuda borrada, cuando el servidor no lo manda escrito.
   * La cifra borrada ya la dijo el marco del aviso: acá no se repite.
   */
  private posicionDeHoyEscritaAca(): string {
    const l = this.liq();
    const falta = this.faltaPorEntregar();
    if (falta < 0 && this.leQuedaDebiendo()) {
      // El renglón final ya dice "Le queda debiendo": esa parte SÍ quedó anotada como deuda
      // (y puede que ya se le haya cobrado en otra); la que no está anotada es la borrada.
      const debe = this.enPesos((-falta / 100).toFixed(2));
      const anotada = this.enPesos(l.le_queda_debiendo);
      return this.deudaYaCobrada()
        ? `Tal como están las cifras, ${this.tercero()} quedó debiendo ${debe} por esta ` +
            `quincena: los ${anotada} del renglón final ya se le cobraron en ` +
            `${this.dondeSeCobro()}, y la deuda borrada todavía la debe.`
        : `Tal como están las cifras, ${this.tercero()} le debe ${debe} al negocio por esta ` +
            `quincena: los ${anotada} del renglón final quedaron anotados como deuda, y la ` +
            'deuda borrada, no.';
    }
    if (falta < 0) {
      return (
        `Tal como están las cifras, ${this.tercero()} todavía le debe ` +
        `${this.enPesos((-falta / 100).toFixed(2))} al negocio por esta quincena.`
      );
    }
    if (falta === 0) {
      return (
        `Tal como están las cifras, no queda nada por entregarle a ${this.tercero()} ni ` +
        'nada que cobrarle.'
      );
    }
    return (
      `Lo que de verdad falta por entregarle a ${this.tercero()} son ` +
      `${this.enPesos((falta / 100).toFixed(2))}, no los ${this.enPesos(l.saldo)} del saldo.`
    );
  }

  /**
   * El porqué de los candados de Corregir, Pagar y Anular sobre esa quincena.
   *
   * LO ESCRIBE EL SERVIDOR (`avisos_deuda_borrada`), uno por acción: es el mismo 422 que
   * esa acción da sobre esta fila (`_aviso_deuda_borrada` con su verbo), con la posición
   * de hoy adentro. Se pinta tal cual. Medido antes del campo: en la de Arriba v2 (saldo
   * $200.000, borrada $120.000) el candado de Pagar decía "le pagaría esos $ 120.000 de
   * más" y el 422 "El saldo dice $200.000, pero lo que de verdad falta entregarle es
   * $80.000…": dos textos para el mismo "no".
   *
   * La redacción de acá queda para una respuesta vieja que no lo trae. Arranca con las
   * palabras del error del backend y deja la posición de hoy al aviso rojo de arriba, que
   * sale siempre al lado de estos candados. Y el remate cambia cuando el tercero NO debe:
   * la corregida con $200.000 más sin pagarse dice "Saldo a pagar $ 200.000" y se le deben
   * $80.000 de verdad. Ahí "mandaría a pagarle a alguien que todavía debe" es falso; lo
   * cierto es que le pagaría de más.
   */
  private avisoDeudaBorrada(verbo: 'corregir' | 'pagar' | 'anular'): string {
    const delServidor = this.liq().avisos_deuda_borrada?.[verbo];
    if (delServidor) return delServidor;
    const cifra = this.enPesos(this.deudaBorrada());
    const remate =
      this.faltaPorEntregar() < 0
        ? 'mandaría a pagarle a alguien que todavía debe.'
        : `le pagaría esos ${cifra} de más.`;
    return (
      `No se puede ${verbo} esta quincena: viene de antes de que existieran los abonos, y el ` +
      `sistema de esa época le borró lo que ${this.tercero()} quedaba debiendo (${cifra}). ` +
      `Hay que repararla antes de tocarla: tal como está, el sistema le sumaría esos ${cifra} ` +
      `a lo que falta por entregarle y ${remate}`
    );
  }

  /**
   * EL RESUMEN COMPLETO, EN EL ORDEN EN QUE SE RESTA Y CON LOS MISMOS RENGLONES DEL PDF.
   *
   * Lo que arregla, y que el dueño reclamó con estas palabras —"suma y resta de arriba
   * abajo y no me cuadra"—:
   *
   *  · "Anticipos aplicados" y "Pagado" estaban ARRIBA de VALOR TOTAL. Son descuentos
   *    del total: leídos antes que él no hay nada de dónde restarlos. Ahora el orden es
   *    el de la cuenta: bruto, + bonificaciones, − descuentos, VALOR TOTAL, − anticipos,
   *    − lo que quedó debiendo de la quincena pasada, − pagado (+ la deuda borrada por la
   *    migración, en las pocas que la tienen), y el saldo al final;
   *  · en la del PROVEEDOR sobraba "Valor transporte". Ese flete no se le descuenta a él
   *    —se le paga al transportador, y tiene su propio comprobante—, así que metido en
   *    la columna la descuadraba. Se dice aparte y con esas palabras (ver `notaFlete`);
   *  · en la del TRANSPORTADOR sobraban "Valor bruto", "Bonificaciones" y "Descuentos",
   *    que en su comprobante son siempre cero: tres renglones en $0 entre los que sí
   *    cuentan. Su PDF nunca los imprimió.
   *
   * La invariante que esta lista tiene que cumplir SIEMPRE, y que hay una prueba que la
   * mide leyendo la pantalla: los renglones con `cuenta` puestos, aplicados con su
   * signo, caen EXACTO en VALOR TOTAL primero y en el saldo del final después.
   */
  readonly renglonesResumen = computed<RenglonResumen[]>(() => {
    const l = this.liq();
    const esProveedor = l.tipo === 'proveedor';
    const filas: RenglonResumen[] = [];

    const plata = (
      clave: string,
      etiqueta: string,
      valor: Monto | null | undefined,
      signo: '' | '+' | '−' = '',
      extra: Partial<RenglonResumen> = {},
    ): void => {
      const cifra = this.enPesos(valor);
      filas.push({
        clave,
        etiqueta,
        texto: signo ? `${signo} ${cifra}` : cifra,
        signo,
        cuenta: true,
        destacado: false,
        alReves: false,
        ...extra,
      });
    };

    // Los litros y el promedio encabezan el resumen como en el PDF, pero NO entran en
    // la columna de plata: son la medida de la quincena, no una cifra que se sume.
    filas.push({
      clave: 'litros',
      etiqueta: 'Total litros',
      texto: this.enLitros(l.total_litros),
      signo: '',
      cuenta: false,
      destacado: false,
      alReves: false,
    });
    if (esProveedor) {
      filas.push({
        clave: 'precio_promedio',
        etiqueta: 'Precio promedio',
        texto: this.enPesos(l.precio_promedio),
        signo: '',
        cuenta: false,
        destacado: false,
        alReves: false,
      });
      plata('valor_bruto', 'Valor bruto', l.valor_bruto);
      plata('bonificaciones', 'Bonificaciones', l.bonificaciones, '+');
      plata('descuentos', 'Descuentos', l.descuentos, MENOS);
    } else {
      // En su comprobante el flete ES el bruto: de ahí arranca la cuenta.
      plata('valor_transporte', 'Valor transporte', l.valor_transporte);
    }

    plata('valor_total', 'Valor total', l.valor_total, '', { destacado: true });
    plata('anticipos', 'Anticipos aplicados', l.anticipos, MENOS);
    // El renglón NUEVO, y solo cuando de verdad se le cobró algo de atrás. Con el mismo
    // rótulo del PDF: el dueño pone los dos documentos uno al lado del otro.
    if (this.cobraSaldoAnterior()) {
      plata('saldo_anterior', ROTULO_SALDO_ANTERIOR, l.saldo_anterior, MENOS);
    }
    if (this.deudaBorrada() > 0) {
      // CON LA DEUDA BORRADA POR LA MIGRACIÓN, `pagado` no es lo entregado: lleva metida
      // la deuda que se borró (borrada = Σ pagos − pagado). Se pinta lo que suma la tabla
      // de pagos, y la deuda borrada va en su propio renglón, en positivo. Así la columna
      // cierra siempre, porque saldo = neto − pagado: la de $180.000 contra $300.000,
      // corregida con $200.000 más y pagada, lee 380.000 − 300.000 − 200.000 + 120.000 = 0,
      // donde antes decía "Pagado − $ 80.000" al lado de un pago de $200.000.
      // Va aunque esté anulada: ahí no hay nada que reparar, pero la cuenta tiene que dar.
      const entregado = this.entregadoEnPagos();
      if (entregado > 0) plata('pagado', 'Pagado', entregado.toFixed(2), MENOS);
      plata('deuda_borrada', ROTULO_DEUDA_BORRADA, l.deuda_borrada_por_la_migracion, '+');
    } else {
      // "Pagado" cuando de verdad se abonó algo, igual que en el PDF (que lo imprime con
      // `pagado > 0`). Mirar solo la lista de pagos dejaba sin renglón a las 'pagada' de
      // antes de los pagos parciales: la migración les puso `pagado` sin ningún pago, y la
      // columna bajaba de $400.000 a "Saldo a pagar $ 0" sin decir por dónde. Un pagado
      // negativo en una respuesta vieja (sin el campo de la deuda borrada) no se pinta:
      // "− −$ 120.000" no se puede leer.
      const pagado = Number(l.pagado ?? 0);
      if ((this.tienePagos() || pagado > 0) && pagado >= 0) {
        plata('pagado', 'Pagado', l.pagado, MENOS);
      }
    }

    // EL RENGLÓN DE CIERRE cambia de rótulo cuando la cuenta queda por debajo de cero:
    // ahí la plata la debe el tercero y la cifra va en POSITIVO. Un menos pegado a un
    // total destacado se lee como "hay que pagar una cifra negativa".
    //
    // Y CON LAS MISMAS TRES PALABRAS DEL PDF: si el negativo no lo hicieron los anticipos
    // sino plata entregada de más (se le pagaron $500.000 y la quincena corregida quedó en
    // $400.000), el papel cierra en "SE LE PAGÓ DE MÁS $100.000" y la pantalla decía "Le
    // queda debiendo $ 100.000": la misma plata con dos causas, y el dueño compara las
    // dos hojas. La pregunta es la del PDF (neto ≥ 0 y pagado > neto), en `causaDeLaDeuda`.
    if (this.leQuedaDebiendo()) {
      const rotulo =
        causaDeLaDeuda(l) === 'entregado_de_mas' ? 'Se le pagó de más' : 'Le queda debiendo';
      plata('le_queda_debiendo', rotulo, l.le_queda_debiendo, '', {
        destacado: true,
        alReves: true,
      });
    } else {
      plata('saldo', 'Saldo a pagar', l.saldo, '', { destacado: true });
    }
    return filas;
  });

  /**
   * EL FLETE DE LA LECHE DEL PROVEEDOR, dicho aparte y explicando por qué no se resta.
   *
   * Esta cifra estaba dentro de la columna del resumen y la descuadraba: el dueño la
   * restaba del valor total y le sobraba plata. No se le descuenta al proveedor —el
   * flete se le paga al transportador, que tiene su propio comprobante—, así que se
   * queda como dato, fuera de la cuenta y con la razón escrita al lado.
   *
   * Null cuando no hay flete o cuando es la del transportador (ahí el flete ES la
   * cuenta, y ya va como primer renglón).
   */
  readonly notaFlete = computed<string | null>(() => {
    const l = this.liq();
    if (l.tipo !== 'proveedor' || Number(l.valor_transporte ?? 0) <= 0) return null;
    return (
      `El flete de esta leche costó ${this.enPesos(l.valor_transporte)}. No se le ` +
      `descuenta a ${this.tercero()}: eso se le paga al transportador, que tiene su ` +
      `propio comprobante. Por eso no entra en la cuenta de arriba.`
    );
  });

  /**
   * La frase completa, como la diría el dueño: "Henri le queda debiendo $4.955,77".
   *
   * Va aparte del renglón del resumen y no en lugar de él: el renglón es una celda de
   * rótulo + cifra (y la tabla se lee de dos en dos), así que la explicación —con el
   * nombre de la persona y el motivo— va en su propia línea debajo. Es el mismo
   * remedio del estado de cuenta del productor cuando al cliente se le cobró de más.
   *
   * Devuelve null cuando no hay nada que explicar, para que la plantilla no tenga que
   * repetir la condición.
   */
  readonly explicacionLeQuedaDebiendo = computed<string | null>(() => {
    // Con la deuda borrada por la migración esta cuenta sale mal (le falta lo borrado), y
    // la frase le diría al dueño una deuda que no es: lo explica el aviso de arriba. Se
    // mira la cifra y no `tieneDeudaBorrada`: en una anulada la frase sería igual de falsa.
    if (!this.leQuedaDebiendo() || this.deudaBorrada() > 0) return null;
    const l = this.liq();
    // LA CAUSA. Cuando esta misma quincena ya venía cargando una deuda vieja, hay que
    // nombrarla: sin ella la frase acusa a los anticipos de una diferencia que no es
    // toda suya, y el dueño suma "anticipos contra valor total" y no le da.
    //
    // Y CUANDO LA DEUDA NO LA HICIERON LOS ANTICIPOS SINO LA PLATA YA ENTREGADA —el
    // sobrepago que deja una corrección: se le entregaron $500.000 y la quincena
    // corregida quedó en $400.000— esta frase era FALSA de cabo a rabo. Ahí no hay
    // anticipos que buscar, y mandar al dueño a buscarlos es peor que no decir nada.
    const causa =
      causaDeLaDeuda(l) !== 'anticipos'
        ? porQueSeLePagoDeMas(l, (monto) => this.enPesos(monto))
        : this.cobraSaldoAnterior()
          ? `los anticipos aplicados (${this.enPesos(l.anticipos)}) más lo que ya venía ` +
            `debiendo de antes (${this.enPesos(l.saldo_anterior)}) suman más que el valor ` +
            `total de esta liquidación (${this.enPesos(l.valor_total)})`
          : `los anticipos aplicados (${this.enPesos(l.anticipos)}) suman más que el valor ` +
            `total de esta liquidación (${this.enPesos(l.valor_total)})`;
    // Y LA CADENA, cuando esta quincena cobró una deuda y volvió a quedar debiendo: lo
    // que viaja a la siguiente YA INCLUYE la vieja. Decirlo evita la pregunta que
    // seguiría —"¿entonces se le está cobrando dos veces?"— con plata de por medio.
    const cadena = this.cobraSaldoAnterior()
      ? ` En esos ${this.enPesos(l.le_queda_debiendo)} ya está incluido lo que traía ` +
        `debiendo de antes, así que no se le cobra dos veces.`
      : '';
    return (
      `${this.tercero()} le queda debiendo ${this.enPesos(l.le_queda_debiendo)}: ` +
      `${causa}. No hay nada que pagarle. ${this.queSigueConLaDeuda()}${cadena}`
    );
  });

  /**
   * DÓNDE SE LE COBRÓ ESA DEUDA — o que todavía está pendiente, o que ya no se cobra.
   *
   * Es la punta que faltaba. Antes esta liquidación decía "esa diferencia se le cobra o
   * se le descuenta en la próxima quincena": una PROMESA que nadie cumplía, porque
   * ningún documento la cobraba. Ahora sí se cobra, así que este texto tiene que decir
   * qué pasó DE VERDAD, y son tres situaciones que el dueño necesita distinguir:
   *
   *  · YA SE COBRÓ: se nombra la liquidación que la cobró CON SU PERÍODO, que es cómo él
   *    identifica un comprobante (un id no le dice nada). También es lo que tiene que
   *    saber si algún día quiere anular esta: primero hay que anular esa;
   *  · ANULADA: acá la promesa era FALSA y hay que decirlo. El servidor no le cobra la
   *    deuda de una liquidación anulada a nadie (la busca entre las que no están
   *    anuladas ni borradas: ver `deudas_sin_cobrar` en el backend), así que si esta
   *    quincena se anuló, esos pesos no los va a recoger ninguna liquidación futura. Lo
   *    que hay que hacer es volver a generarla;
   *  · TODAVÍA NO: se dice PENDIENTE y con qué rótulo va a aparecer allá, para que
   *    cuando vea el descuento en la próxima quincena lo reconozca. Con el "después de
   *    esta" porque es literal lo que hace el servidor: solo se cobra en una liquidación
   *    cuyo período empiece DESPUÉS de que este termine, así que liquidar una quincena
   *    vieja no se la cobra. Y VIAJA IGUAL SI ESTA SIGUE EN BORRADOR —eso es la regla
   *    nueva del servidor, y antes se perdía la deuda de los borradores—, así que se dice
   *    con esas palabras: quien ve un borrador en negativo asume que "todavía no cuenta".
   *
   * Si el backend manda el enlace pero no las fechas, se dice sin el período en vez de
   * callarse: "ya se cobró" sin fecha sigue siendo mejor que una promesa falsa.
   */
  private queSigueConLaDeuda(): string {
    if (this.deudaYaCobrada()) {
      const periodo = this.periodoDondeSeCobro();
      return periodo
        ? `Esa diferencia YA se le cobró en la liquidación del ${periodo}.`
        : 'Esa diferencia YA se le cobró en una liquidación posterior.';
    }
    if (this.liq().estado === 'anulada') {
      return (
        'Esta liquidación está ANULADA, así que esa diferencia no se le cobra en ninguna ' +
        'parte: vuelva a generar la quincena si hay que cobrársela.'
      );
    }
    // El borrador se nombra aparte porque es la sorpresa: sus cifras todavía se pueden
    // corregir y aun así su deuda ya viaja a la próxima quincena que se liquide.
    const aunqueBorrador =
      this.liq().estado === 'borrador'
        ? ' Se le cobra aunque esta liquidación siga en borrador.'
        : '';
    return (
      'Esa diferencia queda PENDIENTE: se le cobra en la próxima quincena que se le ' +
      `liquide después de esta, donde va a aparecer como «${ROTULO_SALDO_ANTERIOR}».` +
      aunqueBorrador
    );
  }

  /**
   * DE DÓNDE SALIÓ EL DESCUENTO, en la liquidación que SE LO COBRA.
   *
   * La otra punta. Un renglón que le quita $120.000 al proveedor sin decir de dónde
   * viene es lo que hace que el dueño desconfíe del sistema —y con razón: es plata que
   * no sale de ninguna recepción de esta quincena—. Acá se nombra la quincena que la
   * dejó y se dice que se cobra UNA sola vez.
   *
   * Null cuando no se cobró nada, que es el caso de casi todos los comprobantes.
   */
  readonly explicacionSaldoAnterior = computed<string | null>(() => {
    if (!this.cobraSaldoAnterior()) return null;
    // LA QUE COBRÓ UNA DEUDA QUE YA NO CUADRA: "son lo que quedó debiendo … Se le cobran
    // acá" sería falso, porque la otra quincena hoy ya no debe eso. Se dice lo que dice el
    // servidor de esta fila, tal cual. (Si esta también dejó deuda en otra, el aviso habla
    // de ESA punta y aquí sigue la explicación de siempre.)
    const descuadre = this.avisoDeudaQueNoCuadra();
    if (descuadre && !this.deudaYaCobrada()) return descuadre;
    const l = this.liq();
    const cifra = this.enPesos(l.saldo_anterior);
    const origenes = this.origenesSaldoAnterior();
    const deDonde =
      origenes.length === 1
        ? `en la liquidación del ${origenes[0].periodo}`
        : origenes.length > 1
          ? `en ${origenes.length} liquidaciones pasadas`
          : // Sin el detalle (el backend manda la cifra pero no las quincenas) se dice
            // lo que se sabe. Callar el renglón sería peor: el descuento ya está hecho.
            'en una quincena pasada';
    return (
      `Los ${cifra} de «${ROTULO_SALDO_ANTERIOR}» son lo que ${this.tercero()} quedó ` +
      `debiendo ${deDonde}, cuando los anticipos que se le habían entregado sumaron más ` +
      `que su quincena. Se le cobran acá, una sola vez.`
    );
  });

  /**
   * Las quincenas que dejaron la deuda, una por renglón: período y cuánto puso cada una.
   *
   * En lista y no dentro de la frase porque pueden ser varias —dos quincenas seguidas en
   * negativo se cobran juntas— y sus cifras tienen que SUMAR el renglón del resumen: así
   * el dueño comprueba el descuento como comprueba el desglose diario.
   */
  readonly origenesSaldoAnterior = computed<{ id: string; periodo: string; valor: string }[]>(() =>
    (this.liq().deudas_cobradas ?? []).map((origen: DeudaCobrada) => ({
      id: origen.id,
      periodo: periodoDe(origen),
      valor: this.enPesos(origen.le_queda_debiendo),
    })),
  );

  /** ¿La deuda que ESTA dejó ya se la cobró otra liquidación? Entonces está congelada. */
  readonly deudaYaCobrada = computed(() => !!this.liq().deuda_trasladada_a_id);

  /**
   * LA DEUDA COBRADA QUE YA NO CUADRA: el 422 de Pagar sobre esta fila, escrito por el
   * servidor (`avisos_deuda_cobrada.pagar`, o el de registrar un pago), o null.
   *
   * Son las parejas que dejó el borrado de pagos de antes del guardia. Medido con Henri:
   * la del 01/06 dejó $100.000 de deuda que la del 16/06 descontó; después se le borró el
   * pago a la primera y quedó "por entregar $400.000" sin deber nada, mientras la segunda
   * seguía descontando los $100.000. El servidor rebota Pagar, Abonar y "Marcar pagada" en
   * las dos puntas, y sin esta pregunta la pantalla pintaba un Pagar que siempre rebota. La
   * pregunta es la del servidor —mira la OTRA quincena, que esta pantalla no tiene—, así
   * que acá solo se lee. Llega a todo el que ve la fila, no solo a quien ve Pagar: el
   * descuadre es de la fila, no del usuario, y con él la ayuda de la línea de estados deja
   * de decir que el pago lo registra un Administrador (el servidor también se lo rebota).
   */
  readonly avisoDeudaQueNoCuadra = computed<string | null>(() => {
    const avisos: Readonly<Record<string, string | undefined>> =
      this.liq().avisos_deuda_cobrada ?? {};
    return avisos['pagar'] || avisos['registrar_pago'] || null;
  });

  /** El período de la liquidación que se cobró la deuda, o null si no vino nombrada. */
  private periodoDondeSeCobro(): string | null {
    const otra = this.liq().deuda_trasladada_a;
    return otra ? periodoDe(otra) : null;
  }

  /** "la liquidación del 16/07/2026 al 31/07/2026", u "otra liquidación" si no vino. */
  private dondeSeCobro(): string {
    const periodo = this.periodoDondeSeCobro();
    return periodo ? `la liquidación del ${periodo}` : 'otra liquidación';
  }

  constructor() {
    // Recarga la liquidación para asegurar que los detalles estén completos.
    firstValueFrom(this.servicio.getById(this.data.item.id))
      .then((liq) => {
        this.liq.set(liq);
        // El motivo de la corrección se pide DESPUÉS y SOLO si la versión dice que hay
        // algo que pedir: en la inmensa mayoría de los comprobantes no hay ninguna, y
        // preguntar siempre sería una consulta de más por cada uno que se abre.
        this.cargarCorrecciones();
      })
      .catch(() => undefined);
  }

  // ------------------------------------------- corregir el precio de un día
  /**
   * Escape cierra el campo, y al cerrarlo el navegador puede disparar el blur
   * del input que acaba de desaparecer. Esta marca evita que ese blur guarde lo
   * que el usuario justamente acaba de cancelar.
   */
  private cancelando = false;

  editarPrecio(detalle: LiquidacionDetalle): void {
    if (!this.puedeEditarPrecio() || this.guardandoId()) return;
    this.cancelando = false;
    this.textoPrecio.set(String(Number(detalle.precio_litro)));
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
   * Al salir del campo se guarda, como en la hoja de cálculo de la que viene el
   * dueño: si hace clic afuera después de teclear, espera que quede. Escape
   * sigue siendo la forma de arrepentirse.
   */
  alSalirDelPrecio(detalle: LiquidacionDetalle): void {
    if (this.cancelando) {
      this.cancelando = false;
      return;
    }
    void this.guardarPrecio(detalle);
  }

  async guardarPrecio(detalle: LiquidacionDetalle): Promise<void> {
    if (this.guardandoId()) return;
    // Si mientras el campo estaba abierto la quincena dejó de aceptar el precio (llegó la
    // recarga con la deuda ya cobrada en otra), se cierra sin mandar nada: cada salida del
    // campo volvía a mandar el PUT y a recibir el mismo 422.
    if (!this.puedeEditarPrecio()) {
      this.editandoId.set(null);
      return;
    }
    const precio = precioTecleado(this.textoPrecio());

    // Sin cambio real, cerrar el campo y no molestar al servidor.
    if (precio === null || precio === Number(detalle.precio_litro)) {
      if (precio === null) {
        this.snackbar.open('Escriba el precio por litro en pesos, por ejemplo 1750', 'OK', {
          duration: 4000,
        });
        return; // el campo se queda abierto para corregir lo tecleado
      }
      this.editandoId.set(null);
      return;
    }

    this.guardandoId.set(detalle.id);
    try {
      const actualizada = await firstValueFrom(
        this.servicio.actualizarPrecioDetalle(this.liq().id, detalle.id, precio),
      );
      // La cifra en pantalla es SIEMPRE la que devolvió el servidor: nunca se
      // pinta el precio nuevo por adelantado. Si el guardado falla, lo que se ve
      // sigue siendo lo que de verdad está guardado.
      this.liq.set(actualizada);
      this.editandoId.set(null);
      // Corregir un día mueve las cifras: el "antes → ahora" del recálculo anterior
      // ya no es el de la pantalla.
      this.cambio.set(null);
      this.snackbar.open('Precio actualizado', 'OK', { duration: 3000 });
    } catch (err) {
      // El campo se queda ABIERTO con lo tecleado: así se ve que ese día quedó
      // sin guardar, en vez de volver a la cifra vieja como si nada.
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible cambiar el precio de ese día');
    } finally {
      this.guardandoId.set(null);
    }
  }

  /**
   * Recalcular se ofrece donde el servidor lo acepta, con permiso de editar.
   *
   * Sirve para dos casos que se ven igual desde afuera: el anticipo que se
   * registró DESPUÉS de generar la liquidación (el resumen quedaba en "Anticipos
   * aplicados $0" y no había cómo recogerlo) y la TARIFA MAL TECLEADA del
   * transportador —el caso del dueño—: la corrigió en la ficha y el comprobante
   * siguió mostrando la cifra vieja, porque sus renglones son la foto del día en
   * que se generó.
   *
   * Los estados los manda `ESTADOS_QUE_ACEPTAN_RECALCULO`, que es el contrato del
   * backend y no una decisión de esta pantalla. Con plata ya entregada no se
   * ofrece —el servidor rebota, y con razón—, pero tampoco desaparece en
   * silencio: ver `motivoNoRecalcular`.
   *
   * Ni en el borrador cuya deuda ya se cobró en otra: en el borrador, el `recalcular` del
   * servidor rebota eso (`_razon_para_no_recalcular`: el estado y después la deuda), así
   * que el botón siempre fallaba. Ahí queda el candado que nombra cuál anular primero.
   */
  readonly puedeRecalcular = computed(
    () =>
      ESTADOS_QUE_ACEPTAN_RECALCULO.includes(this.liq().estado) &&
      !this.tienePagos() &&
      !this.deudaYaCobrada() &&
      this.auth.hasPermission('liquidaciones', 'editar'),
  );

  /**
   * Por qué NO se puede recalcular, en palabras y con la salida que sí funciona.
   *
   * Devuelve null cuando no hay nada que explicar: si se puede, si el usuario no
   * tiene el permiso (nunca vio el botón) o si está anulada (ahí no hay nada que
   * recalcular y el chip de estado ya lo dice).
   */
  readonly motivoNoRecalcular = computed(() => {
    if (this.puedeRecalcular() || !this.auth.hasPermission('liquidaciones', 'editar')) return null;
    const liq = this.liq();
    // LA DEUDA BORRADA VA PRIMERO, en el mismo orden de Corregir y Anular: es la única
    // razón sin salida, y los de abajo nombran `pagado`, que en esta fila es NEGATIVO
    // (−$120.000): "ya está pagado (−$ 120.000)" o "ya se le abonó −$ 70.000" no son ciertos.
    if (this.tieneDeudaBorrada()) {
      return (
        'Sus cifras están en firme y Recalcular solo trabaja sobre borradores. Además trae ' +
        'una deuda borrada de antes de los abonos (ver el aviso de arriba): hay que ' +
        'repararla antes de tocarla.'
      );
    }
    // LA DEUDA YA COBRADA EN OTRA, con el texto del servidor cuando lo manda: es el 422 que
    // daría el botón, con la salida que de verdad existe para quien mira. El servidor lo
    // manda solo sobre el borrador, porque su `recalcular` pregunta el estado primero; en
    // los demás estados siguen los textos de abajo.
    //
    // Sin ese texto (una respuesta vieja), "Anule primero esa liquidación y vuelva a
    // intentarlo" SOLO EN EL BORRADOR: es el único estado en el que anular la otra destraba
    // Recalcular. En una aprobada o una pagada, anulada la otra, esta sigue sin ser
    // borrador y el servidor vuelve a rebotar; ahí siguen los textos de abajo.
    if (
      this.deudaYaCobrada() &&
      (liq.estado === 'borrador' || !!liq.avisos_deuda_cobrada?.recalcular)
    ) {
      return this.avisoDeudaCongelada('recalcular');
    }
    if (liq.estado === 'pagada') {
      // "Ya está pagado" solo si salió plata: la 'pagada' del Pagar de antes con el tercero
      // debiendo tiene pagado $0 (`pagada_sin_que_saliera_un_peso` del backend).
      if (Number(liq.pagado ?? 0) > 0) {
        return (
          `Este comprobante ya está pagado (${this.enPesos(liq.pagado)}): sus cifras quedan ` +
          'en firme y no se pueden recalcular.'
        );
      }
      return this.leQuedaDebiendo()
        ? `No hay nada que entregarle: ${this.tercero()} quedó debiendo ` +
            `${this.enPesos(liq.le_queda_debiendo)}. Sus cifras están en firme y Recalcular ` +
            'solo trabaja sobre borradores.'
        : 'Sus cifras están en firme y Recalcular solo trabaja sobre borradores.';
    }
    // El abono solo se nombra si EXISTE. Y no en la corregida: borrado el abono se queda
    // 'parcial' en su versión 2 (`_estado_tras_corregir`), que tampoco se recalcula ni se
    // anula, así que el consejo no llevaría a nada. Ni con la deuda ya cobrada en otra: ahí
    // el servidor tampoco deja borrar el pago (ver `motivoNoEliminarPago`).
    //
    // La salida es la del servidor para esta misma quincena, en su orden: Corregir primero,
    // el ajuste, y borrar los pagos de último (ver `consejoConLosAbonos`).
    if (this.tienePagos() && !this.fueCorregida() && !this.deudaYaCobrada()) {
      return (
        `Ya se le abonó ${this.enPesos(liq.pagado)} contra estas cifras: quedan en firme y ` +
        `no se pueden recalcular. ${this.consejoConLosAbonos()}`
      );
    }
    // 'parcial' SIN PAGOS es la v2 de una quincena que sus anticipos cubrían, corregida
    // hacia arriba (`_estado_tras_corregir`): la traba el comprobante corregido, no un
    // abono. Y la aprobada corregida no se manda a anular: el `anular` rebota la versión.
    if (liq.estado === 'parcial' || (liq.estado === 'aprobada' && this.fueCorregida())) {
      return this.fueCorregida()
        ? `De esta quincena ya salieron ${this.version()} comprobantes (el original y sus ` +
            'correcciones): sus cifras están en firme y Recalcular solo trabaja sobre borradores.'
        : 'Sus cifras están en firme y Recalcular solo trabaja sobre borradores.';
    }
    // La aprobada cuya deuda ya se cobró en otra: Anular también rebota, así que tampoco se
    // manda a anularla (el candado de Anular dice qué hacer primero).
    if (liq.estado === 'aprobada' && this.deudaYaCobrada()) {
      return (
        `No hay nada que entregarle: ${this.tercero()} quedó debiendo ` +
        `${this.enPesos(liq.le_queda_debiendo)}, y eso ya se le cobró en ` +
        `${this.dondeSeCobro()}. Sus cifras están en firme y Recalcular solo trabaja sobre ` +
        'borradores.'
      );
    }
    // Aprobada SIN pagos: no hay plata entregada, pero el servidor solo recalcula
    // borradores, así que el botón no se puede ofrecer. Se dice cuál es la salida
    // que sí funciona en vez de dejarlo buscando un botón que no está. (Si el
    // backend pasa a aceptarla, este texto desaparece solo: ver
    // ESTADOS_QUE_ACEPTAN_RECALCULO.) La salida la nombra `anulelaYVuelvaAGenerarla`, con
    // el permiso de quien mira: este candado lo ve también quien solo edita.
    //
    // Y SI EL CHIP DICE "pagada · quedó debiendo" (en la base sigue 'aprobada'), el texto
    // tiene que decir lo mismo: "está aprobada, todavía no se le ha pagado nada" al lado
    // de un chip que dice pagada se lee como un error. La rama se decide por el rótulo
    // que manda el backend, no por el saldo. La salida sigue siendo Anular: el servidor
    // la acepta mientras esa deuda no se haya cobrado en otra (ese caso va arriba).
    //
    // Y LA QUE LA DEUDA VIEJA DEJÓ EN CERO (la quincena 2 de Henri: $120.000 contra los
    // $120.000 que dejó debiendo la 1). "Todavía no se le ha pagado nada" al lado de "No
    // hay nada que entregarle" se lee como que algo falta por pagar, y no falta nada. La
    // pregunta es la misma de los botones (`laDeudaViejaCubrioLaQuincena`). Anularla sí
    // sirve: `anular` suelta la deuda que esta se estaba cobrando.
    if (
      liq.estado === 'aprobada' &&
      this.quincenaSaldadaSinCerrar() &&
      this.laDeudaViejaCubrioLaQuincena()
    ) {
      return (
        `No hay nada que entregarle a ${this.tercero()}: con lo que venía debiendo de antes, ` +
        `el saldo quedó en ${this.enPesos('0')}. Sus cifras están en firme y Recalcular solo ` +
        'trabaja sobre borradores. Si quedaron mal —por ejemplo una tarifa que se corrigió ' +
        `después—, ${this.anulelaYVuelvaAGenerarla(
          'al anularla, lo que venía debiendo vuelve a quedar pendiente.',
        )}`
      );
    }
    // Y LA QUE SUS PROPIOS ANTICIPOS DEJARON EN CERO: 100 L × $1.800 = $180.000 contra un
    // adelanto de $180.000. La nota del saldo dice que los anticipos "cubren EXACTO" la
    // quincena y el botón es "Marcar pagada"; "todavía no se le ha pagado nada" al lado es
    // falso con la calculadora en la mano: ya se le entregaron $180.000. Son las mismas
    // señales de ese botón (`puedeCerrarSinPago` sin el permiso), y la frase del cero es la
    // de la nota, que nombra solo los renglones que existen.
    if (
      liq.estado === 'aprobada' &&
      this.quincenaSaldadaSinCerrar() &&
      !this.laDeudaViejaCubrioLaQuincena()
    ) {
      return (
        `${this.explicacionSaldoEnCero()} Sus cifras están en firme y Recalcular solo ` +
        'trabaja sobre borradores. Si quedaron mal —por ejemplo una tarifa que se corrigió ' +
        `después—, ${this.anulelaYVuelvaAGenerarla(
          Number(liq.anticipos ?? 0) > 0
            ? 'al anularla, sus anticipos vuelven a quedar pendientes.'
            : 'todavía no tiene pagos registrados.',
        )}`
      );
    }
    if (liq.estado === 'aprobada' && estadoComoSeLee(liq) === PAGADA_QUEDO_DEBIENDO) {
      return (
        `No hay nada que entregarle: ${this.tercero()} quedó debiendo ` +
        `${this.enPesos(liq.le_queda_debiendo)}. Sus cifras están en firme y Recalcular ` +
        'solo trabaja sobre borradores. Si quedaron mal —por ejemplo una tarifa que se ' +
        `corrigió después—, ${this.anulelaYVuelvaAGenerarla(
          'esa deuda todavía no se le ha cobrado en otra quincena.',
        )}`
      );
    }
    if (liq.estado === 'aprobada') {
      // "Todavía no se le ha pagado nada" solo sin anticipos: el adelanto es plata que salió
      // en la mano contra esta quincena ($300.000 de $500.000), y el dueño la cuenta como
      // entregada. Con ellos se dice lo que es cierto: no hay pagos, y anularla los suelta.
      const consecuencia =
        Number(liq.anticipos ?? 0) > 0
          ? 'todavía no tiene pagos registrados, y al anularla sus anticipos ' +
            `(${this.enPesos(liq.anticipos)}) vuelven a quedar pendientes.`
          : 'todavía no se le ha pagado nada.';
      return (
        'Está aprobada y Recalcular solo trabaja sobre borradores. Si sus cifras quedaron ' +
        'mal —por ejemplo una tarifa que se corrigió después—, ' +
        this.anulelaYVuelvaAGenerarla(consecuencia)
      );
    }
    return null;
  });

  /**
   * ¿QUIEN MIRA PUEDE ANULAR? La pregunta de permiso del botón Anular (`puedeAnular`) y del
   * `POST /anular`, escrita UNA vez para que los consejos que nombran Anular hagan la
   * misma. Compras tiene 'editar' y no 'administrar': ve el candado de Recalcular, y un
   * "anúlela" ahí lo mandaba a un botón que no le sale y que el servidor le rebota con 403.
   */
  private readonly tienePermisoDeAnular = computed(() =>
    this.auth.hasPermission('liquidaciones', 'administrar'),
  );

  /**
   * ¿QUIEN MIRA PUEDE BORRAR UN PAGO? La de la papelera de la tabla de pagos y la del
   * `DELETE /pagos/{id}`: 'liquidaciones:eliminar', que Compras tampoco tiene.
   */
  readonly tienePermisoDeEliminarPagos = computed(() =>
    this.auth.hasPermission('liquidaciones', 'eliminar'),
  );

  /**
   * "anúlela y vuelva a generarla: …", o a quién pedírselo. El Administrador Empresa tiene
   * los dos permisos, así que mandar donde él no es mandar a un botón que no existe.
   */
  private anulelaYVuelvaAGenerarla(consecuencia: string): string {
    return this.tienePermisoDeAnular()
      ? `anúlela y vuelva a generarla: ${consecuencia}`
      : 'pídale a un Administrador de la empresa que la anule y la vuelva a generar: ' +
          consecuencia;
  }

  /**
   * QUÉ HACER CON LAS CIFRAS DE UNA QUINCENA QUE YA TIENE ABONOS, para quien mira.
   *
   * EL MISMO CONSEJO DEL SERVIDOR PARA ESTA QUINCENA, en el mismo orden (el candado de su
   * anticipo, `_consejo_del_candado`, y el de su día, `_consejo_del_abono`): primero
   * Corregir si el botón la acepta —conserva los pagos y sus soportes—, después el ajuste,
   * y de último borrar los pagos, contados y con la advertencia de los soportes. Medido con
   * 100 L × $1.800 = $180.000 y abonos de $50.000 y $20.000 (saldo $80.000): acá decía "Si
   * de verdad hay que rehacerlas, primero elimine el abono." —en singular con dos, sin
   * nombrar Corregir aunque el botón estaba al lado, y sin decir que los soportes se
   * pierden— mientras el anticipo de esa misma quincena decía "use 'Corregir esta
   * quincena', que conserva los pagos y sus soportes … Elimine primero esos 2 pagos solo
   * si …: con ellos se van sus soportes, que no se recuperan". Borrar uno de los dos no
   * destraba nada: la quincena sigue 'parcial' con el otro.
   *
   * Corregir, con la pregunta del botón (`usarCorregir`). Borrar los pagos, solo si
   * borrarlos todos la deja sin pagos (`losPagosSeBorranTodos`), y con el permiso de la
   * papelera; sin él, a quién pedírselo. Lo que no cambia es lo que el servidor manda a
   * todos: el ajuste en la quincena siguiente.
   */
  private consejoConLosAbonos(): string {
    const pagos = this.liq().pagos.length;
    const ajuste = 'registre el ajuste en la quincena siguiente';
    const usar = this.usarCorregir();
    const corregir = usar
      ? `Si sus cifras quedaron mal, ${usar}, que conserva ` +
        `${pagos === 1 ? 'el pago' : 'los pagos'} y sus soportes, o ${ajuste}`
      : `Si sus cifras quedaron mal, ${ajuste}`;
    if (!this.losPagosSeBorranTodos()) return `${corregir}.`;
    const esePago = pagos === 1 ? 'ese pago' : `esos ${pagos} pagos`;
    const conEllos = pagos === 1 ? 'con él' : 'con ellos';
    const soportes = `${conEllos} se van sus soportes, que no se recuperan`;
    const puedeBorrar = this.tienePermisoDeEliminarPagos();
    if (usar) {
      const borrar = puedeBorrar
        ? `Elimine primero ${esePago} solo si de verdad hay que rehacerlas`
        : 'Si de verdad hay que rehacerlas, pídale a un Administrador de la empresa que ' +
          `elimine primero ${esePago}`;
      return `${corregir}. ${borrar}: ${soportes}.`;
    }
    // Corregir rebota (la quincena del flete): borrar los pagos es la única salida por
    // dentro, y va con su advertencia.
    return puedeBorrar
      ? `Elimine primero ${esePago} si de verdad hay que rehacerlas —${soportes}—, o ${ajuste}.`
      : 'Si de verdad hay que rehacerlas, pídale a un Administrador de la empresa que ' +
          `elimine primero ${esePago} —${soportes}—, o ${ajuste}.`;
  }

  /**
   * "use 'Corregir esta quincena'" a quien tiene el botón, "pídale a un Administrador de la
   * empresa que use …" a quien no; null si Corregir rebota esta fila.
   *
   * Son las dos preguntas del `_usar_corregir` del servidor y en su orden: la de la fila
   * (`corregirAceptaLaFila`) y la de quien mira. Con las dos, es `puedeCorregir`: la misma
   * expresión del botón, así que el consejo no puede nombrar uno que no esté.
   */
  private usarCorregir(): string | null {
    if (this.puedeCorregir()) return "use 'Corregir esta quincena'";
    return this.corregirAceptaLaFila()
      ? "pídale a un Administrador de la empresa que use 'Corregir esta quincena'"
      : null;
  }

  /**
   * ¿BORRAR TODOS LOS PAGOS DE LA TABLA LA DEJA SIN PAGOS? La pregunta del servidor antes de
   * mandar a borrarlos (`_pagos_que_se_pueden_borrar`): lo que suma la tabla tiene que
   * cubrir `pagado`. No lo cubre en la 'pagada' de antes de los abonos, que trae parte de
   * la plata en `pagado` sin renglón: borrados los renglones seguiría con pagos, y el
   * consejo mandaría a botar unos soportes para nada. En centavos, como el renglón Pagado.
   */
  private readonly losPagosSeBorranTodos = computed(() => {
    const enLaTabla = Math.round(this.entregadoEnPagos() * 100);
    return enLaTabla > 0 && enLaTabla >= Math.round(Number(this.liq().pagado ?? 0) * 100);
  });

  /**
   * "lo que Henri quedó debiendo ($ 120.000)", o sin la cifra si ya no queda deuda anotada.
   *
   * Una fila de antes del arreglo pudo quedar con la marca de "ya cobrada" y el saldo en
   * positivo (se le borró el pago después de que la siguiente cobrara la deuda): ahí decir
   * "lo que quedó debiendo ($ 0) ya se le cobró" es falso. Lo cierto es que la deuda que
   * dejó ya se cobró en la otra.
   */
  private loQueQuedoDebiendo(): string {
    return this.leQuedaDebiendo()
      ? `lo que ${this.tercero()} quedó debiendo (${this.enPesos(this.liq().le_queda_debiendo)})`
      : 'la deuda que dejó esta quincena';
  }

  /**
   * "NO SE PUEDE, Y PRIMERO HAY QUE ANULAR ESA OTRA": el aviso de la deuda congelada.
   *
   * En cuanto la deuda de esta liquidación se cobró en otra, el servidor rebota anular,
   * recalcular y corregir: cambiarle el total le cambiaría el descuento a un comprobante
   * ya emitido, y el dueño terminaría con dos papeles que no cuadran.
   *
   * EL TEXTO LO ESCRIBE EL SERVIDOR (`avisos_deuda_cobrada`), uno por acción y para quien
   * está mirando: es el mismo 422 que daría esa acción sobre esta fila. "Anule primero esa
   * liquidación" no siempre es la salida —la otra puede ser una v2, que no se anula nunca,
   * o tener pagos encima, o anularla puede no destrabar esta— y esa pregunta mira cifras de
   * la OTRA quincena que esta pantalla no tiene. Se pinta tal cual.
   *
   * La redacción de acá queda solo para una respuesta vieja que no lo trae, y nombra la
   * liquidación con su período porque sin eso el usuario queda atascado. La salida va con
   * el permiso de quien mira: Compras ve el candado de Recalcular y no puede anular.
   */
  private avisoDeudaCongelada(verbo: 'anular' | 'recalcular' | 'corregir'): string {
    const delServidor = this.liq().avisos_deuda_cobrada?.[verbo];
    if (delServidor) return delServidor;
    const salida = this.tienePermisoDeAnular()
      ? 'Anule primero esa liquidación'
      : 'Pídale a un Administrador de la empresa que anule primero esa liquidación';
    return (
      `No se puede ${verbo} esta liquidación: ${this.loQueQuedoDebiendo()} ya se le cobró ` +
      `en ${this.dondeSeCobro()}. ${salida} —así esta deuda vuelve a quedar libre— y ` +
      'vuelva a intentarlo.'
    );
  }

  /**
   * POR QUÉ NO SE LE PUEDE BORRAR UN PAGO, o null si sí se puede.
   *
   * Con la deuda de esta quincena ya cobrada en otra, `eliminar_pago` rebota (la misma
   * pregunta del servidor: `deuda_ya_cobrada`). Medido antes de ese guardia: Henri, 250 L
   * × $2.000 = $500.000 pagados con un pago de $500.000, corregida a $1.600 ($400.000,
   * debe $100.000) y la quincena siguiente ya le descontó esos $100.000. Borrar el pago
   * la dejaba en "parcial · $400.000 por pagar" sin deuda, la otra seguía descontando los
   * $100.000, y al pagar las dos la leche sumaba $700.000 y la plata $600.000.
   *
   * El texto lo escribe el servidor (`avisos_deuda_cobrada.eliminar_pago`); el de acá es
   * para una respuesta vieja, y no nombra ninguna salida: esa depende de la otra quincena.
   * Dice "el saldo" y no "lo que quedó debiendo": en una fila que ya quedó con el saldo en
   * positivo, borrar otro pago no mueve la deuda, pero sí el saldo.
   */
  readonly motivoNoEliminarPago = computed<string | null>(() => {
    if (!this.deudaYaCobrada()) return null;
    const delServidor = this.liq().avisos_deuda_cobrada?.eliminar_pago;
    if (delServidor) return delServidor;
    return (
      `No se puede eliminar un pago de esta liquidación: ${this.loQueQuedoDebiendo()} ya se ` +
      `le cobró en ${this.dondeSeCobro()}. Borrar el pago le cambiaría el saldo a esta ` +
      'quincena sin cambiar el descuento que ya se hizo en esa otra, y las dos dejarían de ' +
      'cuadrar.'
    );
  });

  /**
   * ANULAR: se ofrece solo donde el `anular` del backend lo acepta.
   *
   * Es la mitad de pantalla de sus guardias. Sin esto el botón seguía ahí, el usuario lo
   * oprimía, confirmaba "¿anular esta liquidación?" —una confirmación que da miedo— y
   * recibía un error después de haber dicho sí. Rebota, en este orden: la deuda borrada
   * por la migración (la aprobada de $230.000 contra $300.000 con un abono de $50.000
   * encima), la deuda de esta ya cobrada en otra, y la quincena con correcciones (una
   * aprobada puede ser la v2 de una pagada con saldo en cero que se corrigió hacia
   * arriba). Una aprobada con pagos es siempre la de la deuda borrada: con un pago
   * normal encima el estado ya no es 'aprobada'.
   */
  readonly puedeAnular = computed(
    () =>
      (this.liq().estado === 'borrador' || this.liq().estado === 'aprobada') &&
      !this.tieneDeudaBorrada() &&
      !this.deudaYaCobrada() &&
      !this.fueCorregida() &&
      this.tienePermisoDeAnular(),
  );

  /**
   * Por qué no se puede anular, en el orden del `anular` del backend. Null cuando se puede
   * o cuando el botón nunca estuvo.
   */
  readonly motivoNoAnular = computed(() => {
    const estado = this.liq().estado;
    if (estado !== 'borrador' && estado !== 'aprobada') return null;
    if (!this.tienePermisoDeAnular()) return null;
    if (this.tieneDeudaBorrada()) return this.avisoDeudaBorrada('anular');
    if (this.deudaYaCobrada()) return this.avisoDeudaCongelada('anular');
    if (this.fueCorregida()) {
      return (
        `De esta quincena ya salieron ${this.version()} comprobantes (el original y sus ` +
        'correcciones): no se puede anular.'
      );
    }
    return null;
  });

  // ------------------------------- corregir una quincena que YA SE PAGÓ
  /**
   * LA QUINCENA YA ESTÁ CERRADA Y SE LE OLVIDÓ UN DETALLE: acá es donde se arregla.
   *
   * Lo pidió el dueño con esas palabras. Las condiciones son EL CONTRATO DEL BACKEND, no
   * un gusto de la pantalla (`_exigir_corregible` las exige en este orden):
   *
   *  · sin deuda borrada por la migración de los abonos: corregida tal como está, la
   *    deuda borrada se le SUMA a lo que falta por entregar (ver `tieneDeudaBorrada`);
   *  · la deuda de esta quincena NO puede estar ya cobrada en otra. Ahí la ventana se
   *    cierra y no se abre ni para el Administrador Empresa: el renglón de esa otra hoja
   *    sale de una columna congelada, y mover un peso acá la hace contradecirse sola;
   *  · solo las de LECHE. En la del flete el renglón es (día, ruta) y esos renglones son
   *    la memoria de qué viaje ya se cobró;
   *  · solo 'pagada' o 'parcial'. Lo demás todavía se edita por el camino normal;
   *  · permiso 'administrar', que es el mismo de Anular y de Pagar y que en el sistema
   *    tiene EXACTAMENTE UN ROL: Administrador Empresa. Que es literal lo que se pidió.
   */
  readonly puedeCorregir = computed(
    () => this.corregirAceptaLaFila() && this.auth.hasPermission('liquidaciones', 'administrar'),
  );

  /**
   * LA MITAD DE `puedeCorregir` QUE MIRA LA FILA Y NO A QUIEN MIRA: las cuatro primeras
   * condiciones de arriba. Va aparte para el consejo de quien no tiene el permiso
   * (`usarCorregir`): a Compras el servidor le dice "pídale a un Administrador de la empresa
   * que use 'Corregir esta quincena'" justo cuando esta da sí.
   */
  private readonly corregirAceptaLaFila = computed(
    () =>
      (this.liq().estado === 'pagada' || this.liq().estado === 'parcial') &&
      this.liq().tipo === 'proveedor' &&
      !this.deudaYaCobrada() &&
      !this.tieneDeudaBorrada(),
  );

  /**
   * POR QUÉ NO SE PUEDE CORREGIR, cuando el botón se esperaría y no está.
   *
   * Se explica ÚNICAMENTE sobre una quincena ya cerrada ('pagada' o 'parcial'), que es
   * donde el dueño lo va a buscar. En un borrador o en una aprobada no hay nada que
   * explicar —esas se editan por el camino de siempre— y poner ahí un candado que dice
   * "no se puede corregir" al lado de los campos que SÍ se pueden editar es la clase de
   * aviso que enseña a no leer los avisos. Es el mismo criterio de `motivoNoPagar`.
   *
   * El orden es el del servidor (`_exigir_corregible`): primero la deuda borrada, que es
   * la única sin salida dentro del sistema, y después la deuda congelada, que nombra qué
   * hay que hacer primero. Con las dos marcas, "anule primero esa liquidación" mandaría a
   * anular un comprobante para nada: Corregir volvería a rebotar por la deuda borrada.
   */
  readonly motivoNoCorregir = computed<string | null>(() => {
    const liq = this.liq();
    if (liq.estado !== 'pagada' && liq.estado !== 'parcial') return null;
    if (!this.auth.hasPermission('liquidaciones', 'administrar')) return null;
    if (this.puedeCorregir()) return null;
    if (this.tieneDeudaBorrada()) return this.avisoDeudaBorrada('corregir');
    if (this.deudaYaCobrada()) return this.avisoDeudaCongelada('corregir');
    // Queda el flete. El mensaje es el del backend, con su salida: una liquidación
    // pagada NO reserva sus fechas, así que el día anotado tarde entra en un segundo
    // comprobante del mismo período sin tener que tocar este.
    return (
      'Solo se puede corregir una quincena de leche. Para el flete, genérele un segundo ' +
      `comprobante del período a ${this.tercero()}: una liquidación pagada no reserva sus ` +
      'fechas, así que el día anotado tarde entra ahí.'
    );
  });

  /**
   * Abre el diálogo de corregir y pinta lo que respondió el servidor.
   *
   * La liquidación se reemplaza entera —no solo la cifra que cambió— porque al corregir
   * se mueven a la vez el valor total, el neto, el saldo, el estado y la versión. Y el
   * aviso del recálculo se cierra: su "antes → ahora" dejó de ser el de esta pantalla.
   */
  corregirQuincena(): void {
    this.dialog
      .open(CorregirQuincenaDialog, {
        data: { liquidacion: this.liq() },
        width: '760px',
        maxWidth: '96vw',
      })
      .afterClosed()
      .subscribe((corregida?: Liquidacion) => {
        if (!corregida) return;
        this.cambio.set(null);
        this.liq.set(corregida);
        // El motivo que se acaba de escribir se pide de nuevo: la banda de arriba lo
        // muestra, y hasta acá solo llegó la liquidación.
        this.cargarCorrecciones();
        // "Se le pagó de más" con la pregunta del PDF (`causaDeLaDeuda`), igual que el
        // renglón de cierre: la de $500.000 con $300.000 de anticipo, pagada con $200.000 y
        // corregida a $1.000 el litro, debe $250.000 y el papel dice "LE QUEDA DEBIENDO";
        // de esos, $50.000 son anticipo y no plata entregada de más.
        const rotuloDeLaDeuda =
          causaDeLaDeuda(corregida) === 'entregado_de_mas'
            ? 'Se le pagó de más'
            : 'Le queda debiendo';
        this.snackbar.open(
          Number(corregida.saldo ?? 0) > 0
            ? `Quincena corregida. Queda por entregarle ${this.enPesos(corregida.saldo)}: ` +
                'oprima Pagar cuando le entregue esa plata'
            : Number(corregida.le_queda_debiendo ?? 0) > 0
              ? `Quincena corregida. ${rotuloDeLaDeuda} ` +
                `${this.enPesos(corregida.le_queda_debiendo)}: se le descuenta solo en la ` +
                'quincena siguiente'
              : 'Quincena corregida',
          'OK',
          { duration: 9000 },
        );
      });
  }

  // ------------------------------- la banda del comprobante corregido
  /**
   * LAS CORRECCIONES DE ESTA QUINCENA, o vacío mientras no se hayan pedido.
   *
   * NO viajan dentro de la liquidación a propósito (la relación es diferida en el
   * backend: meterlas en el esquema dispararía una consulta POR FILA al listar una
   * página, para un dato que en casi todas está vacío). Se piden aparte y SOLO cuando
   * `version` es mayor que 1, que es la señal de que hay algo que mostrar.
   */
  readonly correcciones = signal<Correccion[]>([]);

  /** Qué número de hoja es esta. `?? 1` para leer una respuesta vieja sin "vundefined". */
  readonly version = computed(() => Number(this.liq().version ?? 1));

  /** Este comprobante ya se corrigió: hay más de una hoja de la misma quincena. */
  readonly fueCorregida = computed(() => this.version() > 1);

  /**
   * LA BANDA DEL ENCABEZADO: "Corregido el 06/09/2026 · v2 · motivo: …".
   *
   * Va fija arriba y no escondida en una pestaña porque es lo primero que hay que saber
   * de este documento: el productor puede tener DOS hojas de la misma quincena y esta
   * pantalla tiene que decir cuál manda y por qué cambió.
   *
   * Si la versión dice que se corrigió pero el motivo todavía no llegó (o el servidor no
   * lo devolvió), la banda SALE IGUAL sin el motivo: "hay una versión 2" ya es la mitad
   * importante, y callarla mientras carga sería peor.
   */
  readonly bandaDeCorreccion = computed<{
    fecha: string | null;
    motivo: string | null;
    queHacerConElPapel: string;
  } | null>(() => {
    if (!this.fueCorregida()) return null;
    const ultima = this.correcciones()[this.correcciones().length - 1] ?? null;
    return {
      // EN HORA DE COLOMBIA, no la del computador: `created_at` es un instante en UTC
      // y recortarle los diez primeros caracteres mostraba el día de UTC. Una
      // corrección hecha a las 7 de la noche acá cae en el día siguiente allá, así que
      // la banda decía una fecha y el papel —que sí convierte— decía la anterior.
      fecha: ultima ? fechaEnHoraDeColombia(ultima.created_at) : null,
      motivo: ultima?.motivo ?? null,
      // CON LA DEUDA BORRADA, ESTA VERSIÓN TAMPOCO SE ENTREGA. La banda mandaba a
      // "entregarle esta versión" al lado del aviso rojo que pide repararla antes de
      // cualquier otra cosa, y sin los botones de compartir. Medido: la v2 de la de
      // $180.000 contra $300.000, corregida con un día de $50.000, imprime "SALDO A PAGAR
      // $50.000" a un productor que todavía debe $70.000. La pregunta es la de esos
      // botones (`tieneDeudaBorrada`), y la frase no promete ninguna reparación.
      queHacerConElPapel: this.tieneDeudaBorrada()
        ? `El papel que ${this.tercero()} tiene en la mano puede ser el anterior. No le ` +
          'entregue esta versión todavía: primero hay que reparar la quincena (ver el aviso ' +
          'rojo).'
        : `El papel que ${this.tercero()} tiene en la mano puede ser el anterior: entréguele ` +
          'esta versión y recójale la vieja.',
    };
  });

  // ------------------------------- el historial completo de correcciones
  /**
   * EL HISTORIAL VA DESPLEGABLE DEBAJO DE LA BANDA, Y NO EN OTRO DIÁLOGO. Por qué:
   *
   *  · ESTE DETALLE YA ES UNA VENTANA SOBRE OTRA. Se abre desde la lista de quincenas,
   *    que es una pantalla con su propio diálogo encima cuando se corrige. Un tercer
   *    piso de ventanas en una tablet —que es donde el dueño trabaja— tapa la pantalla
   *    entera, se cierra con el botón de atrás sin querer y devuelve al escritorio.
   *  · LAS CIFRAS SE CUADRAN CONTRA LAS DE ABAJO. El renglón dice "lo que hay que
   *    entregarle pasó de $500.000 a $680.000" y esa segunda cifra TIENE que ser la del
   *    resumen que está más abajo en esta misma pantalla. En un diálogo aparte, el
   *    resumen queda tapado justo cuando hay que compararlo.
   *  · Y CERRADO NO CUESTA NADA. La pantalla es densa, y por eso arranca plegado: quien
   *    solo quiere el comprobante ve la banda de siempre, de tres líneas, y quien tiene
   *    al productor enfrente con una hoja vieja en la mano abre la lista de un toque.
   *
   * Lo que se paga a cambio: el historial se desplaza con el contenido (la banda no, que
   * es sticky). Es justo el orden correcto —la advertencia se queda, el detalle se lee—.
   */
  readonly verHistorial = signal(false);

  toggleHistorial(): void {
    this.verHistorial.update((abierto) => !abierto);
  }

  /** Las correcciones traducidas al idioma del dueño. Ver `correcciones-en-palabras`. */
  readonly historial = computed<RenglonDeCorreccion[]>(() =>
    renglonesDeCorrecciones(this.correcciones()),
  );

  /** "una vez" / "3 veces": va acá y no en la plantilla porque "1 veces" se lee como un error. */
  readonly cuantasVeces = computed(() => {
    const cuantas = this.historial().length;
    return cuantas === 1 ? 'una vez' : `${cuantas} veces`;
  });

  /**
   * EL ENLACE DE LA BANDA, con la cuenta adentro: "ver las 3 correcciones".
   *
   * El número va en el rótulo y no escondido adentro porque es la mitad del aviso: si la
   * quincena se corrigió tres veces, el productor puede llegar con cualquiera de las
   * tres hojas, y saber CUÁNTAS hay es lo que le dice al dueño que la que tiene en la
   * mano puede no ser ni la primera ni la última.
   *
   * Con una sola corrección el enlace igual se ofrece —la banda muestra el motivo, pero
   * no QUÉ cambió ni de cuánto a cuánto—, y ahí el rótulo es otro: "ver las 1
   * correcciones" se lee como un error del sistema y le quita confianza a la cifra de al
   * lado. Sin ninguna cargada (todavía, o porque el servidor no respondió) no hay enlace:
   * abriría una lista vacía.
   */
  readonly rotuloHistorial = computed<string | null>(() => {
    const cuantas = this.correcciones().length;
    if (cuantas === 0) return null;
    return cuantas === 1 ? 'ver qué cambió' : `ver las ${cuantas} correcciones`;
  });

  /**
   * EL RÓTULO DEL BOTÓN DE PDF. Con una corrección encima ya no basta con "PDF": lo que
   * el dueño necesita mandar es EL COMPROBANTE CORREGIDO, y el que el productor tiene en
   * la mano es el viejo.
   *
   * Salvo con la deuda borrada: "Descargar comprobante corregido" se lee como "este es el
   * que se manda", y ese papel no se le entrega a nadie hasta repararla (ver la banda).
   * El dueño sí lo puede bajar y mirar.
   */
  readonly rotuloPdf = computed(() => {
    if (!this.fueCorregida()) return 'PDF';
    return this.tieneDeudaBorrada()
      ? 'Descargar PDF (pendiente de reparar)'
      : `Descargar comprobante corregido (v${this.version()})`;
  });

  /** Pide el motivo de la corrección. Solo cuando hay algo que pedir; ver `version`. */
  private cargarCorrecciones(): void {
    if (!this.fueCorregida()) return;
    firstValueFrom(this.servicio.correcciones(this.liq().id))
      .then((lista) => this.correcciones.set(lista ?? []))
      // En silencio: la banda sale igual sin el motivo (ver `bandaDeCorreccion`), y un
      // aviso de error por un texto explicativo taparía el comprobante entero.
      .catch(() => undefined);
  }

  /**
   * PAGAR: no se le paga a quien QUEDÓ DEBIENDO. El servidor lo rebota.
   *
   * Antes el botón aparecía igual —el estado seguía siendo 'aprobada'— y el diálogo de
   * pago abría con el saldo prellenado, que en este caso es una cifra NEGATIVA. El
   * dueño oprimía "Pagar" sobre un comprobante donde no hay nada que entregar.
   *
   * Y ojo con lo que este botón hacía antes de este trabajo: marcaba la liquidación
   * PAGADA sin que saliera un peso, y eso trababa los días de esa quincena en Recepción
   * diaria para siempre. Ahora el backend lo rebota y la quincena se queda en 'aprobada'
   * —que es lo que es— hasta que su deuda se cobre en la siguiente.
   *
   * Tampoco con la deuda borrada por la migración (`_exigir_sin_deuda_borrada` rebota el
   * abono y el /pagar): ese "saldo" trae sumada la deuda que se borró. La quincena de
   * $180.000 contra $300.000 de adelanto, corregida con un día de $50.000, dice "Saldo a
   * pagar $ 50.000" cuando Henri todavía debe $70.000.
   *
   * Ni con la deuda cobrada que ya no cuadra (`avisoDeudaQueNoCuadra`): el servidor rebota
   * el abono y el /pagar en las dos puntas.
   */
  readonly puedePagar = computed(
    () =>
      (this.liq().estado === 'aprobada' || this.liq().estado === 'parcial') &&
      Number(this.liq().saldo ?? 0) > 0 &&
      !this.tieneDeudaBorrada() &&
      !this.avisoDeudaQueNoCuadra() &&
      this.auth.hasPermission('liquidaciones', 'administrar'),
  );

  /**
   * EL TOOLTIP DE PAGAR. "Registrar otro pago" solo si ya hubo uno (`conAbonos`): la
   * parcial v2 sin pagos —$36.000 por entregar después de corregir la que los anticipos
   * cubrían— no tiene ningún pago anterior, y el botón sí se ofrece porque el servidor
   * acepta ese pago.
   */
  readonly tooltipPagar = computed(() => {
    const l = this.liq();
    const queda = `queda debiendo ${this.enPesos(l.saldo)}`;
    if (this.conAbonos()) return `Registrar otro pago: ${queda}`;
    return l.estado === 'parcial'
      ? `Registrar un pago: ${queda}`
      : 'Registrar el pago (puede ser parcial)';
  });

  /**
   * EL SALDO QUEDÓ EXACTO EN CERO: no hay plata por entregar, y nadie quedó debiendo.
   *
   * Es el caso que dejaba una liquidación IMPOSIBLE DE CERRAR. `puedePagar` exigía
   * saldo > 0, así que una quincena de $180.000 con $180.000 de anticipo perdía el botón
   * y se quedaba en 'aprobada' para siempre, con sus días abiertos a que alguien les
   * cambiara las cifras meses después.
   *
   * El `pagar` del backend la acepta cuando el cero lo hicieron los anticipos de ESTA
   * quincena: pasa por su rama de "no hay pago que registrar" y la deja PAGADA. Rebota
   * en dos casos, y en los dos la pantalla no ofrece el botón: si el tercero quedó
   * DEBIENDO, y si el cero lo hizo la deuda arrastrada sin ningún pago
   * (`_no_sale_un_peso_por_la_deuda`; ver `laDeudaViejaCubrioLaQuincena`). Lo que no
   * acepta nunca es un ABONO (`registrar_pago` rebota con saldo <= 0), así que este
   * camino NO pasa por el diálogo de pago —abriría con $0 prellenado y el botón
   * muerto—: va derecho al `POST /pagar`. Ver `cerrarSinPago`.
   */
  readonly saldoEnCero = computed(() => Number(this.liq().saldo ?? 0) === 0);

  /**
   * LA QUINCENA ESTÁ SALDADA Y TODAVÍA ABIERTA: es la situación, sin mirar permisos.
   *
   * El estado importa: TODA liquidación pagada tiene el saldo en cero, y ahí no hay nada
   * que decidir ni que explicar. Lo que este trabajo destrabó es la que quedó en cero
   * SIN cerrarse —'aprobada' (o 'parcial', que el servidor acepta igual)—, que era la que
   * se quedaba abierta para siempre.
   */
  readonly quincenaSaldadaSinCerrar = computed(
    () =>
      (this.liq().estado === 'aprobada' || this.liq().estado === 'parcial') &&
      this.saldoEnCero(),
  );

  /**
   * EL CERO LO HIZO LA DEUDA DE LA QUINCENA PASADA: `POST /pagar` rebota y la quincena se
   * queda 'aprobada' a propósito (`_no_sale_un_peso_por_la_deuda` en el backend).
   *
   * LA RESPUESTA LA DA EL SERVIDOR (`aviso_sin_un_peso_por_la_deuda`): con el campo puesto
   * manda él, también cuando dice null —ese guardia no salta y Pagar no rebota por eso—.
   * Así "Marcar pagada" se esconde exactamente donde el servidor lo rebota, sin copiar sus
   * tres condiciones. Una respuesta vieja no lo trae: ahí se deduce con esas condiciones
   * (`laDeudaViejaSeLlevoElNeto`), como antes.
   */
  readonly laDeudaViejaCubrioLaQuincena = computed(() => {
    const l = this.liq();
    if (l.aviso_sin_un_peso_por_la_deuda !== undefined) {
      return !!comoFrase(l.aviso_sin_un_peso_por_la_deuda);
    }
    return laDeudaViejaSeLlevoElNeto(l);
  });

  /**
   * Cerrar la quincena que no hay que pagar: la misma situación más el permiso de Pagar,
   * y NUNCA cuando el servidor la va a rebotar.
   */
  readonly puedeCerrarSinPago = computed(
    () =>
      this.quincenaSaldadaSinCerrar() &&
      !this.laDeudaViejaCubrioLaQuincena() &&
      !this.tieneDeudaBorrada() &&
      !this.avisoDeudaQueNoCuadra() &&
      this.auth.hasPermission('liquidaciones', 'administrar'),
  );

  /**
   * APROBAR: la pregunta del botón, escrita una vez para el botón y para la ayuda de la
   * línea de estados que dice "apruébala". Es la del `POST /aprobar`: borrador y permiso
   * 'administrar', que Compras y Consulta no tienen (el servidor les responde 403).
   */
  readonly puedeAprobar = computed(
    () =>
      this.liq().estado === 'borrador' &&
      this.auth.hasPermission('liquidaciones', 'administrar'),
  );

  /**
   * LA AYUDA DE LA LÍNEA DE ESTADOS, cuando la de siempre nombraría un botón que no está o
   * afirmaría una plata que no salió.
   *
   * La de 'aprobada' dice "usa Pagar cuando entregues el dinero", y hay tres aprobadas sin
   * ese botón: la que trae la deuda borrada, la que la deuda vieja dejó en cero (no hay
   * botón de ninguna clase) y la que sus propios anticipos dejaron en cero (el botón es
   * "Marcar pagada"). La de 'pagada' dice "El pago quedó registrado" y la de 'parcial' "Se
   * le abonó una parte", y hay pagadas y parciales sin un solo pago (ver `cerradaSinPago`
   * y `conAbonos`). Null = la del estado.
   *
   * Y CON EL PERMISO DE QUIEN MIRA. "usa Pagar", "usa Marcar pagada" y "apruébala" nombran
   * botones que solo tiene 'administrar': Compras y Consulta abren este detalle, no los
   * ven, y el servidor les rebota /pagar, /pagos y /aprobar con 403. Medido con Compras en
   * la aprobada de $180.000: la ayuda decía "usa Pagar" y el candado de Recalcular, en el
   * mismo diálogo, "pídale a un Administrador de la empresa que la anule". Por eso cada
   * botón se nombra con la MISMA señal que lo pone (`puedePagar`, `puedeCerrarSinPago`,
   * `puedeAprobar`), y sin ella se dice quién lo hace. Lo que se afirma de la plata ("sin
   * ningún abono registrado", "Se le abonó una parte", "no hay plata por entregar") es igual
   * para todos: solo cambia la parte que nombra el botón. Para el Administrador no cambia
   * nada: donde tiene el botón, la ayuda es la de siempre.
   *
   * Solo donde la línea de estados muestra la ayuda de ese estado (`estadoComoSeLee`): la
   * de "pagada · quedó debiendo" ya dice lo cierto y no se pisa.
   */
  readonly ayudaDelEstado = computed<string | null>(() => {
    const l = this.liq();
    if (l.estado === 'anulada') return null;
    if (this.tieneDeudaBorrada()) {
      return (
        'Esta quincena trae una deuda borrada de antes de los abonos: hay que repararla ' +
        'antes de pagarla o corregirla.'
      );
    }
    // La deuda cobrada que ya no cuadra: ni Pagar ni "Marcar pagada" están (el servidor los
    // rebota), y "usa Pagar" o "un Administrador registra el pago" mandarían a un botón que
    // rebota también para él. El porqué completo es el del candado de Pagar.
    if (this.avisoDeudaQueNoCuadra() && (l.estado === 'aprobada' || l.estado === 'parcial')) {
      return (
        'Los comprobantes de esta deuda ya no cuadran entre sí: hay que revisarlos antes de ' +
        'entregarle plata.'
      );
    }
    if (l.estado === 'pagada' && estadoComoSeLee(l) === 'pagada') return this.cerradaSinPago();
    // EL BORRADOR: "apruébala" solo con el botón Aprobar delante.
    if (l.estado === 'borrador') {
      return this.puedeAprobar()
        ? null
        : 'Falta revisar los valores y que un Administrador de la empresa la apruebe para ' +
            'poder pagarla.';
    }
    const comoSeLee = estadoComoSeLee(l);
    const conSaldo = Number(l.saldo ?? 0) > 0;
    // Con saldo por entregar y sin la deuda borrada (ya descartada arriba), el único "no"
    // de Pagar es el permiso: ahí se dice quién registra el pago.
    const queHacerConElSaldo = this.puedePagar()
      ? 'usa "Pagar" cuando entregues el dinero.'
      : 'el pago lo registra un Administrador de la empresa cuando se entregue el dinero.';
    // LA PARCIAL SIN UN SOLO ABONO: la v2 de la quincena que sus anticipos cubrían exacto
    // ($180.000 contra $180.000), corregida con un día olvidado de 20 L, queda 'parcial'
    // con pagado $0 y $36.000 por entregar. "Se le abonó una parte" manda al dueño a buscar
    // un abono que no existe. El servidor acepta ese pago, así que a quien tiene el botón
    // se le nombra.
    if (l.estado === 'parcial' && comoSeLee === 'parcial' && conSaldo && !this.conAbonos()) {
      const quedo = this.fueCorregida()
        ? 'Se corrigió y quedó un saldo por entregar'
        : 'Quedó un saldo por entregar';
      return `${quedo}, sin ningún abono registrado: ${queHacerConElSaldo}`;
    }
    // La parcial con abonos y la aprobada con saldo: con el botón, la ayuda de siempre.
    if (l.estado === 'parcial' && comoSeLee === 'parcial' && conSaldo && !this.puedePagar()) {
      return (
        'Se le abonó una parte y todavía queda debiendo: el pago del resto lo registra un ' +
        'Administrador de la empresa.'
      );
    }
    if (l.estado === 'aprobada' && comoSeLee === 'aprobada' && conSaldo && !this.puedePagar()) {
      return `Los valores quedaron en firme: ${queHacerConElSaldo}`;
    }
    if (!this.quincenaSaldadaSinCerrar()) return null;
    if (this.laDeudaViejaCubrioLaQuincena()) {
      return (
        'Los valores quedaron en firme y no queda un peso por entregarle: no hay que ' +
        'pagarla ni marcarla pagada.'
      );
    }
    return this.puedeCerrarSinPago()
      ? 'Los valores quedaron en firme y no hay plata por entregar: usa "Marcar pagada" ' +
          'para cerrarla.'
      : 'Los valores quedaron en firme y no hay plata por entregar: un Administrador de la ' +
          'empresa la marca pagada para cerrarla.';
  });

  /**
   * POR QUÉ ESTA 'pagada' QUEDÓ CERRADA SIN QUE SE REGISTRARA UN PAGO, o null si se pagó.
   *
   * Lo dice el servidor (`cerrada_sin_pago`), con la misma frase que dan sus días y sus
   * anticipos trabados: es su pregunta (`pagada_sin_que_saliera_un_peso`), y copiarla acá
   * sería darle a la línea de estados la oportunidad de contradecir al día de Recepción.
   * Medido: la quincena 2 de Henri vale $200.000, cobra los $120.000 de la 1 y se le pagan
   * los $80.000 del neto; se corrige el precio a $1.200 (valor $120.000) y se borra el
   * pago. Queda pagada v2 con pagado $0 y sin pagos, y la línea decía "El pago quedó
   * registrado" sobre una tabla de pagos vacía.
   *
   * Una respuesta vieja no trae el campo: ahí se usa la pregunta de los botones
   * (`laDeudaViejaSeLlevoElNeto`) y se nombran los renglones que hicieron el cero, que con
   * la calculadora suman el valor total. Sin "sin que saliera un peso": si hubo un adelanto,
   * ese sí salió en la mano.
   */
  readonly cerradaSinPago = computed<string | null>(() => {
    const l = this.liq();
    if (l.estado !== 'pagada') return null;
    // Con el campo puesto manda el servidor, también cuando dice null: esa es la pagada que
    // de verdad se pagó (o que sus anticipos cubrieron), y ahí "El pago quedó registrado"
    // es cierto.
    if (l.cerrada_sin_pago !== undefined) return comoFrase(l.cerrada_sin_pago);
    if (this.tienePagos() || !this.saldoEnCero() || !this.laDeudaViejaCubrioLaQuincena()) {
      return null;
    }
    const cubre = this.queCubreElValor();
    return cubre ? `Quedó cerrada como pagada sin ningún pago registrado: ${cubre}.` : null;
  });

  /**
   * POR QUÉ ESTA QUINCENA NO HAY QUE PAGARLA, nombrando TODO lo que hizo el cero.
   *
   * El texto viejo decía siempre "los anticipos ya entregados cubren exactamente la
   * quincena", y eso ERA MENTIRA cuando el cero lo hacía la deuda arrastrada: en una
   * quincena de $144.482 con $139.526,23 de anticipo y $4.955,77 de deuda vieja, el
   * dueño leía que los anticipos la cubrían, iba a buscarlos y le faltaban casi cinco
   * mil pesos. La frase se arma con los renglones que DE VERDAD suman el valor total
   * —los mismos del resumen y del PDF, en el mismo orden—, así que siempre cuadra.
   */
  readonly explicacionSaldoEnCero = computed<string | null>(() => {
    // Con la deuda borrada el cero es falso: "los anticipos ($300.000) cubren EXACTO el
    // valor total ($230.000)" no cuadra con nada. Lo explica el aviso de arriba.
    if (!this.quincenaSaldadaSinCerrar() || this.tieneDeudaBorrada()) return null;
    const l = this.liq();
    const cubre = this.queCubreElValor();
    if (!cubre) {
      return (
        `No hay nada que entregarle a ${this.tercero()}: el valor total de esta quincena ` +
        `es ${this.enPesos(l.valor_total)}.`
      );
    }
    return (
      `No hay nada que entregarle a ${this.tercero()}: ${cubre}, así que el saldo quedó en ` +
      `${this.enPesos('0')}.`
    );
  });

  /**
   * "los anticipos aplicados ($ 80.000) y lo que ya venía debiendo de antes ($ 120.000)
   * cubren EXACTO el valor total de la quincena ($ 200.000)": los renglones que hicieron
   * el cero, en el orden del resumen. Null si no hay ninguno (la quincena vale $0).
   */
  private queCubreElValor(): string | null {
    const l = this.liq();
    const partes: string[] = [];
    if (Number(l.anticipos ?? 0) > 0) {
      partes.push(`los anticipos aplicados (${this.enPesos(l.anticipos)})`);
    }
    if (this.cobraSaldoAnterior()) {
      partes.push(`lo que ya venía debiendo de antes (${this.enPesos(l.saldo_anterior)})`);
    }
    if (this.tienePagos()) partes.push(`lo que ya se le pagó (${this.enPesos(l.pagado)})`);
    if (partes.length === 0) return null;
    const cuenta =
      partes.length === 1
        ? partes[0]
        : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
    // El verbo concuerda con lo que se está nombrando, no con cuántas cosas son: "los
    // anticipos aplicados … CUBREN" aunque sean el único renglón, y "lo que ya venía
    // debiendo … CUBRE". Una concordancia mala en la pantalla del dueño se lee como
    // descuido, y esta frase habla de plata que no se le entregó a nadie.
    const plural = partes.length > 1 || Number(l.anticipos ?? 0) > 0;
    return (
      `${cuenta} ${plural ? 'cubren' : 'cubre'} EXACTO el valor total de la quincena ` +
      `(${this.enPesos(l.valor_total)})`
    );
  }

  /**
   * LA NOTA DEL CERO QUE SE PINTA debajo del resumen.
   *
   * Cuando el cero lo hizo la deuda arrastrada no hay "Marcar pagada" (el servidor la
   * rebota), y sin decirlo el dueño se queda buscando cómo cerrarla. Se le dice que se
   * queda aprobada, y nada más: el PORQUÉ es el del servidor y lo dice el candado de
   * Pagar (`motivoNoPagar`) con sus palabras. Esta nota decía su propia razón —"marcarla
   * pagada trabaría sus días con un aviso que no es cierto"— y ya no lo era: medido con la
   * de $170.000 − $50.000 de adelanto − $120.000 de deuda, si quedara 'pagada' su día
   * diría "los anticipos ($50.000) y lo que quedó debiendo ($120.000) cubrieron exacto su
   * valor ($170.000)", que es cierto. Pegarle aquí la frase del servidor repetiría la cifra
   * de la deuda con otro formato y otro nombre al lado de la cuenta de esta misma nota.
   */
  readonly notaSaldoEnCero = computed<string | null>(() => {
    const explicacion = this.explicacionSaldoEnCero();
    if (!explicacion || !this.laDeudaViejaCubrioLaQuincena()) return explicacion;
    // "Se queda aprobada" solo sobre una aprobada: con otro estado sería falso.
    if (this.liq().estado !== 'aprobada') return explicacion;
    if (this.liq().aviso_sin_un_peso_por_la_deuda !== undefined) {
      return `${explicacion} Se queda aprobada.`;
    }
    // Una respuesta vieja no trae la frase del servidor: la razón va acá, la misma para la
    // nota y para el candado, y sin afirmar nada del aviso de los días. Lo cierto es la
    // regla, dicha como la dice el servidor: cuando lo que venía debiendo de antes se llevó
    // lo que faltaba del neto, no sale un peso y la quincena no se marca pagada. "Lo que
    // faltaba" y no "el neto": en la de $170.000 el adelanto de $50.000 sí salió.
    return (
      `${explicacion} Se queda aprobada: no queda un peso por entregarle, y cuando lo que ` +
      'venía debiendo de antes se lleva lo que faltaba del neto, el sistema no la marca ' +
      'pagada.'
    );
  });

  /** Por qué no se puede pagar, cuando el botón se esperaría y no está. */
  readonly motivoNoPagar = computed(() => {
    const liq = this.liq();
    if (this.puedePagar() || this.puedeCerrarSinPago()) return null;
    if (!this.auth.hasPermission('liquidaciones', 'administrar')) return null;
    if (liq.estado !== 'aprobada' && liq.estado !== 'parcial') return null;
    // Antes que todo, igual que en el `pagar` del backend: con la deuda borrada el saldo
    // que se pagaría trae esa deuda sumada.
    if (this.tieneDeudaBorrada()) return this.avisoDeudaBorrada('pagar');
    // Después, como en el `pagar` del servidor, la deuda cobrada que ya no cuadra: va antes
    // de "quedó debiendo", que en la que cobró hablaría de una deuda que la otra ya no tiene.
    const descuadre = this.avisoDeudaQueNoCuadra();
    if (descuadre) return descuadre;
    if (this.leQuedaDebiendo()) {
      const cierre = this.deudaYaCobrada()
        ? 'Esa deuda ya se le cobró en otra liquidación.'
        : 'Esa deuda se le cobra en la próxima quincena que se le liquide.';
      // LA CAUSA NO ES SIEMPRE LA MISMA, y hasta este trabajo esta frase solo sabía
      // nombrar una. Con un sobrepago por corrección —se le entregaron $500.000 y la
      // quincena corregida quedó en $400.000— decir "los anticipos suman más que esta
      // quincena" es literalmente falso: no hubo anticipos, hubo plata entregada de más,
      // y el dueño se va a ir a buscar unos anticipos que no existen.
      const porque =
        causaDeLaDeuda(liq) === 'anticipos'
          ? 'porque los anticipos que se le entregaron suman más que esta quincena'
          : `porque ${porQueSeLePagoDeMas(liq, (monto) => this.enPesos(monto))}`;
      return (
        `No hay nada que pagarle: ${this.tercero()} quedó debiendo ` +
        `${this.enPesos(liq.le_queda_debiendo)} ${porque}. ${cierre}`
      );
    }
    // El cero que hizo la deuda arrastrada: no hay botón, y el candado dice por qué con el
    // texto del 422 de Pagar (`aviso_sin_un_peso_por_la_deuda`), tal cual. Una respuesta
    // vieja no lo trae: ahí va la nota, que lleva la razón escrita acá.
    if (this.quincenaSaldadaSinCerrar() && this.laDeudaViejaCubrioLaQuincena()) {
      return this.liq().aviso_sin_un_peso_por_la_deuda || this.notaSaldoEnCero();
    }
    // No queda otro caso: con saldo en cero hay botón (ver `puedeCerrarSinPago`) y con
    // saldo por pagar también. Se devuelve null en vez de un texto de relleno, que dejaría
    // a la pantalla diciendo "no hay nada que pagar" al lado de un botón para cerrarla.
    return null;
  });

  /**
   * El rótulo del candado de Pagar. "No hay nada que pagar" sería falso al lado de un
   * "Saldo a pagar $ 50.000" de la quincena con la deuda borrada: ahí es que no se puede.
   */
  readonly rotuloNoPagar = computed(() =>
    this.tieneDeudaBorrada() || this.avisoDeudaQueNoCuadra()
      ? 'No se puede pagar'
      : 'No hay nada que pagar',
  );

  /** El tooltip del botón dice para qué sirve y, si aplica, lo que va a costar. */
  readonly tooltipRecalcular = computed(() => {
    const liq = this.liq();
    const base =
      liq.tipo === 'transportador'
        ? 'Vuelve a calcular el flete con las tarifas de hoy del transportador y los anticipos pendientes'
        : 'Vuelve a cuadrar la liquidación con los precios y los anticipos de hoy';
    return liq.estado === 'aprobada' ? `${base}. Está aprobada: volverá a borrador` : base;
  });

  /** Lo que movió el último recálculo, o null si no se ha recalculado (o ya se cerró). */
  readonly cambio = signal<CambioDelRecalculo | null>(null);

  cerrarCambio(): void {
    this.cambio.set(null);
  }

  /**
   * Recalcula y DICE CUÁNTO CAMBIÓ.
   *
   * El total de antes se toma de lo que está en pantalla —que es lo que el dueño
   * está mirando— antes de llamar al servidor, así que no hace falta que la API
   * devuelva nada extra. Antes esto avisaba "quedaron aplicados los anticipos
   * pendientes" siempre, aunque no hubiera cambiado un peso: el dueño oprimía y
   * se quedaba sin saber si su corrección de la tarifa había entrado.
   */
  async recalcular(): Promise<void> {
    const antes = this.liq();
    // Se pregunta ANTES de oprimir, no después: recalcular una APROBADA la devuelve
    // a borrador y hay que volver a darle el visto bueno; enterarse cuando ya se ve
    // el chip en "borrador" es enterarse tarde.
    //
    // Hoy el servidor no acepta la aprobada (ver ESTADOS_QUE_ACEPTAN_RECALCULO), así
    // que el botón no se ofrece ahí y por aquí no pasa nadie. El guardia se queda
    // puesto —y probado— porque es la mitad de la pantalla que le falta a ese
    // cambio: sin él, el día que el backend la acepte, la liquidación aprobada del
    // dueño amanecería en borrador sin que nadie le hubiera avisado.
    if (antes.estado === 'aprobada' && !(await this.confirmarVolverABorrador())) return;

    this.procesando.set(true);
    try {
      const despues = await firstValueFrom(this.servicio.recalcular(antes.id));
      // Lo que se pinta es SIEMPRE lo que respondió el servidor, y la comparación
      // se hace contra lo que estaba en pantalla: las dos cifras del aviso son
      // reales, ninguna se calcula aquí.
      this.liq.set(despues);
      const cambio = this.compararCifras(antes, despues);
      this.cambio.set(cambio);
      this.snackbar.open(cambio.aviso ? `${cambio.titulo}. ${cambio.aviso}` : cambio.titulo, 'OK', {
        duration: 9000,
      });
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible recalcular la liquidación');
    } finally {
      this.procesando.set(false);
    }
  }

  /** Le avisa que la aprobada va a volver a borrador. Cerrar sin confirmar = no. */
  private async confirmarVolverABorrador(): Promise<boolean> {
    const liq = this.liq();
    const conQue =
      liq.tipo === 'transportador'
        ? 'las tarifas de hoy del transportador y los anticipos registrados'
        : 'los precios y los anticipos registrados hoy';
    const confirmado = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            titulo: 'Esta liquidación está aprobada',
            mensaje:
              `Recalcular vuelve a calcular las cifras de ${this.tercero()} con ${conQue}. ` +
              'Como ya está aprobada, VOLVERÁ A BORRADOR y tendrá que revisarla y aprobarla ' +
              'otra vez. Todavía no se le ha pagado nada, así que no se mueve plata entregada.',
            accion: 'Recalcular',
            // Explícito: el mensaje dice "borrador" y el detector de verbos
            // destructivos del diálogo lo tomaría por "borrar" y lo pintaría de
            // rojo. Recalcular no borra nada.
            peligro: false,
          },
        })
        .afterClosed(),
    );
    return confirmado === true;
  }

  /**
   * Las cifras del resumen que se comparan, en el orden en que se leen.
   *
   * En la del TRANSPORTADOR el flete va primero porque es su cifra —y la del caso
   * real: una tarifa mal tecleada—, y por eso encabeza el aviso. Ahí el valor
   * total ES el flete, así que no se repite como renglón aparte: dos veces la
   * misma plata con dos rótulos distintos se lee como un descuadre.
   */
  private renglonesComparables(tipo: Liquidacion['tipo']): RenglonComparable[] {
    const litros: RenglonComparable = {
      etiqueta: 'Total litros',
      frase: 'Los litros pasaron',
      leer: (liq) => liq.total_litros,
      litros: true,
    };
    const anticipos: RenglonComparable = {
      etiqueta: 'Anticipos aplicados',
      frase: 'Los anticipos aplicados pasaron',
      leer: (liq) => liq.anticipos,
    };
    /*
     * EL SALDO ANTERIOR NO LO RECALCULA NADIE: no sale de las recepciones, es plata que
     * se arrastra de una quincena pasada y ya quedó cobrada acá. Se compara igual, y a
     * propósito: si algún día se moviera, el dueño tiene que verlo en la cara —es un
     * descuento sobre su comprobante—, no descubrirlo cuadrando el papel a mano. Si no se
     * mueve (lo normal), el renglón no aparece en el aviso.
     */
    const saldoAnterior: RenglonComparable = {
      etiqueta: ROTULO_SALDO_ANTERIOR,
      frase: 'Lo que quedó debiendo de la quincena pasada pasó',
      leer: (liq) => liq.saldo_anterior ?? '0',
    };
    const saldo: RenglonComparable = {
      etiqueta: 'Saldo a pagar',
      frase: 'El saldo a pagar pasó',
      leer: (liq) => liq.saldo,
    };
    if (tipo === 'transportador') {
      return [
        {
          etiqueta: 'Valor transporte',
          frase: 'El flete pasó',
          leer: (liq) => liq.valor_transporte,
        },
        litros,
        anticipos,
        saldoAnterior,
        saldo,
      ];
    }
    return [
      { etiqueta: 'Valor bruto', frase: 'El valor bruto pasó', leer: (liq) => liq.valor_bruto },
      litros,
      {
        // El rótulo es el de la NOTA de abajo y no "Valor transporte", que era el del
        // renglón que este trabajo le quitó al resumen del proveedor: a él el flete no
        // se le descuenta, y el aviso no puede nombrar un renglón que ya no está.
        etiqueta: 'Flete de esta leche',
        frase: 'El flete de esta leche pasó',
        leer: (liq) => liq.valor_transporte,
      },
      anticipos,
      { etiqueta: 'Valor total', frase: 'El valor total pasó', leer: (liq) => liq.valor_total },
      saldoAnterior,
      saldo,
    ];
  }

  /**
   * Una cifra en CENTAVOS ENTEROS, para comparar.
   *
   * En centavos y no restando decimales porque la coma flotante se desvía por
   * fracciones de centavo y ahí saldrían cambios que no existen: "$ 44.506,32
   * pasó a $ 44.506,32". Los litros entran igual (la base los guarda con dos
   * decimales), y el nombre queda cojo pero la cuenta es la misma.
   */
  private enCentavos(valor: Monto | null | undefined): number {
    return Math.round(Number(valor ?? 0) * 100);
  }

  /**
   * ¿Cambiaron los RENGLONES aunque los totales hayan quedado iguales?
   *
   * Pasa de verdad: el reparto de centavos entre las recepciones de un día se
   * puede mover sin que el total del comprobante cambie, y un día que traía un
   * solo renglón puede quedar partido en dos rutas. Decirle "no cambió nada" con
   * el desglose distinto sería mentira, y el desglose es lo que él suma a mano.
   */
  private desgloseCambio(antes: Liquidacion, despues: Liquidacion): boolean {
    const firma = (liq: Liquidacion): string =>
      liq.detalles
        .map((detalle) =>
          [
            detalle.fecha,
            detalle.ruta_nombre ?? '',
            // EL MODO ENTRA EN LA FIRMA: recalcular vuelve a clasificar los días, así
            // que un día que salía en dos líneas por litro puede quedar en UNA que dice
            // "Día completo". El papel cambia de forma aunque la plata quede igual, y
            // decirle al dueño "no cambió nada" con el desglose distinto es mentirle.
            detalle.modo_transporte ?? '',
            // Normalizado a centavos: "82" y "82.00" son la misma cifra y no
            // pueden contar como un renglón que cambió.
            this.enCentavos(detalle.litros),
            this.enCentavos(detalle.precio_litro),
            this.enCentavos(detalle.valor),
          ].join('|'),
        )
        .join('\n');
    return firma(antes) !== firma(despues);
  }

  private compararCifras(antes: Liquidacion, despues: Liquidacion): CambioDelRecalculo {
    const filas: CambioDeCifra[] = [];
    let titulo = '';
    for (const renglon of this.renglonesComparables(despues.tipo)) {
      const cifraAntes = renglon.leer(antes);
      const cifraDespues = renglon.leer(despues);
      if (this.enCentavos(cifraAntes) === this.enCentavos(cifraDespues)) continue;
      const como = (valor: Monto): string =>
        renglon.litros ? this.enLitros(valor) : this.enPesos(valor);
      filas.push({
        etiqueta: renglon.etiqueta,
        antes: como(cifraAntes),
        despues: como(cifraDespues),
      });
      // La primera cifra que cambió encabeza el aviso; las demás quedan en la
      // tabla. Por eso el orden de `renglonesComparables` no es casual.
      if (!titulo) titulo = `${renglon.frase} de ${como(cifraAntes)} a ${como(cifraDespues)}`;
    }

    if (filas.length === 0) {
      titulo = this.desgloseCambio(antes, despues)
        ? 'Recalculado: se reorganizó el desglose y las cifras grandes quedaron iguales'
        : 'Recalculado: las cifras ya estaban al día, no cambió nada';
    }

    return {
      titulo,
      filas,
      aviso:
        antes.estado === 'aprobada' && despues.estado === 'borrador'
          ? 'Volvió a borrador: revísela y apruébela otra vez.'
          : null,
    };
  }

  aprobar(): void {
    void this.ejecutar(() => this.servicio.aprobar(this.liq().id), 'Liquidación aprobada');
  }

  /**
   * Abre el diálogo de pago con el saldo pendiente prellenado.
   *
   * Antes este botón pagaba todo de un golpe sin preguntar. Ahora pasa por el
   * diálogo porque el dueño lo pidió así: "a un proveedor se le puede pagar y
   * quedar debiendo otra parte". Pagar completo sigue siendo un Enter.
   */
  pagar(): void {
    this.dialog
      .open(PagoLiquidacionFormDialog, {
        data: { id: this.liq().id, tercero: this.tercero(), saldo: this.liq().saldo },
        width: '520px',
      })
      .afterClosed()
      .subscribe((actualizada?: Liquidacion) => {
        if (!actualizada) return;
        // Lo que se pinta es SIEMPRE lo que respondió el servidor, nunca una
        // cifra calculada aquí: si algo salió distinto, se ve lo que de verdad
        // quedó guardado. (La lista se recarga sola al cerrar este diálogo.)
        this.liq.set(actualizada);
        this.snackbar.open(
          actualizada.estado === 'pagada'
            ? 'Pago registrado: la liquidación queda pagada'
            : `Pago registrado. Queda debiendo ${this.enPesos(actualizada.saldo)}`,
          'OK',
          { duration: 5000 },
        );
      });
  }

  /**
   * El tooltip del botón que cierra la quincena sin plata: por qué, y qué va a pasar.
   *
   * Las dos mitades importan. El "por qué" sale de `explicacionSaldoEnCero`, que nombra
   * los renglones que hicieron el cero (y no solo los anticipos, que era la mentira). El
   * "qué va a pasar" es que los días quedan trabados: es la consecuencia que el dueño
   * reclamó por los dos lados —"un día no debería quedar trabado si no salió plata", pero
   * "tampoco se puede dejar una quincena cerrada abierta a que le cambien las cifras"—.
   */
  readonly tooltipCerrarSinPago = computed(
    () =>
      `${this.explicacionSaldoEnCero() ?? ''} Márquela pagada para cerrarla: queda en el ` +
      'historial y sus días dejan de poder corregirse.',
  );

  /**
   * CIERRA LA QUINCENA QUE NO HAY QUE PAGAR: la marca pagada sin registrar ningún pago.
   *
   * NO PASA POR EL DIÁLOGO DE PAGO a propósito. Ese diálogo registra un abono y el
   * servidor rebota los abonos cuando el saldo no es positivo; además abriría con $0
   * prellenado, un formulario inválido y el botón muerto: un callejón sin salida. Este
   * camino es el `POST /pagar` (el `pagar` del backend), que con el saldo en cero pasa por
   * su rama de "no hay pago que registrar" y la deja PAGADA. Si el cero lo hizo la deuda
   * arrastrada lo rebota (`_no_sale_un_peso_por_la_deuda`), y por eso ahí el botón que
   * llega hasta acá no se ofrece: ver `puedeCerrarSinPago`.
   *
   * Se pregunta ANTES porque cerrarla traba los días de la quincena en Recepción diaria y
   * de 'pagada' no se puede anular: enterarse después es enterarse tarde.
   */
  async cerrarSinPago(): Promise<void> {
    const confirmado = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            titulo: 'Esta quincena no hay que pagarla',
            mensaje:
              `${this.explicacionSaldoEnCero()} Marcarla PAGADA la cierra sin registrar ` +
              'ningún pago —por acá no sale plata— y desde ese momento sus días ya no se ' +
              'pueden corregir en Recepción diaria. Si todavía hay algo por revisar, ' +
              'déjela aprobada.',
            accion: 'Marcar pagada',
            // Explícito: cerrar una quincena saldada no destruye nada, y el rojo del
            // diálogo está reservado para lo que borra o anula datos.
            peligro: false,
          },
        })
        .afterClosed(),
    );
    if (confirmado !== true) return;
    await this.ejecutar(
      () => this.servicio.pagar(this.liq().id),
      'Liquidación cerrada: quedó pagada y no había plata por entregar',
    );
  }

  // ------------------------------- soportes del pago (la foto de la transferencia)
  /** Cuántas fotos tiene el pago. Con `?? 0` porque una respuesta vieja no trae el campo. */
  cuantosSoportes(pago: PagoLiquidacion): number {
    return pago.adjuntos_count ?? 0;
  }

  /**
   * Lo que dice el clip, en singular o en plural y diciendo qué va a pasar al tocarlo.
   *
   * "Ver los 1 soportes" es la clase de frase que hace que el dueño deje de leer los
   * avisos del sistema, y el pago sin foto necesita que el clip lo INVITE a anexarla:
   * si dijera "Ver soportes (0)" parecería un botón muerto.
   */
  rotuloSoportes(pago: PagoLiquidacion): string {
    const cuantos = this.cuantosSoportes(pago);
    if (cuantos === 0) return 'Anexar la foto de la transferencia de este pago';
    if (cuantos === 1) return 'Ver el soporte de este pago (1 archivo)';
    return `Ver los soportes de este pago (${cuantos} archivos)`;
  }

  /**
   * Abre LA MISMA pantalla de soportes que usa reventa, apuntada a ESTE pago.
   *
   * Los permisos son los de liquidaciones y no los de reventa: acá anexar pide
   * 'administrar' —el mismo permiso que registrar el pago, para que quien no puede
   * entregar la plata tampoco cuelgue el comprobante de haberla entregado—, mientras
   * que allá pide 'crear'. Los eligió así el backend y la pantalla no puede ofrecer
   * un botón que el servidor va a rebotar.
   */
  soportesDelPago(pago: PagoLiquidacion): void {
    const id = this.liq().id;
    this.dialog
      .open(SoportesDialog, {
        data: {
          // `comoFecha` y no el DatePipe: es el mismo "dd/MM/yyyy" que pinta la
          // columna Fecha de la fila que se acaba de tocar, y el dueño tiene que
          // reconocer en el título el pago que abrió.
          titulo: `Pago del ${comoFecha(pago.fecha)} · ${this.enPesos(pago.valor)}`,
          ayuda:
            `Estas fotos quedan pegadas a este pago —${this.tercero()}, quincena del ` +
            `${periodoDe(this.liq())}—, no a la liquidación entera.`,
          permisos: {
            subir: 'liquidaciones:administrar',
            compartir: 'liquidaciones:exportar',
            eliminar: 'liquidaciones:eliminar',
          },
          listar: () => this.servicio.adjuntosDePago(id, pago.id),
          subir: (archivos: File[]) => this.servicio.subirAdjuntosDePago(id, pago.id, archivos),
          compartir: (adjuntoId: string) => this.servicio.compartirAdjuntoDePago(adjuntoId),
          eliminar: (adjuntoId: string) => this.servicio.eliminarAdjuntoDePago(adjuntoId),
        },
        width: '720px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((resultado?: SoportesResultado) => {
        if (!resultado?.cambiado) return;
        this.ponerCuantosSoportes(pago.id, resultado.cuantos);
      });
  }

  /**
   * Refresca el número del clip sin volver a pedir la liquidación entera.
   *
   * El número lo trae el propio diálogo, que acaba de contar los archivos que hay: ir
   * a buscarlo al servidor sería una vuelta completa por un dato que ya está en la
   * mano, y mientras tanto el clip mostraría el número viejo. Se rehace el arreglo de
   * pagos en vez de mutarlo porque `liq` es una señal y solo repinta si cambia la
   * referencia; las CIFRAS del pago no se tocan —anexar una foto no mueve un peso—.
   */
  private ponerCuantosSoportes(pagoId: string, cuantos: number): void {
    this.liq.update((liq) => ({
      ...liq,
      pagos: liq.pagos.map((p) => (p.id === pagoId ? { ...p, adjuntos_count: cuantos } : p)),
    }));
  }

  /** La media frase que avisa de las fotos que se van con el pago. Vacía si no hay. */
  private avisoSoportesQueSeVan(pago: PagoLiquidacion): string {
    const cuantos = this.cuantosSoportes(pago);
    if (cuantos === 0) return '';
    return cuantos === 1
      ? ' Se borra también su soporte (la foto de la transferencia).'
      : ` Se borran también sus ${cuantos} soportes (las fotos de la transferencia).`;
  }

  /**
   * Elimina un pago mal registrado. El backend baja el `pagado`, devuelve el
   * saldo y recalcula el estado (de pagada a parcial, o de parcial a aprobada).
   *
   * Se lleva por delante SUS SOPORTES, también del almacenamiento: la foto de una
   * transferencia que ya no existe no se queda ocupando espacio.
   */
  eliminarPago(pago: PagoLiquidacion): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar pago',
          // SE VAN TAMBIÉN SUS SOPORTES, y hay que decirlo ANTES. El backend borra la
          // foto de la transferencia junto con el pago —y del almacenamiento, no solo
          // de la lista—: enterarse después es haber perdido la única prueba de una
          // entrega de plata. Solo se dice cuando de verdad hay alguno.
          mensaje:
            `¿Eliminar el pago de ${this.enPesos(pago.valor)}? El saldo volverá a subir ` +
            `por ese valor.${this.avisoSoportesQueSeVan(pago)} Esta acción no se puede ` +
            'deshacer.',
          accion: 'Eliminar',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => this.servicio.eliminarPago(this.liq().id, pago.id),
          'Pago eliminado: el saldo quedó al día',
        );
      });
  }

  /**
   * La misma cifra que pinta la tabla, para los textos que no pasan por la
   * plantilla (avisos y confirmaciones).
   *
   * Antes iba con `toLocaleString()` a secas, que deja "1.250,5" y hasta tres
   * decimales: el aviso decía una cifra y el resumen de al lado otra.
   */
  private enPesos(monto: unknown): string {
    return pesosExactos(monto as Monto);
  }

  /**
   * Los litros como los pinta la tabla: dos decimales y la unidad.
   *
   * Es el mismo pipe de la plantilla, instanciado una sola vez, para que el aviso
   * del recálculo y el resumen de WhatsApp no puedan decir "82 L" donde la
   * columna dice "81,99 L".
   */
  private readonly litrosPipe = new CantidadPipe();

  private enLitros(monto: unknown): string {
    return this.litrosPipe.transform(monto as Monto, 'L', 2);
  }

  anular(): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Anular liquidación',
          mensaje:
            '¿Anular esta liquidación? Las recepciones y anticipos del período quedarán disponibles para volver a liquidar.',
          accion: 'Anular',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(() => this.servicio.anular(this.liq().id), 'Liquidación anulada');
      });
  }

  async descargarPdf(): Promise<void> {
    this.descargando.set(true);
    try {
      await firstValueFrom(this.servicio.descargarPdf(this.liq().id));
    } catch (err) {
      // Con `catch {` se perdía el mensaje que el interceptor sí había generado
      // ("Sin conexión…", "El servidor tardó demasiado…") y quedaba un texto fijo
      // que no dice qué pasó ni qué hacer.
      this.snackbar.open(detalleDeError(err, 'No fue posible descargar el PDF'), 'OK', {
        duration: 5000,
      });
    } finally {
      this.descargando.set(false);
    }
  }

  async compartir(): Promise<void> {
    this.compartiendo.set(true);
    try {
      const blob = await firstValueFrom(this.servicio.pdfBlob(this.liq().id));
      const nombre = `liquidacion_${this.tercero()}.pdf`.replace(/\s+/g, '_');
      const resultado = await compartirArchivo(
        blob,
        nombre,
        `Liquidación de ${this.tercero()}`,
        `Recibo de liquidación de ${this.tercero()}`,
      );
      if (resultado === 'descargado') {
        this.snackbar.open(
          'Tu dispositivo no permite compartir directamente; se descargó el PDF',
          'OK',
          { duration: 4000 },
        );
      }
    } catch (err) {
      this.snackbar.open(detalleDeError(err, 'No fue posible compartir el recibo'), 'OK', {
        duration: 5000,
      });
    } finally {
      this.compartiendo.set(false);
    }
  }

  /**
   * Abre WhatsApp con un resumen en texto de la liquidación.
   *
   * SALE DEL MISMO RESUMEN QUE PINTA LA PANTALLA (`renglonesResumen`), renglón por
   * renglón y en el mismo orden. Antes este mensaje traía cuatro cifras escogidas a
   * mano —litros, valor total y el saldo— y le faltaban los descuentos del medio: el
   * tercero recibía un "Valor total: $44.506,32 / Le queda debiendo: $4.955,77" que no
   * se puede cuadrar, porque los anticipos que explican la diferencia no estaban.
   * Ahora el chat, la pantalla y el papel dicen lo mismo y en el mismo orden; el
   * renglón nuevo de lo que quedó debiendo de la quincena pasada entra solo.
   *
   * Y el último renglón cambia igual que en la pantalla y en el PDF cuando la cuenta
   * queda por debajo de cero: acá el mensaje llega SUELTO, sin la tabla alrededor, así
   * que un "Saldo a pagar: -$120.000,00" reenviado al proveedor es peor todavía.
   */
  enviarWhatsApp(): void {
    const l = this.liq();
    const renglones = this.renglonesResumen()
      .map((renglon) => `${renglon.etiqueta}: ${renglon.texto}`)
      .join('\n');
    const texto =
      `*Liquidación de ${this.tercero()}*\n` +
      `Período: ${comoFecha(l.periodo_inicio)} al ${comoFecha(l.periodo_fin)}\n` +
      renglones;
    compartirWhatsApp(texto);
  }

  private async ejecutar(
    accion: () => Observable<Liquidacion>,
    mensaje: string,
  ): Promise<void> {
    // El aviso del recálculo habla de un antes y un ahora que dejan de ser los de
    // la pantalla en cuanto se aprueba, se paga o se anula: se cierra.
    this.cambio.set(null);
    this.procesando.set(true);
    try {
      const actualizada = await firstValueFrom(accion());
      this.liq.set(actualizada);
      this.snackbar.open(mensaje, 'OK', { duration: 3000 });
    } catch (err) {
      // Aprobar/pagar/anular SÍ guardan: si el resultado quedó en duda, el aviso
      // se queda hasta que el usuario lo cierre.
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible completar la acción');
    } finally {
      this.procesando.set(false);
    }
  }
}
