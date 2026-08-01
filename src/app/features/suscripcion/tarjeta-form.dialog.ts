import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { FuentePago, SuscripcionConfig } from '../../core/models';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { ErrorPasarela, SuscripcionService } from './suscripcion.service';

/**
 * Validación de Luhn: la suma de control que traen todas las tarjetas reales.
 * No sustituye a la pasarela (Wompi revalida); solo atrapa el dedazo ANTES de
 * mandar la tarjeta, que es cuando todavía se puede corregir gratis.
 */
function luhnValido(digitos: string): boolean {
  let suma = 0;
  let doblar = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = Number(digitos[i]);
    if (doblar) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
    doblar = !doblar;
  }
  return suma % 10 === 0;
}

/** El número (sin los espacios del agrupado) debe tener 13-19 dígitos y pasar Luhn. */
function validarNumeroTarjeta(control: AbstractControl<string>): ValidationErrors | null {
  const digitos = control.value.replace(/\s/g, '');
  if (!/^\d{13,19}$/.test(digitos) || !luhnValido(digitos)) return { tarjeta: true };
  return null;
}

/** Vencimiento 'MM/AA' válido y que no esté en el pasado. */
function validarVencimiento(control: AbstractControl<string>): ValidationErrors | null {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(control.value);
  if (!match) return { vencimiento: true };
  const hoy = new Date();
  const anio = 2000 + Number(match[2]);
  const mes = Number(match[1]);
  if (anio < hoy.getFullYear() || (anio === hoy.getFullYear() && mes < hoy.getMonth() + 1)) {
    return { vencimiento: true };
  }
  return null;
}

/**
 * Alta (o reemplazo) de la tarjeta de la suscripción.
 *
 * El número viaja del navegador DIRECTO a Wompi (tokenización con la llave
 * pública): a nuestro backend solo llega el token. Por eso este diálogo no
 * usa ApiService para ese paso y NUNCA loguea lo tecleado.
 */
