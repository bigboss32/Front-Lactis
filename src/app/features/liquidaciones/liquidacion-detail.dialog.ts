import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, firstValueFrom } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { Liquidacion, LiquidacionDetalle, PagoLiquidacion } from '../../core/models';
import { compartirArchivo, compartirWhatsApp } from '../../shared/compartir';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { EstadoChip } from '../../shared/estado-chip';
import { CantidadPipe, MoneyPipe } from '../../shared/pipes';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { LiquidacionEstadoStepper } from './liquidacion-estado-stepper';
import { LiquidacionesService } from './liquidaciones.service';
import { PagoLiquidacionFormDialog } from './pago-form.dialog';

/**
 * Lee un precio escrito a la colombiana: "1.750" son mil setecientos cincuenta,
 * no uno con setenta y cinco. El punto separa miles y la coma es el decimal, al
 * revés de lo que entiende Number(). Devuelve null si lo tecleado no es un
 * precio utilizable, para no mandarle NaN al backend.
 */
function precioTecleado(texto: string): number | null {
  const limpio = texto.trim().replace(/\s|\$/g, '').replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  const numero = Number(limpio);
  return numero > 0 ? numero : null;
}

@Component({
  selector: 'app-liquidacion-detail',
  imports: [
    DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule,
    MatTableModule, MatTooltipModule, EstadoChip, MoneyPipe, CantidadPipe, HasPermissionDirective,
    LiquidacionEstadoStepper, SpinnerBoton,
  ],
  templateUrl: './liquidacion-detail.dialog.html',
  styles: `
    .info {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 32px;
      margin-bottom: 8px;
    }
    .etiqueta {
      display: block;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }
    h3 {
      margin: 16px 0 8px;
      font-size: 1rem;
      font-weight: 500;
    }
    table { width: 100%; }
    .num { text-align: right; }
    .sin-datos {
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
      margin: 8px 0;
    }
    .resumen {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 32px;
      max-width: 420px;
    }
    .resumen .destacado { font-weight: 600; }

    .ayuda-precio {
      margin: 6px 0 0;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }

    /* ---------------------------------------- precio por litro editable */
    /*
     * El botón se ve como texto normal: la fila no debe parecer un formulario.
     * La pista de que se puede tocar aparece al pasar el mouse o al enfocar, que
     * es cuando el usuario ya está preguntándose si se puede.
     */
    .precio-editable {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      margin: -2px -6px;
      font: inherit;
      color: inherit;
      background: transparent;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-variant-numeric: tabular-nums;
    }
    .precio-editable:hover,
    .precio-editable:focus-visible {
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
    }
    .precio-editable .lapiz {
      font-size: 16px;
      width: 16px;
      height: 16px;
      opacity: 0;
      color: var(--mat-sys-primary);
      transition: opacity 120ms ease;
    }
    .precio-editable:hover .lapiz,
    .precio-editable:focus-visible .lapiz { opacity: 1; }
    /* En pantalla táctil no hay hover: si el lápiz nunca se ve, nadie descubre
       que la cifra se puede corregir. */
    @media (hover: none) {
      .precio-editable .lapiz { opacity: 0.6; }
    }

    .precio-edicion {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      justify-content: flex-end;
    }
    .precio-edicion input {
      width: 96px;
      padding: 4px 6px;
      font: inherit;
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--mat-sys-on-surface);
      background: var(--mat-sys-surface);
      border: 1px solid var(--mat-sys-primary);
      border-radius: 4px;
    }
    .precio-edicion input:disabled { opacity: 0.7; }
  `,
})
export class LiquidacionDetailDialog {
  private readonly servicio = inject(LiquidacionesService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(MatSnackBar);
  private readonly auth = inject(AuthService);

  readonly data = inject<{ item: Liquidacion }>(MAT_DIALOG_DATA);

  readonly liq = signal<Liquidacion>(this.data.item);
  readonly procesando = signal(false);
  readonly descargando = signal(false);
  readonly compartiendo = signal(false);

  /** Día cuyo precio se está editando (su id), o null si no hay ninguno. */
  readonly editandoId = signal<string | null>(null);
  /** Día cuyo precio se está guardando: mientras tanto el campo queda quieto. */
  readonly guardandoId = signal<string | null>(null);
  /** Lo tecleado en el campo abierto, tal cual, sin interpretar todavía. */
  readonly textoPrecio = signal('');

  readonly tercero = computed(
    () => this.liq().proveedor_nombre ?? this.liq().transportador_nombre ?? '—',
  );

  /**
   * El precio solo se corrige en BORRADOR y solo en liquidaciones de proveedor.
   *
   * Aprobada o pagada quiere decir que ese precio ya se le pagó a alguien, y en
   * la del transportador la cifra de esa columna es la tarifa del flete del día
   * —otra cosa—. El backend rechaza los dos casos igual: esto es para que el
   * campo ni siquiera se ofrezca.
   */
  readonly puedeEditarPrecio = computed(
    () =>
      this.liq().estado === 'borrador' &&
      this.liq().tipo === 'proveedor' &&
      this.auth.hasPermission('liquidaciones', 'editar'),
  );

  readonly columnasDetalle = ['fecha', 'litros', 'precio_litro', 'valor'];
  readonly columnasPagos = ['fecha', 'valor', 'observaciones', 'acciones'];

  /** Si ya se le abonó algo: manda el historial, no el estado. */
  readonly tienePagos = computed(() => this.liq().pagos.length > 0);

  constructor() {
    // Recarga la liquidación para asegurar que los detalles estén completos.
    firstValueFrom(this.servicio.getById(this.data.item.id))
      .then((liq) => this.liq.set(liq))
      .catch(() => undefined);
  }

  // ------------------------------------------- corregir el precio de un día
  /**
   * Escape cierra el campo, y al cerrarlo el navegador puede disparar el blur
   * del input que acaba de desaparecer. Esta marca evita que ese blur guarde lo
   * que el usuario justamente acaba de cancelar.
   */
  private cancelando = false;

  editarPrecio(detalle: LiquidacionDetalle): void {
    if (!this.puedeEditarPrecio() || this.guardandoId()) return;
    this.cancelando = false;
    this.textoPrecio.set(String(Number(detalle.precio_litro)));
    this.editandoId.set(detalle.id);
  }

  cancelarPrecio(): void {
    this.cancelando = true;
    this.editandoId.set(null);
  }

  alEscribirPrecio(valor: string): void {
    this.textoPrecio.set(valor);
  }

  /**
   * Al salir del campo se guarda, como en la hoja de cálculo de la que viene el
   * dueño: si hace clic afuera después de teclear, espera que quede. Escape
   * sigue siendo la forma de arrepentirse.
   */
  alSalirDelPrecio(detalle: LiquidacionDetalle): void {
    if (this.cancelando) {
      this.cancelando = false;
      return;
    }
    void this.guardarPrecio(detalle);
  }

  async guardarPrecio(detalle: LiquidacionDetalle): Promise<void> {
    if (this.guardandoId()) return;
    const precio = precioTecleado(this.textoPrecio());

    // Sin cambio real, cerrar el campo y no molestar al servidor.
    if (precio === null || precio === Number(detalle.precio_litro)) {
      if (precio === null) {
        this.snackbar.open('Escriba el precio por litro en pesos, por ejemplo 1750', 'OK', {
          duration: 4000,
        });
        return; // el campo se queda abierto para corregir lo tecleado
      }
      this.editandoId.set(null);
      return;
    }

    this.guardandoId.set(detalle.id);
    try {
      const actualizada = await firstValueFrom(
        this.servicio.actualizarPrecioDetalle(this.liq().id, detalle.id, precio),
      );
      // La cifra en pantalla es SIEMPRE la que devolvió el servidor: nunca se
      // pinta el precio nuevo por adelantado. Si el guardado falla, lo que se ve
      // sigue siendo lo que de verdad está guardado.
      this.liq.set(actualizada);
      this.editandoId.set(null);
      this.snackbar.open('Precio actualizado', 'OK', { duration: 3000 });
    } catch (err) {
      // El campo se queda ABIERTO con lo tecleado: así se ve que ese día quedó
      // sin guardar, en vez de volver a la cifra vieja como si nada.
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible cambiar el precio de ese día');
    } finally {
      this.guardandoId.set(null);
    }
  }

  /**
   * Recalcular solo se ofrece en BORRADOR, con permiso de editar.
   *
   * Es la salida al caso del anticipo que se registró después de generar la
   * liquidación: el resumen quedaba en "Anticipos aplicados $0" y no había cómo
   * recogerlo. Fuera de borrador el backend rebota igual; esto es para que el
   * botón ni siquiera se ofrezca sobre algo que ya se pagó.
   */
  readonly puedeRecalcular = computed(
    () =>
      this.liq().estado === 'borrador' && this.auth.hasPermission('liquidaciones', 'editar'),
  );

  recalcular(): void {
    void this.ejecutar(
      () => this.servicio.recalcular(this.liq().id),
      'Liquidación recalculada: quedaron aplicados los anticipos pendientes',
    );
  }

  aprobar(): void {
    void this.ejecutar(() => this.servicio.aprobar(this.liq().id), 'Liquidación aprobada');
  }

  /**
   * Abre el diálogo de pago con el saldo pendiente prellenado.
   *
   * Antes este botón pagaba todo de un golpe sin preguntar. Ahora pasa por el
   * diálogo porque el dueño lo pidió así: "a un proveedor se le puede pagar y
   * quedar debiendo otra parte". Pagar completo sigue siendo un Enter.
   */
  pagar(): void {
    this.dialog
      .open(PagoLiquidacionFormDialog, {
        data: { id: this.liq().id, tercero: this.tercero(), saldo: this.liq().saldo },
        width: '520px',
      })
      .afterClosed()
      .subscribe((actualizada?: Liquidacion) => {
        if (!actualizada) return;
        // Lo que se pinta es SIEMPRE lo que respondió el servidor, nunca una
        // cifra calculada aquí: si algo salió distinto, se ve lo que de verdad
        // quedó guardado. (La lista se recarga sola al cerrar este diálogo.)
        this.liq.set(actualizada);
        this.snackbar.open(
          actualizada.estado === 'pagada'
            ? 'Pago registrado: la liquidación queda pagada'
            : `Pago registrado. Queda debiendo ${this.enPesos(actualizada.saldo)}`,
          'OK',
          { duration: 5000 },
        );
      });
  }

  /**
   * Elimina un pago mal registrado. El backend baja el `pagado`, devuelve el
   * saldo y recalcula el estado (de pagada a parcial, o de parcial a aprobada).
   */
  eliminarPago(pago: PagoLiquidacion): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Eliminar pago',
          mensaje:
            `¿Eliminar el pago de ${this.enPesos(pago.valor)}? El saldo volverá a subir ` +
            'por ese valor. Esta acción no se puede deshacer.',
          accion: 'Eliminar',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(
          () => this.servicio.eliminarPago(this.liq().id, pago.id),
          'Pago eliminado: el saldo quedó al día',
        );
      });
  }

  private enPesos(monto: unknown): string {
    return `$${Number(monto).toLocaleString('es-CO')}`;
  }

  anular(): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Anular liquidación',
          mensaje:
            '¿Anular esta liquidación? Las recepciones y anticipos del período quedarán disponibles para volver a liquidar.',
          accion: 'Anular',
        },
      })
      .afterClosed()
      .subscribe((confirmado) => {
        if (!confirmado) return;
        void this.ejecutar(() => this.servicio.anular(this.liq().id), 'Liquidación anulada');
      });
  }

  async descargarPdf(): Promise<void> {
    this.descargando.set(true);
    try {
      await firstValueFrom(this.servicio.descargarPdf(this.liq().id));
    } catch (err) {
      // Con `catch {` se perdía el mensaje que el interceptor sí había generado
      // ("Sin conexión…", "El servidor tardó demasiado…") y quedaba un texto fijo
      // que no dice qué pasó ni qué hacer.
      this.snackbar.open(detalleDeError(err, 'No fue posible descargar el PDF'), 'OK', {
        duration: 5000,
      });
    } finally {
      this.descargando.set(false);
    }
  }

  async compartir(): Promise<void> {
    this.compartiendo.set(true);
    try {
      const blob = await firstValueFrom(this.servicio.pdfBlob(this.liq().id));
      const nombre = `liquidacion_${this.tercero()}.pdf`.replace(/\s+/g, '_');
      const resultado = await compartirArchivo(
        blob,
        nombre,
        `Liquidación de ${this.tercero()}`,
        `Recibo de liquidación de ${this.tercero()}`,
      );
      if (resultado === 'descargado') {
        this.snackbar.open(
          'Tu dispositivo no permite compartir directamente; se descargó el PDF',
          'OK',
          { duration: 4000 },
        );
      }
    } catch (err) {
      this.snackbar.open(detalleDeError(err, 'No fue posible compartir el recibo'), 'OK', {
        duration: 5000,
      });
    } finally {
      this.compartiendo.set(false);
    }
  }

  /** Abre WhatsApp con un resumen en texto de la liquidación. */
  enviarWhatsApp(): void {
    const l = this.liq();
    const money = (m: unknown) => `$${Number(m).toLocaleString('es-CO')}`;
    const fecha = (iso: string) => iso.split('-').reverse().join('/');
    const texto =
      `*Liquidación de ${this.tercero()}*\n` +
      `Período: ${fecha(l.periodo_inicio)} al ${fecha(l.periodo_fin)}\n` +
      `Total litros: ${Number(l.total_litros).toLocaleString('es-CO')} L\n` +
      `Valor total: ${money(l.valor_total)}\n` +
      `Saldo a pagar: ${money(l.saldo)}`;
    compartirWhatsApp(texto);
  }

  private async ejecutar(
    accion: () => Observable<Liquidacion>,
    mensaje: string,
  ): Promise<void> {
    this.procesando.set(true);
    try {
      const actualizada = await firstValueFrom(accion());
      this.liq.set(actualizada);
      this.snackbar.open(mensaje, 'OK', { duration: 3000 });
    } catch (err) {
      // Aprobar/pagar/anular SÍ guardan: si el resultado quedó en duda, el aviso
      // se queda hasta que el usuario lo cierre.
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible completar la acción');
    } finally {
      this.procesando.set(false);
    }
  }
}
