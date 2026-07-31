import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { UPLOADS_BASE } from '../../core/api.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Monto, VehiculoGasto, ViajeDetalle, ViajeServicio } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { PageHeader } from '../../shared/page-header';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { AbonoFleteFormDialog } from './abono-flete-form.dialog';
import { AbonosFleteListDialog } from './abonos-flete-list.dialog';
import { ETIQUETAS_CATEGORIA_GASTO, TransporteGastosService } from './transporte-gastos.service';
import { VehiculoGastoFormDialog } from './vehiculo-gasto-form.dialog';
import { ViajeFinalizarDialog } from './viaje-finalizar.dialog';
import { ViajeFormDialog } from './viaje-form.dialog';
import { ViajeServicioFormDialog } from './viaje-servicio-form.dialog';
import { ETIQUETAS_ESTADO_VIAJE, ViajesService } from './viajes.service';

/**
 * Detalle del viaje: la pantalla de trabajo del módulo. Aquí se cargan los
 * fletes (servicios) y los gastos, se cobra la cartera y se cierra el viaje.
 * Es el reporte de rentabilidad por viaje: los totales los calcula el backend.
 */
@Component({
  selector: 'app-viaje-detail',
  imports: [
    DatePipe, RouterLink,
    MatCardModule, MatTableModule, MatButtonModule, MatIconModule,
    MatProgressBarModule, MatTooltipModule,
    PageHeader, EstadoChip, MoneyPipe, CantidadPipe, HasPermissionDirective,
  ],
  templateUrl: './viaje-detail.page.html',
  styles: `
    .ficha {
      margin-bottom: 16px;
      padding: 16px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;

      div { display: flex; flex-direction: column; gap: 2px; }
      .etq { font-size: 0.75rem; color: var(--mat-sys-on-surface-variant); }
    }
    .observaciones {
      margin: 12px 0 0;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: pre-line;
    }
    .total-card {
      padding: 14px 16px;

      .titulo { margin: 0; font-size: 0.8rem; color: var(--mat-sys-on-surface-variant); }
      .valor { margin: 2px 0 0; font-size: 1.35rem; font-weight: 600; font-variant-numeric: tabular-nums; }
      .sub { margin: 2px 0 0; font-size: 0.78rem; color: var(--mat-sys-on-surface-variant); }
    }
    .negativa { color: var(--mat-sys-error); }
    .seccion-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      margin: 20px 0 8px;

      h2 { margin: 0; font-size: 1.1rem; font-weight: 500; }
    }
    .tabla-seccion { margin-bottom: 8px; }
    .chip-sentido {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      background: color-mix(in srgb, currentColor 10%, transparent);
      color: var(--mat-sys-on-surface-variant);
    }
    .cliente-directorio {
      display: inline-flex;
      align-items: center;
      gap: 4px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-on-surface-variant); }
    }
    .mat-mdc-footer-cell { font-weight: 600; }

    // El atributo [hidden] lo esconde el navegador con display:none, pero
    // cualquier regla de Material sobre la fila gana por especificidad. Se
    // reafirma aquí para que ocultar el pie sin filas funcione siempre.
    tr[hidden] { display: none; }
  `,
})
export class ViajeDetailPage implements OnInit {
  private readonly servicio = inject(ViajesService);
  private readonly gastosService = inject(TransporteGastosService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  /** Id del viaje, enlazado desde la ruta /transporte/viajes/:id. */
  readonly id = input.required<string>();

  readonly uploadsBase = UPLOADS_BASE;
  readonly etiquetasCategoria = ETIQUETAS_CATEGORIA_GASTO;
  readonly columnasServicios = [
    'sentido', 'cliente', 'descripcion', 'cobro', 'valor', 'abonado', 'saldo',
    'estado', 'acciones',
  ];
  readonly columnasGastos = [
    'fecha', 'categoria', 'concepto', 'valor', 'odometro', 'adjunto', 'acciones',
  ];

  readonly viaje = signal<ViajeDetalle | null>(null);
  readonly cargando = signal(false);
  readonly errorCarga = signal<string | null>(null);

  readonly enCurso = computed(() => this.viaje()?.estado === 'en_curso');
  readonly estadoEtiqueta = computed(() => {
    const estado = this.viaje()?.estado ?? '';
    return ETIQUETAS_ESTADO_VIAJE[estado] ?? estado;
  });
  /** Abonado total de los servicios no anulados (el resto lo trae el backend). */
  readonly totalAbonado = computed(() =>
    (this.viaje()?.servicios ?? [])
      .filter((s) => s.estado !== 'anulada')
      .reduce((acum, s) => acum + Number(s.abonado), 0),
  );

  ngOnInit(): void {
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorCarga.set(null);
    try {
      this.viaje.set(await firstValueFrom(this.servicio.detalle(this.id())));
    } catch (err) {
      this.viaje.set(null);
      this.errorCarga.set(
        detalleDeError(
          err,
          'No se pudo cargar el viaje. Revise la conexión e intente de nuevo.',
        ),
      );
    } finally {
      this.cargando.set(false);
    }
  }

  negativo(valor: Monto): boolean {
    return Number(valor) < 0;
  }

  etiquetaCategoria(categoria: string): string {
    return this.etiquetasCategoria[categoria] ?? categoria;
  }

  // ---------------------------------------------------------- acciones viaje
  editar(): void {
    const viaje = this.viaje();
    if (!viaje) return;
    this.dialog
      .open(ViajeFormDialog, { data: { item: viaje }, width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Viaje actualizado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  finalizar(): void {
    const viaje = this.viaje();
    if (!viaje) return;
    this.dialog
      .open(ViajeFinalizarDialog, { data: { viaje }, width: '520px' })
      .afterClosed()
      .subscribe((actualizado?: ViajeDetalle) => {
        if (actualizado) {
          this.viaje.set(actualizado);
          this.snackbar.open('Viaje finalizado', 'OK', { duration: 3000 });
        }
      });
  }

  reabrir(): void {
    const viaje = this.viaje();
    if (!viaje) return;
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Reabrir viaje',
          mensaje: `¿Reabrir el viaje Nº ${viaje.numero} para corregir servicios o gastos?`,
          accion: 'Reabrir',
          peligro: false,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          this.viaje.set(await firstValueFrom(this.servicio.reabrir(viaje.id)));
          this.snackbar.open('Viaje reabierto', 'OK', { duration: 3000 });
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible reabrir el viaje');
        }
      });
  }

  anular(): void {
    const viaje = this.viaje();
    if (!viaje) return;
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Anular viaje',
          mensaje: `¿Anular el viaje Nº ${viaje.numero}? Se anulan también sus servicios y deja de contar en los reportes. Solo es posible si no tiene abonos.`,
          accion: 'Anular',
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          this.viaje.set(await firstValueFrom(this.servicio.anular(viaje.id)));
          this.snackbar.open('Viaje anulado', 'OK', { duration: 3000 });
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible anular el viaje');
        }
      });
  }

  // --------------------------------------------------------------- servicios
  agregarServicio(): void {
    const viaje = this.viaje();
    if (!viaje) return;
    this.dialog
      .open(ViajeServicioFormDialog, { data: { viaje }, width: '720px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Servicio guardado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  editarServicio(servicioFlete: ViajeServicio): void {
    const viaje = this.viaje();
    if (!viaje) return;
    this.dialog
      .open(ViajeServicioFormDialog, {
        data: { viaje, servicio: servicioFlete },
        width: '720px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Servicio actualizado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  eliminarServicio(servicioFlete: ViajeServicio): void {
    const viaje = this.viaje();
    if (!viaje) return;
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar servicio',
          mensaje: `¿Eliminar el flete "${servicioFlete.descripcion}"? Solo es posible si no tiene abonos.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(this.servicio.eliminarServicio(viaje.id, servicioFlete.id));
          this.snackbar.open('Servicio eliminado', 'OK', { duration: 3000 });
          this.cargar();
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible eliminar el servicio');
        }
      });
  }

  anularServicio(servicioFlete: ViajeServicio): void {
    const viaje = this.viaje();
    if (!viaje) return;
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Anular servicio',
          mensaje: `¿Anular el flete "${servicioFlete.descripcion}"? Deja de contar en los ingresos y en la cartera.`,
          accion: 'Anular',
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(this.servicio.anularServicio(viaje.id, servicioFlete.id));
          this.snackbar.open('Servicio anulado', 'OK', { duration: 3000 });
          this.cargar();
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible anular el servicio');
        }
      });
  }

  abonar(servicioFlete: ViajeServicio): void {
    this.dialog
      .open(AbonoFleteFormDialog, {
        data: {
          servicioId: servicioFlete.id,
          titulo: `Abonar a "${servicioFlete.descripcion}"`,
          saldo: servicioFlete.saldo,
        },
        width: '520px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Abono registrado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  verAbonos(servicioFlete: ViajeServicio): void {
    this.dialog
      .open(AbonosFleteListDialog, {
        data: {
          titulo: `Abonos de "${servicioFlete.descripcion}"`,
          servicioId: servicioFlete.id,
          abonos: servicioFlete.abonos,
        },
        width: '640px',
      })
      .afterClosed()
      .subscribe((cambiado) => {
        if (cambiado) this.cargar();
      });
  }

  puedeAbonar(servicioFlete: ViajeServicio): boolean {
    return (
      !servicioFlete.es_interno &&
      ['pendiente', 'parcial'].includes(servicioFlete.estado) &&
      Number(servicioFlete.saldo) > 0
    );
  }

  // ------------------------------------------------------------------ gastos
  agregarGasto(): void {
    const viaje = this.viaje();
    if (!viaje) return;
    this.dialog
      .open(VehiculoGastoFormDialog, { data: { viaje }, width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Gasto guardado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  editarGasto(gasto: VehiculoGasto): void {
    const viaje = this.viaje();
    if (!viaje) return;
    this.dialog
      .open(VehiculoGastoFormDialog, { data: { viaje, item: gasto }, width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Gasto actualizado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  eliminarGasto(gasto: VehiculoGasto): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar gasto',
          mensaje: `¿Eliminar el gasto de ${this.etiquetasCategoria[gasto.categoria] ?? gasto.categoria}? El registro quedará inactivo.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(this.gastosService.remove(gasto.id));
          this.snackbar.open('Gasto eliminado', 'OK', { duration: 3000 });
          this.cargar();
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible eliminar el gasto');
        }
      });
  }
}
