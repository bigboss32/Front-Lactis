import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { Empleado, PagoEmpleado } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { dateToIso, hoyDate } from '../../shared/date-utils';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { MoneyPipe } from '../../shared/pipes';
import { NominaService } from './nomina.service';

@Component({
  selector: 'app-pagos-empleado',
  imports: [
    ReactiveFormsModule, DatePipe, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatTooltipModule, MatDatepickerModule, MatTableModule,
    MatProgressBarModule, MatSnackBarModule, MoneyPipe, MilesInputDirective,
  ],
  template: `
    <h2 mat-dialog-title>Pagos de {{ data.empleado.nombre }} {{ data.empleado.apellido }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-pago" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Días trabajados</mat-label>
          <input matInput type="number" min="0.01" step="0.01" formControlName="dias_trabajados" required />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Valor por día</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="valor_dia" />
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Período</mat-label>
          <input matInput formControlName="periodo" placeholder="Ej. Julio Q1" />
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea matInput formControlName="observaciones" rows="2"></textarea>
        </mat-form-field>
      </form>

      <div class="total-line">
        <span>Total a pagar</span>
        <span class="total-valor">{{ total() | money }}</span>
      </div>

      <div class="acciones-form">
        <button
          mat-flat-button
          type="submit"
          form="form-pago"
          [disabled]="form.invalid || guardando()"
        >
          <mat-icon>add</mat-icon> Registrar pago
        </button>
      </div>

      <h3>Historial de pagos</h3>

      @if (cargando()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <table mat-table [dataSource]="pagos()">
        <ng-container matColumnDef="fecha">
          <th mat-header-cell *matHeaderCellDef>Fecha</th>
          <td mat-cell *matCellDef="let pago">{{ pago.fecha | date: 'dd/MM/yyyy' }}</td>
        </ng-container>

        <ng-container matColumnDef="dias_trabajados">
          <th mat-header-cell *matHeaderCellDef class="num">Días</th>
          <td mat-cell *matCellDef="let pago" class="num">{{ pago.dias_trabajados }}</td>
        </ng-container>

        <ng-container matColumnDef="valor_dia">
          <th mat-header-cell *matHeaderCellDef class="num">Valor/día</th>
          <td mat-cell *matCellDef="let pago" class="num">{{ pago.valor_dia | money }}</td>
        </ng-container>

        <ng-container matColumnDef="anticipos">
          <th mat-header-cell *matHeaderCellDef class="num">Anticipos</th>
          <td mat-cell *matCellDef="let pago" class="num">{{ pago.anticipos | money }}</td>
        </ng-container>

        <ng-container matColumnDef="total">
          <th mat-header-cell *matHeaderCellDef class="num">Total</th>
          <td mat-cell *matCellDef="let pago" class="num">{{ pago.total | money }}</td>
        </ng-container>

        <ng-container matColumnDef="acciones">
          <th mat-header-cell *matHeaderCellDef class="col-acciones"></th>
          <td mat-cell *matCellDef="let pago" class="col-acciones">
            <button mat-icon-button matTooltip="Eliminar" (click)="eliminar(pago)">
              <mat-icon>delete</mat-icon>
            </button>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columnas"></tr>
        <tr mat-row *matRowDef="let pago; columns: columnas"></tr>
      </table>

      @if (!cargando() && pagos().length === 0) {
        <p class="sin-datos">Este empleado no tiene pagos registrados</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: `
    h3 {
      margin: 16px 0 8px;
      font-size: 1rem;
      font-weight: 500;
    }
    table { width: 100%; }
    .num { text-align: right; }
    .total-line {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin: 4px 0 12px;
      padding-top: 8px;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .total-valor {
      font-size: 1.25rem;
      font-weight: 600;
    }
    .acciones-form {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 8px;
    }
    .sin-datos {
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
      margin: 8px 0;
    }
  `,
})
export class PagosEmpleadoDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(NominaService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<{ empleado: Empleado }>(MAT_DIALOG_DATA);

  readonly columnas = ['fecha', 'dias_trabajados', 'valor_dia', 'anticipos', 'total', 'acciones'];
  readonly pagos = signal<PagoEmpleado[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    fecha: [hoyDate() as Date | null, Validators.required],
    dias_trabajados: [null as number | null, [Validators.required, Validators.min(0.01)]],
    valor_dia: [
      this.data.empleado.valor_dia != null ? Number(this.data.empleado.valor_dia) : null,
      [Validators.min(0)],
    ],
    periodo: [''],
    observaciones: [''],
  });

  private readonly valores = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  readonly total = computed(() => {
    const v = this.valores();
    const dias = Number(v.dias_trabajados) || 0;
    const valorDia =
      v.valor_dia != null && (v.valor_dia as unknown) !== ''
        ? Number(v.valor_dia)
        : Number(this.data.empleado.valor_dia ?? 0);
    return dias * valorDia;
  });

  constructor() {
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const respuesta = await firstValueFrom(this.servicio.listar(this.data.empleado.id));
      this.pagos.set(respuesta.items);
    } finally {
      this.cargando.set(false);
    }
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const v = this.form.getRawValue();
      await firstValueFrom(
        this.servicio.crear({
          empleado_id: this.data.empleado.id,
          fecha: dateToIso(v.fecha)!,
          dias_trabajados: Number(v.dias_trabajados),
          valor_dia:
            v.valor_dia != null && (v.valor_dia as unknown) !== '' ? Number(v.valor_dia) : null,
          periodo: v.periodo || null,
          observaciones: v.observaciones || null,
        }),
      );
      this.snackbar.open('Pago registrado', 'OK', { duration: 3000 });
      this.form.patchValue({ dias_trabajados: null, periodo: '', observaciones: '' });
      this.form.markAsPristine();
      await this.cargar();
    } catch (err) {
      const detalle =
        err instanceof HttpErrorResponse
          ? (err.error?.error?.detail ?? 'No fue posible registrar el pago')
          : 'No fue posible registrar el pago';
      this.snackbar.open(detalle, 'OK', { duration: 5000 });
    } finally {
      this.guardando.set(false);
    }
  }

  eliminar(pago: PagoEmpleado): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar pago',
          mensaje: `¿Eliminar el pago del ${dateToIso(pago.fecha)} por ${pago.dias_trabajados} día(s)?`,
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        await firstValueFrom(this.servicio.eliminar(pago.id));
        this.snackbar.open('Pago eliminado', 'OK', { duration: 3000 });
        await this.cargar();
      });
  }
}
