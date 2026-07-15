import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { API_BASE } from '../../core/api.service';
import { AuthService } from '../../core/auth/auth.service';

type Modo = 'login' | 'recuperar' | 'reset';

@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule,
  ],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly modo = signal<Modo>('login');
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly verPassword = signal(false);

  readonly formLogin = this.fb.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  readonly formRecuperar = this.fb.group({
    correo: ['', [Validators.required, Validators.email]],
  });

  readonly formReset = this.fb.group({
    token: ['', Validators.required],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  async login(): Promise<void> {
    if (this.formLogin.invalid) return;
    this.cargando.set(true);
    this.error.set(null);
    try {
      const { username, password } = this.formLogin.getRawValue();
      await this.auth.login(username, password);
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
      this.router.navigateByUrl(returnUrl);
    } catch (err) {
      this.error.set(this.detalle(err, 'No fue posible iniciar sesión'));
    } finally {
      this.cargando.set(false);
    }
  }

  async recuperar(): Promise<void> {
    if (this.formRecuperar.invalid) return;
    this.cargando.set(true);
    this.error.set(null);
    try {
      const respuesta = await firstValueFrom(
        this.http.post<{ detail: string }>(`${API_BASE}/auth/recuperar-password`, {
          correo: this.formRecuperar.getRawValue().correo,
        }),
      );
      this.mensaje.set(respuesta.detail);
      this.modo.set('reset');
    } catch (err) {
      this.error.set(this.detalle(err, 'No fue posible solicitar la recuperación'));
    } finally {
      this.cargando.set(false);
    }
  }

  async reset(): Promise<void> {
    if (this.formReset.invalid) return;
    this.cargando.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.post(`${API_BASE}/auth/reset-password`, this.formReset.getRawValue()),
      );
      this.mensaje.set('Contraseña restablecida. Ya puede iniciar sesión.');
      this.modo.set('login');
    } catch (err) {
      this.error.set(this.detalle(err, 'Token inválido o expirado'));
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarModo(modo: Modo): void {
    this.modo.set(modo);
    this.error.set(null);
    this.mensaje.set(null);
  }

  private detalle(err: unknown, porDefecto: string): string {
    if (err instanceof HttpErrorResponse) {
      return err.error?.error?.detail ?? porDefecto;
    }
    return porDefecto;
  }
}
