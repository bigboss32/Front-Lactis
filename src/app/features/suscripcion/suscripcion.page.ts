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
import { SpinnerBoton } from '../../shared/spinner-boton';
import { PseFormDialog } from './pse-form.dialog';
import {
  ETIQUETAS_ESTADO_PAGO,
  ETIQUETAS_ESTADO_SUSCRIPCION,
  ETIQUETAS_METODO_PAGO,
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
    PageHeader, EstadoChip, MoneyPipe, HasPermissionDirective, SpinnerBoton,
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

      <!-- PSE dejado a medias: el pago existe y está esperando en el banco.
           Sin esto la persona queda atascada: no puede pagar otra vez (hay uno
           pendiente) y no sabe que le falta un clic para terminar. -->
      @if (psePendiente(); as pse) {
        <div class="retomar">
          <mat-icon aria-hidden="true">account_balance</mat-icon>
          <div>
            <strong>Tienes un pago por PSE sin aprobar.</strong>
            <p>
              Quedó registrado {{ pse.created_at | date: 'dd/MM/yyyy HH:mm' }} y
              está esperando que lo apruebes en el portal de tu banco.
            </p>
          </div>
          <div class="acciones-retomar">
            @if (pse.url_banco) {
              <a mat-flat-button [href]="pse.url_banco" target="_blank" rel="noopener">
                <mat-icon>open_in_new</mat-icon> Continuar en el banco
              </a>
            } @else {
              <!-- Wompi publica el enlace del banco un instante DESPUÉS de crear
                   la transacción; el backend lo rescata al consultar el estado. -->
              <button mat-flat-button [disabled]="consultando()" (click)="actualizarEstado()">
                <mat-icon>refresh</mat-icon> Buscar el enlace del banco
              </button>
            }
            <!-- Para cuando el webhook no llega: pregunta a la pasarela AHORA.
                 Sin esto, quien ya pagó en el banco se queda mirando un
                 "pendiente" que puede no moverse nunca. -->
            <button mat-stroked-button [disabled]="consultando()" (click)="actualizarEstado()">
              @if (consultando()) {
                <app-spinner-boton /> Consultando…
              } @else {
                <ng-container><mat-icon>sync</mat-icon> Ya pagué, actualizar</ng-container>
              }
            </button>
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
                    Hay un pago en proceso; normalmente se confirma solo en unos
                    minutos.
                  </p>
                  <!-- Si es un PSE, el aviso de arriba ya trae este botón: no se
                       repite. Este es para el pago con tarjeta que se quedó
                       colgado, que también puede pasar. -->
                  @if (!psePendiente()) {
                    <button
                      mat-stroked-button
                      class="consultar"
                      [disabled]="consultando()"
                      (click)="actualizarEstado()"
                    >
                      @if (consultando()) {
                        <app-spinner-boton /> Consultando…
                      } @else {
                        <ng-container><mat-icon>sync</mat-icon> Actualizar estado</ng-container>
                      }
                    </button>
                  }
                }
              }
            </mat-card-content>
            @if (!d.exenta) {
              <mat-card-actions>
                <button
                  mat-flat-button
                  *hasPermission="'suscripcion:crear'"
                  [disabled]="pagando() || d.pago_pendiente || !d.fuente_pago || alDia()"
                  (click)="pagar()"
                >
                  <mat-icon>credit_card</mat-icon>
                  {{ pagando() ? 'Procesando…' : 'Pagar con la tarjeta' }}
                </button>
                <!-- PSE no necesita tarjeta guardada: es el camino para quien no
                     tiene ninguna, y el único si su banco no le da tarjetas. -->
                <button
                  mat-stroked-button
                  *hasPermission="'suscripcion:crear'"
                  [disabled]="pagando() || d.pago_pendiente || alDia()"
                  (click)="abrirPse()"
                >
                  <mat-icon>account_balance</mat-icon> Pagar por PSE
                </button>
              </mat-card-actions>
              @if (alDia()) {
                <!-- Un botón gris sin explicación no dice nada. Y es LA pregunta
                     que se hace quien entra: "¿por qué no me deja pagar?". -->
                <mat-card-footer class="nota pie">
                  El mes ya está pagado, no hay nada que cobrar. El botón se
                  activa cuando falten {{ d.dias_aviso }} días o menos para el
                  vencimiento, o si ya se venció.
                </mat-card-footer>
              } @else if (!auth.hasPermission('suscripcion', 'crear')) {
                <mat-card-footer class="nota pie">
                  Si la suscripción está vencida, pídele al administrador de la
                  empresa que realice el pago.
                </mat-card-footer>
              } @else if (!d.fuente_pago) {
                <mat-card-footer class="nota pie">
                  Sin tarjeta guardada puedes pagar por PSE, que debita de tu banco.
                  La tarjeta solo hace falta para el cobro automático mensual.
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
                  Sin tarjeta guardada. La mensualidad no se cobra sola: hay que
                  pagarla a mano cada mes, con tarjeta o por PSE.
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

            <ng-container matColumnDef="metodo">
              <th mat-header-cell *matHeaderCellDef>Medio</th>
              <td mat-cell *matCellDef="let fila">{{ etiquetaMetodo(fila.metodo) }}</td>
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

    .acciones-retomar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .consultar { margin-top: 10px; }

    .retomar {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      padding: 14px 16px;
      border-radius: 12px;
      border-left: 4px solid #b26a00;
      background: color-mix(in srgb, #b26a00 12%, transparent);

      > div { flex: 1 1 260px; }
      strong { color: #b26a00; }
      p { margin: 2px 0 0; color: var(--mat-sys-on-surface-variant); }
      > mat-icon { flex-shrink: 0; color: #b26a00; }
    }
    :host-context(html.dark) .retomar {
      strong, > mat-icon { color: #ffb74d; }
    }

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

  readonly columnas = ['fecha', 'monto', 'estado', 'metodo', 'origen', 'periodo'];

  readonly detalle = signal<SuscripcionDetalle | null>(null);
  readonly pagos = signal<PagoSuscripcion[]>([]);
  readonly totalPagos = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly cargando = signal(false);
  readonly pagando = signal(false);
  /** Preguntándole a la pasarela cómo quedó el pago (el botón "Ya pagué"). */
  readonly consultando = signal(false);
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

  /**
   * El pago por PSE que quedó esperando aprobación en el banco, si lo hay.
   *
   * Se busca en la PRIMERA página del historial (que viene de más nuevo a
   * más viejo): un PSE a medias es necesariamente reciente, y lo que importa
   * que solo puede haber uno pendiente a la vez.
   */
  readonly psePendiente = computed(() => {
    if (!this.detalle()?.pago_pendiente) return null;
    return (
      this.pagos().find(
        (p) => p.metodo === 'PSE' && p.estado_transaccion === 'PENDING' && !!p.url_banco,
      ) ?? null
    );
  });

  /**
   * No hay nada que pagar: la suscripción está al día y le sobra tiempo.
   *
   * Se apagan los botones a propósito. Pagar con un mes entero por delante no
   * está prohibido por capricho: el dinero no se pierde (los meses se acumulan),
   * pero nadie quiere descubrir que adelantó tres meses por darle dos veces al
   * botón. El backend lo rechaza igual con 'suscripcion_al_dia'; esto solo
   * evita que se llegue hasta el error.
   *
   * 'por_vencer', 'gracia' y 'bloqueada' sí dejan pagar: adelantarse unos días
   * al vencimiento es justo lo que se quiere.
   */
  readonly alDia = computed(() => this.detalle()?.estado === 'activa');

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

  etiquetaMetodo(metodo: string): string {
    return ETIQUETAS_METODO_PAGO[metodo] ?? metodo;
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.sinPermiso.set(false);
    this.error.set(false);
    // Se vuelve a la primera página del historial. No es cosmético: el aviso de
    // "continuar en el banco" busca el pago pendiente en lo que esté cargado, y
    // si el usuario se había ido a la página 3 el pago recién creado no estaría
    // ahí — el aviso desaparecería justo cuando más falta hace.
    this.page.set(1);
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

  /**
   * "Ya pagué, actualizar": le pregunta a la pasarela cómo quedó el pago sin
   * esperar al webhook.
   *
   * Hace falta porque el webhook se puede perder: Wompi lo reintenta tres veces
   * en 24 horas y si el servidor estaba dormido en las tres, el pago se queda
   * en "pendiente" para siempre aunque el banco ya haya debitado. Antes de esto
   * la única salida era esperar.
   */
  async actualizarEstado(): Promise<void> {
    if (this.consultando()) return;
    this.consultando.set(true);
    const estabaBloqueada = this.estado() === 'bloqueada';
    try {
      const r = await firstValueFrom(this.servicio.actualizarEstado());
      this.detalle.set(r.suscripcion);
      this.page.set(1);
      await this.cargarPagos();
      // El banner del layout y el guard del paywall leen el PERFIL: si el pago
      // acaba de entrar, hay que refrescarlo para que el sistema se desbloquee.
      if (r.cambio) await this.auth.recargarPerfil();
      this.snackbar.open(this.mensajeDelEstado(r.cambio, r.estado_pago), 'OK', {
        duration: 7000,
      });
      if (r.estado_pago === 'APPROVED' && estabaBloqueada) {
        this.router.navigate(['/inicio']);
      }
    } catch (err) {
      this.snackbar.open(
        detalleDeError(err, 'No fue posible consultar el estado del pago'),
        'OK',
        { duration: 6000 },
      );
    } finally {
      this.consultando.set(false);
    }
  }

  /** Lo que se le dice a la persona según lo que contestó la pasarela. */
  private mensajeDelEstado(cambio: boolean, estado: string | null): string {
    if (!estado) return 'No hay ningún pago en proceso.';
    if (!cambio) {
      return 'El banco todavía no ha confirmado el pago. Vuelve a intentar en unos minutos.';
    }
    switch (estado) {
      case 'APPROVED':
        return '¡Listo! El pago entró y la suscripción quedó al día.';
      case 'DECLINED':
        return 'El banco RECHAZÓ el pago. No se debitó nada: puedes volver a intentar.';
      case 'VOIDED':
        return 'El pago fue anulado. Puedes volver a intentar.';
      default:
        return 'El pago no se pudo completar. Puedes volver a intentar.';
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

  /**
   * Pago por PSE. La config de Wompi se pide igual que para la tarjeta: los
   * permalinks de los términos que hay que aceptar salen de ahí y son frescos.
   */
  async abrirPse(): Promise<void> {
    const d = this.detalle();
    if (!d) return;
    try {
      const config = await firstValueFrom(this.servicio.config());
      this.dialog
        .open(PseFormDialog, { data: { config, tarifa: d.tarifa }, width: '560px' })
        .afterClosed()
        .subscribe(() => {
          // Se recarga SIEMPRE, se haya pagado o no. Aunque el diálogo devuelve
          // el resultado por los dos botones que lo cierran, condicionar la
          // recarga a ese valor deja la puerta abierta a que un cierre por otra
          // vía esconda un pago que ya existe. Recargar de más no cuesta nada;
          // no enterarse de un pago sí.
          this.cargar();
        });
    } catch (err) {
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
