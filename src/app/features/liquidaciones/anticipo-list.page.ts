import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Anticipo } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { EstadoChip } from '../../shared/estado-chip';
import { EstadoFiltrosService } from '../../shared/estado-filtros.service';
import { PageHeader } from '../../shared/page-header';
import { MoneyPipe } from '../../shared/pipes';
import { dateToIso } from '../../shared/date-utils';
import { RangoFechasRapido } from '../../shared/rango-fechas-rapido';
import { AnticipoFormDialog } from './anticipo-form.dialog';
import { AnticiposService } from './anticipos.service';

@Component({
  selector: 'app-anticipo-list',
  imports: [
    DatePipe, MatCardModule, MatTableModule, MatPaginatorModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule, MatInputModule, ReactiveFormsModule,
    MatDatepickerModule, RangoFechasRapido,
    PageHeader, EstadoChip, MoneyPipe, HasPermissionDirective,
  ],
  templateUrl: './anticipo-list.page.html',
  styles: `
    .tipo-beneficiario {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
    }
  `,
})
export class AnticipoListPage implements OnInit {
  private readonly servicio = inject(AnticiposService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly estadoFiltros = inject(EstadoFiltrosService);

  readonly columnas = ['beneficiario', 'fecha', 'valor', 'observaciones', 'aplicado', 'acciones'];
  readonly filas = signal<Anticipo[]>([]);
  readonly total = signal(0);
  readonly sumaTotal = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly desde = new FormControl<Date | null>(null);
  readonly hasta = new FormControl<Date | null>(null);

  private readonly etiquetasTipo: Record<string, string> = {
    proveedor: 'Proveedor',
    transportador: 'Transportador',
    empleado: 'Empleado',
  };

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.desde.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    this.hasta.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
  }

  ngOnInit(): void {
    this.estadoFiltros.vincular(
      'anticipos',
      { buscar: this.buscar, desde: this.desde, hasta: this.hasta },
      this.destroyRef,
    );
    this.cargar();
  }

  nombreBeneficiario(fila: Anticipo): string {
    return fila.tercero_nombre ?? '—';
  }

  tipoBeneficiario(fila: Anticipo): string {
    return this.etiquetasTipo[fila.tipo] ?? fila.tipo;
  }

  /**
   * Aviso para el anticipo que SÍ se puede tocar pero que va a mover una
   * liquidación ya generada. Vacío si está suelto.
   *
   * Que se pueda corregir no quiere decir que sea inocuo: si la liquidación
   * estaba aprobada, retrocede a borrador y hay que volver a aprobarla. Sin este
   * aviso, el dueño descubriría el retroceso al día siguiente sin saber por qué.
   */
  avisoAlTocar(fila: Anticipo): string {
    if (fila.liquidacion_estado === 'aprobada') {
      return (
        'Está descontado en una liquidación APROBADA: al guardar, esa liquidación ' +
        'vuelve a borrador y se recalcula. Habrá que aprobarla otra vez.'
      );
    }
    if (fila.liquidacion_estado === 'borrador') {
      return 'Está descontado en una liquidación en borrador: al guardar, esa liquidación se recalcula sola.';
    }
    return '';
  }

  /** Por qué este anticipo quedó trabado: son dos situaciones distintas. */
  motivoDelCandado(fila: Anticipo): string {
    if (fila.pago_empleado_id) {
      return 'Ya se le descontó al empleado en un pago de nómina: no se puede editar ni eliminar.';
    }
    if (fila.liquidacion_estado === 'pagada') {
      return (
        'La liquidación en la que se descontó ya se pagó. Si la cifra está mala, ' +
        'registre el ajuste en la quincena siguiente.'
      );
    }
    return (
      'La liquidación en la que se descontó ya tiene un pago registrado. Elimine ' +
      'primero ese pago si de verdad hay que corregirlo.'
    );
  }

  recargar(): void {
    this.page.set(1);
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const search = this.buscar.value || undefined;
      const desde = dateToIso(this.desde.value) ?? undefined;
      const hasta = dateToIso(this.hasta.value) ?? undefined;
      const params = { page: this.page(), page_size: this.pageSize(), search, desde, hasta };
      
      const [respuesta, suma] = await Promise.all([
        firstValueFrom(this.servicio.list(params)),
        firstValueFrom(this.servicio.sumaTotales(search, undefined, desde, hasta))
      ]);
      
      this.filas.set(respuesta.items);
      this.total.set(respuesta.total);
      this.sumaTotal.set(suma ?? 0);
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarPagina(evento: PageEvent): void {
    this.page.set(evento.pageIndex + 1);
    this.pageSize.set(evento.pageSize);
    this.cargar();
  }

  abrirFormulario(item?: Anticipo): void {
    this.dialog
      .open(AnticipoFormDialog, { data: { item }, width: '560px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Anticipo guardado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  eliminar(item: Anticipo): void {
    // Si el anticipo está descontado en una liquidación, borrarlo le SUBE el neto
    // a pagar por ese valor. Se dice en la confirmación porque es plata: el dueño
    // tiene que saber qué se mueve antes de decir que sí, no después.
    const aviso = this.avisoAlTocar(item);
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar anticipo',
          mensaje:
            `¿Eliminar el anticipo de "${this.nombreBeneficiario(item)}"? El registro quedará inactivo.` +
            (aviso ? ` ${aviso}` : ''),
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        try {
          await firstValueFrom(this.servicio.remove(item.id));
          this.snackbar.open('Anticipo eliminado', 'OK', { duration: 3000 });
        } catch (err) {
          // El candado vive en el backend: si entre que se pintó la lista y este
          // clic alguien le registró un pago a la liquidación, rebota aquí. Sin
          // este catch la promesa quedaba sin atender y el usuario no veía nada.
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible eliminar el anticipo');
        }
        this.cargar();
      });
  }
}
