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
import { Empresa } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { PageHeader } from '../../shared/page-header';
import { AdminEmpresaDialog } from './admin-empresa.dialog';
import { EmpresaFormDialog } from './empresa-form.dialog';
import { EmpresasService } from './empresas.service';

@Component({
  selector: 'app-empresa-list',
  imports: [
    ReactiveFormsModule, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
    PageHeader, EstadoChip, HasPermissionDirective,
  ],
  templateUrl: './empresa-list.page.html',
})
export class EmpresaListPage implements OnInit {
  private readonly servicio = inject(EmpresasService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  readonly columnas = ['nombre', 'nit', 'ciudad', 'telefono', 'correo', 'estado', 'acciones'];
  readonly filas = signal<Empresa[]>([]);
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

  abrirFormulario(item?: Empresa): void {
    this.dialog
      .open(EmpresaFormDialog, { data: { item }, width: '640px' })
      .afterClosed()
      .subscribe((resultado: Empresa | true | undefined) => {
        if (!resultado) return;
        this.snackbar.open('Empresa guardada', 'OK', { duration: 3000 });
        this.cargar();
        // Al crear (no al editar) el diálogo devuelve la Empresa:
        // se ofrece continuar con la creación de su administrador.
        if (resultado !== true) {
          this.ofrecerCrearAdministrador(resultado);
        }
      });
  }

  /** Paso 2 del flujo guiado: propone crear el administrador de la empresa recién creada. */
  private ofrecerCrearAdministrador(empresa: Empresa): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Empresa creada',
          mensaje: `¿Quieres crear ahora el usuario administrador de ${empresa.nombre}? Sin un administrador, nadie podrá operar esta empresa.`,
          accion: 'Crear administrador',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (confirmado) this.crearAdministrador(empresa);
      });
  }

  crearAdministrador(empresa: Empresa): void {
    this.dialog.open(AdminEmpresaDialog, { data: { empresa }, width: '560px' });
  }

  eliminar(item: Empresa): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar empresa',
          mensaje: `¿Eliminar la empresa "${item.nombre}"? El registro quedará inactivo.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        await firstValueFrom(this.servicio.remove(item.id));
        this.snackbar.open('Empresa eliminada', 'OK', { duration: 3000 });
        this.cargar();
      });
  }
}
