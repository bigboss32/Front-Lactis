import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter, map } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import { NotificacionesService } from '../notificaciones.service';
import { ThemeService } from '../theme.service';
import { BarraBusquedaGlobal } from '../../shared/barra-busqueda-global';
import { NAV_GROUPS, NEGOCIOS, NavGroup, Negocio } from './nav';

@Component({
  selector: 'app-layout',
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule, MatButtonModule,
    MatMenuModule, MatBadgeModule, MatDividerModule, MatSelectModule, MatTooltipModule,
    BarraBusquedaGlobal,
  ],
  templateUrl: './layout.html',
  styleUrl: './layout.scss',
})
export class Layout implements OnInit, OnDestroy {
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly router = inject(Router);
  private readonly snackbar = inject(MatSnackBar);

  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  readonly notificaciones = inject(NotificacionesService);

  /**
   * Pantallas donde el menú se pliega (modo "over" y cerrado al entrar).
   *
   * Incluye Medium (960–1279px) a propósito: ahí caen las TABLETS. Con el menú
   * fijo se comía 267px de 1024 (un 26% de la pantalla), dejando el contenido en
   * 757px pero con el diseño de escritorio, porque toda la CSS responsive del
   * proyecto arranca en 900px. Y como ese menú no tenía nada que desplazar, la
   * franja quedaba como zona muerta para el dedo: pasar el dedo por ahí no
   * movía la página.
   */
  readonly esMovil = toSignal(
    this.breakpoints
      .observe([Breakpoints.Medium, Breakpoints.Small, Breakpoints.XSmall])
      .pipe(map((r) => r.matches)),
    { initialValue: false },
  );
  /**
   * Empresas del selector de la barra: las que el backend puso en el perfil
   * (membresías del usuario, o todas las activas si es superadmin). Se muestra
   * al superadmin siempre y al resto solo cuando tiene más de una.
   */
  readonly empresasSelector = computed(() => this.auth.empresasDisponibles());
  /** Elemento con el scroll de la página (mat-sidenav-content). */
  private readonly contenido = viewChild('contenido', { read: ElementRef });

  /**
   * Negocio aparte donde está parado el usuario (null en la quesera). De aquí
   * salen el menú contextual y la identidad de color de la interfaz: así el
   * menú no mezcla los dos libros contables, que era lo que confundía, y el
   * usuario ve de una en qué negocio está.
   */
  readonly negocio = computed<Negocio | null>(() => {
    const ruta = this.urlActual().split('?')[0];
    return NEGOCIOS.find((n) => ruta === n.prefijo || ruta.startsWith(n.prefijo + '/')) ?? null;
  });

  private readonly gruposBase = computed<NavGroup[]>(() => this.negocio()?.grupos ?? NAV_GROUPS);

  /**
   * Aviso de la suscripción de la empresa activa (franja entre la barra y el
   * contenido): ámbar cuando está por vencer, rojo en los días de gracia. El
   * superadmin no lo ve nunca (las empresas no son "suyas" y él no se bloquea)
   * y el bloqueo total tampoco lo necesita: de ese se encargan el guard y el
   * paywall (features/suscripcion/suscripcion.page.ts).
   */
  readonly avisoSuscripcion = computed<{ tono: 'ambar' | 'rojo'; texto: string } | null>(() => {
    const perfil = this.auth.perfil();
    const suscripcion = perfil?.suscripcion;
    if (!perfil || perfil.es_superadmin || !suscripcion) return null;
    const dias = suscripcion.dias_restantes;
    if (suscripcion.estado === 'por_vencer' && dias !== null) {
      return {
        tono: 'ambar',
        texto:
          dias === 0
            ? 'La suscripción vence hoy.'
            : `La suscripción vence en ${enDias(dias)}.`,
      };
    }
    if (suscripcion.estado === 'gracia' && dias !== null) {
      // En gracia los días restantes vienen NEGATIVOS: -2 con 5 de gracia
      // significa que venció hace 2 días y el bloqueo cae en 3.
      const paraBloqueo = suscripcion.dias_gracia + dias;
      return {
        tono: 'rojo',
        texto:
          `La suscripción venció hace ${enDias(-dias)}. ` +
          `El sistema se bloqueará en ${enDias(paraBloqueo)}.`,
      };
    }
    return null;
  });

  readonly grupos = computed(() => {
    this.auth.perfil();
    return this.gruposBase().map((grupo) => ({
      ...grupo,
      items: grupo.items.filter((item) => item.siempre || this.auth.hasPermission(item.modulo)),
    })).filter((grupo) => grupo.items.length > 0);
  });

  /** Grupos del menú (acordeón) que están desplegados, por título. */
  readonly abiertos = signal<Set<string>>(new Set());

  /** URL actual, para abrir automáticamente el grupo del módulo en pantalla. */
  private readonly urlActual = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  private pollId: ReturnType<typeof setInterval> | null = null;
  /** Ticks del polling de notificaciones (uno por minuto). */
  private ticksPoll = 0;

  constructor() {
    // Abre el grupo del módulo actual (sin cerrar los que el usuario abrió).
    effect(() => {
      const grupo = this.grupoDeRuta(this.urlActual());
      if (grupo) {
        this.abiertos.update((s) => (s.has(grupo) ? s : new Set(s).add(grupo)));
      }
    });
  }

