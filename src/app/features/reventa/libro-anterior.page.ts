import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Monto } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { PageHeader } from '../../shared/page-header';
import { MoneyPipe } from '../../shared/pipes';
import { ReventaTabs } from './reventa-tabs';
import { hoyIso, ReventaService, SaldoAnterior, TipoSaldoAnterior } from './reventa.service';
import {
  SaldoAbonoFormDialog,
  SaldoAbonosListDialog,
  SaldoAnteriorFormDialog,
} from './saldo-anterior-form.dialog';

/**
 * Un lado del libro anterior: las cuentas por cobrar a clientes o las cuentas
 * por pagar a productores. Es hermana de compra-list.tab y venta-list.tab (misma
 * tabla, mismos botones, mismos permisos), pero sin kilos ni precio por kilo:
 * estas cuentas solo mueven plata.
 */
@Component({
  selector: 'app-saldo-anterior-list-tab',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    EstadoChip, MoneyPipe, HasPermissionDirective,
  ],
  template: `
    <div class="tarjeta" [class.azul]="esCobrar()" [class.ambar]="!esCobrar()">
      <span class="icono">
        <mat-icon aria-hidden="true">{{ esCobrar() ? 'request_quote' : 'agriculture' }}</mat-icon>
      </span>
      <span class="textos">
        <span class="cifra">{{ totalPendiente() === null ? '—' : (totalPendiente() | money) }}</span>
        <span class="titulo">
          {{ esCobrar() ? 'Le deben del libro anterior' : 'Debe del libro anterior' }}
        </span>
        @if (totalPendiente() !== null) {
          <span class="detalle">
            {{
              esCobrar()
                ? 'Suma de lo que falta por cobrar de las cuentas viejas (sin las anuladas)'
                : 'Suma de lo que falta por pagar de las cuentas viejas (sin las anuladas)'
            }}
          </span>
          @if (filtrosActivos()) {
            <span class="detalle">
              El listado de abajo está filtrado: la cifra es la de todas las cuentas.
            </span>
          }
        } @else if (cargandoTotal()) {
          <!-- La consulta va en camino: el guion se queda solo, sin texto de
               fallo. Con señal lenta el aviso de error era falso. -->
          <span class="detalle">Consultando el total…</span>
        } @else {
          <span class="detalle">No se pudo consultar el total; abajo está el detalle cuenta por cuenta.</span>
        }
      </span>
    </div>

    <div class="page-toolbar">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>{{ esCobrar() ? 'Buscar cliente o concepto' : 'Buscar productor o concepto' }}</mat-label>
        <input matInput [formControl]="buscar" [placeholder]="esCobrar() ? 'Nombre del cliente' : 'Nombre del productor'" />
        @if (buscar.value) {
          <button matSuffix mat-icon-button aria-label="Limpiar" (click)="buscar.setValue('')">
            <mat-icon>close</mat-icon>
          </button>
        }
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Estado</mat-label>
        <mat-select [formControl]="estado">
          <mat-option [value]="null">Todos</mat-option>
          <mat-option value="pendiente">Pendiente</mat-option>
          <mat-option value="parcial">Parcial</mat-option>
          <mat-option value="pagada">Pagada</mat-option>
          <mat-option value="anulada">Anulada</mat-option>
        </mat-select>
      </mat-form-field>
      <span class="spacer"></span>
      <button mat-flat-button *hasPermission="'reventa:crear'" (click)="nueva()">
        <mat-icon>add</mat-icon> {{ esCobrar() ? 'Nueva cuenta por cobrar' : 'Nueva cuenta por pagar' }}
      </button>
    </div>

    <mat-card class="table-card tarjetas alto-limitado">
      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <!-- La tabla se oculta si la consulta falló: una tabla con solo el encabezado
           se lee igual que "no hay nada". -->
      @if (!errorCarga()) {
        <!-- .zona-tabla es lo único que se desplaza: el encabezado fijo necesita
             un antecesor con scroll al que pegarse, y el paginador queda fuera de
             este div para no irse de vista al bajar. -->
        <div class="zona-tabla">
          <table mat-table [dataSource]="filas()">
            <ng-container matColumnDef="fecha">
              <th mat-header-cell *matHeaderCellDef>Fecha</th>
              <td mat-cell *matCellDef="let fila" [attr.data-label]="'Fecha'">
                {{ fila.fecha | date: 'dd/MM/yyyy' }}
              </td>
            </ng-container>

            <ng-container matColumnDef="tercero">
              <th mat-header-cell *matHeaderCellDef>{{ esCobrar() ? 'Cliente' : 'Productor' }}</th>
              <td mat-cell *matCellDef="let fila" [attr.data-label]="esCobrar() ? 'Cliente' : 'Productor'">
                {{ fila.tercero }}
              </td>
            </ng-container>

            <ng-container matColumnDef="concepto">
              <th mat-header-cell *matHeaderCellDef>Concepto</th>
              <td mat-cell *matCellDef="let fila" [attr.data-label]="'Concepto'">{{ fila.concepto }}</td>
            </ng-container>

            <ng-container matColumnDef="valor_total">
              <th mat-header-cell *matHeaderCellDef class="num">Total</th>
              <td mat-cell *matCellDef="let fila" class="num" [attr.data-label]="'Total'">
                {{ fila.valor_total | money }}
              </td>
            </ng-container>

            <ng-container matColumnDef="abonado">
              <th mat-header-cell *matHeaderCellDef class="num">Abonado</th>
              <td mat-cell *matCellDef="let fila" class="num" [attr.data-label]="'Abonado'">
                {{ fila.abonado | money }}
              </td>
            </ng-container>

            <ng-container matColumnDef="saldo">
              <th mat-header-cell *matHeaderCellDef class="num">Saldo</th>
              <td mat-cell *matCellDef="let fila" class="num" [attr.data-label]="'Saldo'">
                {{ fila.saldo | money }}
                @if (conSaldo(fila)) {
                  <span
                    class="badge-saldo"
                    [class.pagar]="!esCobrar()"
                    [matTooltip]="esCobrar() ? 'Saldo pendiente de cobrar al cliente' : 'Saldo pendiente de pagar al productor'"
                  >
                    {{ esCobrar() ? 'por cobrar' : 'por pagar' }}
                  </span>
                }
              </td>
            </ng-container>

            <ng-container matColumnDef="estado">
              <th mat-header-cell *matHeaderCellDef>Estado</th>
              <td mat-cell *matCellDef="let fila" [attr.data-label]="'Estado'">
                <app-estado-chip [estado]="fila.estado" />
              </td>
            </ng-container>

            <ng-container matColumnDef="acciones">
              <th mat-header-cell *matHeaderCellDef class="col-acciones"></th>
              <td mat-cell *matCellDef="let fila" class="col-acciones">
                <button
                  mat-icon-button
                  *hasPermission="'reventa:crear'"
                  [matTooltip]="esCobrar() ? 'Registrar un pago del cliente' : 'Registrar un pago al productor'"
                  [disabled]="!puedeAbonar(fila)"
                  (click)="abonar(fila)"
                >
                  <mat-icon>payments</mat-icon>
                </button>
                <button mat-icon-button matTooltip="Ver abonos" (click)="verAbonos(fila)">
                  <mat-icon>receipt_long</mat-icon>
                </button>
                <button
                  mat-icon-button
                  *hasPermission="'reventa:editar'"
                  matTooltip="Editar"
                  [disabled]="fila.estado === 'anulada'"
                  (click)="editar(fila)"
                >
                  <mat-icon>edit</mat-icon>
                </button>
                <button
                  mat-icon-button
                  *hasPermission="'reventa:administrar'"
                  matTooltip="Anular (solo sin abonos)"
                  [disabled]="fila.estado === 'anulada' || tieneAbonos(fila)"
                  (click)="anular(fila)"
                >
                  <mat-icon>block</mat-icon>
                </button>
                <button
                  mat-icon-button
                  *hasPermission="'reventa:eliminar'"
                  matTooltip="Eliminar (solo sin abonos)"
                  [disabled]="tieneAbonos(fila)"
                  (click)="eliminar(fila)"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="columnas; sticky: true"></tr>
            <tr mat-row *matRowDef="let fila; columns: columnas"></tr>
          </table>
        </div>
      }

      @if (errorCarga(); as error) {
        <div class="error-state" role="alert">
          <mat-icon aria-hidden="true">cloud_off</mat-icon>
          <p>{{ error }}</p>
          <p class="aclara">
            Esto no quiere decir que no haya cuentas pendientes: la consulta no alcanzó a llegar.
          </p>
          <button mat-stroked-button type="button" (click)="cargar()">
            <mat-icon>refresh</mat-icon> Reintentar
          </button>
        </div>
      }

      <!-- El estado vacío solo cuando de verdad se consultó y no había nada. -->
      @if (!cargando() && !errorCarga() && filas().length === 0) {
        <div class="empty-state">
          <mat-icon>menu_book</mat-icon>
          @if (filtrosActivos()) {
            <p>No hay cuentas del libro anterior para los filtros seleccionados</p>
          } @else {
            <p>
              {{
                esCobrar()
                  ? 'Todavía no ha cargado cuentas que le queden debiendo del sistema anterior'
                  : 'Todavía no ha cargado cuentas que usted deba del sistema anterior'
              }}
            </p>
          }
        </div>
      }

      <!-- Sin consulta no hay conteo: el paginador diría "0 de 0". -->
      @if (!errorCarga()) {
        <mat-paginator
          [length]="total()"
          [pageIndex]="page() - 1"
          [pageSize]="pageSize()"
          [pageSizeOptions]="[10, 20, 50, 100]"
          (page)="cambiarPagina($event)"
          showFirstLastButtons
        />
      }
    </mat-card>
  `,
  styles: `
    .spacer { flex: 1; }

    .table-card .col-acciones { width: 230px; }

    // En celular la tabla se vuelve tarjetas y los iconos envuelven: la celda
    // toma el ancho de la tarjeta. Con un ancho fijo mayor que la pantalla el
    // primer icono quedaría recortado.
    @media (max-width: 700px) {
      .table-card.tarjetas .col-acciones { width: auto; }
    }

    // Misma tarjeta de cifra grande que el resumen de reventa, para que las dos
    // pantallas se lean igual.
    .tarjeta {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 16px;
      padding: 14px 16px;
      min-height: 76px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);

      .icono {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        flex-shrink: 0;
        background: color-mix(in srgb, var(--color-tarjeta) 15%, transparent);
        color: var(--color-tarjeta);
      }

      .textos {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .cifra { font-size: 1.4rem; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; }
      .titulo { font-size: 0.85rem; color: var(--mat-sys-on-surface-variant); }
      .detalle { font-size: 0.8rem; color: var(--mat-sys-on-surface-variant); }
    }

    .tarjeta.ambar { --color-tarjeta: #b26a00; }
    .tarjeta.azul  { --color-tarjeta: #1565c0; }

    .badge-saldo {
      display: inline-block;
      margin-left: 8px;
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 500;
      white-space: nowrap;
      background: color-mix(in srgb, #1565c0 15%, transparent);
      color: #1565c0;
    }

    .badge-saldo.pagar {
      background: color-mix(in srgb, #b26a00 15%, transparent);
      color: #b26a00;
    }

    :host-context(html.dark) {
      .tarjeta.ambar { --color-tarjeta: #ffb74d; }
      .tarjeta.azul  { --color-tarjeta: #64b5f6; }
      .badge-saldo { color: #64b5f6; }
      .badge-saldo.pagar { color: #ffb74d; }
    }
  `,
})
export class SaldoAnteriorListTab implements OnInit {
  private readonly servicio = inject(ReventaService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  /** Lado del libro que muestra esta pestaña. No cambia en toda su vida. */
  readonly tipo = input.required<TipoSaldoAnterior>();
  /** Total pendiente de este lado, calculado por la página; null mientras no haya cifra. */
  readonly totalPendiente = input<number | null>(null);
  /**
   * La consulta del total va en camino. Sin esto el null de la primera carga se
   * leía como error y la tarjeta afirmaba un fallo que no había ocurrido.
   */
  readonly cargandoTotal = input(false);
  /** Avisa a la página que hubo cambios para recargar el total de arriba. */
  readonly cambio = output<void>();

  readonly columnas = [
    'fecha', 'tercero', 'concepto', 'valor_total', 'abonado', 'saldo', 'estado', 'acciones',
  ];
  readonly filas = signal<SaldoAnterior[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  /**
   * Mensaje de la consulta fallida. Mientras esté puesto NO se muestra el estado
   * vacío: si el listado no cargó después de registrar un abono, decir que no
   * hay cuentas hace que el abono se registre otra vez.
   */
  readonly errorCarga = signal<string | null>(null);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  /** Si hay búsqueda o estado puestos, el listado NO es todas las cuentas. */
  readonly filtrosActivos = signal(false);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly estado = new FormControl<string | null>(null);

  readonly esCobrar = computed(() => this.tipo() === 'cobrar');

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.estado.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
  }

  ngOnInit(): void {
    // Recuerda los filtros de esta pestaña durante la sesión (una clave por lado
    // del libro). Restaura sin disparar eventos; la primera carga ya los usa.
    this.estadoFiltros.vincular(
      `reventa-libro-anterior-${this.tipo()}`,
      { buscar: this.buscar, estado: this.estado },
      this.destroyRef,
    );
    void this.cargar();
  }

  recargar(): void {
    this.page.set(1);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorCarga.set(null);
    this.filtrosActivos.set(Boolean(this.buscar.value || this.estado.value));
    try {
      const respuesta = await firstValueFrom(
        this.servicio.listarSaldosAnteriores({
          tipo: this.tipo(),
          page: this.page(),
          page_size: this.pageSize(),
          search: this.buscar.value || null,
          estado: this.estado.value,
        }),
      );
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
    } catch (err) {
      // Se limpia lo anterior: si la consulta falló, los saldos que quedaran en
      // pantalla ya no se pueden confirmar y se leerían como si fueran de hoy.
      this.filas.set([]);
      this.total.set(0);
      this.errorCarga.set(
        detalleDeError(
          err,
          'No se pudieron cargar las cuentas del libro anterior. Revise la conexión e intente de nuevo.',
        ),
      );
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    void this.cargar();
  }

  tieneAbonos(fila: SaldoAnterior): boolean {
    return Number(fila.abonado) > 0;
  }

  conSaldo(fila: SaldoAnterior): boolean {
    return Number(fila.saldo) > 0 && fila.estado !== 'anulada';
  }

  puedeAbonar(fila: SaldoAnterior): boolean {
    return fila.estado !== 'pagada' && fila.estado !== 'anulada';
  }

  nueva(): void {
    this.abrirFormulario({ tipo: this.tipo() }, 'Cuenta del libro anterior registrada');
  }

  editar(fila: SaldoAnterior): void {
    this.abrirFormulario({ tipo: this.tipo(), item: fila }, 'Cuenta del libro anterior actualizada');
  }

  private abrirFormulario(
    data: { tipo: TipoSaldoAnterior; item?: SaldoAnterior },
    mensaje: string,
  ): void {
    this.dialog
      .open(SaldoAnteriorFormDialog, { data, width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.snackbar.open(mensaje, 'OK', { duration: 3000 });
        this.notificar();
      });
  }

  abonar(fila: SaldoAnterior): void {
    this.dialog
      .open(SaldoAbonoFormDialog, {
        data: {
          id: fila.id,
          titulo: this.esCobrar() ? `Abono de ${fila.tercero}` : `Abonar a ${fila.tercero}`,
          saldo: fila.saldo,
        },
        width: '480px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.snackbar.open('Abono registrado', 'OK', { duration: 3000 });
        this.notificar();
      });
  }

  verAbonos(fila: SaldoAnterior): void {
    this.dialog
      .open(SaldoAbonosListDialog, {
        data: {
          titulo: this.esCobrar() ? `Abonos de ${fila.tercero}` : `Abonos a ${fila.tercero}`,
          abonos: fila.abonos,
          id: fila.id,
        },
        width: '560px',
      })
      .afterClosed()
      .subscribe((cambiado) => {
        if (cambiado) this.notificar();
      });
  }

  anular(fila: SaldoAnterior): void {
    const efecto = this.esCobrar() ? 'los saldos por cobrar' : 'los saldos por pagar';
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Anular cuenta del libro anterior',
          mensaje: `¿Anular la cuenta de ${fila.tercero} (${fila.concepto})? Quedará marcada como anulada y saldrá de ${efecto}.`,
          accion: 'Anular',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.anularSaldoAnterior(fila.id)),
          'Cuenta anulada',
          'No fue posible anular la cuenta',
        );
      });
  }

  eliminar(fila: SaldoAnterior): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar cuenta del libro anterior',
          mensaje: `¿Eliminar la cuenta de ${fila.tercero} (${fila.concepto})? Esta acción no se puede deshacer.`,
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => firstValueFrom(this.servicio.eliminarSaldoAnterior(fila.id)),
          'Cuenta eliminada',
          'No fue posible eliminar la cuenta',
        );
      });
  }

  private notificar(): void {
    void this.cargar();
    this.cambio.emit();
  }

  private async ejecutar(
    accion: () => Promise<unknown>,
    mensaje: string,
    porDefecto: string,
  ): Promise<void> {
    try {
      await accion();
      this.snackbar.open(mensaje, 'OK', { duration: 3000 });
      this.notificar();
    } catch (err) {
      // Anular/eliminar SÍ guardan: si el resultado quedó en duda, el aviso se
      // queda hasta que el usuario lo cierre (ver shared/errores-ui.ts).
      avisarErrorAlGuardar(this.snackbar, err, porDefecto);
    }
  }
}

