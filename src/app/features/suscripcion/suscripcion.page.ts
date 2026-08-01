import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { PagoSuscripcion, SuscripcionDetalle } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { EstadoChip } from '../../shared/estado-chip';
import { PageHeader } from '../../shared/page-header';
import { MoneyPipe } from '../../shared/pipes';
import {
  ETIQUETAS_ESTADO_PAGO,
  ETIQUETAS_ESTADO_SUSCRIPCION,
  ETIQUETAS_ORIGEN_PAGO,
  SuscripcionService,
} from './suscripcion.service';
import { TarjetaFormDialog } from './tarjeta-form.dialog';

/**
 * Pantalla de la suscripción de la empresa activa... y también EL PAYWALL: es
 * a donde mandan el guard y el interceptor cuando la empresa está bloqueada,
 * y por eso es de las pocas rutas que el bloqueo deja pasar.
 */
@Component({
  selector: 'app-suscripcion-page',
  imports: [
    DatePipe, MatCardModule, MatTableModule, MatPaginatorModule, MatButtonModule,
    MatIconModule, MatProgressBarModule,
    PageHeader, EstadoChip, MoneyPipe, HasPermissionDirective,
  ],
  template: `
    <div class="page">
      <app-page-header
        titulo="Suscripción"
        subtitulo="Mensualidad del sistema para la empresa activa"
      />

      <!-- Paywall: se pinta también cuando GET /suscripcion falló por permiso,
           porque el estado viene del perfil (que siempre está disponible). -->
      @if (estado() === 'bloqueada') {
        <div class="paywall">
          <mat-icon aria-hidden="true">lock</mat-icon>
          <div>
            <strong>La suscripción está vencida y el sistema quedó bloqueado.</strong>
            <p>
              Regulariza el pago para seguir trabajando. Mientras tanto solo esta
              pantalla y tu perfil siguen disponibles.
            </p>
          </div>
        </div>
      }

      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (sinPermiso()) {
        <!-- Tiene sesión pero no el permiso del módulo suscripcion: puede pasar
             (la ruta no lleva permisoGuard, ver app.routes.ts) pero no ver ni
             pagar nada. Se le dice a quién acudir. -->
        <div class="empty-state">
          <mat-icon>card_membership</mat-icon>
          <p>No tienes acceso a la suscripción de esta empresa.</p>
          <p>Pídele al administrador de la empresa que revise o regularice el pago.</p>
        </div>
      } @else if (error()) {
        <div class="error-state">
          <mat-icon>cloud_off</mat-icon>
          <p>No fue posible consultar la suscripción.</p>
          <p class="aclara">Revisa la señal y vuelve a intentar.</p>
          <button mat-stroked-button (click)="cargar()">
            <mat-icon>refresh</mat-icon> Reintentar
          </button>
        </div>
      } @else if (detalle(); as d) {
        <div class="grid">
          <mat-card>
            <mat-card-header><mat-card-title>Estado</mat-card-title></mat-card-header>
            <mat-card-content>
              <div class="renglon">
                <span>Estado</span>
                <app-estado-chip [estado]="etiquetaEstado(d.estado)" />
              </div>
              @if (d.exenta) {
                <p class="nota">Sin costo: esta empresa está exenta de pago.</p>
              } @else {
                <div class="renglon">
                  <span>Tarifa mensual</span>
                  <strong>{{ d.tarifa | money }}</strong>
                </div>
                <div class="renglon">
                  <span>Pagada hasta</span>
                  <strong>{{ d.pagada_hasta | date: 'dd/MM/yyyy' }}</strong>
                </div>
                <div class="renglon">
                  <span>Días restantes</span>
                  <strong>{{ d.dias_restantes }}</strong>
                </div>
                @if (d.pago_pendiente) {
                  <p class="nota pendiente">
                    Hay un pago en proceso; el resultado se confirmará en unos minutos.
                  </p>
                }
              }
            </mat-card-content>
            @if (!d.exenta) {
              <mat-card-actions>
                <button
                  mat-flat-button
                  *hasPermission="'suscripcion:crear'"
                  [disabled]="pagando() || d.pago_pendiente || !d.fuente_pago"
                  (click)="pagar()"
                >
                  <mat-icon>payments</mat-icon>
                  {{ pagando() ? 'Procesando…' : 'Pagar ahora' }}
                </button>
              </mat-card-actions>
              @if (!auth.hasPermission('suscripcion', 'crear')) {
                <mat-card-footer class="nota pie">
                  Si la suscripción está vencida, pídele al administrador de la
                  empresa que realice el pago.
                </mat-card-footer>
              } @else if (!d.fuente_pago) {
                <mat-card-footer class="nota pie">
                  Guarda una tarjeta para poder pagar (y para el cobro automático mensual).
                </mat-card-footer>
              }
            }
          </mat-card>

          <mat-card>
            <mat-card-header><mat-card-title>Tarjeta de pago</mat-card-title></mat-card-header>
            <mat-card-content>
              @if (d.fuente_pago; as f) {
                <div class="renglon">
                  <span>Tarjeta</span>
                  <strong>{{ f.marca }} •••• {{ f.ultimos4 }}</strong>
                </div>
                <div class="renglon">
                  <span>Vence</span>
                  <strong>{{ f.exp_mes }}/{{ f.exp_anio }}</strong>
                </div>
                <div class="renglon">
                  <span>Correo del pagador</span>
                  <strong>{{ f.customer_email }}</strong>
                </div>
                <p class="nota">
                  Con la tarjeta guardada, la mensualidad se cobra automáticamente al vencer.
                </p>
              } @else {
                <p class="nota">
                  Sin tarjeta guardada. Guarda una para que la mensualidad se cobre
                  automáticamente y para poder usar "Pagar ahora".
                </p>
              }
            </mat-card-content>
            @if (!d.exenta) {
              <mat-card-actions>
                <button
                  mat-stroked-button
                  *hasPermission="'suscripcion:administrar'"
                  (click)="abrirTarjeta()"
                >
                  <mat-icon>credit_card</mat-icon>
                  {{ d.fuente_pago ? 'Cambiar tarjeta' : 'Guardar tarjeta' }}
                </button>
                @if (d.fuente_pago) {
                  <button
                    mat-button
                    *hasPermission="'suscripcion:administrar'"
                    (click)="eliminarTarjeta()"
                  >
                    <mat-icon>delete</mat-icon> Eliminar
                  </button>
                }
              </mat-card-actions>
              @if (!auth.hasPermission('suscripcion', 'administrar')) {
                <mat-card-footer class="nota pie">
                  La tarjeta la gestiona el administrador de la empresa.
                </mat-card-footer>
              }
            }
          </mat-card>
        </div>

        <h2 class="titulo-historial">Historial de pagos</h2>
        <mat-card class="table-card">
          <table mat-table [dataSource]="pagos()">
            <ng-container matColumnDef="fecha">
              <th mat-header-cell *matHeaderCellDef>Fecha</th>
              <td mat-cell *matCellDef="let fila">{{ fila.created_at | date: 'dd/MM/yyyy HH:mm' }}</td>
            </ng-container>

            <ng-container matColumnDef="monto">
              <th mat-header-cell *matHeaderCellDef class="num">Monto</th>
              <td mat-cell *matCellDef="let fila" class="num">{{ fila.monto | money }}</td>
            </ng-container>

            <ng-container matColumnDef="estado">
              <th mat-header-cell *matHeaderCellDef>Estado</th>
              <td mat-cell *matCellDef="let fila">
                <app-estado-chip [estado]="etiquetaPago(fila.estado_transaccion)" />
              </td>
            </ng-container>

            <ng-container matColumnDef="origen">
              <th mat-header-cell *matHeaderCellDef>Origen</th>
              <td mat-cell *matCellDef="let fila">{{ etiquetaOrigen(fila.origen) }}</td>
            </ng-container>

            <ng-container matColumnDef="periodo">
              <th mat-header-cell *matHeaderCellDef>Período que cubrió</th>
              <td mat-cell *matCellDef="let fila">
                @if (fila.periodo_desde) {
                  {{ fila.periodo_desde | date: 'dd/MM/yyyy' }} —
                  {{ fila.periodo_hasta | date: 'dd/MM/yyyy' }}
                } @else {
                  —
                }
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="columnas"></tr>
            <tr mat-row *matRowDef="let fila; columns: columnas"></tr>
          </table>

          @if (pagos().length === 0) {
            <div class="empty-state">
              <mat-icon>receipt_long</mat-icon>
              <p>Todavía no hay pagos registrados</p>
            </div>
          }

          <mat-paginator
            [length]="totalPagos()"
            [pageIndex]="page() - 1"
            [pageSize]="pageSize()"
            [pageSizeOptions]="[10, 20, 50]"
            (page)="cambiarPagina($event)"
            showFirstLastButtons
          />
        </mat-card>
      }
    </div>
  `,
  styles: `
    .paywall {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 16px;
      padding: 14px 16px;
      border-radius: 12px;
      border-left: 4px solid #c62828;
      background: color-mix(in srgb, #c62828 14%, transparent);
      color: #c62828;

      p { margin: 2px 0 0; color: var(--mat-sys-on-surface-variant); }
      mat-icon { flex-shrink: 0; }
    }
    :host-context(html.dark) .paywall { color: #e57373; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }

    .renglon {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 6px 0;

      > span { color: var(--mat-sys-on-surface-variant); }
    }

    .nota {
      margin: 8px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.88rem;

      &.pendiente { color: #b26a00; }
    }
    :host-context(html.dark) .nota.pendiente { color: #ffb74d; }

    .pie { padding: 0 16px 12px; }

    mat-card-actions { gap: 8px; }

    .titulo-historial {
      margin: 24px 0 12px;
      font-size: 1.1rem;
      font-weight: 500;
    }
  `,
})
export class SuscripcionPage implements OnInit {
  private readonly servicio = inject(SuscripcionService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  readonly columnas = ['fecha', 'monto', 'estado', 'origen', 'periodo'];

  readonly detalle = signal<SuscripcionDetalle | null>(null);
  readonly pagos = signal<PagoSuscripcion[]>([]);
  readonly totalPagos = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly cargando = signal(false);
  readonly pagando = signal(false);
  /** GET /suscripcion devolvió 403: sin `suscripcion:consultar`. */
  readonly sinPermiso = signal(false);
  readonly error = signal(false);

  /**
   * Estado para el paywall: el del detalle si cargó, o el del perfil como
   * respaldo (así el banner rojo también se ve para quien no tiene permiso
   * de consultar la suscripción y cayó aquí redirigido por el bloqueo).
   */
  readonly estado = computed(
    () => this.detalle()?.estado ?? this.auth.perfil()?.suscripcion?.estado ?? null,
  );

  private readonly money = new MoneyPipe();

  ngOnInit(): void {
    this.cargar();
  }

  // Etiquetas legibles con la clave cruda como respaldo. El `??` va aquí y no
  // en el template porque los Record<string, string> indexan como `string` y
  // la plantilla lo marcaría como coalescencia innecesaria (NG8102).
  etiquetaEstado(estado: string): string {
    return ETIQUETAS_ESTADO_SUSCRIPCION[estado] ?? estado;
  }

  etiquetaPago(estado: string): string {
    return ETIQUETAS_ESTADO_PAGO[estado] ?? estado;
  }

  etiquetaOrigen(origen: string): string {
    return ETIQUETAS_ORIGEN_PAGO[origen] ?? origen;
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.sinPermiso.set(false);
    this.error.set(false);
    try {
      this.detalle.set(await firstValueFrom(this.servicio.resumen()));
      await this.cargarPagos();
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 403) {
        this.sinPermiso.set(true);
      } else {
        this.error.set(true);
      }
    } finally {
      this.cargando.set(false);
    }
  }

