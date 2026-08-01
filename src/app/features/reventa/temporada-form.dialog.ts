import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { dateToIso, isoToDate } from '../../shared/date-utils';
import { ReventaService, Temporada, TemporadaPayload } from './reventa.service';

export interface TemporadaFormData {
  /** Si viene, se edita esa temporada; si no, se crea una nueva. */
  temporada?: Temporada;
  /** Inicio propuesto (día siguiente al último cierre), solo al crear. */
  proximoInicio?: string | null;
}

/**
 * Abrir o editar una temporada. Son solo cuatro campos porque una temporada es
 * eso: un nombre y un rango de fechas. Las cifras no se escriben nunca, se
 * calculan de las compras y las ventas de esas fechas.
 *
 * "Sigue abierta" es una casilla y no un campo de fecha vacío a propósito: dejar
 * un campo en blanco no dice si es que no se sabe o si es que no ha terminado, y
 * esa diferencia cambia lo que hace el sistema (la abierta se calcula hasta hoy).
 */
@Component({
  selector: 'app-temporada-form-dialog',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatButtonModule, MatCheckboxModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ editando() ? 'Editar temporada' : 'Nueva temporada' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="formulario">
        <mat-form-field class="ancho-total">
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" maxlength="80" placeholder="Ej: Temporada de Semana Santa" />
          <mat-hint>Como la llama usted: un mes, una feria, una fecha del año</mat-hint>
          @if (form.controls.nombre.hasError('required') && form.controls.nombre.touched) {
            <mat-error>Póngale un nombre para reconocerla</mat-error>
          }
        </mat-form-field>

        <!-- Un solo calendario para las dos fechas: la temporada ES un rango, y
             marcando el primer día y el último de una pasada no hay que abrir
             dos calendarios ni acordarse de cuál campo era cuál. -->
        <mat-form-field class="ancho-total">
          <mat-label>Fechas de la temporada</mat-label>
          <mat-date-range-input [rangePicker]="calendario">
            <input matStartDate placeholder="Empezó" formControlName="fecha_inicio" />
            <!-- Sin fecha de fin el rótulo dice por qué está vacío: en blanco a
                 secas no se sabe si falta el dato o si es que no ha terminado. -->
            <input matEndDate formControlName="fecha_fin"
                   [placeholder]="sigueAbierta.value ? 'Sigue abierta' : 'Terminó'" />
          </mat-date-range-input>
          <mat-datepicker-toggle matIconSuffix [for]="calendario" />
          <mat-date-range-picker #calendario [dateClass]="claseDia" />
          <mat-hint>
            Los días con punto son en los que entró queso
          </mat-hint>
          @if (form.controls.fecha_inicio.hasError('required') && form.controls.fecha_inicio.touched) {
            <mat-error>Falta la fecha de inicio</mat-error>
          } @else if (rangoAlReves()) {
            <mat-error>No puede terminar antes de empezar</mat-error>
          }
        </mat-form-field>

        <mat-checkbox class="ancho-total" [formControl]="sigueAbierta" (change)="alCambiarAbierta()">
          Sigue abierta (es la que está corriendo)
        </mat-checkbox>
        @if (sigueAbierta.value) {
          <p class="nota ancho-total">
            <mat-icon aria-hidden="true">info</mat-icon>
            Mientras esté abierta, las cifras se calculan hasta hoy. Solo puede haber
            una temporada abierta a la vez.
          </p>
        }

        <mat-form-field class="ancho-total">
          <mat-label>Notas (opcional)</mat-label>
          <textarea matInput formControlName="notas" rows="2" maxlength="500"
                    placeholder="Ej: subió el precio del queso a mitad de temporada"></textarea>
        </mat-form-field>

        <p class="nota ancho-total">
          <mat-icon aria-hidden="true">calculate</mat-icon>
          La ganancia no se escribe: sale de las compras y las ventas que estén entre
          esas dos fechas, y es la misma que muestra el Resumen si lo filtra igual.
        </p>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button [disabled]="form.invalid || rangoAlReves()" (click)="guardar()">
        {{ editando() ? 'Guardar' : 'Crear temporada' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .formulario {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px 16px;
      padding-top: 6px;
      min-width: min(460px, 78vw);
    }
    .ancho-total { grid-column: 1 / -1; }
    .nota {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.82rem;
      line-height: 1.35;
    }
    .nota mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex: none;
    }
    @media (max-width: 560px) {
      .formulario { grid-template-columns: 1fr; }
    }
  `,
})
export class TemporadaFormDialog {
  private readonly fb = inject(FormBuilder);
  private readonly ref = inject(MatDialogRef<TemporadaFormDialog>);
  private readonly servicio = inject(ReventaService);
  readonly data = inject<TemporadaFormData>(MAT_DIALOG_DATA, { optional: true }) ?? {};

  readonly editando = signal(!!this.data.temporada);

  readonly form = this.fb.group({
    nombre: [this.data.temporada?.nombre ?? '', [Validators.required, Validators.minLength(2)]],
    fecha_inicio: [
      isoToDate(this.data.temporada?.fecha_inicio ?? this.data.proximoInicio ?? null) ?? new Date(),
      Validators.required,
    ],
    fecha_fin: [isoToDate(this.data.temporada?.fecha_fin ?? null)],
    notas: [this.data.temporada?.notas ?? ''],
  });

  /** Al crear arranca abierta: lo normal es abrir la temporada que empieza hoy. */
  readonly sigueAbierta = this.fb.nonNullable.control(
    this.data.temporada ? this.data.temporada.abierta : true,
  );

  /**
   * Los días en que ENTRÓ queso, para marcarlos con un punto en el calendario:
   * la temporada se delimita sobre los días que hubo movimiento, y así se ve
   * dónde empezó y dónde paró la entrada en vez de adivinar las fechas.
   *
   * Se pide una sola vez al abrir el diálogo. No hace falta refrescarlo: el
   * diálogo dura lo que dura llenar el formulario y las compras no cambian
   * mientras tanto. Si la consulta falla no se avisa nada, porque el punto es
   * una ayuda: sin él el formulario se llena igual.
   */
  private readonly diasConEntrada = signal<ReadonlySet<string>>(new Set());

  /**
   * Campo y no método: el calendario guarda la referencia, y un método suelto
   * perdería el `this` al llamarlo desde dentro del componente de Material.
   *
   * `dateToIso` arma la fecha con los componentes LOCALES (no con
   * toISOString(), que pasa a UTC y en Colombia devolvería el día anterior
   * antes de las 7 p.m.), así que el punto cae en el día que es.
   */
  readonly claseDia = (d: Date): string =>
    this.diasConEntrada().has(dateToIso(d)) ? 'dia-con-entrada' : '';

  constructor() {
    this.servicio.lotes().subscribe({
      next: (p) => this.diasConEntrada.set(new Set(p.lotes.map((l) => l.fecha))),
      error: () => {},
    });

    // Poner fecha de fin es justo lo contrario de que la temporada siga
    // abierta, así que la casilla se desmarca sola. Con un solo calendario el
    // usuario marca el rango completo de una vez, y sin esto la fecha que
    // acaba de elegir se descartaría al guardar sin que él se diera cuenta.
    this.form.controls.fecha_fin.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((fin) => {
        if (fin && this.sigueAbierta.value) this.sigueAbierta.setValue(false);
      });
  }

  /**
   * El backend también lo valida; esto es para no mandar el viaje en balde.
   *
   * Método y no `computed`: lo que compara son controles de formulario, que no
   * son señales, así que un `computed` se quedaría pegado en el primer valor y
   * el aviso no saldría nunca.
   */
  rangoAlReves(): boolean {
    if (this.sigueAbierta.value) return false;
    const inicio = this.form.controls.fecha_inicio.value;
    const fin = this.form.controls.fecha_fin.value;
    return !!inicio && !!fin && fin < inicio;
  }

  alCambiarAbierta(): void {
    // Al marcar "sigue abierta" se limpia la fecha de fin: si se quedara puesta,
    // el usuario creería que guardó esa fecha.
    if (this.sigueAbierta.value) this.form.controls.fecha_fin.setValue(null);
  }

  guardar(): void {
    if (this.form.invalid || this.rangoAlReves()) return;
    const v = this.form.getRawValue();
    const payload: TemporadaPayload = {
      nombre: (v.nombre ?? '').trim(),
      fecha_inicio: dateToIso(v.fecha_inicio) ?? '',
      // null y no undefined: al editar hay que poder BORRAR la fecha de fin para
      // reabrirla, y con undefined el exclude_unset del backend la dejaría igual.
      fecha_fin: this.sigueAbierta.value ? null : dateToIso(v.fecha_fin),
      notas: (v.notas ?? '').trim() || null,
    };
    this.ref.close(payload);
  }
}
