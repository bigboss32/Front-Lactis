import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { ProveedoresService } from '../proveedores/proveedores.service';
import { TransportadoresService } from '../transportadores/transportadores.service';
import { Monto } from '../../core/models';
import { compartirArchivo, compartirWhatsApp } from '../../shared/compartir';
import { dateToIso } from '../../shared/date-utils';
import { CantidadPipe, MoneyPipe, pesosExactos } from '../../shared/pipes';
import { OpcionSelect, SelectBuscable } from '../../shared/select-buscable';
import { LiquidacionesService, PreLiquidacion } from './liquidaciones.service';

type TipoTercero = 'proveedor' | 'transportador';

/**
 * La plata en CENTAVOS ENTEROS, para poder compararla y restarla sin desviarse.
 *
 * Acá se decide si un renglón cuadra con la cifra grande y cuánto va a quedar de saldo de
 * verdad: en coma flotante 144.482,00 − 20.000,10 − 4.955,77 no da exacto 119.526,13 y la
 * pantalla se pondría a discutir por un centavo con el papel.
 */
function centavos(valor: Monto | null | undefined): number {
  return Math.round(Number(valor ?? 0) * 100);
}

/** De centavos enteros a la cifra escrita, con el mismo formateador de todo el proyecto. */
function pesosDeCentavos(cantidad: number): string {
  return pesosExactos(cantidad / 100);
}

/** Presets de período: [inicio, fin] como Date locales. */
function quincenaActual(): [Date, Date] {
  const h = new Date();
  const y = h.getFullYear();
  const m = h.getMonth();
  return h.getDate() <= 15
    ? [new Date(y, m, 1), new Date(y, m, 15)]
    : [new Date(y, m, 16), new Date(y, m + 1, 0)];
}

function quincenaPasada(): [Date, Date] {
  const h = new Date();
  const y = h.getFullYear();
  const m = h.getMonth();
  return h.getDate() <= 15
    ? [new Date(y, m - 1, 16), new Date(y, m, 0)]
    : [new Date(y, m, 1), new Date(y, m, 15)];
}

function esteMes(): [Date, Date] {
  const h = new Date();
  const y = h.getFullYear();
  const m = h.getMonth();
  return [new Date(y, m, 1), new Date(y, m + 1, 0)];
}

/**
 * Pre-liquidación: le muestra a un proveedor o transportador cómo va en el
 * período con las recepciones aún sin liquidar, sin generar ni guardar nada.
 * Permite compartir un PDF preliminar (no oficial) por WhatsApp, etc.
 */
