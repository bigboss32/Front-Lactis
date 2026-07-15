import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { API_BASE } from '../api.service';
import { Perfil, TokenResponse } from '../models';

const ACCESS_KEY = 'qe.access';
const REFRESH_KEY = 'qe.refresh';
const EMPRESA_KEY = 'qe.empresa';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly perfil = signal<Perfil | null>(null);
  /** Empresa activa para el superadmin (header X-Empresa-Id). */
  readonly empresaActiva = signal<string | null>(localStorage.getItem(EMPRESA_KEY));
  readonly esSuperadmin = computed(() => this.perfil()?.es_superadmin ?? false);

  private permisos = new Set<string>();
  private perfilPromise: Promise<Perfil | null> | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  get accessToken(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  }

  get refreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  }

  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  // ------------------------------------------------------------------ login
  async login(username: string, password: string): Promise<void> {
    // El backend usa OAuth2PasswordRequestForm: cuerpo x-www-form-urlencoded
    const body = new HttpParams({ fromObject: { username, password } }).toString();
    const tokens = await firstValueFrom(
      this.http.post<TokenResponse>(`${API_BASE}/auth/login`, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
    this.guardarTokens(tokens);
    this.perfilPromise = null;
    await this.ensurePerfil();
  }

  async logout(): Promise<void> {
    const refresh = this.refreshToken;
    if (refresh) {
      try {
        await firstValueFrom(
          this.http.post(`${API_BASE}/auth/logout`, { refresh_token: refresh }),
        );
      } catch {
        // logout es idempotente: los tokens locales se limpian igual
      }
    }
    this.limpiarSesion();
    this.router.navigate(['/login']);
  }

  limpiarSesion(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    this.perfil.set(null);
    this.permisos.clear();
    this.perfilPromise = null;
  }

  // ----------------------------------------------------------------- perfil
  ensurePerfil(): Promise<Perfil | null> {
    if (this.perfil()) return Promise.resolve(this.perfil());
    if (!this.isAuthenticated) return Promise.resolve(null);
    this.perfilPromise ??= firstValueFrom(this.http.get<Perfil>(`${API_BASE}/auth/me`))
      .then((perfil) => {
        this.perfil.set(perfil);
        this.permisos = new Set(perfil.permisos);
        return perfil;
      })
      .catch(() => {
        this.perfilPromise = null;
        return null;
      });
    return this.perfilPromise;
  }

  hasPermission(modulo: string, accion = 'consultar'): boolean {
    const perfil = this.perfil();
    if (!perfil) return false;
    return perfil.es_superadmin || this.permisos.has(`${modulo}:${accion}`);
  }

  // ---------------------------------------------------------------- refresh
  /** Renueva el access token; comparte una única petición entre llamadas concurrentes. */
  refrescar(): Promise<string | null> {
    const refresh = this.refreshToken;
    if (!refresh) return Promise.resolve(null);
    this.refreshPromise ??= firstValueFrom(
      this.http.post<TokenResponse>(`${API_BASE}/auth/refresh`, { refresh_token: refresh }),
    )
      .then((tokens) => {
        this.guardarTokens(tokens);
        return tokens.access_token;
      })
      .catch(() => {
        this.limpiarSesion();
        return null;
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  // ---------------------------------------------------------------- empresa
  seleccionarEmpresa(empresaId: string | null): void {
    this.empresaActiva.set(empresaId);
    if (empresaId) {
      localStorage.setItem(EMPRESA_KEY, empresaId);
    } else {
      localStorage.removeItem(EMPRESA_KEY);
    }
  }

  private guardarTokens(tokens: TokenResponse): void {
    localStorage.setItem(ACCESS_KEY, tokens.access_token);
    localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
  }
}