  /** Título del grupo cuyo ítem coincide con la ruta dada (null si ninguno). */
  private grupoDeRuta(url: string): string | null {
    const ruta = url.split('?')[0];
    for (const grupo of this.gruposBase()) {
      if (!grupo.title) continue;
      if (grupo.items.some((it) => ruta === it.route || ruta.startsWith(it.route + '/'))) {
        return grupo.title;
      }
    }
    return null;
  }

  estaAbierto(title: string): boolean {
    return this.abiertos().has(title);
  }

  toggleGrupo(title: string): void {
    this.abiertos.update((s) => {
      const nuevo = new Set(s);
      if (nuevo.has(title)) nuevo.delete(title);
      else nuevo.add(title);
      return nuevo;
    });
  }

  async ngOnInit(): Promise<void> {
    await this.auth.ensurePerfil();
    // Selecciona la primera empresa para el superadmin si no hay una activa
    // guardada (a los demás se la normaliza el propio AuthService).
    if (this.auth.esSuperadmin() && !this.auth.empresaActiva()) {
      const primera = this.empresasSelector()[0];
      if (primera) this.auth.seleccionarEmpresa(primera.id);
    }
    this.notificaciones.refrescar();
    this.pollId = setInterval(() => {
      this.notificaciones.refrescar();
      // Cada 15 ticks (15 min) se recarga también el perfil: el estado de la
      // suscripción cambia solo con el paso de los días (o por el webhook de
      // la pasarela) y el aviso debe seguirlo sin que nadie pulse F5.
      if (++this.ticksPoll % 15 === 0) this.auth.recargarPerfil();
    }, 60_000);
  }

  ngOnDestroy(): void {
    if (this.pollId) clearInterval(this.pollId);
  }

  async cambiarEmpresa(empresaId: string): Promise<void> {
    const anterior = this.auth.empresaActiva();
    if (empresaId === anterior) return;
    // El orden importa: primero la empresa (para que el header salga bien),
    // luego el perfil (los guards de la navegación usan ensurePerfil() cacheado
    // y deben ver los permisos de la NUEVA empresa) y solo al final se navega.
    this.auth.seleccionarEmpresa(empresaId);
    const perfil = await this.auth.recargarPerfil();
    if (!perfil) {
      // La red falló: se revierte para que el selector no mienta. El perfil
      // anterior sigue intacto (recargarPerfil no lo toca cuando falla).
      this.auth.seleccionarEmpresa(anterior);
      this.snackbar.open(
        'No fue posible cambiar de empresa. Revisa la señal y vuelve a intentar.',
        'OK',
        { duration: 5000 },
      );
      return;
    }
    // Recarga la vista actual para que los datos correspondan a la nueva empresa.
    // Si en ella no tiene permiso para esta pantalla, permisoGuard lo manda a
    // /inicio con su aviso: es el comportamiento deseado.
    const url = this.router.url;
    await this.router.navigateByUrl('/', { skipLocationChange: true });
    await this.router.navigateByUrl(url);
  }

  logout(): void {
    this.auth.logout();
  }

  /**
   * Reenvía la rueda del mouse del menú lateral al contenido cuando el menú no
   * puede desplazarse (o ya llegó a su tope): así la página scrollea aunque el
   * cursor esté sobre el menú, evitando la "zona muerta" de scroll.
   */
  reenviarRueda(evento: WheelEvent): void {
    this.desplazarContenido(evento.currentTarget as HTMLElement, evento.deltaY, evento);
  }

  /** Y del último toque, para calcular cuánto se arrastró el dedo. */
  private toqueY: number | null = null;

  onToqueInicio(evento: TouchEvent): void {
    this.toqueY = evento.touches[0]?.clientY ?? null;
  }

  /**
   * Mismo problema que la rueda pero con el dedo: en pantallas grandes con táctil
   * (una tablet apaisada de 1280px o más) el menú queda fijo y, si no tiene nada
   * que desplazar, arrastrar el dedo sobre él no movía nada. Aquí ese arrastre se
   * reenvía al contenido para que no haya zona muerta.
   */
  onToqueMover(evento: TouchEvent): void {
    const y = evento.touches[0]?.clientY;
    if (y == null || this.toqueY == null) return;
    const delta = this.toqueY - y;
    this.toqueY = y;
    this.desplazarContenido(evento.currentTarget as HTMLElement, delta, evento);
  }

  onToqueFin(): void {
    this.toqueY = null;
  }

  /**
   * Desplaza el contenido de la página cuando el menú no puede desplazarse (o ya
   * llegó a su tope), para que la página se mueva aunque el gesto empiece sobre
   * el menú y no quede una "zona muerta" de scroll.
   */
  private desplazarContenido(host: HTMLElement, delta: number, evento: Event): void {
    if (!delta) return;
    // El scroll del menú vive en el contenedor interno de Material.
    const nav = (host.querySelector('.mat-drawer-inner-container') as HTMLElement | null) ?? host;
    const enTope =
      (delta < 0 && nav.scrollTop <= 0) ||
      (delta > 0 && nav.scrollTop + nav.clientHeight >= nav.scrollHeight - 1);
    if (nav.scrollHeight <= nav.clientHeight + 1 || enTope) {
      const cont = this.contenido()?.nativeElement;
      if (cont) {
        cont.scrollTop += delta;
        if (evento.cancelable) evento.preventDefault();
      }
    }
  }
}

/** '1 día' / 'N días', para que el aviso de la suscripción no diga "1 días". */
function enDias(dias: number): string {
  return dias === 1 ? '1 día' : `${dias} días`;
}
