import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Monto } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { dateToIso, hoyDate, isoToDate } from '../../shared/date-utils';
import { avisarErrorAlGuardar } from '../../shared/errores-ui';
import { MilesInputDirective } from '../../shared/miles-input.directive';
import { MoneyPipe } from '../../shared/pipes';
import { protegerCambios } from '../../shared/proteger-cambios';
import { SpinnerBoton } from '../../shared/spinner-boton';
import {
  AbonoReventa,
  ReventaService,
  SaldoAnterior,
  TipoSaldoAnterior,
} from './reventa.service';

export interface SaldoAnteriorDialogData {
  /** Lado del libro: 'cobrar' (un cliente le debe) o 'pagar' (él le debe a un productor). */
  tipo: TipoSaldoAnterior;
  item?: SaldoAnterior;
}

/**
 * Carga o edita una cuenta a medio pagar traída del sistema anterior.
 *
 * No pide kilos ni precio por kilo a propósito: estas cuentas NO son ventas ni
 * compras de aquí, no tocan el queso disponible ni la ganancia. Lo único que se
 * necesita del libro viejo es de qué era la cuenta, por cuánto, qué le habían
 * abonado y de qué fecha es el documento.
 */
@Component({
  selector: 'app-saldo-anterior-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatButtonModule, MatAutocompleteModule, MoneyPipe,
    MilesInputDirective, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ titulo() }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-saldo-anterior" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha del documento</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
          <mat-hint>La del libro viejo, no la de hoy</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ etiquetaTercero() }}</mat-label>
          <input matInput formControlName="tercero" required maxlength="150" [matAutocomplete]="autoTercero" />
          <mat-autocomplete #autoTercero="matAutocomplete">
            @for (nombre of tercerosFiltrados(); track nombre) {
              <mat-option [value]="nombre">{{ nombre }}</mat-option>
            }
          </mat-autocomplete>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>¿De qué era?</mat-label>
          <input
            matInput
            formControlName="concepto"
            required
            maxlength="200"
            [placeholder]="ejemploConcepto()"
          />
          <mat-hint>Para reconocer la cuenta en el libro viejo</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Valor total</mat-label>
          <input matInput type="text" inputmode="numeric" appMiles formControlName="valor_total" required />
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>
        @if (!data.item) {
          <mat-form-field>
            <mat-label>Ya abonado</mat-label>
            <input matInput type="text" inputmode="numeric" appMiles formControlName="abonado" />
            <span matTextPrefix>$&nbsp;</span>
            <mat-hint>Lo que ya le habían pagado en el libro viejo (déjelo en cero si no había abonado nada)</mat-hint>
          </mat-form-field>
        }
        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea matInput formControlName="observaciones" rows="2" maxlength="500"></textarea>
        </mat-form-field>
      </form>

      <div class="calculo" [class.error]="abonoExcede()">
        @if (abonoExcede()) {
          <span>
            Lo abonado ({{ abonadoActual() | money }}) es más que el valor total de la cuenta.
            @if (data.item) {
              Para bajar el total, elimine primero un abono desde «Ver abonos».
            }
          </span>
        } @else {
          <span>
            {{ etiquetaSaldo() }}: <strong>{{ saldoVivo() | money }}</strong>
          </span>
          @if (abonadoActual() > 0) {
            <span>Ya abonado: <strong>{{ abonadoActual() | money }}</strong></span>
          }
        }
      </div>

      @if (data.item) {
        <p class="nota">
          El abonado no se cambia aquí: se mueve registrando o eliminando abonos, igual que en
          las compras y las ventas.
        </p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-saldo-anterior"
        [disabled]="form.invalid || abonoExcede() || guardando()"
      >
        @if (guardando()) {
          <app-spinner-boton /> Guardando…
        } @else {
          Guardar
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    // Espacio extra entre filas: casi todos los campos llevan una pista debajo.
    .form-grid { row-gap: 22px; }

    .calculo {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 32px;
      margin-top: 16px;
      padding: 10px 14px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface-variant);

      strong { color: var(--mat-sys-on-surface); font-variant-numeric: tabular-nums; }
    }

    // La cuenta quedaría con saldo negativo: se avisa aquí, antes de gastar el
    // viaje al servidor (al crear, el backend rechaza el abonado que se pasa del
    // total; al editar no hay quien lo pare, y un saldo en negativo restaría de
    // lo que hay por cobrar).
    .calculo.error {
      background: color-mix(in srgb, var(--mat-sys-error) 12%, transparent);
      color: var(--mat-sys-error);
    }

    .nota {
      margin: 10px 0 0;
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class SaldoAnteriorFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<SaldoAnteriorFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<SaldoAnteriorDialogData>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  /** El tipo lo fija la pestaña desde la que se abre; aquí no se cambia de lado. */
  private readonly tipo: TipoSaldoAnterior = this.data.item?.tipo ?? this.data.tipo;

  readonly form = this.fb.group({
    fecha: [
      this.data.item ? (isoToDate(this.data.item.fecha) ?? hoyDate()) : hoyDate(),
      Validators.required,
    ],
    tercero: [this.data.item?.tercero ?? '', [Validators.required, Validators.minLength(2)]],
    concepto: [this.data.item?.concepto ?? '', [Validators.required, Validators.minLength(2)]],
    valor_total: [
      Number(this.data.item?.valor_total ?? 0),
      [Validators.required, Validators.min(0.01)],
    ],
    abonado: [Number(this.data.item?.abonado ?? 0), [Validators.min(0)]],
    observaciones: [this.data.item?.observaciones ?? ''],
  });

  /** Re-emite en cada cambio del formulario para recalcular el saldo en vivo. */
  private readonly cambios = toSignal(this.form.valueChanges);

  /** Nombres ya usados del lado que corresponde, para autocompletar. */
  readonly terceros = signal<string[]>([]);

  constructor() {
    firstValueFrom(this.servicio.sugerencias())
      // Un saldo por cobrar es de un CLIENTE y uno por pagar es de un PRODUCTOR:
      // la lista tiene que ser la del lado correcto para que el backend canonice
      // el nombre contra ella y la deuda no quede partida en dos escrituras.
      .then((s) => this.terceros.set(this.tipo === 'cobrar' ? s.clientes : s.productores))
      .catch(() => undefined);
    protegerCambios(this.dialogRef, () => this.form);
  }

  titulo(): string {
    if (this.data.item) return 'Editar cuenta del libro anterior';
    return this.tipo === 'cobrar'
      ? 'Nueva cuenta por cobrar del libro anterior'
      : 'Nueva cuenta por pagar del libro anterior';
  }

  etiquetaTercero(): string {
    return this.tipo === 'cobrar' ? 'Cliente que le debe' : 'Productor al que le debe';
  }

  etiquetaSaldo(): string {
    return this.tipo === 'cobrar' ? 'Queda por cobrar' : 'Queda por pagar';
  }

  ejemploConcepto(): string {
    return this.tipo === 'cobrar' ? 'Ej. Venta 120 kg del 3 de mayo' : 'Ej. Factura 045';
  }

  readonly tercerosFiltrados = computed(() => {
    this.cambios();
    const texto = (this.form.getRawValue().tercero ?? '').toLowerCase().trim();
    const todos = this.terceros();
    const filtrados = texto ? todos.filter((n) => n.toLowerCase().includes(texto)) : todos;
    return filtrados.slice(0, 20);
  });

  /** Al editar manda el abonado que ya tiene la cuenta (el campo no se muestra). */
  readonly abonadoActual = computed(() => {
    this.cambios();
    return this.data.item
      ? Number(this.data.item.abonado)
      : Number(this.form.getRawValue().abonado || 0);
  });

  readonly saldoVivo = computed(() => {
    this.cambios();
    return Number(this.form.getRawValue().valor_total || 0) - this.abonadoActual();
  });

  /** Lo abonado no puede pasarse del total: el backend lo rechaza con BusinessError. */
  readonly abonoExcede = computed(() => this.saldoVivo() < 0);

  async guardar(): Promise<void> {
    if (this.form.invalid || this.abonoExcede()) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      const payload = {
        fecha: dateToIso(valores.fecha),
        tercero: valores.tercero.trim(),
        concepto: valores.concepto.trim(),
        valor_total: Number(valores.valor_total),
        observaciones: valores.observaciones?.trim() || null,
      };
      await firstValueFrom(
        this.data.item
          ? this.servicio.editarSaldoAnterior(this.data.item.id, payload)
          : this.servicio.crearSaldoAnterior({
              ...payload,
              tipo: this.tipo,
              abonado: Number(valores.abonado || 0),
            }),
      );
      this.dialogRef.close(true);
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible guardar la cuenta');
    } finally {
      this.guardando.set(false);
    }
  }
}

