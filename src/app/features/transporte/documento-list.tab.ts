import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, firstValueFrom } from 'rxjs';

import { UPLOADS_BASE } from '../../core/api.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { AlertaDocumento, Vehiculo, VehiculoDocumento } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { MoneyPipe } from '../../shared/pipes';
import { RangoFechasRapido } from '../../shared/rango-fechas-rapido';
import { dateToIso, isoToDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { DocumentoFormDialog } from './documento-form.dialog';
import {
  ETIQUETAS_TIPO_DOCUMENTO,
  TIPOS_DOCUMENTO_VEHICULO,
  VehiculoDocumentosService,
} from './vehiculo-documentos.service';
import { VehiculosService } from './vehiculos.service';

/**
 * Pestaña de documentos legales del vehículo (SOAT, tecnomecánica, seguros…),
 * con banner de vencimientos y chip de vigencia calculado en el cliente.
 */
@Component({
  selector: 'app-documento-list-tab',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule, MatDatepickerModule,
    EstadoChip, MoneyPipe, HasPermissionDirective, RangoFechasRapido,
  ],
  templateUrl: './documento-list.tab.html',
  styles: `
    :host { display: block; padding-top: 8px; }

    // Banner de vencimientos: mismo molde ámbar del indicador de reventa.
    .banner-alertas {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, #b26a00 35%, transparent);
      background: color-mix(in srgb, #b26a00 12%, transparent);
      color: #b26a00;
      font-size: 0.9rem;

      mat-icon { flex-shrink: 0; }
      strong { font-weight: 600; }

      .chip {
        display: inline-block;
        margin: 2px 4px 2px 0;
        padding: 1px 9px;
        border-radius: 8px;
        font-weight: 600;
        background: color-mix(in srgb, #b26a00 20%, transparent);
      }

      // El documento ya vencido resalta en rojo dentro del mismo banner.
      .chip.vencido {
        background: color-mix(in srgb, #c62828 18%, transparent);
        color: #c62828;
      }
    }

    :host-context(html.dark) {
      .banner-alertas { color: #ffb74d; border-color: color-mix(in srgb, #ffb74d 35%, transparent); }
      .banner-alertas .chip.vencido { color: #e57373; }
    }
  `,
})
export class DocumentoListTab implements OnInit {
  private readonly servicio = inject(VehiculoDocumentosService);
  private readonly vehiculosService = inject(VehiculosService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly estadoFiltros = inject(EstadoFiltrosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly uploadsBase = UPLOADS_BASE;
  readonly tipos = TIPOS_DOCUMENTO_VEHICULO;
  readonly etiquetasTipo = ETIQUETAS_TIPO_DOCUMENTO;
  readonly columnas = [
    'vehiculo', 'tipo', 'descripcion', 'expedicion', 'vencimiento',
    'vigencia', 'valor', 'adjunto', 'acciones',
  ];
  readonly filas = signal<VehiculoDocumento[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly vehiculos = signal<Vehiculo[]>([]);
  /** Documentos vencidos o por vencer (banner); vacío si la consulta falla. */
  readonly alertas = signal<AlertaDocumento[]>([]);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly vehiculoId = new FormControl<string | null>(null);
  readonly tipo = new FormControl<string | null>(null);
  readonly desde = new FormControl<Date | null>(null);
  readonly hasta = new FormControl<Date | null>(null);

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    const filtros: AbstractControl[] = [this.vehiculoId, this.tipo, this.desde, this.hasta];
    for (const control of filtros) {
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    }
    // Todos los vehículos (también inactivos): resuelven la placa de registros viejos.
    firstValueFrom(this.vehiculosService.list({ page_size: 100 })).then((pagina) =>
      this.vehiculos.set(pagina.items),
    );
    this.cargarAlertas();
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'transporte.documentos',
      {
        buscar: this.buscar,
        vehiculoId: this.vehiculoId,
        tipo: this.tipo,
        desde: this.desde,
        hasta: this.hasta,
      },
      this.destroyRef,
    );
    this.cargar();
  }

  recargar(): void {
    this.page.set(1);
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.filtrar({
          page: this.page(),
          page_size: this.pageSize(),
          search: this.buscar.value || null,
          vehiculo_id: this.vehiculoId.value,
          tipo: this.tipo.value,
          desde: dateToIso(this.desde.value),
          hasta: dateToIso(this.hasta.value),
        }),
      );
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
    } finally {
      this.cargando.set(false);
    }
  }

  /** El banner es informativo: si la consulta falla, la pestaña sale sin él. */
  private cargarAlertas(): void {
    firstValueFrom(this.vehiculosService.alertas())
      .then((alertas) => this.alertas.set(alertas.documentos))
      .catch(() => undefined);
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    this.cargar();
  }

  etiquetaTipo(tipo: string): string {
    return this.etiquetasTipo[tipo] ?? tipo;
  }

  placaDe(vehiculoId: string): string {
    const vehiculo = this.vehiculos().find((v) => v.id === vehiculoId);
    return vehiculo?.placa ?? '—';
  }

  /** Vigencia calculada en el cliente: vencido / por vencer (30 días) / vigente. */
  vigenciaDe(documento: VehiculoDocumento): string {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const vencimiento = isoToDate(documento.fecha_vencimiento);
    if (!vencimiento) return 'vigente';
    const dias = Math.round((vencimiento.getTime() - hoy.getTime()) / 86_400_000);
    if (dias < 0) return 'vencido';
    if (dias <= 30) return 'por vencer';
    return 'vigente';
  }

  /** Texto del banner: "venció hace N días" / "vence hoy" / "vence en N días". */
  textoVencimiento(alerta: AlertaDocumento): string {
    const dias = alerta.dias_restantes;
    if (dias < 0) return `venció hace ${-dias} ${-dias === 1 ? 'día' : 'días'}`;
    if (dias === 0) return 'vence hoy';
    return `vence en ${dias} ${dias === 1 ? 'día' : 'días'}`;
  }

  abrirFormulario(item?: VehiculoDocumento): void {
    this.dialog
      .open(DocumentoFormDialog, {
        data: { item, vehiculoId: this.vehiculoId.value ?? undefined },
        width: '720px',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Documento guardado', 'OK', { duration: 3000 });
          this.cargar();
          this.cargarAlertas();
        }
      });
  }

  eliminar(item: VehiculoDocumento): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar documento',
          mensaje: `¿Eliminar el documento "${this.etiquetaTipo(item.tipo)}"? El registro quedará inactivo.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(this.servicio.remove(item.id));
          this.snackbar.open('Documento eliminado', 'OK', { duration: 3000 });
          this.cargar();
          this.cargarAlertas();
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible eliminar el documento');
        }
      });
  }
}
