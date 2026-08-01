import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { BancoPSE, ResultadoPse, SuscripcionConfig } from '../../core/models';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { MoneyPipe } from '../../shared/pipes';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { SuscripcionService } from './suscripcion.service';

/** Documentos con los que el banco identifica a quien paga. */
const TIPOS_DOCUMENTO = [
  { valor: 'CC' as const, etiqueta: 'Cédula de ciudadanía' },
  { valor: 'CE' as const, etiqueta: 'Cédula de extranjería' },
  { valor: 'NIT' as const, etiqueta: 'NIT' },
  { valor: 'TI' as const, etiqueta: 'Tarjeta de identidad' },
  { valor: 'PP' as const, etiqueta: 'Pasaporte' },
];

/**
 * Pago de la mensualidad por PSE (débito desde la cuenta del banco).
 *
 * Va en DOS PASOS y el diálogo los muestra los dos, porque PSE no termina
 * aquí: el primero crea la transacción y el segundo es el botón que lleva al
 * portal del banco, donde la persona aprueba el débito. Ese botón tiene que
 * ser un clic de verdad —no una redirección automática— o el bloqueador de
 * ventanas emergentes se lo come y el pago queda a medias sin que se entienda
 * por qué.
 *
 * LA DIFERENCIA CON LA TARJETA, y hay que decirla en la cara: PSE paga ESTE
 * mes y nada más. No queda nada guardado para el cobro automático, porque cada
 * débito exige que alguien entre al banco y lo apruebe.
 */