/**
 * Libro de la cuenta anterior: lo que quedó a medio pagar en el sistema que el
 * cliente usaba antes de Lactis.
 *
 * Vive FUERA de la shell de reventa a propósito. La shell filtra todas sus
 * sub-páginas por un rango de fechas que arranca en el mes actual, y estas
 * cuentas son viejas por definición (la fecha que llevan es la del documento
 * original): dentro de la shell la pantalla se vería vacía el día que se abre.
 */
@Component({
  selector: 'app-libro-anterior',
  imports: [MatTabsModule, PageHeader, SaldoAnteriorListTab, ReventaTabs],
  template: `
    <div class="page">
      <app-reventa-tabs />
      <app-page-header
        titulo="Libro de la cuenta anterior"
        subtitulo="Cuentas a medio pagar que vienen del sistema que usaba antes"
      />

      <p class="ayuda">
        Aquí se cargan las cuentas que quedaron a medio pagar en el sistema anterior: ventas
        viejas que un cliente todavía le debe y compras viejas que usted todavía le debe a un
        productor. Suman en lo que tiene <strong>por cobrar</strong> y <strong>por pagar</strong>,
        aceptan abonos y salen en el estado de cuenta que le manda al cliente. No son ventas ni
        compras de este sistema: no mueven el queso disponible, ni los kilos, ni la ganancia.
      </p>

      <mat-tab-group>
        <mat-tab label="Por cobrar (clientes)">
          <ng-template matTabContent>
            <div class="tab-panel">
              <app-saldo-anterior-list-tab
                [tipo]="'cobrar'"
                [totalPendiente]="porCobrar()"
                [cargandoTotal]="cargandoTotales()"
                (cambio)="cargarTotales()"
              />
            </div>
          </ng-template>
        </mat-tab>
        <mat-tab label="Por pagar (productores)">
          <ng-template matTabContent>
            <div class="tab-panel">
              <app-saldo-anterior-list-tab
                [tipo]="'pagar'"
                [totalPendiente]="porPagar()"
                [cargandoTotal]="cargandoTotales()"
                (cambio)="cargarTotales()"
              />
            </div>
          </ng-template>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: `
    .ayuda {
      margin: 0 0 16px;
      max-width: 900px;
      font-size: 0.9rem;
      line-height: 1.45;
      color: var(--mat-sys-on-surface-variant);

      strong { color: var(--mat-sys-on-surface); font-weight: 600; }
    }

    .tab-panel { padding-top: 16px; }
  `,
})
export class LibroAnteriorPage {
  private readonly servicio = inject(ReventaService);

  /** Totales del libro anterior; null mientras no haya cifra que mostrar. */
  readonly porCobrar = signal<number | null>(null);
  readonly porPagar = signal<number | null>(null);
  /**
   * La consulta del resumen está en vuelo. Va aparte de las cifras porque null
   * significa dos cosas distintas: "todavía no llegó" y "no se pudo consultar", y
   * las pestañas solo pueden afirmar el fallo en el segundo caso (igual que el
   * `cargando`/`errorCarga` separados de los listados).
   */
  readonly cargandoTotales = signal(true);

  constructor() {
    void this.cargarTotales();
  }

  /**
   * Los totales salen del resumen y no de sumar el listado: es la MISMA cifra
   * que muestra la pantalla de Resumen dentro de "Por cobrar a clientes" y "Por
   * pagar a productores", así que las dos pantallas no pueden discrepar. Son
   * acumulados (histórico, sin filtro de fechas), por eso el rango que se manda
   * da igual, como en la página de ajustes.
   */
  async cargarTotales(): Promise<void> {
    this.cargandoTotales.set(true);
    try {
      const r = await firstValueFrom(this.servicio.resumen(hoyIso(), hoyIso()));
      this.porCobrar.set(soloSiViene(r.por_cobrar_libro_anterior));
      this.porPagar.set(soloSiViene(r.por_pagar_libro_anterior));
    } catch {
      // Un cero inventado se leería como "no le deben nada": mejor sin cifra.
      this.porCobrar.set(null);
      this.porPagar.set(null);
    } finally {
      this.cargandoTotales.set(false);
    }
  }
}

/** Monto que puede faltar en la respuesta: null en vez de un cero que no es cierto. */
function soloSiViene(valor: Monto | null | undefined): number | null {
  return valor === null || valor === undefined || valor === '' ? null : Number(valor);
}
