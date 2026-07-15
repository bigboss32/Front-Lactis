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

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { TipoQueso } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { MoneyPipe } from '../../shared/pipes';
import { TipoQuesoFormDialog } from './tipo-queso-form.dialog';
import { TiposQuesoService } from './produccion.service';

@Component({
  selector: 'app-tipos-queso-tab',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    EstadoChip, MoneyPipe, HasPermissionDirective,
  ],
  templateUrl: './tipos-queso.tab.html',
})
export class TiposQuesoTab implements OnInit {
  private readonly servicio = inject(TiposQuesoService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  readonly columnas = ['nombre', 'descripcion', 'precio_referencia', 'estado', 'acciones'];
  readonly filas = signal<TipoQueso[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  readonly buscar = new FormControl('', { nonNullable: true });
  readonly estado = new FormControl<string | null>(null);

  constructor() {
    this.buscar.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargar());
    this.estado.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
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
        this.servicio.list({
          page: this.page(),
          page_size: this.pageSize(),
          search: this.buscar.value || null,
          estado: this.estado.value,
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

  abrirFormulario(item?: TipoQueso): void {
    this.dialog
      .open(TipoQuesoFormDialog, { data: { item }, width: '560px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Tipo de queso guardado', 'OK', { duration: 3000 });
          this.cargar();
        }
      });
  }

  eliminar(item: TipoQueso): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar tipo de queso',
          mensaje: `¿Eliminar "${item.nombre}"? El registro quedará inactivo.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        await firstValueFrom(this.servicio.remove(item.id));
        this.snackbar.open('Tipo de queso eliminado', 'OK', { duration: 3000 });
        this.cargar();
      });
  }
}
