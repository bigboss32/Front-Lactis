import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService } from '../../core/api.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Page, Produccion, TipoQueso } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { CantidadPipe } from '../../shared/pipes';
import { ProduccionFormDialog } from './produccion-form.dialog';
import { ProduccionService } from './produccion.service';

@Component({
  selector: 'app-produccion-diaria-tab',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    DatePipe, DecimalPipe, CantidadPipe, HasPermissionDirective,
  ],
  templateUrl: './produccion-diaria.tab.html',
})
export class ProduccionDiariaTab implements OnInit {
  private readonly servicio = inject(ProduccionService);
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  readonly columnas = [
    'fecha', 'tipo_queso', 'cantidad', 'peso_kg', 'litros_usados',
    'rendimiento', 'merma', 'acciones',
  ];
  readonly filas = signal<Produccion[]>([]);
  readonly tiposQueso = signal<TipoQueso[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  readonly desde = new FormControl('', { nonNullable: true });
  readonly hasta = new FormControl('', { nonNullable: true });
  readonly tipoQuesoId = new FormControl<string | null>(null);

  constructor() {
    this.desde.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.hasta.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.tipoQuesoId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());

    firstValueFrom(
      this.api.get<Page<TipoQueso>>('/tipos-queso', { page_size: 100, estado: 'activo' }),
    ).then((pagina) => this.tiposQueso.set(pagina.items));
  }

  ngOnInit(): void {
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
          tipo_queso_id: this.tipoQuesoId.value,
          desde: this.desde.value || null,
          hasta: this.hasta.value || null,
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

  abrirFormulario(item?: Produccion): void {
    this.dialog
      .open(ProduccionFormDialog, { data: { item }, width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Producción guardada', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  eliminar(item: Produccion): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar producción',
          mensaje: `¿Eliminar el registro del ${item.fecha}? El registro quedará inactivo.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        await firstValueFrom(this.servicio.remove(item.id));
        this.snackbar.open('Producción eliminada', 'OK', { duration: 3000 });
        this.cargar();
      });
  }
}
