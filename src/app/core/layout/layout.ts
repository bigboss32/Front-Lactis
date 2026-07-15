import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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
import { firstValueFrom, map } from 'rxjs';

import { ApiService } from '../api.service';
import { AuthService } from '../auth/auth.service';
import { Empresa, Page } from '../models';
import { NotificacionesService } from '../notificaciones.service';
import { ThemeService } from '../theme.service';
import { NAV_GROUPS } from './nav';

@Component({
  selector: 'app-layout',
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule, MatButtonModule,
    MatMenuModule, MatBadgeModule, MatDividerModule, MatSelectModule, MatTooltipModule,
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

  readonly esMovil = toSignal(
    this.breakpoints.observe([Breakpoints.Small, Breakpoints.XSmall]).pipe(map((r) => r.matches)),
    { initialValue: false },
  );
  readonly empresas = signal<Empresa[]>([]);

  readonly grupos = computed(() => {
    this.auth.perfil();
    return NAV_GROUPS.map((grupo) => ({
      ...grupo,
      items: grupo.items.filter((item) => this.auth.hasPermission(item.modulo)),
    })).filter((grupo) => grupo.items.length > 0);
  });

  private pollId: ReturnType<typeof setInterval> | null = null;

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
}
