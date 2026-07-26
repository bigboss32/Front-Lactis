import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { CajaDiaria } from '../../core/models';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { MoneyPipe } from '../../shared/pipes';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { CajaService } from './caja.service';

/**
 * Datos del diálogo: solo el id de la caja.
 *
 * A propósito NO se recibe la caja del padre. Sobre el saldo se construyen las
 * tres cosas que decide el usuario (saldo esperado, diferencia y si la nota es
 * obligatoria), y una foto tomada por el padre puede estar vieja: si el dueño
 * registra un egreso y abre el arqueo antes de que llegue el refresco, la
 * pantalla le muestra un descuadre que no existe (o —peor— le dice que la caja
 * cuadra cuando no cuadra, dejándole las observaciones como opcionales). El
 * cierre es IRREVERSIBLE (no hay endpoint para reabrir una caja), así que el
 * diálogo pide la caja él mismo al abrirse.
 */
export interface CerrarCajaDialogData {
  cajaId: string;
}

/** Estado del arqueo una vez contado el efectivo. `null` = todavía no se ha contado. */
type EstadoArqueo = 'cuadra' | 'sobrante' | 'faltante';

/**
 * Tolerancia del arqueo, en pesos: por debajo de un peso la caja CUADRA.
 *
 * El saldo viene de un Decimal y puede traer centavos, pero el campo de efectivo
 * contado solo acepta pesos enteros (MilesInputDirective redondea) y la
 * diferencia se muestra con MoneyPipe, que no imprime decimales. Sin tolerancia,
 * un saldo esperado de $150.000,30 contra $150.000 contados mostraba «Falta en
 * caja $0» y al mismo tiempo exigía justificar por escrito ese descuadre, sin
 * manera de cuadrarlo desde el campo: el usuario quedaba trabado. Lo que se
 * muestra y lo que se exige tienen que coincidir.
 */
const TOLERANCIA_ARQUEO = 1;

