import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Notificacion } from '../../core/models';
import { PageHeader } from '../../shared/page-header';
import { NotificacionesService } from './notificaciones.service';

/** Etiquetas legibles para los tipos de alerta que emite el backend. */
const ETIQUETAS_TIPO: Record<string, string> = {
  stock_bajo: 'Stock bajo',
  proveedores_sin_liquidar: 'Proveedores sin liquidar',
  pagos_pendientes: 'Pagos pendientes',
  usuario_bloqueado: 'Usuario bloqueado',
};

@Component({
  selector: 'app-notificacion-list',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTableModule, MatPaginatorModule,
    MatButtonModule, MatIconModule, MatProgressBarModule, MatSlideToggleModule,
    MatTooltipModule,
    PageHeader, HasPermissionDirective,
  ],
  templateUrl: './notificacion-list.page.html',
  styles: `
    tr.no-leida td { font-weight: 600; }

    .chip-tipo {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      background: color-mix(in srgb, currentColor 12%, transparent);
      color: var(--mat-sys-on-surface-variant);
    }

    .leida-icono   { color: #2e7d32; }
    .pendiente-icono { color: var(--mat-sys-on-surface-variant); }
    :host-context(html.dark) {
      .leida-icono { color: #81c784; }
    }

    td.mensaje { max-width: 380px; }
  `,
})
export class NotificacionListPage implements OnInit {
  private readonly servicio = inject(NotificacionesService);
  private readonly snackbar = inject(MatSnackBar);

  readonly columnas = ['leida', 'tipo', 'titulo', 'mensaje', 'fecha', 'acciones'];
  readonly filas = signal<Notificacion[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly generando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  readonly soloNoLeidas = new FormControl(false, { nonNullable: true });

  constructor() {
    this.soloNoLeidas.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
  }

  ngOnInit(): void {
    this.cargar();
  }

  etiquetaTipo(tipo: string): string {
    return ETIQUETAS_TIPO[tipo] ?? tipo;
  }

  recargar(): void {
    this.page.set(1);
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.listar({
          page: this.page(),
          page_size: this.pageSize(),
          solo_no_leidas: this.soloNoLeidas.value || undefined,
        }),
      );
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    this.cargar();
  }

  async marcarLeida(item: Notificacion): Promise<void> {
    try {
      await firstValueFrom(this.servicio.marcarLeida(item.id));
      this.cargar();
    } catch (err) {
      this.snackbar.open(this.detalleError(err), 'OK', { duration: 5000 });
    }
  }

  async marcarTodas(): Promise<void> {
    try {
      const respuesta = await firstValueFrom(this.servicio.marcarTodas());
      this.snackbar.open(
        respuesta.marcadas > 0
          ? `${respuesta.marcadas} notificaciones marcadas como leídas`
          : 'No hay notificaciones pendientes',
        'OK',
        { duration: 4000 },
      );
      this.cargar();
    } catch (err) {
      this.snackbar.open(this.detalleError(err), 'OK', { duration: 5000 });
    }
  }

  async generarAlertas(): Promise<void> {
    this.generando.set(true);
    try {
      const respuesta = await firstValueFrom(this.servicio.generarAlertas());
      if (respuesta.generadas === 0) {
        this.snackbar.open('No se generaron alertas nuevas', 'OK', { duration: 4000 });
      } else {
        const detalle = Object.entries(respuesta.detalle)
          .filter(([, cantidad]) => cantidad > 0)
          .map(([tipo, cantidad]) => `${this.etiquetaTipo(tipo)}: ${cantidad}`)
          .join(', ');
        this.snackbar.open(
          `${respuesta.generadas} alertas generadas — ${detalle}`,
          'OK',
          { duration: 7000 },
        );
      }
      this.cargar();
    } catch (err) {
      this.snackbar.open(this.detalleError(err), 'OK', { duration: 5000 });
    } finally {
      this.generando.set(false);
    }
  }

  private detalleError(err: unknown): string {
    return err instanceof HttpErrorResponse
      ? (err.error?.error?.detail ?? 'No fue posible completar la operación')
      : 'No fue posible completar la operación';
  }
}
