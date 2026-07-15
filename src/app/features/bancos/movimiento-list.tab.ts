import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { CuentaBancaria, MovimientoBancario } from '../../core/models';
import { EstadoChip } from '../../shared/estado-chip';
import { MoneyPipe } from '../../shared/pipes';
import { CuentasBancariasService, MovimientosBancariosService } from './bancos.service';
import { MovimientoBancarioFormDialog } from './movimiento-bancario-form.dialog';

@Component({
  selector: 'app-movimiento-bancario-list-tab',
  imports: [
    ReactiveFormsModule, DatePipe, MatCardModule, MatTableModule, MatPaginatorModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatCheckboxModule,
    EstadoChip, MoneyPipe, HasPermissionDirective,
  ],
  templateUrl: './movimiento-list.tab.html',
  styles: `
    .negativo { color: var(--mat-sys-error); }
  `,
})
export class MovimientoBancarioListTab implements OnInit {
  private readonly servicio = inject(MovimientosBancariosService);
  private readonly cuentasServicio = inject(CuentasBancariasService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  readonly columnas = [
    'seleccion', 'fecha', 'cuenta', 'tipo', 'concepto', 'referencia', 'valor', 'conciliado',
  ];
  readonly filas = signal<MovimientoBancario[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly conciliando = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly cuentas = signal<CuentaBancaria[]>([]);

  readonly seleccion = signal<ReadonlySet<string>>(new Set<string>());
  readonly seleccionables = computed(() => this.filas().filter((f) => !f.conciliado));
  readonly todosSeleccionados = computed(() => {
    const seleccionables = this.seleccionables();
    return seleccionables.length > 0 && seleccionables.every((f) => this.seleccion().has(f.id));
  });
  readonly algunoSeleccionado = computed(() =>
    this.seleccionables().some((f) => this.seleccion().has(f.id)),
  );

  readonly cuentaId = new FormControl<string | null>(null);
  readonly conciliado = new FormControl<'todos' | 'si' | 'no'>('todos', { nonNullable: true });
  readonly desde = new FormControl('', { nonNullable: true });
  readonly hasta = new FormControl('', { nonNullable: true });

  constructor() {
    this.cuentaId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    this.conciliado.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    this.desde.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
    this.hasta.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recargar());
  }

  ngOnInit(): void {
    this.cargar();
    firstValueFrom(this.cuentasServicio.list({ page_size: 100, estado: 'activo' })).then((page) =>
      this.cuentas.set(page.items),
    );
  }

  cuentaNombre(id: string): string {
    const cuenta = this.cuentas().find((c) => c.id === id);
    return cuenta ? `${cuenta.banco} — ${cuenta.numero_cuenta}` : '—';
  }

  recargar(): void {
    this.page.set(1);
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.seleccion.set(new Set<string>());
    try {
      const conciliadoFiltro = this.conciliado.value;
      const respuesta = await firstValueFrom(
        this.servicio.list({
          page: this.page(),
          page_size: this.pageSize(),
          cuenta_id: this.cuentaId.value,
          conciliado: conciliadoFiltro === 'todos' ? null : conciliadoFiltro === 'si',
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

  toggleSeleccion(id: string): void {
    const nueva = new Set(this.seleccion());
    if (nueva.has(id)) {
      nueva.delete(id);
    } else {
      nueva.add(id);
    }
    this.seleccion.set(nueva);
  }

  toggleTodos(marcar: boolean): void {
    this.seleccion.set(
      marcar ? new Set(this.seleccionables().map((f) => f.id)) : new Set<string>(),
    );
  }

  nuevoMovimiento(): void {
    this.dialog
      .open(MovimientoBancarioFormDialog, { width: '640px' })
      .afterClosed()
      .subscribe((guardado) => {
        if (guardado) {
          this.snackbar.open('Movimiento registrado', 'OK', { duration: 3000 });
          this.recargar();
        }
      });
  }

  async conciliarSeleccionados(): Promise<void> {
    const ids = [...this.seleccion()];
    if (ids.length === 0) return;
    this.conciliando.set(true);
    try {
      const conciliados = await firstValueFrom(this.servicio.conciliar(ids));
      this.snackbar.open(
        `${conciliados.length} movimiento(s) conciliado(s)`,
        'OK',
        { duration: 3000 },
      );
      this.cargar();
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible conciliar los movimientos')
          : 'No fue posible conciliar los movimientos';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.conciliando.set(false);
    }
  }
}