@Component({
  selector: 'app-pse-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatCheckboxModule, MatIconModule,
    MatProgressBarModule, SpinnerBoton, MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>Pagar por PSE</h2>
    <mat-dialog-content>
      @if (resultado(); as r) {
        <!-- Paso 2: el pago YA está creado y esperando en el banco. -->
        <div class="listo">
          <mat-icon aria-hidden="true">account_balance</mat-icon>
          <p class="grande">Falta aprobarlo en el banco</p>
          <p>
            El pago de <strong>{{ r.pago.monto | money }}</strong> quedó registrado y
            está esperando. Entra al portal de tu banco y apruébalo para que la
            suscripción quede al día.
          </p>
          @if (r.url_banco) {
            <a
              mat-flat-button
              class="ir"
              [href]="r.url_banco"
              target="_blank"
              rel="noopener"
              (click)="cerrar()"
            >
              <mat-icon>open_in_new</mat-icon> Ir al banco
            </a>
            <p class="aclara">
              Se abre en otra pestaña. Si la cierras sin terminar, el botón
              "Continuar en el banco" de esta pantalla te lleva de vuelta.
            </p>
          } @else {
            <!-- Wompi no devolvió la URL: raro, pero el pago existe y el webhook
                 lo resolverá igual. No se puede fingir un enlace que no hay. -->
            <p class="aclara">
              La pasarela no devolvió el enlace del banco. Espera unos minutos y
              recarga: si el pago no se aprueba, podrás volver a intentar.
            </p>
          }
        </div>
      } @else {
        <div class="aviso">
          <mat-icon aria-hidden="true">info</mat-icon>
          <span>
            PSE paga <strong>este mes</strong>. Para que la mensualidad se cobre
            sola cada mes hay que guardar una tarjeta.
          </span>
        </div>

        @if (cargandoBancos()) {
          <mat-progress-bar mode="indeterminate" />
          <p class="aclara">Consultando los bancos disponibles…</p>
        } @else if (errorBancos()) {
          <div class="error-bancos">
            <mat-icon>cloud_off</mat-icon>
            <p>{{ errorBancos() }}</p>
            <button mat-stroked-button type="button" (click)="cargarBancos()">
              <mat-icon>refresh</mat-icon> Reintentar
            </button>
          </div>
        } @else {
          <form [formGroup]="form" class="form-grid" id="form-pse" (ngSubmit)="pagar()">
            <mat-form-field class="full">
              <mat-label>Banco</mat-label>
              <mat-select formControlName="banco" required>
                @for (b of bancos(); track b.financial_institution_code) {
                  <mat-option [value]="b.financial_institution_code">
                    {{ b.financial_institution_name }}
                  </mat-option>
                }
              </mat-select>
              <mat-hint>El banco de donde sale la plata</mat-hint>
            </mat-form-field>

            <mat-form-field>
              <mat-label>Tipo de persona</mat-label>
              <mat-select formControlName="tipo_persona" required>
                <mat-option value="0">Natural</mat-option>
                <mat-option value="1">Jurídica (empresa)</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field>
              <mat-label>Tipo de documento</mat-label>
              <mat-select formControlName="tipo_documento" required>
                @for (t of tiposDocumento; track t.valor) {
                  <mat-option [value]="t.valor">{{ t.etiqueta }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <mat-form-field class="full">
              <mat-label>Número de documento</mat-label>
              <!-- El teclado numérico solo para los documentos que son números:
                   con un pasaporte hay que poder escribir letras sin pelear. -->
              <input
                matInput
                [attr.inputmode]="soloNumeros() ? 'numeric' : 'text'"
                autocomplete="off"
                maxlength="20"
                formControlName="documento"
                required
              />
              <mat-hint>El del titular de la cuenta, como está en el banco</mat-hint>
              @if (form.controls.documento.hasError('minlength')) {
                <mat-error>Muy corto: revisa el número</mat-error>
              }
              @if (form.controls.documento.hasError('pattern')) {
                <mat-error>Sin puntos, guiones ni espacios</mat-error>
              }
            </mat-form-field>

            <!-- Wompi exige aceptar los dos documentos también en PSE. -->
            <mat-checkbox class="full acepta" formControlName="acepta">
              Acepto los
              <a
                [href]="data.config.acceptance.permalink"
                target="_blank"
                rel="noopener"
                (click)="$event.stopPropagation()"
              >términos y condiciones</a>
              y la
              <a
                [href]="data.config.personal_data_auth.permalink"
                target="_blank"
                rel="noopener"
                (click)="$event.stopPropagation()"
              >autorización de tratamiento de datos personales</a>
              de Wompi
            </mat-checkbox>
          </form>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (resultado()) {
        <button mat-button type="button" (click)="cerrar()">Cerrar</button>
      } @else {
        <button mat-button mat-dialog-close type="button">Cancelar</button>
        <button
          mat-flat-button
          type="submit"
          form="form-pse"
          [disabled]="form.invalid || pagando() || cargandoBancos() || !!errorBancos()"
        >
          @if (pagando()) {
            <app-spinner-boton /> Preparando…
          } @else {
            Pagar {{ data.tarifa | money }}
          }
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .aviso {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
      padding: 10px 12px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      font-size: 0.85rem;
      line-height: 1.35;

      mat-icon { flex-shrink: 0; color: var(--mat-sys-primary); }
    }

    .aclara {
      margin: 8px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.85rem;
      line-height: 1.4;
    }

    .error-bancos {
      padding: 20px 0;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);

      mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: 0.55; }
      p { margin: 8px 0 14px; }
    }

    .listo {
      padding: 8px 0 4px;
      text-align: center;

      > mat-icon {
        font-size: 46px;
        width: 46px;
        height: 46px;
        color: var(--mat-sys-primary);
      }
      p { margin: 8px 0 0; line-height: 1.45; }
      .grande { font-size: 1.05rem; font-weight: 500; }
      .ir { margin-top: 16px; }
    }

    .acepta {
      margin: 4px 0 8px;

      a { color: var(--mat-sys-primary); }
    }
  `,
})
export class PseFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(SuscripcionService);
  private readonly dialogRef = inject(MatDialogRef<PseFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ config: SuscripcionConfig; tarifa: number | string }>(MAT_DIALOG_DATA);
  readonly tiposDocumento = TIPOS_DOCUMENTO;

  readonly bancosCrudos = signal<BancoPSE[]>([]);
  readonly cargandoBancos = signal(false);
  readonly errorBancos = signal<string | null>(null);
  readonly pagando = signal(false);
  /** Cuando llega, el pago YA existe: el diálogo pasa al paso "ve al banco". */
  readonly resultado = signal<ResultadoPse | null>(null);

  /** CC, NIT y TI son solo números; CE y pasaporte pueden llevar letras. */
  readonly soloNumeros = signal(true);

  /** Alfabético: Wompi los devuelve en el orden que quiere y son treinta y pico. */
  readonly bancos = computed(() =>
    [...this.bancosCrudos()].sort((a, b) =>
      a.financial_institution_name.localeCompare(b.financial_institution_name, 'es'),
    ),
  );

  readonly form = this.fb.group({
    banco: ['', Validators.required],
    tipo_persona: ['0' as '0' | '1', Validators.required],
    tipo_documento: ['CC' as 'CC' | 'CE' | 'NIT' | 'TI' | 'PP', Validators.required],
    documento: [
      '',
      // El mínimo es el mismo del backend (4). El patrón deja letras y números
      // pero NO puntos ni guiones: el NIT con el dígito de verificación pegado
      // lo rechaza el banco, y es el error típico. Letras sí, porque un
      // pasaporte y muchas cédulas de extranjería las llevan.
      [Validators.required, Validators.minLength(4), Validators.pattern(/^[A-Za-z0-9]+$/)],
    ],
    acepta: [false, Validators.requiredTrue],
  });

  constructor() {
    // Sin protegerCambios: aquí no hay nada que se pierda al cerrar (el pago
    // todavía no existe), y con el pago ya creado cerrar es justo lo que toca.
    this.cargarBancos();
    this.form.controls.tipo_documento.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((tipo) => this.soloNumeros.set(tipo !== 'CE' && tipo !== 'PP'));
  }

  async cargarBancos(): Promise<void> {
    this.cargandoBancos.set(true);
    this.errorBancos.set(null);
    try {
      this.bancosCrudos.set(await firstValueFrom(this.servicio.bancosPse()));
      if (this.bancosCrudos().length === 0) {
        this.errorBancos.set('La pasarela no devolvió ningún banco. Intenta más tarde.');
      }
    } catch (err) {
      this.errorBancos.set(
        detalleDeError(err, 'No fue posible consultar los bancos disponibles'),
      );
    } finally {
      this.cargandoBancos.set(false);
    }
  }

  async pagar(): Promise<void> {
    if (this.form.invalid || this.pagando()) return;
    this.pagando.set(true);
    try {
      const v = this.form.getRawValue();
      const resultado = await firstValueFrom(
        this.servicio.pagarPse({
          banco: v.banco,
          tipo_persona: v.tipo_persona,
          tipo_documento: v.tipo_documento,
          documento: v.documento.trim(),
        }),
      );
      // No se redirige solo: el paso 2 pinta un enlace de verdad para que el
      // clic sea del usuario y ningún bloqueador lo tumbe.
      this.resultado.set(resultado);
      // Con el pago YA creado, Escape y el clic fuera dejan de cerrar: por ahí
      // se sale con `close(undefined)` y la pantalla no se enteraría de que hay
      // un pago esperando en el banco. Se sale por los botones, que sí avisan.
      this.dialogRef.disableClose = true;
    } catch (err) {
      // `pago_pendiente` puede traer la URL del pago anterior a medias: se
      // devuelve tal cual para que la pantalla ofrezca retomarlo en vez de
      // dejar a la persona atascada con un error que no explica qué hacer.
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible iniciar el pago por PSE');
    } finally {
      this.pagando.set(false);
    }
  }

  /** Devuelve el resultado a la pantalla para que refresque y ofrezca retomar. */
  cerrar(): void {
    this.dialogRef.close(this.resultado());
  }
}
