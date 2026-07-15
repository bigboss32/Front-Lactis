import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

import { Auditoria } from '../../core/models';

/** Muestra el registro de auditoría con los estados "antes" y "después" lado a lado. */
@Component({
  selector: 'app-auditoria-detalle',
  imports: [MatDialogModule, MatButtonModule, DatePipe],
  template: `
    <h2 mat-dialog-title>Detalle de la operación</h2>
    <mat-dialog-content>
      <div class="meta">
        <div><span class="etiqueta">Fecha</span> {{ data.registro.created_at | date: 'dd/MM/yyyy HH:mm:ss' }}</div>
        <div><span class="etiqueta">Módulo</span> {{ data.registro.modulo }}</div>
        <div><span class="etiqueta">Acción</span> {{ data.registro.accion }}</div>
        <div><span class="etiqueta">Entidad</span> {{ data.registro.entidad }}</div>
        <div><span class="etiqueta">IP</span> {{ data.registro.ip ?? '—' }}</div>
      </div>

      <div class="comparacion">
        <div>
          <h3>Antes</h3>
          <pre>{{ json(data.registro.antes) }}</pre>
        </div>
        <div>
          <h3>Después</h3>
          <pre>{{ json(data.registro.despues) }}</pre>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: `
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 24px;
      margin-bottom: 16px;
      font-size: 0.9rem;

      .etiqueta {
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.75rem;
        text-transform: uppercase;
        margin-right: 4px;
      }
    }

    .comparacion {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      @media (max-width: 700px) { grid-template-columns: 1fr; }

      h3 { margin: 0 0 8px; font-size: 0.95rem; font-weight: 500; }
      pre {
        margin: 0;
        padding: 12px;
        border-radius: 8px;
        background: color-mix(in srgb, currentColor 6%, transparent);
        font-size: 0.8rem;
        max-height: 50vh;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
    }
  `,
})
export class AuditoriaDetalleDialog {
  readonly data = inject<{ registro: Auditoria }>(MAT_DIALOG_DATA);

  json(valor: Record<string, unknown> | null): string {
    return valor ? JSON.stringify(valor, null, 2) : 'Sin datos';
  }
}