// ---------------------------------------------------------------- abonos
// Los saldos del libro anterior tienen sus propios diálogos de abonos, hermanos
// de abono-form.dialog.ts y abonos-list.dialog.ts: aquellos hablan solo con los
// endpoints de compras y de ventas ('compra' | 'venta'), y estos van contra
// /reventa/saldos-anteriores/{id}/abonos. La pantalla se ve igual.

export interface SaldoAbonoDialogData {
  id: string;
  titulo: string;
  saldo: Monto;
}

/** Registra un abono (pago parcial) sobre una cuenta del libro anterior. */
@Component({
  selector: 'app-saldo-abono-form',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatButtonModule, MoneyPipe, MilesInputDirective,
    SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.titulo }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" id="form-abono-saldo" (ngSubmit)="guardar()">
        <mat-form-field>
          <mat-label>Fecha</mat-label>
          <input matInput [matDatepicker]="pFecha" (click)="pFecha.open()" formControlName="fecha" required />
          <mat-datepicker-toggle matSuffix [for]="pFecha" />
          <mat-datepicker #pFecha />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Valor</mat-label>
          <!-- cdkFocusInitial: el foco arranca en el valor, no en la fecha (que se llena con el calendario). -->
          <input matInput type="text" inputmode="numeric" appMiles formControlName="valor" required cdkFocusInitial />
          <span matTextPrefix>$&nbsp;</span>
          <mat-hint>Saldo pendiente: {{ data.saldo | money }}</mat-hint>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Observaciones</mat-label>
          <textarea matInput formControlName="observaciones" rows="2" maxlength="300"></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button
        mat-flat-button
        type="submit"
        form="form-abono-saldo"
        [disabled]="form.invalid || guardando()"
      >
        @if (guardando()) {
          <app-spinner-boton /> Registrando abono…
        } @else {
          Registrar abono
        }
      </button>
    </mat-dialog-actions>
  `,
})
export class SaldoAbonoFormDialog {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly servicio = inject(ReventaService);
  private readonly dialogRef = inject(MatDialogRef<SaldoAbonoFormDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<SaldoAbonoDialogData>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);

  readonly form = this.fb.group({
    fecha: [hoyDate(), Validators.required],
    valor: [
      Number(this.data.saldo),
      [Validators.required, Validators.min(0.01), Validators.max(Number(this.data.saldo))],
    ],
    observaciones: [''],
  });

  constructor() {
    protegerCambios(this.dialogRef, () => this.form);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) return;
    this.guardando.set(true);
    try {
      const valores = this.form.getRawValue();
      await firstValueFrom(
        this.servicio.abonarSaldoAnterior(this.data.id, {
          fecha: dateToIso(valores.fecha),
          valor: Number(valores.valor),
          observaciones: valores.observaciones || null,
        }),
      );
      this.dialogRef.close(true);
    } catch (err) {
      // Cuando no se sabe si el abono entró (tiempo agotado, 5xx, señal caída
      // con el celular en línea) el aviso dura mucho más y hay que cerrarlo a
      // mano: es el mensaje que evita que el dueño lo registre dos veces.
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible registrar el abono');
    } finally {
      this.guardando.set(false);
    }
  }
}

export interface SaldoAbonosDialogData {
  titulo: string;
  abonos: AbonoReventa[];
  id: string;
}

/**
 * Lista de abonos de una cuenta del libro anterior. Permite eliminar uno
 * registrado por error: el backend baja el "abonado" y recalcula el estado.
 * El primero suele ser el "Abonado en el libro anterior", el que traía el
 * documento viejo.
 */
@Component({
  selector: 'app-saldo-abonos-list',
  imports: [
    DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatTableModule,
    MatTooltipModule, MoneyPipe, HasPermissionDirective,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.titulo }}</h2>
    <mat-dialog-content>
      @if (abonos().length > 0) {
        <table mat-table [dataSource]="abonos()">
          <ng-container matColumnDef="fecha">
            <th mat-header-cell *matHeaderCellDef>Fecha</th>
            <td mat-cell *matCellDef="let abono">{{ abono.fecha | date: 'dd/MM/yyyy' }}</td>
          </ng-container>

          <ng-container matColumnDef="valor">
            <th mat-header-cell *matHeaderCellDef class="num">Valor</th>
            <td mat-cell *matCellDef="let abono" class="num">{{ abono.valor | money }}</td>
          </ng-container>

          <ng-container matColumnDef="observaciones">
            <th mat-header-cell *matHeaderCellDef>Observaciones</th>
            <td mat-cell *matCellDef="let abono">{{ abono.observaciones || '—' }}</td>
          </ng-container>

          <ng-container matColumnDef="acciones">
            <th mat-header-cell *matHeaderCellDef class="col-acciones"></th>
            <td mat-cell *matCellDef="let abono" class="col-acciones">
              <button
                mat-icon-button
                *hasPermission="'reventa:crear'"
                matTooltip="Eliminar este abono (registrado por error)"
                [disabled]="eliminando()"
                (click)="eliminarAbono(abono)"
              >
                <mat-icon>delete</mat-icon>
              </button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="columnas"></tr>
          <tr mat-row *matRowDef="let abono; columns: columnas"></tr>
        </table>
      } @else {
        <div class="empty-state">
          <mat-icon>payments</mat-icon>
          <p>No hay abonos registrados</p>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cerrar()">Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: `
    table { width: 100%; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .col-acciones { width: 48px; text-align: right; }
  `,
})
export class SaldoAbonosListDialog {
  private readonly servicio = inject(ReventaService);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef<SaldoAbonosListDialog>);
  private readonly snackbar = inject(MatSnackBar);

  readonly data = inject<SaldoAbonosDialogData>(MAT_DIALOG_DATA);
  readonly abonos = signal<AbonoReventa[]>([...this.data.abonos]);
  readonly eliminando = signal(false);
  readonly columnas = ['fecha', 'valor', 'observaciones', 'acciones'];

  /** Se pone en true si se eliminó algún abono, para que la lista se recargue al cerrar. */
  private cambiado = false;

  eliminarAbono(abono: AbonoReventa): void {
    const valor = `$${Number(abono.valor).toLocaleString('es-CO')}`;
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar abono',
          mensaje: `¿Eliminar el abono de ${valor}? Se recalculará el saldo. Esta acción no se puede deshacer.`,
          accion: 'Eliminar',
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        this.eliminando.set(true);
        try {
          await firstValueFrom(this.servicio.eliminarAbonoSaldoAnterior(this.data.id, abono.id));
          this.abonos.update((lista) => lista.filter((a) => a.id !== abono.id));
          this.cambiado = true;
          this.snackbar.open('Abono eliminado', 'OK', { duration: 3000 });
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible eliminar el abono');
        } finally {
          this.eliminando.set(false);
        }
      });
  }

  cerrar(): void {
    this.dialogRef.close(this.cambiado);
  }
}
