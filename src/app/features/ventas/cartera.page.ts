import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { CarteraCliente } from '../../core/models';
import { PageHeader } from '../../shared/page-header';
import { MoneyPipe } from '../../shared/pipes';
import { VentasService } from './ventas.service';

@Component({
  selector: 'app-cartera',
  imports: [
    RouterLink, MatCardModule, MatTableModule, MatButtonModule, MatIconModule,
    MatProgressBarModule, PageHeader, MoneyPipe,
  ],
  template: `
    <div class="page">
      <app-page-header
        titulo="Cartera"
        subtitulo="Saldos pendientes de cobro por cliente, ordenados por saldo"
      >
        <button mat-stroked-button routerLink="/ventas">
          <mat-icon>arrow_back</mat-icon> Volver a ventas
        </button>
      </app-page-header>

      <mat-card class="table-card tarjetas">
        @if (cargando()) {
          <mat-progress-bar mode="indeterminate" />
        }

        <table mat-table [dataSource]="filas()">
          <ng-container matColumnDef="cliente">
            <th mat-header-cell *matHeaderCellDef>Cliente</th>
            <td mat-cell *matCellDef="let fila" [attr.data-label]="'Cliente'">{{ fila.cliente_nombre }}</td>
            <td mat-footer-cell *matFooterCellDef>Total</td>
          </ng-container>

          <ng-container matColumnDef="ventas_pendientes">
            <th mat-header-cell *matHeaderCellDef class="num">Ventas pendientes</th>
            <td mat-cell *matCellDef="let fila" class="num" [attr.data-label]="'Ventas pendientes'">{{ fila.ventas_pendientes }}</td>
            <td mat-footer-cell *matFooterCellDef></td>
          </ng-container>

          <ng-container matColumnDef="total_facturado">
            <th mat-header-cell *matHeaderCellDef class="num">Facturado</th>
            <td mat-cell *matCellDef="let fila" class="num" [attr.data-label]="'Facturado'">{{ fila.total_facturado | money }}</td>
            <td mat-footer-cell *matFooterCellDef></td>
          </ng-container>

          <ng-container matColumnDef="total_pagado">
            <th mat-header-cell *matHeaderCellDef class="num">Pagado</th>
            <td mat-cell *matCellDef="let fila" class="num" [attr.data-label]="'Pagado'">{{ fila.total_pagado | money }}</td>
            <td mat-footer-cell *matFooterCellDef></td>
          </ng-container>

          <ng-container matColumnDef="saldo">
            <th mat-header-cell *matHeaderCellDef class="num">Saldo</th>
            <td mat-cell *matCellDef="let fila" class="num" [attr.data-label]="'Saldo'">{{ fila.saldo | money }}</td>
            <td mat-footer-cell *matFooterCellDef class="num">{{ totalSaldo() | money }}</td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="columnas"></tr>
          <tr mat-row *matRowDef="let fila; columns: columnas"></tr>
          @if (filas().length > 0) {
            <tr mat-footer-row *matFooterRowDef="columnas"></tr>
          }
        </table>

        @if (!cargando() && filas().length === 0) {
          <div class="empty-state">
            <mat-icon>account_balance_wallet</mat-icon>
            <p>No hay cartera pendiente de cobro</p>
          </div>
        }
      </mat-card>
    </div>
  `,
  styles: `
    .mat-mdc-footer-cell { font-weight: 600; }
  `,
})
export class CarteraPage implements OnInit {
  private readonly servicio = inject(VentasService);

  readonly columnas = ['cliente', 'ventas_pendientes', 'total_facturado', 'total_pagado', 'saldo'];
  readonly filas = signal<CarteraCliente[]>([]);
  readonly cargando = signal(false);

  readonly totalSaldo = computed(() =>
    this.filas().reduce((acum, fila) => acum + Number(fila.saldo), 0),
  );

  ngOnInit(): void {
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const cartera = await firstValueFrom(this.servicio.cartera());
      this.filas.set([...cartera].sort((a, b) => Number(b.saldo) - Number(a.saldo)));
    } finally {
      this.cargando.set(false);
    }
  }
}