@Component({
  selector: 'app-preliquidacion-dialog',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatDatepickerModule,
    MatProgressBarModule, MatTableModule, MatTooltipModule, DatePipe, MoneyPipe, CantidadPipe, SelectBuscable,
  ],
  template: `
    <h2 mat-dialog-title>Pre-liquidación · ¿cómo va?</h2>
    <mat-dialog-content>
      <p class="ayuda">
        Calcula el avance de un proveedor o transportador con las recepciones aún
        sin liquidar. No genera ni guarda nada; es solo para consultar.
      </p>

      <div class="presets">
        <button mat-stroked-button type="button" (click)="aplicarPreset('actual')">
          <mat-icon>event</mat-icon> Esta quincena
        </button>
        <button mat-stroked-button type="button" (click)="aplicarPreset('pasada')">
          <mat-icon>event</mat-icon> Quincena pasada
        </button>
        <button mat-stroked-button type="button" (click)="aplicarPreset('mes')">
          <mat-icon>event</mat-icon> Este mes
        </button>
      </div>

      <form [formGroup]="form" class="form-grid" id="form-preliq" (ngSubmit)="calcular()">
        <mat-form-field>
          <mat-label>Tipo</mat-label>
          <mat-select formControlName="tipo">
            <mat-option value="proveedor">Proveedor</mat-option>
            <mat-option value="transportador">Transportador</mat-option>
          </mat-select>
        </mat-form-field>
        <app-select-buscable
          formControlName="tercero_id"
          [opciones]="terceros()"
          [label]="tipoLabel()"
        />
        <mat-form-field>
          <mat-label>Inicio del período</mat-label>
          <input matInput [matDatepicker]="pInicio" (click)="pInicio.open()" formControlName="periodo_inicio" required />
          <mat-datepicker-toggle matSuffix [for]="pInicio" />
          <mat-datepicker #pInicio />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Fin del período</mat-label>
          <input matInput [matDatepicker]="pFin" (click)="pFin.open()" formControlName="periodo_fin" required />
          <mat-datepicker-toggle matSuffix [for]="pFin" />
          <mat-datepicker #pFin />
        </mat-form-field>
      </form>

      @if (calculando()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (sinDatos()) {
        <p class="sin-datos">
          No hay recepciones sin liquidar para ese tercero en el período.
        </p>
      }

      @if (resultado(); as r) {
        <div class="resultado">
          <h3>{{ r.tercero_nombre }}@if (r.tercero_detalle) { <small> · {{ r.tercero_detalle }}</small> }</h3>

          <!--
            Con centavos y con dos decimales en los litros, igual que el detalle de
            abajo, que el comprobante oficial y que el PDF preliminar: es el mismo
            desglose que el dueño suma a mano y tiene que dar EXACTO la cifra grande.

            Y EN EL ORDEN EN QUE SE RESTA, como el comprobante oficial: "Anticipos
            aplicados" estaba ARRIBA de "Valor total", y son un descuento del total
            —leídos antes que él no hay nada de dónde restarlos—. El dueño suma y resta
            de arriba abajo, así que el orden no es presentación: es la cuenta.
          -->
          <div class="resumen">
            <span>Total litros</span>
            <span class="num">{{ r.total_litros | cantidad: 'L' : 2 }}</span>

            @if (esProveedor()) {
              <span>Precio promedio</span>
              <span class="num">{{ r.precio_promedio | money: true }}</span>
              <span>Valor bruto</span>
              <span class="num">{{ r.valor_bruto | money: true }}</span>
              <span>Bonificaciones</span>
              <span class="num">+ {{ r.bonificaciones | money: true }}</span>
              <span>Descuentos</span>
              <span class="num">− {{ r.descuentos | money: true }}</span>
            } @else {
              <span>Valor transporte</span>
              <span class="num">{{ r.valor_transporte | money: true }}</span>
            }

            <span class="destacado">Valor total</span>
            <span class="num destacado">{{ r.valor_total | money: true }}</span>

            <span>Anticipos aplicados</span>
            <span class="num">− {{ r.anticipos | money: true }}</span>

            <!--
              LO QUE QUEDÓ DEBIENDO DE LA QUINCENA PASADA, con el mismo rótulo del
              comprobante y del PDF. En el avance NO sale: el avance no genera nada y no
              resta esa deuda —el papel del mismo avance tampoco—, así que la deuda va como
              AVISO más abajo y no como renglón. Este renglón queda para el día en que el
              servidor mande la cifra YA RESTADA del saldo, y aparece solo si la columna
              cuadra con él: un "− $120.000" encima de un saldo que no lo tiene adentro
              descuadra el desglose contra la cifra grande. Ver el computed
              cobraSaldoAnterior.
            -->
            @if (cobraSaldoAnterior()) {
              <span>Lo que quedó debiendo de la quincena pasada</span>
              <span class="num">− {{ r.saldo_anterior | money: true }}</span>
            }

            <span class="destacado">Saldo estimado</span>
            <span class="num destacado">{{ r.saldo | money: true }}</span>
          </div>

          <!--
            EL AVISO DE LA DEUDA, CON LAS MISMAS PALABRAS DEL PAPEL.

            El caso medido: el avance de Henri va en $250.000 y él quedó debiendo $120.000
            de la quincena pasada. El PDF de ESTE MISMO avance ya advertía que van a salir
            $130.000, y la pantalla decía $250.000 y nada más. El dueño manda el papel
            mirando la pantalla: si los dos no dicen lo mismo, la discusión con el
            proveedor la pierde él. Así que acá va el MISMO texto del PDF, palabra por
            palabra, con la misma cifra de "saldo de verdad" (ver el computed
            avisoDeLaDeuda).

            El avance sigue SIN restarla, igual que el papel: la deuda se cobra en el
            momento de generar, y prometer el descuento antes sería anunciar una resta que
            todavía no tiene dueño.
          -->
          @if (avisoDeLaDeuda(); as aviso) {
            <p class="aviso-deuda">
              <mat-icon aria-hidden="true">report_problem</mat-icon>
              <span>{{ aviso }}</span>
            </p>
          } @else if (!cobraSaldoAnterior() && !servidorSabeDeLaDeuda()) {
            <!--
              Y CUANDO EL SERVIDOR NO DICE NADA DE DEUDAS: no se puede prometer que no hay
              ninguna, porque esta pantalla no lo sabe. Se advierte que el saldo estimado
              puede bajar, que es lo único cierto.
            -->
            <p class="aviso-estimado">
              Es un avance: si {{ r.tercero_nombre }} quedó debiendo algo de una quincena
              pasada, eso se le cobra al generar la liquidación y el saldo baja.
            </p>
          }

          @if (r.detalles.length) {
            <h4>Detalle diario</h4>
            <table mat-table [dataSource]="r.detalles" class="detalle">
              <ng-container matColumnDef="fecha">
                <th mat-header-cell *matHeaderCellDef>Fecha</th>
                <td mat-cell *matCellDef="let d">{{ d.fecha | date: 'dd/MM/yyyy' }}</td>
              </ng-container>
              <ng-container matColumnDef="ruta">
                <th mat-header-cell *matHeaderCellDef>Ruta</th>
                <td mat-cell *matCellDef="let d">
                  {{ d.ruta_nombre || '—' }}
                  <!-- La ruta se pudo borrar después de las recepciones que este
                       avance está sumando: la tarifa sigue valiendo, pero el
                       renglón lo tiene que decir. -->
                  @if (d.ruta_borrada) {
                    <span class="borrada">(borrada)</span>
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="litros">
                <th mat-header-cell *matHeaderCellDef class="num">Litros</th>
                <td mat-cell *matCellDef="let d" class="num">{{ d.litros | cantidad: 'L' : 2 }}</td>
              </ng-container>
              <!--
                LA TARIFA POR LITRO. Sin esta columna la invariante que el dueño
                revisa a mano —litros × precio = valor— no se puede comprobar en la
                pantalla, y dos renglones del mismo día y la misma ruta partidos por
                un cambio de tarifa a mitad de quincena quedaban sin nada que los
                distinga: dos líneas iguales con valores distintos.
                Va en las dos (proveedor y transportador) porque el PDF preliminar
                la imprime en las dos, y es la misma tabla.
              -->
              <ng-container matColumnDef="precio_litro">
                <th mat-header-cell *matHeaderCellDef class="num">Precio/L</th>
                <td mat-cell *matCellDef="let d" class="num">{{ d.precio_litro | money: true }}</td>
              </ng-container>
              <ng-container matColumnDef="valor">
                <th mat-header-cell *matHeaderCellDef class="num">Valor</th>
                <td mat-cell *matCellDef="let d" class="num">{{ d.valor | money: true }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columnasDetalle()"></tr>
              <tr mat-row *matRowDef="let d; columns: columnasDetalle()"></tr>
            </table>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cerrar</button>
      @if (resultado()) {
        <button
          mat-stroked-button
          type="button"
          matTooltip="Abre WhatsApp con el resumen en texto"
          (click)="enviarWhatsApp()"
        >
          <mat-icon>chat</mat-icon> WhatsApp
        </button>
        <button
          mat-stroked-button
          type="button"
          [disabled]="compartiendo()"
          (click)="compartir()"
        >
          <mat-icon>share</mat-icon> Compartir PDF
        </button>
      }
      <button
        mat-flat-button
        type="submit"
        form="form-preliq"
        [disabled]="form.invalid || calculando()"
      >
        <mat-icon>calculate</mat-icon> Calcular
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .ayuda { margin: 0 0 12px; color: var(--mat-sys-on-surface-variant); font-size: 0.85rem; }
    .presets { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
    .sin-datos { margin: 12px 0 0; color: var(--mat-sys-on-surface-variant); font-style: italic; }

    .resultado { margin-top: 16px; }
    .resultado h3 { margin: 0 0 8px; font-size: 1rem; font-weight: 600; }
    .resultado h3 small { color: var(--mat-sys-on-surface-variant); font-weight: 400; }
    .resultado h4 { margin: 16px 0 8px; font-size: 0.9rem; font-weight: 500; }

    .resumen {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 32px;
      max-width: 420px;
    }
    .resumen .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .resumen .destacado { font-weight: 600; }
    /* El avance no conoce las deudas de quincenas pasadas: se advierte antes de que el
       dueño le prometa una cifra al proveedor por WhatsApp. */
    .aviso-estimado {
      max-width: 420px;
      margin: 10px 0 0;
      font-size: 0.8125rem;
      line-height: 1.35;
      color: var(--mat-sys-on-surface-variant);
    }
    /* Y EL AVISO DE LA DEUDA QUE SÍ EXISTE, que es otra cosa: no es "puede que baje", es
       "va a bajar, y a esto". Se ve como un aviso y no como letra chica porque es la cifra
       que el dueño está a punto de prometerle al proveedor. */
    .aviso-deuda {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      max-width: 520px;
      margin: 12px 0 0;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--mat-sys-error);
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font-size: 0.8125rem;
      line-height: 1.4;

      mat-icon {
        flex-shrink: 0;
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--mat-sys-error);
      }
    }

    table.detalle { width: 100%; }
    table.detalle .num { text-align: right; font-variant-numeric: tabular-nums; }
    /* La marca de ruta borrada: visible pero sin competir con las cifras. */
    .borrada {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }

    @media (max-width: 560px) {
      .form-grid { grid-template-columns: 1fr; }
      /* Con 32px de separación el rótulo largo del renglón nuevo se parte en cuatro
         líneas en un celular. */
      .resumen { gap: 4px 12px; max-width: none; }
    }
  `,
})
export class PreLiquidacionDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(LiquidacionesService);
  private readonly proveedoresSrv = inject(ProveedoresService);
  private readonly transportadoresSrv = inject(TransportadoresService);
  private readonly dialogRef = inject(MatDialogRef<PreLiquidacionDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly terceros = signal<OpcionSelect[]>([]);
  readonly resultado = signal<PreLiquidacion | null>(null);
  readonly calculando = signal(false);
  readonly compartiendo = signal(false);
  readonly sinDatos = signal(false);

  /**
   * La columna "Ruta" solo cuando los renglones la traen (transportador).
   *
   * Sus renglones son por día Y ruta: si hizo Nápoles y Mira Valle el mismo día,
   * ese día sale en DOS renglones con valores distintos, y sin decir cuál ruta es
   * cada uno se leen como el mismo día repetido.
   *
   * "Precio/L" va SIEMPRE, en las dos. Es la columna que hace comprobable el
   * renglón: sin ella el avance mostraba litros y valor y la cuenta del medio
   * quedaba en la cabeza de nadie, y además es la única cosa que distingue dos
   * renglones del mismo día y la misma ruta cuando la tarifa cambió a mitad de
   * quincena. El PDF preliminar la imprime en las dos, y es la misma tabla.
   */
  readonly columnasDetalle = computed(() =>
    this.resultado()?.detalles.some((d) => !!d.ruta_id || !!d.ruta_nombre)
      ? ['fecha', 'ruta', 'litros', 'precio_litro', 'valor']
      : ['fecha', 'litros', 'precio_litro', 'valor'],
  );

  private readonly quincena = quincenaActual();

  readonly form = this.fb.group({
    tipo: ['proveedor' as TipoTercero, Validators.required],
    tercero_id: ['', Validators.required],
    periodo_inicio: [this.quincena[0], Validators.required],
    periodo_fin: [this.quincena[1], Validators.required],
  });

  readonly esProveedor = computed(() => this.resultado()?.tipo === 'proveedor');

  /**
   * ¿Sale el renglón "Lo que quedó debiendo de la quincena pasada" en el resumen?
   *
   * SOLO SI LA COLUMNA CUADRA CON ÉL: valor total − anticipos − saldo anterior tiene que
   * dar EXACTO el saldo estimado que se está mostrando. Y no es paranoia: hoy el avance no
   * resta esa deuda (la resta la hace el generar, y el papel del avance tampoco la hace),
   * así que si algún día llega `saldo_anterior` en el avance SIN estar restado del saldo,
   * este renglón pintaría un "− $120.000" encima de una cifra grande que no lo tiene
   * adentro. El dueño suma la columna a mano: le sobrarían $120.000 y dejaría de creerle
   * al desglose entero.
   *
   * Cuando la deuda existe pero NO está restada, no se pinta el renglón: se avisa. Ver
   * `avisoDeLaDeuda`, que es lo que dice el papel.
   */
  readonly cobraSaldoAnterior = computed(() => {
    const r = this.resultado();
    if (!r) return false;
    const anterior = centavos(r.saldo_anterior);
    if (anterior <= 0) return false;
    return centavos(r.valor_total) - centavos(r.anticipos) - anterior === centavos(r.saldo);
  });

  /** ¿El servidor dijo algo sobre deudas viejas en este avance (aunque haya dicho cero)? */
  readonly servidorSabeDeLaDeuda = computed(() => {
    const r = this.resultado();
    return !!r && r.deuda_pendiente !== undefined && r.deuda_pendiente !== null;
  });

  /**
   * LA DEUDA QUE EL SALDO ESTIMADO TODAVÍA NO TIENE RESTADA, en centavos enteros.
   *
   * Sale de `deuda_pendiente`, que es como la manda el servidor. Y de respaldo, de un
   * `saldo_anterior` que llegó sin estar restado del saldo: es la misma plata con otro
   * nombre, y callarla porque el campo se llama distinto sería dejar al dueño prometiendo
   * una cifra que no va a pagar.
   */
  readonly deudaSinDescontar = computed(() => {
    const r = this.resultado();
    if (!r) return 0;
    const pendiente = centavos(r.deuda_pendiente);
    if (pendiente > 0) return pendiente;
    const anterior = centavos(r.saldo_anterior);
    return anterior > 0 && !this.cobraSaldoAnterior() ? anterior : 0;
  });

  /**
   * EL AVISO DE LA DEUDA, PALABRA POR PALABRA COMO LO IMPRIME EL PDF DEL AVANCE.
   *
   * El texto no se inventa acá: es el del papel (`_aviso_de_la_deuda_que_falta_por_cobrar`
   * en el backend), con la misma cifra de deuda y el mismo "saldo de verdad". El dueño
   * manda el PDF mirando esta pantalla y el proveedor recibe el PDF: si la pantalla dice
   * $250.000 y el papel dice que van a salir $130.000, el que queda mal es el dueño.
   *
   * Las dos ramas son las del papel: cuando después de la deuda todavía queda algo por
   * pagarle, y cuando la deuda se come el saldo y el tercero sigue debiendo.
   */
  readonly avisoDeLaDeuda = computed(() => {
    const r = this.resultado();
    const deuda = this.deudaSinDescontar();
    if (!r || deuda <= 0) return '';
    const queda = centavos(r.saldo) - deuda;
    const remate =
      queda >= 0
        ? `así que el saldo de verdad va a quedar en ${pesosDeCentavos(queda)} y no en el ` +
          'SALDO ESTIMADO de arriba'
        : 'así que no va a quedar saldo por pagarle: le seguiría quedando debiendo ' +
          pesosDeCentavos(-queda);
    return (
      `AVISO: este avance TODAVÍA NO DESCUENTA lo que ${r.tercero_nombre} quedó debiendo ` +
      `de quincenas anteriores (${pesosDeCentavos(deuda)}). Ese saldo se le cobra en el ` +
      `momento de generar la liquidación oficial, ${remate}.`
    );
  });

  tipoLabel(): string {
    return this.form.controls.tipo.value === 'transportador' ? 'Transportador' : 'Proveedor';
  }

  constructor() {
    this.form.controls.tipo.valueChanges.pipe(takeUntilDestroyed()).subscribe((tipo) => {
      this.form.controls.tercero_id.setValue('');
      this.resultado.set(null);
      this.sinDatos.set(false);
      void this.cargarTerceros(tipo);
    });
    void this.cargarTerceros(this.form.controls.tipo.value);
  }

  private async cargarTerceros(tipo: TipoTercero): Promise<void> {
    try {
      let opciones: OpcionSelect[];
      if (tipo === 'proveedor') {
        const pagina = await firstValueFrom(
          this.proveedoresSrv.list({ page_size: 200, estado: 'activo' }),
        );
        opciones = pagina.items.map((t) => ({ id: t.id, nombre: t.nombre }));
      } else {
        const pagina = await firstValueFrom(
          this.transportadoresSrv.list({ page_size: 200, estado: 'activo' }),
        );
        opciones = pagina.items.map((t) => ({ id: t.id, nombre: t.nombre }));
      }
      this.terceros.set(opciones);
    } catch {
      this.terceros.set([]);
    }
  }

  aplicarPreset(cual: 'actual' | 'pasada' | 'mes'): void {
    const [inicio, fin] =
      cual === 'actual' ? quincenaActual() : cual === 'pasada' ? quincenaPasada() : esteMes();
    this.form.patchValue({ periodo_inicio: inicio, periodo_fin: fin });
  }

  async calcular(): Promise<void> {
    if (this.form.invalid) return;
    this.calculando.set(true);
    this.resultado.set(null);
    this.sinDatos.set(false);
    try {
      const filas = await firstValueFrom(this.servicio.previsualizar(this.payload()));
      if (filas.length) this.resultado.set(filas[0]);
      else this.sinDatos.set(true);
    } catch (err) {
      this.snackbar.open(this.mensajeError(err, 'No fue posible calcular la pre-liquidación'), 'OK', {
        duration: 5000,
      });
    } finally {
      this.calculando.set(false);
    }
  }

  async compartir(): Promise<void> {
    this.compartiendo.set(true);
    try {
      const blob = await firstValueFrom(this.servicio.previsualizarPdfBlob(this.payload()));
      const nombre = this.resultado()?.tercero_nombre ?? 'tercero';
      const resultado = await compartirArchivo(
        blob,
        `preliquidacion_${nombre}.pdf`.replace(/\s+/g, '_'),
        `Pre-liquidación de ${nombre}`,
        'Avance preliminar (no oficial).',
      );
      if (resultado === 'descargado') {
        this.snackbar.open(
          'Tu dispositivo no permite compartir directamente; se descargó el PDF',
          'OK',
          { duration: 4000 },
        );
      }
    } catch (err) {
      this.snackbar.open(this.mensajeError(err, 'No fue posible compartir la pre-liquidación'), 'OK', {
        duration: 5000,
      });
    } finally {
      this.compartiendo.set(false);
    }
  }

  /**
   * Abre WhatsApp con un resumen en texto del avance (preliminar).
   *
   * Por los mismos formateadores de la pantalla: el tercero recibe este mensaje y
   * después el PDF, y las dos cifras tienen que ser la misma. `toLocaleString()` a
   * secas dejaba "$1.250,5" y hasta tres decimales.
   */
  enviarWhatsApp(): void {
    const r = this.resultado();
    if (!r) return;
    const litros = new CantidadPipe();
    const fecha = (iso: string) => iso.split('-').reverse().join('/');
    const valorLinea = this.esProveedor()
      ? `Valor total: ${pesosExactos(r.valor_total)}`
      : `Transporte: ${pesosExactos(r.valor_transporte)}`;
    // El renglón del saldo anterior solo si el avance lo trae RESTADO, y en el mismo lugar
    // en que lo pinta la pantalla: entre los anticipos y el saldo. El mensaje se lo
    // reenvían al tercero y tiene que poder cuadrarse igual que el papel, así que se guía
    // por la misma condición que el renglón de la pantalla (que la columna cuadre).
    const saldoAnterior = this.cobraSaldoAnterior()
      ? `Lo que quedó debiendo de la quincena pasada: − ${pesosExactos(r.saldo_anterior)}\n`
      : '';
    // Y EL AVISO DE LA DEUDA VA TAMBIÉN EN EL MENSAJE, con las mismas palabras del papel.
    // Este texto llega al MISMO proveedor que después recibe el PDF: si el mensaje promete
    // $250.000 y el papel avisa $130.000, el dueño ya prometió de más por escrito.
    const aviso = this.avisoDeLaDeuda() ? `\n\n${this.avisoDeLaDeuda()}` : '';
    const texto =
      `*Pre-liquidación de ${r.tercero_nombre}*\n` +
      `(avance preliminar, no oficial)\n` +
      `Período: ${fecha(r.periodo_inicio)} al ${fecha(r.periodo_fin)}\n` +
      `Total litros: ${litros.transform(r.total_litros, 'L', 2)}\n` +
      `${valorLinea}\n` +
      `Anticipos: − ${pesosExactos(r.anticipos)}\n` +
      saldoAnterior +
      `Saldo estimado: ${pesosExactos(r.saldo)}` +
      aviso;
    compartirWhatsApp(texto);
  }

  private payload() {
    const v = this.form.getRawValue();
    return {
      periodo_inicio: dateToIso(v.periodo_inicio)!,
      periodo_fin: dateToIso(v.periodo_fin)!,
      tipo: v.tipo,
      tercero_id: v.tercero_id,
    };
  }

  private mensajeError(err: unknown, generico: string): string {
    return err instanceof HttpErrorResponse ? (err.error?.error?.detail ?? generico) : generico;
  }
}
