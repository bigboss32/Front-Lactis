import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  inject,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
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
import { Page, Ruta, Transportador } from '../../core/models';
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

/** Quincena a la que pertenece una fecha ISO (YYYY-MM-DD). */
function quincenaDeIso(iso: string): Quincena {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return { anio, mes: mes - 1, mitad: dia <= 15 ? 1 : 2 };
}

function quincenaDeHoy(): Quincena {
  return quincenaDeIso(toIso(new Date()));
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
    /* Botón "Hoy": vuelve a la quincena actual y centra la columna del día. */
    .btn-hoy {
      flex-shrink: 0;
      padding: 0 12px;
      min-width: 0;
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
    /*
     * La tarjeta es el CONTENEDOR DE CONSULTA de la grilla: la compactación de más
     * abajo se decide sobre su ancho (el ancho real disponible para la tabla) y no
     * sobre el de la ventana. Ver el bloque "cuadrícula compacta" para el motivo.
     *
     * El container-type va en la tarjeta y no en .grilla-scroll porque una regla
     * @container no puede dar estilo al propio contenedor, y .grilla-scroll sí
     * necesita cambiar con el ancho (el scroll-padding de la columna congelada).
     * La tarjeta no lleva padding, así que su caja de contenido mide exactamente
     * lo mismo que .grilla-scroll.
     */
    .grilla-card {
      padding: 0;
      overflow: hidden;
      container-name: grilla-lactis;
      container-type: inline-size;
    }
    .grilla-scroll {
      overflow-x: auto;
      max-width: 100%;
      /*
       * Ancho de las dos columnas congeladas (proveedor a la izquierda, litros a la
       * derecha) y de una columna de día. Se declaran como variables porque cambian
       * con la compactación y porque el scroll-padding de abajo tiene que ir en el
       * propio .grilla-scroll. Los valores son los medidos: 170px de contenido + 24
       * de padding + 1 de borde = 195px la de proveedor, y 82px la de litros con
       * "1.446 L".
       */
      --ancho-col-prov: 195px;
      --ancho-col-litros: 82px;
      --ancho-col-dia: 68px;
      /*
       * Al tabular por los botones de las celdas, el navegador desplaza esta zona
       * para mostrar lo que recibe el foco; sin el scroll-padding lo daba por
       * visible aunque quedara DEBAJO de una columna congelada (son sticky: flotan
       * encima del contenido desplazado, no lo empujan). Medido a 768x1024 con
       * scrollLeft en 0: los botones 12 a 16 de la primera fila recibían el foco
       * tapados por la columna de litros —el 14, el 15 y el 16 ni siquiera estaban
       * en pantalla— y el scrollLeft se quedaba en 0, así que el anillo de foco
       * desaparecía y un Enter abría el diálogo de una celda que no se veía. Es el
       * mismo remedio que scroll-padding-top en las tablas con encabezado fijo.
       *
       * Se suma UNA COLUMNA DE DÍA al ancho de cada columna congelada, y no es
       * adorno: al mover el foco, el navegador solo corrige el desplazamiento si el
       * elemento queda COMPLETAMENTE fuera de la zona útil (y entonces lo centra);
       * si queda a medias sobre el borde, lo deja quieto. Medido: con el padding
       * exacto (71px) el botón 13 se centraba bien, pero el 12 se quedaba con 16 de
       * sus 46px debajo de la columna de litros. Con un día de más, cualquier botón
       * que quede a medias sobre el borde de la zona termina, en el peor caso, justo
       * al lado de la columna congelada, nunca debajo.
       */
      scroll-padding-inline:
        calc(var(--ancho-col-prov) + var(--ancho-col-dia))
        calc(var(--ancho-col-litros) + var(--ancho-col-dia));
    }

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
    /*
     * width Y max-width con box-sizing: border-box, no min-width + max-width: en una
     * tabla de layout automático el max-width de una celda es solo una sugerencia y
     * el navegador ensancha la columna hasta el MÍNIMO DE CONTENIDO del nombre más
     * largo. Con los nombres reales de una quesera ("Asociación de Productores El
     * Roble", 34 caracteres) la columna se iba muy por encima de los 240px de tope y
     * empujaba los días fuera de la pantalla. 195px = los mismos 170 de contenido +
     * 24 de padding + 1 de borde que ya medía con nombres cortos: en el PC no cambia
     * nada de lo que se ve hoy, solo deja de crecer con nombres largos.
     */
    .col-proveedor {
      position: sticky;
      left: 0;
      z-index: 2;
      box-sizing: border-box;
      width: 195px;
      max-width: 195px;
      padding: 8px 12px;
      text-align: left;
      background: var(--mat-sys-surface-container-low);
      border-right: 1px solid var(--mat-sys-outline-variant);
    }
    .prov { display: flex; flex-direction: column; white-space: normal; }
    /*
     * overflow-wrap: anywhere es lo que hace que el ancho de arriba se respete: baja
     * el mínimo de contenido de la celda al de un carácter, así un nombre largo parte
     * línea dentro de la columna en vez de ensancharla. Sin esto, width y max-width
     * son letra muerta.
     */
    .prov-nombre,
    .prov-detalle { overflow-wrap: anywhere; }
    .prov-nombre { font-weight: 700; line-height: 1.2; }
    .prov-detalle {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      line-height: 1.3;
    }

    /* Proveedor retirado/eliminado: se conserva (para liquidar) pero se resalta */
    tr.fila-retirado td { background: color-mix(in srgb, #c62828 8%, transparent); }
    /* La columna congelada repite el tinte con fondo OPACO: el color de la fila es
       semitransparente y por debajo de una celda fija se vería el contenido que se
       desplaza. */
    tr.fila-retirado .col-proveedor {
      background: color-mix(in srgb, #c62828 12%, var(--mat-sys-surface-container-low));
    }
    .chip-retirado {
      display: inline-block;
      margin-left: 6px;
      padding: 0 6px;
      border-radius: 8px;
      font-size: 0.62rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      vertical-align: middle;
      white-space: nowrap;
      background: color-mix(in srgb, #c62828 18%, transparent);
      color: #c62828;
    }
    :host-context(html.dark) .chip-retirado { color: #e57373; }

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
    /* En pantallas táctiles no existe el hover: si el "+" queda invisible, las celdas
       vacías parecen cuadros en blanco y no se ve dónde anotar. Se deja insinuado
       siempre (sin ensuciar la grilla del PC, que sigue reaccionando al mouse). */
    @media (hover: none) {
      .celda-btn.vacia .mas { opacity: 0.35; }
    }

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

    /* Ícono de "tiene transporte asignado" dentro de la celda */
    .carrito {
      font-size: 13px;
      width: 13px;
      height: 13px;
      color: var(--mat-sys-primary);
      flex-shrink: 0;
    }

    /* Columnas de totales por proveedor */
    .col-total {
      padding: 8px 12px;
      text-align: right;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      border-left: 1px solid var(--mat-sys-outline-variant);
    }
    th.col-total { vertical-align: bottom; border-left: 1px solid var(--mat-sys-outline-variant); }

    /*
     * Total de litros: columna FIJA pegada al borde derecho, el espejo de la
     * columna de proveedor. Así, al arrastrar la quincena, nunca se pierde de vista
     * de quién es la fila (izquierda) ni cuántos litros lleva (derecha).
     *
     * Se congela SOLO esta de las cuatro columnas de totales: las tres de pesos
     * suman 255px más y una columna fija RESERVA su ancho contra el borde derecho,
     * así que congelarlas dejaría el área de días en menos de 500px —por debajo de
     * los 736px que ocupa la quincena— y volvería a no caber. Las de pesos quedan a
     * un arrastre corto (240px en la tablet apaisada).
     *
     * Desde 701px, o sea de tablet en adelante y NO en el celular: en 360px de
     * pantalla esos ~70px reservados son un quinto del ancho y se comerían dos de
     * los cuatro días que hoy se alcanzan a ver. En el celular la grilla se
     * arrastra exactamente igual que antes.
     *
     * OJO, ESTÁ MEDIDO: en la tablet APAISADA esta columna NO llega a congelarse.
     * right: 0 en sticky solo empuja el elemento cuando su posición natural se
     * saldría por el borde derecho del contenedor, y a 1024px la tabla desborda
     * apenas 240px: la columna se mueve con el contenido (medido a 1024x768: x=899
     * con scrollLeft 0 y x=659 con scrollLeft 240). A 768x1024 sí se pega. No hace
     * daño —en apaisada la quincena entera cabe, así que no hay nada que perder de
     * vista—, pero que nadie apoye una decisión futura en "en apaisada está
     * congelada". El centrado del día de hoy ya lo tiene en cuenta: ver
     * anchoTotalCongelado().
     */
    @media (min-width: 701px) {
      .col-total-litros {
        position: sticky;
        right: 0;
        /* Por debajo de la columna de proveedor (z-index: 2), que es la que debe
           mandar si en una pantalla angosta las dos llegaran a tocarse. */
        z-index: 1;
        /* Fondo opaco obligatorio: una celda fija transparente deja ver por debajo
           las columnas de pesos al desplazar. Es el mismo fondo de la tarjeta, así
           que no se nota como una columna aparte (y sigue al tema claro/oscuro). */
        background: var(--mat-sys-surface-container-low);
      }
      tr.fila-retirado .col-total-litros {
        background: color-mix(in srgb, #c62828 12%, var(--mat-sys-surface-container-low));
      }
    }

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
    /* Segunda línea del estado vacío: dice QUÉ HACER cuando el filtro dejó la
       grilla sin filas. Va más pequeña para que la frase principal siga siendo
       la que se lee primero. */
    .empty-state .empty-detalle {
      margin: 4px auto 0;
      max-width: 42ch;
      font-size: 0.85rem;
    }

    /* ------------------------------ cuadrícula compacta (por ancho de contenido) */
    /*
     * La grilla sigue siendo cuadrícula: se desplaza en horizontal y la columna de
     * proveedor queda fija (la de litros también, pero solo de tablet en adelante);
     * lo único que cambia es que se compacta para que quepan más días de una mirada.
     *
     * SE DECIDE POR EL ANCHO DEL CONTENEDOR (container query), no por el de la
     * ventana. Con una @media de 1279px el PC se quedaba sin la mejora aunque la
     * necesitara igual: desde 1280px vuelve el menú lateral fijo (252px medidos), así
     * que el ancho útil a 1280px es prácticamente el mismo que en la tablet apaisada
     * con el menú plegado. Medido antes de este arreglo: 1024x768 → franja de 961px,
     * día de 46px, 16 de 16 días; 1280x800 → franja de 965px (4px MÁS) pero día de
     * 68px y solo 9 de 16 días. El dueño veía la quincena completa en la tablet y
     * recortada en el computador, con más pantalla.
     *
     * Se eligió la container query (opción a) y no estirar la @media a ~1546px porque
     * no hay que saber cuánto mide el menú: la pregunta que importa es "¿cuánto ancho
     * le queda a la tabla?", y eso es exactamente lo que mide el contenedor. Sirve
     * igual si mañana el menú cambia de ancho, si se pliega a mano o si la grilla se
     * mete en un panel más estrecho.
     *
     * 1364px = el ancho de contenido a partir del cual la quincena YA cabe sin
     * compactar, así que por encima no se compacta y la tabla no queda comprimida sin
     * necesidad: 195px de la columna de proveedor + 16 días de 68px (1088px) + 82px
     * de la columna de litros congelada = 1365px. Medido a 1920x1080 (contenedor de
     * 1400px): 16 de 16 días visibles sin compactar.
     */
    @container grilla-lactis (max-width: 1364px) {
      table.grilla { font-size: 0.8rem; }
      /*
       * Ancho DE VERDAD (width, no min-width): ver el comentario de .col-proveedor
       * más arriba. Medido a 1024x768 sustituyendo solo el nombre del productor:
       * antes, "Productor 1" (11 caracteres) daba 139px y la quincena cabía, pero
       * "Hacienda Santa Bárbara" (22) daba 159px y "Asociación de Productores El
       * Roble" (34) daba 167px, y con eso ya NO cabía. O sea: la mejora se sostenía
       * solo con los nombres de los datos de prueba. Con width: 122px la columna se
       * queda en 122px con cualquier nombre: el de 34 caracteres parte en tres
       * líneas ("Asociación de" / "Productores El" / "Roble", siempre por los
       * espacios, nunca a mitad de palabra) y su fila pasa de 43 a 75px de alto.
       */
      .col-proveedor {
        box-sizing: border-box;
        width: 122px;
        max-width: 122px;
        padding: 6px 8px;
      }
      /* Las franjas congeladas y los días miden menos: el desplazamiento del foco
         al tabular se ajusta solo. */
      .grilla-scroll {
        --ancho-col-prov: 122px;
        --ancho-col-litros: 71px;
        --ancho-col-dia: 46px;
      }
      .prov-nombre { font-size: 0.82rem; }
      .prov-detalle { font-size: 0.7rem; }
      th.col-dia { min-width: 42px; }
      td.celda { min-width: 42px; }
      .celda-btn,
      .celda-contenido { min-height: 42px; padding: 4px; }
      .col-total { padding: 6px 8px; }
    }

    /* ------------------------------------- ancho de los días de tablet en adelante */
    /*
     * Desde 701px de VENTANA (o sea de tablet en adelante, nunca en el celular: allí
     * la geometría no se toca) y solo cuando el CONTENIDO obliga a compactar.
     *
     * box-sizing: border-box es la clave: las celdas de tabla son content-box por
     * omisión, así que el min-width se SUMABA a los 12px de padding del encabezado
     * y cada día terminaba midiendo 54px en vez de los 42px que aparentaba la regla
     * de arriba. 16 días eran 864px y no cabían en los 751px libres de la tablet
     * apaisada. Con border-box el min-width ya es el ancho real de la columna.
     *
     * 46px y no 42px porque el contenido más ancho de la columna es el total del pie
     * ("1.446" = 33px + 12px de padding = 45px): por debajo de eso el navegador
     * ensancha solo las columnas con datos y los días quedan desparejos. Con 46px
     * las 16 columnas miden igual y suman 736px, que sí caben.
     *
     * Las celdas de día del PIE (.celda-dia-total) van en la misma regla: son las que
     * llevan el número más ancho de la columna —el que justifica los 46px— y eran
     * justo las que se habían quedado sin restringir. Medido a 1024x768 sustituyendo
     * solo el total del pie de un día: con "1.446" todas medían 46px, pero con
     * "12.345" esa sola columna se iba a 52,4px y con "1.446,5" a 55,6px, y la
     * cuadrícula quedaba despareja.
     *
     * Cuentas del pie, medidas con la fuente real (Roboto 700, cifras tabulares):
     * a 0,8rem "12.345" mide 40,4px y "123.456" 47,8px, así que bajar el padding
     * horizontal a 1px (44px libres de los 46) alcanza para 5 cifras y hasta para
     * "1.446,5" (43,6px), pero NO para 6 cifras. Por eso el total del pie baja
     * además a 0,7rem —el mismo tamaño que la abreviatura del día del encabezado,
     * y en negrita— con lo que "123.456" mide 41,8px y sobran 2,2px. Es el precio de
     * que la cuadrícula quede pareja con cualquier total: un solo número más ancho
     * desparejaba las 16 columnas.
     *
     * COSTE ASUMIDO: el objetivo táctil de la celda del día baja de 68x46 a 46x42px,
     * por debajo del mínimo de 48px que recomienda Material, y es el control que se
     * pulsa unas 180 veces por quincena (12 productores x 15 días). Es un canje
     * deliberado a cambio de que la quincena entera entre en pantalla y no haya que
     * arrastrar la franja para cerrarla.
     *
     * Y no basta con los 46px de ancho VISIBLE que sobran en apaisada: a 48px la
     * fila entera (122 de proveedor + 16x48 = 768 + 71 de litros) mide 961px, o sea
     * EXACTAMENTE el contenedor de la tablet apaisada, y con eso la columna de litros
     * empieza a pegarse al borde derecho y a tapar el último día —justo lo que
     * describe el comentario de .col-total-litros—. Con 46px la fila mide 929px y
     * quedan 32px de margen, que es lo que aguanta que la columna de litros crezca
     * con totales de 5 cifras ("12.345 L") sin que se pegue. Subir a 48px pide antes
     * recortar por otro lado (por ejemplo, mover una de las tres columnas de pesos).
     */
    @media (min-width: 701px) {
      @container grilla-lactis (max-width: 1364px) {
        th.col-dia,
        td.celda,
        td.celda-dia-total { box-sizing: border-box; min-width: 46px; }
        tfoot .fila-total td.celda-dia-total {
          padding-left: 1px;
          padding-right: 1px;
          font-size: 0.7rem;
        }
      }
    }

    /* En el celular la columna de litros no se congela (ver .col-total-litros), así
       que por la derecha no hay nada que tape el foco al tabular; queda solo el día
       de margen, que sirve para que un botón cortado por el borde del contenedor
       entre completo en pantalla al recibir el foco. El día mide 54px porque aquí no
       se aplica la regla de los 46px (esa es de tablet en adelante). */
    @media (max-width: 700px) {
      .grilla-scroll {
        --ancho-col-litros: 0px;
        --ancho-col-dia: 54px;
      }
    }

    /* ------------------------------------- encabezado adaptado al celular */
    /* Solo celular: el título de la quincena cede ancho para que quepan las flechas
       y el botón "Hoy" en 360px. En la tablet NO se aplica —ahí sobra sitio y
       encogerlo se vería mal. */
    @media (max-width: 700px) {
      .selector-quincena { gap: 4px; }
      .etiqueta-quincena { min-width: 0; flex: 1 1 auto; font-size: 1.05rem; }
      .btn-hoy { padding: 0 10px; }
    }
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

  /**
   * Día de hoy en ISO. Es un SIGNAL y no una constante fijada al construir el
   * componente: la tablet de la oficina se queda encendida toda la noche (uso
   * normal) y con un valor fijo, al día siguiente, el botón "Hoy" centraba la
   * columna de AYER y —cruzando del 15 al 16— enQuincenaActual() seguía
   * afirmando que la pantalla ya estaba en la quincena nueva. Se refresca al
   * inicio de cada cargar().
   */
  readonly hoy = signal(toIso(new Date()));
  readonly quincena = signal<Quincena>(quincenaDeHoy());
  readonly grilla = signal<GrillaQuincena | null>(null);
  readonly cargando = signal(false);
  readonly rutas = signal<Ruta[]>([]);
  readonly transportadores = signal<Transportador[]>([]);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly rutaId = new FormControl<string | null>(null);
  readonly transportadorId = new FormControl<string | null>(null);

  /** Contenedor de la grilla que se desplaza en horizontal. */
  private readonly scrollGrilla = viewChild<ElementRef<HTMLElement>>('scrollGrilla');
  /** Encabezados de día, en el mismo orden que dias(). */
  private readonly encabezadosDia = viewChildren<ElementRef<HTMLElement>>('encabezadoDia');
  /**
   * Encabezado de la columna de proveedor: es position: sticky, así que su ancho
   * es la parte del contenedor que NO queda libre para el contenido desplazado.
   */
  private readonly encabezadoProveedor = viewChild<ElementRef<HTMLElement>>('encabezadoProveedor');
  /**
   * Encabezado del total de litros: de tablet en adelante es position: sticky
   * contra el borde derecho, así que reserva su ancho igual que la columna de
   * proveedor reserva el suyo por la izquierda.
   */
  private readonly encabezadoTotalLitros =
    viewChild<ElementRef<HTMLElement>>('encabezadoTotalLitros');
  /** Queda pendiente centrar la columna de hoy cuando termine la carga en curso. */
  private centrarPendiente = true;

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

  /**
   * Quincena que contiene el día de hoy. Se deriva del signal `hoy()` —y no de
   * un new Date() dentro del computed— para que se recalcule cuando el día
   * cambia con la pantalla abierta.
   */
  private readonly quincenaActual = computed(() => quincenaDeIso(this.hoy()));

  /** Verdadero si la quincena mostrada es la que contiene el día de hoy. */
  readonly enQuincenaActual = computed(() => {
    const q = this.quincena();
    const actual = this.quincenaActual();
    return q.anio === actual.anio && q.mes === actual.mes && q.mitad === actual.mitad;
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

  /** Posición de la columna de hoy dentro de dias(); -1 si la quincena no la incluye. */
  private readonly indiceHoy = computed(() => this.dias().findIndex((d) => d.iso === this.hoy()));

  /**
   * El botón "Hoy" tiene algo que hacer si se está en otra quincena (volver a la
   * actual) o si la columna de hoy está en la grilla (recentrarla tras arrastrarla).
   */
  readonly puedeIrAHoy = computed(() => {
    if (!this.enQuincenaActual()) return true;
    // Ya se está en la quincena de hoy: el botón solo sirve para recentrar, así que
    // hace falta que haya tabla en pantalla (sin filas se muestra el estado vacío).
    return (this.grilla()?.filas.length ?? 0) > 0 && this.indiceHoy() >= 0;
  });

  /**
   * Hay al menos un filtro puesto. Es un SIGNAL que se refresca en cada carga
   * (ver cargar()) y no un computed sobre los FormControl: los controles no son
   * reactivos para los signals, así que un computed que los leyera no se
   * volvería a calcular al cambiarlos y la pantalla se quedaría con el mensaje
   * de vacío equivocado.
   *
   * Sirve para explicar POR QUÉ no hay filas: una quincena sin nada anotado y
   * una quincena en la que el filtro no dejó pasar nada se ven igual (tabla en
   * blanco), pero se arreglan de maneras opuestas.
   */
  readonly conFiltros = signal(false);

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
    this.transportadorId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.cargar());
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'recepciones-grilla',
      { buscar: this.buscar, rutaId: this.rutaId, transportadorId: this.transportadorId },
      this.destroyRef,
    );
    this.cargar();
    firstValueFrom(
      this.api.get<Page<Ruta>>('/rutas', { page_size: 100, estado: 'activo' }),
    ).then((r) => this.rutas.set(r.items));
    // Van TODOS los transportadores, también los inactivos, y a propósito: este
    // es un selector de CONSULTA, no un campo para registrar leche nueva. Si un
    // transportador se retira y aquí solo salieran los activos, sus quincenas
    // pasadas quedarían imposibles de mirar en esta pantalla —su historia se
    // volvería invisible—, que es justo lo contrario de lo que se busca al
    // apartarlo. En el formulario de recepción, donde sí se registra leche
    // nueva, sigue yendo estado=activo.
    firstValueFrom(
      this.api.get<Page<Transportador>>('/transportadores', { page_size: 100 }),
    ).then((r) => this.transportadores.set(r.items));
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
    this.centrarPendiente = true;
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
    this.centrarPendiente = true;
    this.cargar();
  }

  /**
   * Botón "Hoy": si se está en otra quincena vuelve a la del día de hoy; si ya se
   * está en ella solo recentra la columna (útil si el usuario arrastró la grilla).
   */
  irAHoy(): void {
    // Se refresca antes de decidir: si la pantalla pasó la noche abierta, "hoy"
    // ya no es el día con el que se construyó el componente.
    this.refrescarHoy();
    if (this.enQuincenaActual()) {
      this.centrarColumnaHoy();
      return;
    }
    this.quincena.set(this.quincenaActual());
    this.centrarPendiente = true;
    this.cargar();
  }

  async cargar(): Promise<void> {
    // Cada carga vuelve a mirar el reloj, así enQuincenaActual(), indiceHoy() y el
    // resaltado de la columna se recalculan si de por medio pasó la medianoche.
    this.refrescarHoy();
    this.cargando.set(true);
    // Se recuerda con qué filtros se pidió ESTA grilla, para que el mensaje de
    // "no hay filas" corresponda a lo que se está mostrando.
    const buscar = this.buscar.value || null;
    const rutaId = this.rutaId.value;
    const transportadorId = this.transportadorId.value;
    this.conFiltros.set(!!buscar || !!rutaId || !!transportadorId);
    try {
      const { desde, hasta } = this.rango();
      this.grilla.set(
        await firstValueFrom(
          this.servicio.grilla(desde, hasta, buscar, rutaId, transportadorId),
        ),
      );
    } catch (err) {
      this.grilla.set(null);
      this.mostrarError(err, 'No fue posible cargar la grilla');
    } finally {
      this.cargando.set(false);
      if (this.centrarPendiente) this.programarCentradoHoy();
    }
  }

  /** Pone al día el signal `hoy` (solo escribe si de verdad cambió el día). */
  private refrescarHoy(): void {
    const iso = toIso(new Date());
    if (iso !== this.hoy()) this.hoy.set(iso);
  }

  /**
   * Centra la columna de hoy una sola vez por carga y solo si la quincena mostrada
   * la incluye: si el usuario navegó a una quincena vieja se respeta su posición.
   */
  private programarCentradoHoy(): void {
    if (!this.enQuincenaActual()) return;
    // La tabla se pinta después de esta vuelta del ciclo, por eso se espera un turno.
    setTimeout(() => {
      if (this.centrarPendiente && this.centrarColumnaHoy()) this.centrarPendiente = false;
    }, 0);
  }

  /**
   * Desplaza el contenedor de la grilla para dejar la columna de hoy al centro.
   * El scrollLeft se calcula a mano (y no con scrollIntoView) porque scrollIntoView
   * también arrastra el scroll vertical de la página. Devuelve false si todavía no
   * hay tabla en pantalla (grilla vacía o sin cargar).
   *
   * Se centra sobre el área REALMENTE visible, descontando el ancho de las dos
   * columnas congeladas: son position: sticky y flotan ENCIMA del contenido
   * desplazado, así que centrar sobre el ancho completo del contenedor dejaba la
   * columna de hoy debajo de ellas. Medido en un celular de 360px (contenedor de
   * 336px), con un nombre de proveedor de 21-23 caracteres quedaban tapados 22 de
   * los 54px de la columna: casi la mitad, justo AL CARGAR, que es lo que este
   * centrado promete evitar. Con los nombres cortos de los datos de prueba no se
   * notaba.
   */
  private centrarColumnaHoy(): boolean {
    const contenedor = this.scrollGrilla()?.nativeElement;
    const indice = this.indiceHoy();
    const columna = indice >= 0 ? this.encabezadosDia()[indice]?.nativeElement : undefined;
    if (!contenedor || !columna) return false;
    const cajaContenedor = contenedor.getBoundingClientRect();
    const cajaColumna = columna.getBoundingClientRect();
    // Se toman del DOM (y no de constantes) porque el ancho de las columnas
    // congeladas depende del nombre del proveedor, de las cifras y del breakpoint.
    const anchoSticky =
      this.encabezadoProveedor()?.nativeElement.getBoundingClientRect().width ?? 0;
    const anchoTotalFijo = this.anchoTotalCongelado();
    // El área útil es la franja entre las dos columnas congeladas: es sobre ella
    // que se centra.
    const areaUtil = contenedor.clientWidth - anchoSticky - anchoTotalFijo;
    // En la tablet la quincena completa cabe en esa franja: ahí no hay nada que
    // centrar y desplazarla solo esconde los primeros días debajo de la columna de
    // proveedor. Se deja al comienzo, con los 15 o 16 días a la vista.
    if (this.anchoColumnasDia() <= areaUtil) {
      contenedor.scrollLeft = 0;
      return true;
    }
    const desfase =
      cajaColumna.left - cajaContenedor.left - anchoSticky - (areaUtil - cajaColumna.width) / 2;
    // El navegador recorta el valor a los límites reales del contenedor.
    contenedor.scrollLeft += desfase;
    return true;
  }

  /**
   * Ancho que le quita al área útil la columna de total de litros congelada contra
   * el borde derecho. Devuelve 0 si no le quita nada, y hay DOS casos:
   *
   * - en el celular no es sticky (ver los estilos): el área útil llega hasta el
   *   borde del contenedor;
   * - de tablet en adelante es sticky pero puede no estar PEGADA: right: 0 solo
   *   empuja el elemento cuando su posición natural se saldría por el borde derecho,
   *   y en la tablet apaisada la tabla desborda tan poco que la columna se mueve con
   *   el contenido. Mientras no esté pegada no tapa ninguna columna de día, así que
   *   descontar su ancho era regalar ~70px de holgura justo donde hacen falta: con
   *   ellos, a 1024x768 la quincena cabe en la franja y el centrado la deja quieta
   *   al comienzo en vez de desplazarla.
   *
   * Se mira si está pegada comparando su borde derecho con el borde derecho ÚTIL del
   * contenedor (clientWidth, que ya descuenta una barra de desplazamiento). Pegarse
   * exige un scrollLeft MENOR que el de ahora, así que si no está pegada en esta
   * posición no puede quedar pegada al desplazar la franja hacia la derecha, que es
   * lo único que hace el centrado.
   */
  private anchoTotalCongelado(): number {
    const encabezado = this.encabezadoTotalLitros()?.nativeElement;
    const contenedor = this.scrollGrilla()?.nativeElement;
    if (!encabezado || !contenedor) return 0;
    if (getComputedStyle(encabezado).position !== 'sticky') return 0;
    const caja = encabezado.getBoundingClientRect();
    const bordeUtil = contenedor.getBoundingClientRect().left + contenedor.clientWidth;
    // 1px de tolerancia: los anchos de columna salen fraccionarios.
    const pegada = caja.right >= bordeUtil - 1;
    return pegada ? caja.width : 0;
  }

  /** Ancho que ocupan juntas todas las columnas de día. */
  private anchoColumnasDia(): number {
    const encabezados = this.encabezadosDia();
    if (encabezados.length === 0) return 0;
    const primero = encabezados[0].nativeElement.getBoundingClientRect();
    const ultimo = encabezados[encabezados.length - 1].nativeElement.getBoundingClientRect();
    return ultimo.right - primero.left;
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
      .subscribe((resultado) => {
        if (!resultado) return;
        this.snackbar.open(
          resultado === 'eliminado' ? 'Recepción eliminada' : 'Recepción guardada',
          'OK',
          { duration: 3000 },
        );
        this.cargar();
        this.cambio.emit();
      });
  }

  private mostrarError(err: unknown, fallback: string): void {
    const detalle =
      err instanceof HttpErrorResponse ? (err.error?.error?.detail ?? fallback) : fallback;
    this.snackbar.open(detalle, 'OK', { duration: 5000 });
  }
}
