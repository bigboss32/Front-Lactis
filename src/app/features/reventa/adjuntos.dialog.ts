import { Clipboard } from '@angular/cdk/clipboard';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { HasPermissionDirective } from '../../core/auth/has-permission.directive';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { avisarErrorAlGuardar, detalleDeError } from '../../shared/errores-ui';
import { SpinnerBoton } from '../../shared/spinner-boton';
import { AdjuntoReventa, ReventaService } from './reventa.service';

export interface AdjuntosDialogData {
  /** De qué documento cuelgan los soportes. */
  tipo: 'compra' | 'venta';
  id: string;
  /** Para el título: "Yeferson · 3 sep" o "Tienda La 33 · 5 sep". */
  titulo: string;
}

/** Lo que el navegador acepta en el selector. El backend valida de verdad. */
const ACEPTADOS = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';

/**
 * Los soportes de pago (fotos de las transferencias) de una compra o una venta.
 *
 * TODO LO QUE SE VE AQUÍ ES TEMPORAL. Las imágenes se muestran con enlaces
 * firmados que el backend acaba de crear y que caducan en minutos: no hay
 * ninguna URL guardada en ningún lado. Por eso, cuando una miniatura no carga,
 * lo primero que se ofrece es «Actualizar», que vuelve a pedir la lista con
 * enlaces nuevos — casi siempre es eso y no que la imagen se haya perdido.
 *
 * COMPARTIR ES OTRA COSA, no el mismo enlace. Es un enlace aparte, de más
 * duración, que se copia al portapapeles junto con la fecha hasta la que sirve.
 * Esa fecha se muestra siempre y se copia junto al enlace: quien manda por
 * WhatsApp un comprobante de pago tiene que saber qué está repartiendo.
 */
