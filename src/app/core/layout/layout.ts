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
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter, firstValueFrom, map } from 'rxjs';

import { ApiService } from '../api.service';
import { AuthService } from '../auth/auth.service';
import { Empresa, Page } from '../models';
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
  private readonly api = inject(ApiService);
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly router = inject(Router);

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
  readonly empresas = signal<Empresa[]>([]);
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
    if (this.auth.esSuperadmin()) {
      const page = await firstValueFrom(this.api.get<Page<Empresa>>('/empresas', { page_size: 100 }));
      this.empresas.set(page.items);
      // Selecciona la primera empresa si no hay una activa guardada
      if (!this.auth.empresaActiva() && page.items.length > 0) {
        this.auth.seleccionarEmpresa(page.items[0].id);
      }
    }
    this.notificaciones.refrescar();
    this.pollId = setInterval(() => this.notificaciones.refrescar(), 60_000);
  }

  ngOnDestroy(): void {
    if (this.pollId) clearInterval(this.pollId);
  }

  cambiarEmpresa(empresaId: string): void {
    this.auth.seleccionarEmpresa(empresaId);
    // Recarga la vista actual para que los datos correspondan a la nueva empresa
    const url = this.router.url;
    this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => this.router.navigateByUrl(url));
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
