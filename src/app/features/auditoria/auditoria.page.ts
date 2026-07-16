import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { debounceTime, firstValueFrom, merge } from 'rxjs';

import { Auditoria, LoginAudit } from '../../core/models';
import { dateToIso } from '../../shared/date-utils';
import { PageHeader } from '../../shared/page-header';
import { AuditoriaDetalleDialog } from './auditoria-detalle.dialog';
import { AuditoriaService } from './auditoria.service';

@Component({
  selector: 'app-auditoria-page',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTabsModule, MatTableModule,
    MatPaginatorModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatIconModule, MatProgressBarModule, MatDatepickerModule,
    PageHeader,
  ],
  templateUrl: './auditoria.page.html',
  styles: `
    .contenido-tab { padding-top: 16px; }

    tr.fila-clic {
      cursor: pointer;
      &:hover { background: color-mix(in srgb, currentColor 5%, transparent); }
    }

    .ok    { color: #2e7d32; }
    .fallo { color: #c62828; }
    :host-context(html.dark) {
      .ok    { color: #81c784; }
      .fallo { color: #e57373; }
    }
  `,
})
export class AuditoriaPage implements OnInit {
  private readonly servicio = inject(AuditoriaService);
  private readonly dialog = inject(MatDialog);

  // -------------------------------------------------------------- operaciones
  readonly columnasOps = ['fecha', 'modulo', 'accion', 'entidad', 'ip'];
  readonly operaciones = signal<Auditoria[]>([]);
  readonly totalOps = signal(0);
  readonly cargandoOps = signal(false);
  readonly pageOps = signal(1);
  readonly pageSizeOps = signal(20);

  readonly modulo = new FormControl('', { nonNullable: true });
  readonly accion = new FormControl('', { nonNullable: true });
  readonly desde = new FormControl<Date | null>(null);
  readonly hasta = new FormControl<Date | null>(null);

  // ------------------------------------------------------------------- logins
  readonly columnasLogins = ['fecha', 'username_intentado', 'exito', 'motivo', 'ip'];
  readonly logins = signal<LoginAudit[]>([]);
  readonly totalLogins = signal(0);
  readonly cargandoLogins = signal(false);
  readonly pageLogins = signal(1);
  readonly pageSizeLogins = signal(20);

  readonly exito = new FormControl<boolean | null>(null);

  constructor() {
    merge(this.modulo.valueChanges, this.accion.valueChanges)
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.recargarOperaciones());
    merge(this.desde.valueChanges, this.hasta.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.recargarOperaciones());
    this.exito.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargarLogins());
  }

  ngOnInit(): void {
    this.cargarOperaciones();
    this.cargarLogins();
  }

  recargarOperaciones(): void {
    this.pageOps.set(1);
    this.cargarOperaciones();
  }

  async cargarOperaciones(): Promise<void> {
    this.cargandoOps.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.listar({
          page: this.pageOps(),
          page_size: this.pageSizeOps(),
          modulo: this.modulo.value || null,
          accion: this.accion.value || null,
          desde: dateToIso(this.desde.value),
          hasta: dateToIso(this.hasta.value),
        }),
      );
      this.operaciones.set(respuesta.items);
      this.totalOps.set(respuesta.total);
    } finally {
      this.cargandoOps.set(false);
    }
  }

  cambiarPaginaOps(evento: PageEvent): void {
    this.pageOps.set(evento.pageIndex + 1);
    this.pageSizeOps.set(evento.pageSize);
    this.cargarOperaciones();
  }

  verDetalle(registro: Auditoria): void {
    this.dialog.open(AuditoriaDetalleDialog, { data: { registro }, width: '900px' });
  }

  recargarLogins(): void {
    this.pageLogins.set(1);
    this.cargarLogins();
  }

  async cargarLogins(): Promise<void> {
    this.cargandoLogins.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.servicio.logins({
          page: this.pageLogins(),
          page_size: this.pageSizeLogins(),
          exito: this.exito.value,
        }),
      );
      this.logins.set(respuesta.items);
      this.totalLogins.set(respuesta.total);
    } finally {
      this.cargandoLogins.set(false);
    }
  }

  cambiarPaginaLogins(evento: PageEvent): void {
    this.pageLogins.set(evento.pageIndex + 1);
    this.pageSizeLogins.set(evento.pageSize);
    this.cargarLogins();
  }
}
