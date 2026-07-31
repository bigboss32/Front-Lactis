import {
  HttpClient,
  HttpContext,
  HttpContextToken,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { API_BASE } from '../api.service';
import { EmpresaResumen, Perfil, TokenResponse } from '../models';

const ACCESS_KEY = 'qe.access';
const REFRESH_KEY = 'qe.refresh';
const EMPRESA_KEY = 'qe.empresa';

/**
 * Marca una petición que debe ir SIN el header X-Empresa-Id aunque haya una
 * empresa activa. La usa `revalidarMembresia()`: para saber si el usuario sigue
 * siendo miembro de la empresa activa hay que preguntarle al backend por su
 * empresa PRINCIPAL, y con el header puesto la pregunta misma daría 403.
 * Mismo patrón que SOLO_LECTURA (core/errores-red.ts): el contexto es local de
 * Angular y nunca viaja por la red.
 */
export const SIN_EMPRESA = new HttpContextToken<boolean>(() => false);

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly perfil = signal<Perfil | null>(null);
  /** Empresa activa (header X-Empresa-Id): la elegida en el selector de la barra. */
  readonly empresaActiva = signal<string | null>(localStorage.getItem(EMPRESA_KEY));
  readonly esSuperadmin = computed(() => this.perfil()?.es_superadmin ?? false);
  /**
   * Empresas a las que puede entrar el usuario, según el backend: sus
   * membresías, o todas las activas si es superadmin. Alimenta el selector.
   */
  readonly empresasDisponibles = computed<EmpresaResumen[]>(() => this.perfil()?.empresas ?? []);

  private permisos = new Set<string>();
  private perfilPromise: Promise<Perfil | null> | null = null;
  private refreshPromise: Promise<string | null> | null = null;
  private revalidacionPromise: Promise<boolean> | null = null;

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
    // La empresa activa del usuario ANTERIOR no se hereda: si en este navegador
    // un superadmin dejó guardada la empresa 2 y luego entra Alirio, sin este
    // reset Alirio arrancaría pidiendo datos de una empresa que quizá no es suya.
    this.seleccionarEmpresa(null);
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
    // La empresa activa también es de la sesión: dejarla en localStorage haría
    // que el siguiente usuario del mismo navegador la heredara.
    this.seleccionarEmpresa(null);
    this.perfil.set(null);
    this.permisos.clear();
    this.perfilPromise = null;
  }

  // ----------------------------------------------------------------- perfil
  ensurePerfil(): Promise<Perfil | null> {
    if (this.perfil()) return Promise.resolve(this.perfil());
    if (!this.isAuthenticated) return Promise.resolve(null);
    // Esta primera llamada va SIN header X-Empresa-Id (el interceptor solo lo
    // pone cuando ya conoce las membresías del perfil): el backend responde con
    // el contexto de la empresa PRINCIPAL, y de ahí se normaliza la activa.
    this.perfilPromise ??= firstValueFrom(this.http.get<Perfil>(`${API_BASE}/auth/me`))
      .then((perfil) => {
        this.aplicarPerfil(perfil);
        return this.normalizarEmpresaActiva(perfil);
      })
      .catch(() => {
        this.perfilPromise = null;
        return null;
      });
    return this.perfilPromise;
  }

  /** Reemplaza perfil y permisos de una sola vez (nunca deja el perfil en null). */
  private aplicarPerfil(perfil: Perfil): void {
    this.perfil.set(perfil);
    this.permisos = new Set(perfil.permisos);
  }

  /**
   * Cuadra la empresa activa guardada con las membresías que dijo el backend.
   *
   * - Superadmin: no se toca (el layout autoselecciona la primera si no hay).
   * - Guardada ausente o que ya no es membresía: cae a la principal del perfil
   *   (o a la primera membresía si no tiene principal).
   * - Guardada válida pero distinta de la del perfil recién pedido: ese perfil
   *   vino con roles/permisos de la PRINCIPAL, así que se re-pide una vez, ya
   *   con el header puesto, para que el menú refleje la empresa activa real.
   */
  private async normalizarEmpresaActiva(perfil: Perfil): Promise<Perfil> {
    if (perfil.es_superadmin) return perfil;
    const empresas = perfil.empresas ?? [];
    const activa = this.empresaActiva();
    if (!activa || !empresas.some((empresa) => empresa.id === activa)) {
      this.seleccionarEmpresa(perfil.empresa_id ?? empresas[0]?.id ?? null);
      return perfil;
    }
    if (activa !== perfil.empresa_id) {
      return (await this.recargarPerfil()) ?? perfil;
    }
    return perfil;
  }

  /**
   * Vuelve a pedir /auth/me y reemplaza perfil y permisos SIN pasar por null:
   * el menú no parpadea mientras se cambia de empresa. Devuelve null SOLO si la
   * red falló; en ese caso el perfil anterior queda intacto.
   */
  async recargarPerfil(): Promise<Perfil | null> {
    try {
      const perfil = await firstValueFrom(this.http.get<Perfil>(`${API_BASE}/auth/me`));
      this.aplicarPerfil(perfil);
      return perfil;
    } catch {
      return null;
    }
  }

  /**
   * ¿El usuario sigue siendo miembro de la empresa activa? Se pregunta cuando
   * una petición con header X-Empresa-Id recibe 403: puede ser un permiso que
   * le falta... o que el superadmin le quitó la membresía mientras trabajaba.
   *
   * Pide /auth/me SIN header (marca SIN_EMPRESA: con el header puesto la
   * pregunta misma daría 403). Si perdió la membresía, aplica el perfil de su
   * empresa principal y deja esa como activa; devuelve `false` para que el
   * interceptor avise y lo lleve a /inicio. Si la red falla no se puede afirmar
   * nada: devuelve `true` y el 403 original sigue su curso.
   *
   * La promesa se comparte entre los 403 concurrentes de una misma pantalla
   * (una lista dispara varias peticiones a la vez y todas fallarían juntas).
   */
  revalidarMembresia(): Promise<boolean> {
    this.revalidacionPromise ??= firstValueFrom(
      this.http.get<Perfil>(`${API_BASE}/auth/me`, {
        context: new HttpContext().set(SIN_EMPRESA, true),
      }),
    )
      .then((perfil) => {
        const activa = this.empresaActiva();
        const sigueSiendoMiembro =
          perfil.es_superadmin ||
          (perfil.empresas ?? []).some((empresa) => empresa.id === activa);
        if (!sigueSiendoMiembro) {
          this.aplicarPerfil(perfil);
          this.seleccionarEmpresa(perfil.empresa_id ?? perfil.empresas?.[0]?.id ?? null);
        }
        return sigueSiendoMiembro;
      })
      .catch(() => true)
      .finally(() => {
        this.revalidacionPromise = null;
      });
    return this.revalidacionPromise;
  }

  hasPermission(modulo: string, accion = 'consultar'): boolean {
    const perfil = this.perfil();
    if (!perfil) return false;
    return perfil.es_superadmin || this.permisos.has(`${modulo}:${accion}`);
  }

  // ---------------------------------------------------------------- refresh
  /**
   * Renueva el access token; comparte una única petición entre llamadas concurrentes.
   *
   * Devuelve `null` SOLO cuando la sesión de verdad se acabó (el servidor
   * rechazó el refresh token). Si el fallo fue de RED, RECHAZA con ese error en
   * vez de devolver null, y deja los tokens donde estaban.
   *
   * Por qué importa la diferencia: antes cualquier fallo borraba qe.access y
   * qe.refresh. Con el token vencido de la noche a la mañana y Render
   * arrancando en frío (~45 s contra un límite de 30 s), la primera acción del
   * día —registrar un abono— acababa así: 401 -> refresh -> tiempo agotado ->
   * sesión borrada -> navegación a /login -> el diálogo del abono se cierra
   * (MatDialog usa closeOnNavigation) y el dueño pierde lo que había escrito,
   * sin que hubiera nada malo con su sesión.
   */
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
      .catch((error: unknown) => {
        // Solo un rechazo de credenciales prueba que la sesión ya no sirve.
        if (this.esRechazoDeCredenciales(error)) {
          this.limpiarSesion();
          return null;
        }
        // Fallo de red: el refresh token sigue siendo bueno, así que no se toca
        // nada. Se propaga para que el interceptor lo traduzca a "sin conexión"
        // en vez de mandar al login.
        throw error;
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  /**
   * ¿El servidor rechazó las credenciales? Es lo único que justifica cerrar la
   * sesión. Un status 0, un TimeoutError o un 5xx significan que no hubo
   * respuesta, no que el refresh token esté vencido.
   */
  private esRechazoDeCredenciales(error: unknown): boolean {
    return error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403);
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