/** Arqueo de caja: registra el efectivo contado y cierra la caja del día. */
@Component({
  selector: 'app-cerrar-caja-dialog',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MilesInputDirective, MoneyPipe, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>Cerrar caja (arqueo)</h2>
    <mat-dialog-content>
      <p class="aviso-cierre" role="note">
        <mat-icon aria-hidden="true">lock</mat-icon>
        <span>Una vez cerrada, esta caja no se puede volver a abrir. Cuenta el efectivo con calma.</span>
      </p>

      <!-- Mientras no llegue el saldo al día no se muestra NADA del arqueo: es
           preferible hacer esperar un segundo que mostrar una cifra vieja. -->
      @if (cargando()) {
        <div class="cargando-saldo" role="status">
          <mat-progress-bar mode="indeterminate" />
          <p>Cargando el saldo de la caja…</p>
        </div>
      }

      @if (errorCarga(); as error) {
        <div class="error-carga" role="alert">
          <mat-icon aria-hidden="true">error_outline</mat-icon>
          <div class="texto-error">
            <p class="detalle">{{ error }}</p>
            <p class="explica">
              Sin el saldo al día no se puede hacer el arqueo, y el cierre no se puede reabrir:
              no se habilita sobre una cifra que no se pudo confirmar.
            </p>
          </div>
          @if (reintentable()) {
            <button mat-stroked-button type="button" (click)="cargar()">
              <mat-icon>refresh</mat-icon> Reintentar
            </button>
          }
        </div>
      }

      @if (caja(); as c) {
        <div class="arqueo">
          <div class="fila">
            <span class="etq">Saldo esperado en caja</span>
            <strong class="val">{{ saldoEsperado() | money }}</strong>
          </div>
          <p class="desglose">
            Inicial {{ c.saldo_inicial | money }} + ingresos
            {{ c.total_ingresos | money }} − egresos {{ c.total_egresos | money }}
          </p>

          @if (estadoArqueo(); as estado) {
            <div class="fila fila-diferencia">
              <span class="etq">{{ rotuloDiferencia() }}</span>
              <strong
                class="val"
                [class.sobrante]="estado === 'sobrante'"
                [class.faltante]="estado === 'faltante'"
                [class.cuadra]="estado === 'cuadra'"
              >
                {{ valorDiferencia() | money }}
              </strong>
            </div>
            @if (exigeObservaciones()) {
              <p class="nota-descuadre">
                Anota abajo qué pasó: esa nota es lo único que quedará para entender el descuadre
                más adelante.
              </p>
            }
          }
        </div>
      }

      <!-- El <form> se queda SIEMPRE en el DOM (aunque vacío mientras carga)
           porque la regla de celular de styles.scss selecciona el diálogo con
           :has(form): si apareciera después, el diálogo saltaría a pantalla
           completa al llegar el dato. Los campos sí esperan al saldo. -->
      <form [formGroup]="form" class="form-grid" id="form-cerrar-caja" (ngSubmit)="guardar()">
        @if (caja()) {
          <mat-form-field class="full">
            <mat-label>Efectivo contado</mat-label>
            <input
              matInput
              type="text"
              inputmode="numeric"
              appMiles
              formControlName="efectivo_contado"
              required
              (blur)="alSalirDelEfectivo()"
            />
            <span matTextPrefix>$&nbsp;</span>
            <mat-hint>Dinero físico contado al hacer el arqueo</mat-hint>
          </mat-form-field>
          <mat-form-field class="full">
            <mat-label>Observaciones{{ exigeObservaciones() ? '' : ' (opcional)' }}</mat-label>
            <textarea matInput formControlName="observaciones" rows="2"></textarea>
            @if (form.controls.observaciones.hasError('required')) {
              <mat-error>Explica el descuadre: este cierre no se puede reabrir</mat-error>
            } @else if (exigeObservaciones()) {
              <mat-hint>Obligatorio porque la caja no cuadra</mat-hint>
            }
          </mat-form-field>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <!-- Sin caja cargada el botón queda deshabilitado: cerrar es irreversible. -->
      <button
        mat-flat-button
        type="submit"
        form="form-cerrar-caja"
        [disabled]="!caja() || form.invalid || guardando()"
      >
        @if (guardando()) {
          <app-spinner-boton /> Cerrando caja…
        } @else {
          Cerrar caja
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    // Aviso de irreversibilidad: ámbar, visible pero sin el rojo de error.
    .aviso-cierre {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 0.85rem;
      background: color-mix(in srgb, #b26a00 12%, transparent);
      color: #b26a00;

      mat-icon {
        flex: none;
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    // Espera del saldo: ocupa el sitio del bloque de arqueo para que el diálogo
    // no salte cuando llega el dato.
    .cargando-saldo {
      padding: 12px 14px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;

      p {
        margin: 10px 0 0;
        font-size: 0.8rem;
        color: var(--mat-sys-on-surface-variant);
      }
    }

    // Carga fallida: el arqueo queda oculto y el cierre deshabilitado.
    .error-carga {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      border: 1px solid var(--mat-sys-error);
      border-radius: 12px;
      color: var(--mat-sys-error);

      mat-icon {
        flex: none;
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      .texto-error { flex: 1 1 auto; }

      .detalle {
        margin: 0;
        font-size: 0.85rem;
        font-weight: 500;
      }

      .explica {
        margin: 4px 0 0;
        font-size: 0.78rem;
        color: var(--mat-sys-on-surface-variant);
      }

      button { flex: none; }
    }

    .arqueo {
      padding: 12px 14px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;

      .fila {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 16px;
      }

      .etq {
        font-size: 0.8rem;
        color: var(--mat-sys-on-surface-variant);
      }

      .val {
        font-size: 1.15rem;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }

      .desglose {
        margin: 2px 0 0;
        font-size: 0.75rem;
        color: var(--mat-sys-on-surface-variant);
      }

      .fila-diferencia {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid var(--mat-sys-outline-variant);
      }

      .nota-descuadre {
        margin: 6px 0 0;
        font-size: 0.8rem;
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .val.cuadra, .val.sobrante { color: #2e7d32; }
    .val.faltante { color: #c62828; }

    :host-context(html.dark) {
      .aviso-cierre { color: #ffb74d; }
      .val.cuadra, .val.sobrante { color: #81c784; }
      .val.faltante { color: #e57373; }
    }
  `,
})
export class CerrarCajaDialog implements OnInit {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(CajaService);
  private readonly dialogRef = inject(MatDialogRef<CerrarCajaDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<CerrarCajaDialogData>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  /** Caja recién traída del backend. `null` = todavía no hay saldo en el que confiar. */
  readonly caja = signal<CajaDiaria | null>(null);
  readonly cargando = signal(false);
  /** Mensaje de la carga fallida; mientras esté puesto, el arqueo no se muestra. */
  readonly errorCarga = signal<string | null>(null);
  /** Falso cuando reintentar no puede cambiar nada (p. ej. la caja ya está cerrada). */
  readonly reintentable = signal(true);

  /** Lo que debería haber en la caja: es contra esto que el backend calcula la diferencia. */
  readonly saldoEsperado = computed(() => Number(this.caja()?.saldo_final ?? 0));

  /**
   * Diferencia (contado − esperado) que se le muestra al usuario.
   * `null` mientras no haya contado nada, para no mostrar un faltante inventado.
   */
  private readonly diferencia = signal<number | null>(null);

  readonly estadoArqueo = computed<EstadoArqueo | null>(() => {
    const dif = this.diferencia();
    if (dif === null) return null;
    // Los centavos del saldo no son un descuadre: ver TOLERANCIA_ARQUEO.
    if (Math.abs(dif) < TOLERANCIA_ARQUEO) return 'cuadra';
    return dif > 0 ? 'sobrante' : 'faltante';
  });

  readonly rotuloDiferencia = computed(() => {
    switch (this.estadoArqueo()) {
      case 'sobrante':
        return 'Sobra en caja';
      case 'faltante':
        return 'Falta en caja';
      default:
        return 'La caja cuadra';
    }
  });

  /**
   * El faltante se muestra en POSITIVO: el rótulo ya dice si sobra o si falta.
   * Si la caja cuadra se muestra un cero exacto, para que la cifra no contradiga
   * al rótulo cuando la diferencia son solo centavos (ver TOLERANCIA_ARQUEO).
   */
  readonly valorDiferencia = computed(() =>
    this.estadoArqueo() === 'cuadra' ? 0 : Math.abs(this.diferencia() ?? 0),
  );

  /** Si la caja no cuadra, las observaciones dejan de ser opcionales. */
  readonly exigeObservaciones = computed(() => {
    const estado = this.estadoArqueo();
    return estado === 'sobrante' || estado === 'faltante';
  });

  readonly form = this.fb.group({
    // Arranca vacío (no en 0) para que nadie cierre una caja sin haber contado.
    efectivo_contado: [null as number | null, [Validators.required, Validators.min(0)]],
    observaciones: [''],
  });

  constructor() {
    protegerCambios(this.dialogRef, () => this.form);
  }

  ngOnInit(): void {
    this.cargar();
  }

  /**
   * Trae la caja del backend. Es la ÚNICA fuente del saldo esperado: si falla, el
   * arqueo se queda oculto y "Cerrar caja" deshabilitado.
   *
   * DECISIÓN: no se permite cerrar sin arqueo. El cierre es irreversible (no hay
   * endpoint para reabrir una caja) y sin saldo confirmado la pantalla no puede
   * decir si cuadra ni exigir la nota del descuadre; dejar cerrar a ciegas sería
   * guardar un arqueo que nadie revisó. Ante el error se ofrece reintentar y, si
   * la señal no vuelve, cancelar y volver a entrar más tarde.
   */
  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorCarga.set(null);
    this.reintentable.set(true);
    try {
      const caja = await firstValueFrom(this.servicio.getById(this.data.cajaId));
      if (caja.estado !== 'abierta') {
        // Alguien más la cerró mientras este diálogo estaba en camino: reintentar
        // no la va a reabrir, así que no se ofrece.
        this.caja.set(null);
        this.reintentable.set(false);
        this.errorCarga.set('Esta caja ya está cerrada: no se puede volver a cerrar.');
        return;
      }
      this.caja.set(caja);
      // El saldo pudo cambiar entre dos cargas: se reclasifica lo ya contado.
      if (this.diferencia() !== null) this.recalcularDiferencia();
    } catch (err) {
      this.caja.set(null);
      this.errorCarga.set(detalleDeError(err, 'No fue posible cargar el saldo de la caja'));
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Calcula la diferencia SOLO cuando el campo pierde el foco.
   *
   * OJO: esto NO es un descuido ni algo pendiente de "mejorar" con un computed sobre
   * valueChanges. Es una decisión de negocio: si la diferencia se recalculara mientras
   * el usuario teclea, el arqueo se convierte en ajustar el efectivo contado hasta que
   * dé cero, que es exactamente lo que un arqueo debe evitar. Primero se cuenta y se
   * escribe la cifra; solo después aparece el descuadre.
   */
  alSalirDelEfectivo(): void {
    this.recalcularDiferencia();
  }

  async guardar(): Promise<void> {
    // Sin saldo confirmado no se cierra: el botón ya está deshabilitado, pero el
    // submit puede llegar por la tecla Enter del formulario.
    if (!this.caja()) return;
    // Recalcula antes de enviar: en algunos navegadores el clic en un botón no dispara
    // el blur del campo, y sin esto un descuadre podría colarse sin nota que lo explique.
    this.recalcularDiferencia();
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const caja = await firstValueFrom(
        this.servicio.cerrar(this.data.cajaId, {
          efectivo_contado: valores.efectivo_contado ?? 0,
          observaciones: valores.observaciones || null,
        }),
      );
      // Devuelve la caja actualizada para que el detalle muestre la diferencia.
      this.dialogRef.close(caja);
    } catch (err) {
      // Cerrar la caja es una escritura con plata: si no se sabe si quedó
      // cerrada, el aviso dura hasta que el usuario lo cierre.
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible cerrar la caja');
    } finally {
      this.guardando.set(false);
    }
  }

  private recalcularDiferencia(): void {
    const contado = this.form.controls.efectivo_contado.value;
    this.diferencia.set(contado === null ? null : Number(contado) - this.saldoEsperado());
    this.sincronizarValidadorObservaciones();
  }

  /** Observaciones obligatorias mientras la caja no cuadre; opcionales si cuadra. */
  private sincronizarValidadorObservaciones(): void {
    const control = this.form.controls.observaciones;
    const exige = this.exigeObservaciones();
    control.setValidators(exige ? [Validators.required] : []);
    control.updateValueAndValidity();
    // Se marca como "tocado" para que el mensaje en rojo salga de inmediato: si no,
    // el botón "Cerrar caja" quedaría deshabilitado sin decir por qué.
    if (exige) control.markAsTouched();
  }
}