@Component({
  selector: 'app-tarjeta-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatCheckboxModule, MatIconModule, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.reemplaza ? 'Cambiar tarjeta' : 'Guardar tarjeta' }}</h2>
    <mat-dialog-content>
      @if (esSandbox) {
        <div class="banda-sandbox">
          <mat-icon aria-hidden="true">science</mat-icon>
          <span>
            Modo pruebas (sandbox): usa la tarjeta 4242 4242 4242 4242 con cualquier CVC
            y una fecha futura. No se cobra dinero real.
          </span>
        </div>
      }
      <form [formGroup]="form" class="form-grid" id="form-tarjeta" (ngSubmit)="guardar()">
        <mat-form-field class="full">
          <mat-label>Número de la tarjeta</mat-label>
          <input
            matInput
            type="text"
            inputmode="numeric"
            autocomplete="cc-number"
            formControlName="numero"
            (input)="formatearNumero()"
            required
          />
          @if (form.controls.numero.hasError('tarjeta')) {
            <mat-error>El número de la tarjeta no es válido</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>Vence (MM/AA)</mat-label>
          <input
            matInput
            type="text"
            inputmode="numeric"
            autocomplete="cc-exp"
            placeholder="MM/AA"
            formControlName="vencimiento"
            (input)="formatearVencimiento()"
            required
          />
          @if (form.controls.vencimiento.hasError('vencimiento')) {
            <mat-error>Fecha inválida o vencida</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>CVC</mat-label>
          <input
            matInput
            type="password"
            inputmode="numeric"
            autocomplete="cc-csc"
            maxlength="4"
            formControlName="cvc"
            required
          />
          @if (form.controls.cvc.hasError('pattern')) {
            <mat-error>3 o 4 dígitos</mat-error>
          }
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Titular (como aparece en la tarjeta)</mat-label>
          <input matInput autocomplete="cc-name" formControlName="titular" required />
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Correo del pagador</mat-label>
          <input matInput type="email" formControlName="correo" required />
          <mat-hint>A este correo llegan los comprobantes de la pasarela</mat-hint>
          @if (form.controls.correo.hasError('email')) {
            <mat-error>Correo inválido</mat-error>
          }
        </mat-form-field>
        <!-- Wompi exige aceptar DOS documentos (términos y datos personales);
             los links van a los permalinks frescos que trajo /suscripcion/config.
             El stopPropagation evita que abrir un link marque/desmarque la casilla. -->
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
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-tarjeta"
        [disabled]="form.invalid || guardando()"
      >
        @if (guardando()) {
          <app-spinner-boton /> Guardando…
        } @else {
          Guardar tarjeta
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .banda-sandbox {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: color-mix(in srgb, #b26a00 14%, transparent);
      color: #b26a00;
      font-size: 0.85rem;
      line-height: 1.35;

      mat-icon { flex-shrink: 0; }
    }
    :host-context(html.dark) .banda-sandbox { color: #ffb74d; }

    .acepta {
      margin: 4px 0 8px;

      a { color: var(--mat-sys-primary); }
    }
  `,
})
export class TarjetaFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(SuscripcionService);
  private readonly auth = inject(AuthService);
  private readonly dialogRef = inject(MatDialogRef<TarjetaFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ config: SuscripcionConfig; reemplaza: boolean }>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);
  readonly esSandbox = this.servicio.esSandbox(this.data.config);

  readonly form = this.fb.group({
    numero: ['', [Validators.required, validarNumeroTarjeta]],
    vencimiento: ['', [Validators.required, validarVencimiento]],
    cvc: ['', [Validators.required, Validators.pattern(/^\d{3,4}$/)]],
    titular: ['', [Validators.required, Validators.minLength(3)]],
    // Prefill con el correo del usuario: casi siempre el pagador es él mismo.
    correo: [this.auth.perfil()?.correo ?? '', [Validators.required, Validators.email]],
    acepta: [false, Validators.requiredTrue],
  });

  constructor() {
    protegerCambios(this.dialogRef, () => this.form);
  }

  /** Agrupa el número de a 4 (4242 4242…) mientras se teclea; el valor útil son los dígitos. */
  formatearNumero(): void {
    const control = this.form.controls.numero;
    const digitos = control.value.replace(/\D/g, '').slice(0, 19);
    control.setValue(digitos.replace(/(\d{4})(?=\d)/g, '$1 '), { emitEvent: false });
  }

  /** Inserta la barra de 'MM/AA' sola: se teclean 4 dígitos y listo. */
  formatearVencimiento(): void {
    const control = this.form.controls.vencimiento;
    const digitos = control.value.replace(/\D/g, '').slice(0, 4);
    const texto = digitos.length > 2 ? `${digitos.slice(0, 2)}/${digitos.slice(2)}` : digitos;
    control.setValue(texto, { emitEvent: false });
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const [mes, anio] = valores.vencimiento.split('/');
      // Paso 1: navegador → Wompi. Solo sale de aquí el token resultante.
      const token = await this.servicio.tokenizarTarjeta(this.data.config, {
        numero: valores.numero.replace(/\s/g, ''),
        cvc: valores.cvc,
        exp_mes: mes,
        exp_anio: anio,
        titular: valores.titular.trim(),
      });
      // Paso 2: el token + los dos tokens de aceptación van a nuestro backend,
      // que crea la fuente de pago (y reemplaza la anterior si la había).
      const fuente = await firstValueFrom(
        this.servicio.guardarFuentePago({
          token,
          customer_email: valores.correo,
          acceptance_token: this.data.config.acceptance.acceptance_token,
          accept_personal_auth: this.data.config.personal_data_auth.acceptance_token,
        }),
      );
      this.dialogRef.close(fuente as FuentePago);
    } catch (err) {
      if (err instanceof ErrorPasarela) {
        // Mensaje de Wompi ya traducido (tarjeta inválida, pasarela caída…).
        this.snackbar.open(err.message, 'OK', { duration: 8000 });
      } else {
        avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar la tarjeta');
      }
    } finally {
      this.guardando.set(false);
    }
  }
}
