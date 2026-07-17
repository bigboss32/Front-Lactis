import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Anticipo } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EstadoChip } from '../../shared/estado-chip';
import { PageHeader } from '../../shared/page-header';
import { MoneyPipe } from '../../shared/pipes';
import { AnticipoFormDialog } from './anticipo-form.dialog';
import { AnticiposService } from './anticipos.service';

@Component({
  selector: 'app-anticipo-list',
  imports: [
    DatePipe, MatCardModule, MatTableModule, MatPaginatorModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatTooltipModule,
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

  readonly columnas = ['beneficiario', 'fecha', 'valor', 'observaciones', 'aplicado', 'acciones'];
  readonly filas = signal<Anticipo[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  private readonly etiquetasTipo: Record<string, string> = {
    proveedor: 'Proveedor',
    transportador: 'Transportador',
    empleado: 'Empleado',
  };

  ngOnInit(): void {
    this.cargar();
  }

  nombreBeneficiario(fila: Anticipo): string {
    return fila.tercero_nombre ?? '—';
  }

  tipoBeneficiario(fila: Anticipo): string {
    return this.etiquetasTipo[fila.tipo] ?? fila.tipo;
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.list({ page: this.page(), page_size: this.pageSize() }),
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
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar anticipo',
          mensaje: `¿Eliminar el anticipo de "${this.nombreBeneficiario(item)}"? El registro quedará inactivo.`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        await firstValueFrom(this.servicio.remove(item.id));
        this.snackbar.open('Anticipo eliminado', 'OK', { duration: 3000 });
        this.cargar();
      });
  }
}