  private async cargarPagos(): Promise<void> {
    const respuesta = await firstValueFrom(
      this.servicio.pagos({ page: this.page(), page_size: this.pageSize() }),
    );
    this.pagos.set(respuesta.items);
    this.totalPagos.set(respuesta.total);
  }

  async cambiarPagina(evento: PageEvent): Promise<void> {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    try {
      await this.cargarPagos();
    } catch (err) {
      this.snackbar.open(
        detalleDeError(err, 'No fue posible cargar el historial'),
        'OK',
        { duration: 5000 },
      );
    }
  }

  /** Abre el alta/cambio de tarjeta; la config de Wompi se pide FRESCA cada vez. */
  async abrirTarjeta(): Promise<void> {
    try {
      const config = await firstValueFrom(this.servicio.config());
      this.dialog
        .open(TarjetaFormDialog, {
          data: { config, reemplaza: !!this.detalle()?.fuente_pago },
          width: '560px',
        })
        .afterClosed()
        .subscribe((guardada) => {
          if (!guardada) return;
          this.snackbar.open('Tarjeta guardada', 'OK', { duration: 4000 });
          this.cargar();
        });
    } catch (err) {
      // wompi_no_configurado (llaves sin poner) llega con su propio detalle.
      this.snackbar.open(
        detalleDeError(err, 'La pasarela de pagos no está disponible'),
        'OK',
        { duration: 6000 },
      );
    }
  }

