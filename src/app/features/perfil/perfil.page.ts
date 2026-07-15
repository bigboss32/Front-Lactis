import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { PageHeader } from '../../shared/page-header';

@Component({
  selector: 'app-perfil-page',
  imports: [
    ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatListModule, PageHeader,
  ],
  template: `
    <div class="page">
      <app-page-header titulo="Mi perfil" [subtitulo]="auth.perfil()?.correo ?? ''" />

      <div class="grid">
        <mat-card>
          <mat-card-header><mat-card-title>Información</mat-card-title></mat-card-header>
          <mat-card-content>
            <mat-list>
              <mat-list-item>
                <span matListItemTitle>{{ auth.perfil()?.nombre }} {{ auth.perfil()?.apellido }}</span>
                <span matListItemLine>Usuario: {{ auth.perfil()?.username }}</span>
              </mat-list-item>
              <mat-list-item>
                <span matListItemTitle>Roles</span>
                <span matListItemLine>{{ auth.perfil()?.roles?.join(', ') }}</span>
              </mat-list-item>
            </mat-list>
          </mat-card-content>
        </mat-card>

        <mat-card>
          <mat-card-header><mat-card-title>Cambiar contraseña</mat-card-title></mat-card-header>
          <mat-card-content>
            <form [formGroup]="form" (ngSubmit)="cambiar()" class="form-grid">
              <mat-form-field class="full">
                <mat-label>Contraseña actual</mat-label>
                <input matInput type="password" formControlName="password_actual" autocomplete="current-password" />
              </mat-form-field>
              <mat-form-field class="full">
                <mat-label>Nueva contraseña</mat-label>
                <input matInput type="password" formControlName="password_nueva" autocomplete="new-password" />
                <mat-hint>Mínimo 8 caracteres, con letras y números</mat-hint>
              </mat-form-field>
              <div class="full acciones">
                <button mat-flat-button type="submit" [disabled]="form.invalid || guardando()">
                  Actualizar contraseña
                </button>
              </div>
            </form>
          </mat-card-content>
        </mat-card>
      </div>
    </div>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }
    .acciones { margin-top: 8px; }
  `,
})
export class PerfilPage {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly snackbar = inject(MatSnackBar);

  readonly auth = inject(AuthService);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    password_actual: ['', Validators.required],
    password_nueva: ['', [Validators.required, Validators.minLength(8)]],
  });

  async cambiar(): Promise<void> {
    this.guardando.set(true);
    try {
      await firstValueFrom(this.api.post('/auth/cambiar-password', this.form.getRawValue()));
      this.snackbar.open('Contraseña actualizada', 'OK', { duration: 4000 });
      this.form.reset();
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible actualizar')
          : 'No fue posible actualizar';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }
}