@Component({
  selector: 'app-reventa-adjuntos',
  imports: [
    DatePipe, MatButtonModule, MatDialogModule, MatIconModule, MatProgressBarModule,
    MatTooltipModule, HasPermissionDirective, SpinnerBoton,
  ],
  template: `
    <h2 mat-dialog-title>Soportes de pago</h2>
    <mat-dialog-content>
      <p class="sub">{{ data.titulo }}</p>

      @if (noDisponible()) {
        <!--
          El servidor no tiene configurado el almacenamiento. No es culpa de
          quien mira, así que se explica y se deja el resto de la pantalla
          usable en vez de mostrar un error rojo.
        -->
        <div class="aviso">
          <mat-icon>cloud_off</mat-icon>
          <p>{{ noDisponible() }}</p>
        </div>
      }

      @if (cargando()) {
        <div class="cargando"><mat-progress-bar mode="indeterminate" /></div>
      } @else if (errorCarga()) {
        <div class="error-state">
          <mat-icon>error_outline</mat-icon>
          <p>{{ errorCarga() }}</p>
          <button mat-stroked-button (click)="recargar()">Reintentar</button>
        </div>
      } @else if (adjuntos().length === 0 && !noDisponible()) {
        <div class="empty-state">
          <mat-icon>photo_camera</mat-icon>
          <p>Todavía no hay soportes. Anexe la foto de la transferencia.</p>
        </div>
      }

      @if (adjuntos().length > 0) {
        <div class="galeria">
          @for (adjunto of adjuntos(); track adjunto.id) {
            <div class="tarjeta">
              <button
                type="button"
                class="vista"
                [disabled]="!adjunto.url"
                matTooltip="Abrir en una pestaña nueva"
                (click)="abrir(adjunto)"
              >
                @if (adjunto.es_imagen && adjunto.url && !rotas().has(adjunto.id)) {
                  <img
                    [src]="adjunto.url"
                    [alt]="adjunto.nombre_archivo"
                    loading="lazy"
                    (error)="marcarRota(adjunto.id)"
                  />
                } @else {
                  <!--
                    PDF del banco, foto de iPhone que el navegador no dibuja, o
                    enlace ya caducado: se muestra un icono en vez de una imagen
                    rota, que parecería que el soporte se perdió.
                  -->
                  <div class="icono">
                    <mat-icon>{{ adjunto.es_imagen ? 'image' : 'picture_as_pdf' }}</mat-icon>
                  </div>
                }
              </button>

              <div class="pie">
                <span class="nombre" [matTooltip]="adjunto.nombre_archivo">
                  {{ adjunto.nombre_archivo }}
                </span>
                <span class="meta">
                  {{ tamano(adjunto.tamano_bytes) }}
                  @if (adjunto.subido_por_nombre) {
                    · {{ adjunto.subido_por_nombre }}
                  }
                  · {{ adjunto.created_at | date: 'dd/MM/yyyy' }}
                </span>
              </div>

              <div class="acciones">
                <button
                  mat-icon-button
                  *hasPermission="'reventa:exportar'"
                  matTooltip="Copiar un enlace para mandarlo por WhatsApp"
                  [disabled]="!adjunto.url || compartiendo() === adjunto.id"
                  (click)="compartir(adjunto)"
                >
                  <mat-icon>share</mat-icon>
                </button>
                <button
                  mat-icon-button
                  *hasPermission="'reventa:eliminar'"
                  matTooltip="Borrar este soporte"
                  [disabled]="eliminando() === adjunto.id"
                  (click)="eliminar(adjunto)"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              </div>
            </div>
          }
        </div>
      }

      @if (subiendo()) {
        <!--
          La barra de progreso NO es adorno: una tanda de fotos de celular pesa
          decenas de MB y desde la finca eso son minutos. Sin ella la pantalla
          parece congelada y la gente vuelve a darle al botón.
        -->
        <div class="progreso">
          <mat-progress-bar
            [mode]="progreso() > 0 ? 'determinate' : 'indeterminate'"
            [value]="progreso()"
          />
          <span>Subiendo {{ cuantasSuben() }}… {{ progreso() }}%</span>
        </div>
      }

      @if (errorSubida()) {
        <div class="error-subida">
          <mat-icon>error_outline</mat-icon>
          <span>{{ errorSubida() }}</span>
        </div>
      }

      <input
        #selector
        type="file"
        hidden
        multiple
        [accept]="aceptados"
        (change)="seleccionar($event)"
      />
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="cerrar()">Cerrar</button>
      <button
        mat-button
        matTooltip="Vuelve a pedir enlaces nuevos (los de ver caducan a los pocos minutos)"
        [disabled]="cargando() || subiendo()"
        (click)="recargar()"
      >
        Actualizar
      </button>
      <!--
        Dos botones en ramas separadas y no uno con un @if adentro: compartir la
        raíz rompe la proyección del icono de MatButton (NG8011) y el icono sale
        fuera de su sitio. Mismo apaño que en gasto-form.dialog.ts.
      -->
      @if (subiendo()) {
        <button mat-flat-button disabled>
          <app-spinner-boton />
          Subiendo…
        </button>
      } @else {
        <button
          mat-flat-button
          *hasPermission="'reventa:crear'"
          [disabled]="sinCupo()"
          [matTooltip]="sinCupo() ? 'Ya no caben más soportes en este documento' : ''"
          (click)="selector.click()"
        >
          <mat-icon>add_a_photo</mat-icon>
          Anexar imágenes
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .sub { margin: 0 0 12px; color: var(--mat-sys-on-surface-variant); }

    .galeria {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 12px;
    }
    .tarjeta {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .vista {
      all: unset;
      cursor: pointer;
      display: block;
      aspect-ratio: 4 / 3;
      background: var(--mat-sys-surface-container-high);
    }
    .vista:disabled { cursor: default; }
    .vista img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .icono {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--mat-sys-on-surface-variant);
    }
    .icono mat-icon { transform: scale(1.8); }

    .pie { padding: 8px 10px 0; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .nombre {
      font-size: 0.85rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meta { font-size: 0.72rem; color: var(--mat-sys-on-surface-variant); }
    .acciones { display: flex; justify-content: flex-end; padding: 0 4px 4px; }

    .progreso { margin-top: 16px; display: flex; flex-direction: column; gap: 6px; }
    .progreso span { font-size: 0.85rem; color: var(--mat-sys-on-surface-variant); }
    .cargando { padding: 24px 0; }

    .aviso, .error-subida {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 8px;
      margin-bottom: 12px;
    }
    .aviso { background: var(--mat-sys-surface-container-high); }
    .aviso p { margin: 0; font-size: 0.9rem; }
    .error-subida {
      margin-top: 12px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font-size: 0.9rem;
    }

    .empty-state, .error-state {
      text-align: center;
      padding: 24px 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .empty-state mat-icon, .error-state mat-icon { transform: scale(1.6); margin-bottom: 12px; }
  `,
})
export class AdjuntosDialog {
  private readonly servicio = inject(ReventaService);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef<AdjuntosDialog>);
  private readonly snackbar = inject(MatSnackBar);
  private readonly portapapeles = inject(Clipboard);

  readonly data = inject<AdjuntosDialogData>(MAT_DIALOG_DATA);
  readonly aceptados = ACEPTADOS;

  readonly adjuntos = signal<AdjuntoReventa[]>([]);
  readonly cargando = signal(true);
  readonly errorCarga = signal<string | null>(null);
  readonly noDisponible = signal<string | null>(null);
  readonly cupo = signal(0);
  readonly subiendo = signal(false);
  readonly progreso = signal(0);
  readonly cuantasSuben = signal('');
  readonly errorSubida = signal<string | null>(null);
  readonly compartiendo = signal<string | null>(null);
  readonly eliminando = signal<string | null>(null);
  /** Ids cuyas miniaturas fallaron (enlace caducado o formato que el navegador no dibuja). */
  readonly rotas = signal<Set<string>>(new Set());

  readonly sinCupo = computed(() => !!this.noDisponible() || this.cupo() <= 0);

  /** Se pone en true si algo cambió, para que la lista de atrás se recargue. */
  private cambiado = false;

  constructor() {
    this.recargar();
  }

  // ------------------------------------------------------------------ carga
  async recargar(): Promise<void> {
    this.cargando.set(true);
    this.errorCarga.set(null);
    this.rotas.set(new Set());
    try {
      const lista = await firstValueFrom(
        this.data.tipo === 'compra'
          ? this.servicio.adjuntosDeCompra(this.data.id)
          : this.servicio.adjuntosDeVenta(this.data.id),
      );
      this.adjuntos.set(lista.adjuntos);
      this.cupo.set(lista.cupo_restante);
      this.noDisponible.set(lista.disponible ? null : lista.mensaje);
    } catch (err) {
      this.errorCarga.set(detalleDeError(err, 'No fue posible cargar los soportes'));
    } finally {
      this.cargando.set(false);
    }
  }

  marcarRota(id: string): void {
    this.rotas.update((previas) => new Set(previas).add(id));
  }

  // ------------------------------------------------------------------ subir
  seleccionar(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivos = Array.from(input.files ?? []);
    // Se limpia el input para que volver a escoger EL MISMO archivo dispare el
    // change otra vez (si no, el segundo intento tras un fallo no hace nada).
    input.value = '';
    if (archivos.length === 0) return;
    void this.subir(archivos);
  }

  private async subir(archivos: File[]): Promise<void> {
    this.subiendo.set(true);
    this.progreso.set(0);
    this.errorSubida.set(null);
    this.cuantasSuben.set(
      archivos.length === 1 ? '1 imagen' : `${archivos.length} imágenes`,
    );
    const peticion =
      this.data.tipo === 'compra'
        ? this.servicio.subirAdjuntosDeCompra(this.data.id, archivos)
        : this.servicio.subirAdjuntosDeVenta(this.data.id, archivos);
    try {
      await new Promise<void>((resolver, rechazar) => {
        peticion.subscribe({
          next: (evento) => {
            this.progreso.set(evento.progreso);
            if (evento.cuerpo) {
              this.adjuntos.set(evento.cuerpo.adjuntos);
              this.cupo.set(evento.cuerpo.cupo_restante);
              this.rotas.set(new Set());
            }
          },
          error: rechazar,
          complete: resolver,
        });
      });
      this.cambiado = true;
      this.snackbar.open(
        archivos.length === 1 ? 'Soporte anexado' : `${archivos.length} soportes anexados`,
        'OK',
        { duration: 3000 },
      );
    } catch (err) {
      // Se muestra DENTRO del diálogo además del aviso flotante: en el campo la
      // subida falla a menudo y un toast que se va en cinco segundos deja al
      // dueño creyendo que la foto quedó guardada.
      const mensaje = detalleDeError(err, 'No fue posible subir las imágenes');
      this.errorSubida.set(mensaje);
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible subir las imágenes');
    } finally {
      this.subiendo.set(false);
      this.progreso.set(0);
    }
  }

  // -------------------------------------------------------------------- ver
  abrir(adjunto: AdjuntoReventa): void {
    if (!adjunto.url) return;
    // noopener: el enlace firmado se abre en el dominio del almacenamiento y no
    // tiene por qué poder tocar esta pestaña.
    window.open(adjunto.url, '_blank', 'noopener');
  }

  // -------------------------------------------------------------- compartir
  async compartir(adjunto: AdjuntoReventa): Promise<void> {
    this.compartiendo.set(adjunto.id);
    try {
      const enlace = await firstValueFrom(this.servicio.compartirAdjunto(adjunto.id));
      // Se copia el enlace CON la fecha de caducidad pegada: si solo se copiara
      // la URL, el dueño pegaría en WhatsApp un enlace sin saber —ni poder
      // decirle a quien lo recibe— hasta cuándo sirve.
      const texto = `${enlace.url}\n\n(Este enlace sirve ${enlace.expira_texto})`;
      const copiado = this.portapapeles.copy(texto);
      this.snackbar.open(
        copiado
          ? `Enlace copiado. Sirve ${enlace.expira_texto}`
          : `No se pudo copiar. El enlace sirve ${enlace.expira_texto}`,
        'OK',
        { duration: 10000 },
      );
    } catch (err) {
      avisarErrorAlGuardar(this.snackbar, err, 'No fue posible crear el enlace para compartir');
    } finally {
      this.compartiendo.set(null);
    }
  }

  // ----------------------------------------------------------------- borrar
  eliminar(adjunto: AdjuntoReventa): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          titulo: 'Borrar soporte',
          mensaje:
            `¿Borrar «${adjunto.nombre_archivo}»? Se borra también el archivo ` +
            `del almacenamiento y no se puede recuperar.`,
          accion: 'Borrar',
        },
      })
      .afterClosed()
      .subscribe(async (confirmado) => {
        if (!confirmado) return;
        this.eliminando.set(adjunto.id);
        try {
          await firstValueFrom(this.servicio.eliminarAdjunto(adjunto.id));
          this.adjuntos.update((lista) => lista.filter((a) => a.id !== adjunto.id));
          this.cupo.update((n) => n + 1);
          this.cambiado = true;
          this.snackbar.open('Soporte borrado', 'OK', { duration: 3000 });
        } catch (err) {
          avisarErrorAlGuardar(this.snackbar, err, 'No fue posible borrar el soporte');
        } finally {
          this.eliminando.set(null);
        }
      });
  }

  // --------------------------------------------------------------- utilidad
  tamano(bytes: number): string {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  }

  cerrar(): void {
    this.dialogRef.close(this.cambiado);
  }
}