  eliminarTarjeta(): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar tarjeta',
          mensaje:
            '¿Eliminar la tarjeta guardada? El cobro automático quedará desactivado ' +
            'hasta que se guarde otra.',
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(this.servicio.eliminarFuentePago());
          this.snackbar.open('Tarjeta eliminada', 'OK', { duration: 4000 });
          this.cargar();
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible eliminar la tarjeta');
        }
      });
  }

  pagar(): void {
    const d = this.detalle();
    if (!d?.fuente_pago) return;
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Pagar suscripción',
          mensaje:
            `Se cobrarán ${this.money.transform(d.tarifa)} a la tarjeta ` +
            `${d.fuente_pago.marca} •••• ${d.fuente_pago.ultimos4}.`,
          accion: 'Pagar ahora',
          peligro: false,
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (confirmado) this.ejecutarPago();
      });
  }

  private async ejecutarPago(): Promise<void> {
    this.pagando.set(true);
    try {
      const estabaBloqueada = this.estado() === 'bloqueada';
      const resultado = await firstValueFrom(this.servicio.pagar());
      this.detalle.set(resultado.suscripcion);
      await this.cargarPagos();
      // El banner del layout y el guard del paywall leen el PERFIL: se
      // refresca para que el desbloqueo (o el bloqueo) se vea de inmediato.
      await this.auth.recargarPerfil();
      switch (resultado.pago.estado_transaccion) {
        case 'APPROVED':
          this.snackbar.open('Pago aprobado: suscripción al día', 'OK', { duration: 5000 });
          // Venía del paywall: se le devuelve el sistema completo.
          if (estabaBloqueada) this.router.navigate(['/inicio']);
          break;
        case 'DECLINED':
          // DECLINED llega con 200: no es un error de red, es la tarjeta.
          this.snackbar.open(
            'La pasarela RECHAZÓ el pago. Revisa la tarjeta o guarda otra.',
            'OK',
            { duration: 8000 },
          );
          break;
        default:
          // PENDING u otro estado no final: el webhook o la consulta perezosa
          // de GET /suscripcion lo resolverán.
          this.snackbar.open(
            'El pago quedó en proceso; el resultado se confirmará en unos minutos.',
            'OK',
            { duration: 8000 },
          );
      }
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible procesar el pago');
    } finally {
      this.pagando.set(false);
    }
  }
}
