import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, Subject, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { Liquidacion } from '../../core/models';
import { LiquidacionDetailDialog } from './liquidacion-detail.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * LA QUINCENA 'pagada' DE ANTES DEL 01/08 CON MÁS ADELANTO QUE LECHE, TAL COMO LA DEJÓ
 * LA MIGRACIÓN a5e7c1b4d9f2 (pagos parciales): saldo = 0 y pagado = valor_total -
 * anticipos = -120.000, SIN renglones en `pagos`. Las cifras son las que devuelve
 * GET /liquidaciones/{id} en tests/test_zz_existentes_historia.py del backend.
 */
const MIGRADA: Liquidacion = {
  id: 'l-migrada',
  empresa_id: 'e-1',
  estado: 'pagada',
  estado_visible: 'pagada',
  created_at: '2026-07-16T00:00:00Z',
  updated_at: '2026-08-02T00:00:00Z',
  tipo: 'proveedor',
  proveedor_id: 'p-1',
  proveedor_nombre: 'Julio Pagada',
  transportador_id: null,
  transportador_nombre: null,
  periodo_inicio: '2026-07-01',
  periodo_fin: '2026-07-15',
  total_litros: '90',
  precio_promedio: '2000',
  valor_bruto: '180000.00',
  bonificaciones: '0',
  descuentos: '0',
  valor_transporte: '0',
  anticipos: '300000.00',
  valor_total: '180000.00',
  saldo_anterior: '0',
  neto_a_pagar: '-120000.00',
  pagado: '-120000.00',
  saldo: '0.00',
  le_queda_debiendo: '0',
  observaciones: null,
  detalles: [],
  pagos: [],
};

class ServicioFalso {
  readonly porId = new Subject<Liquidacion>();
  getById(): Observable<Liquidacion> {
    return this.porId as unknown as Observable<Liquidacion>;
  }
}

const pesos = (texto: string): number => {
  const limpio = texto.replace(/[^\d,−-]/g, '').replace(',', '.');
  const negativo = /[−-]/.test(limpio);
  const n = Number(limpio.replace(/[−-]/g, '')) || 0;
  return negativo ? -n : n;
};

describe('zz existentes · historia: la pagada que borró su deuda en la migración', () => {
  it('el resumen del detalle no cuadra y no dice que el tercero debe', async () => {
    await TestBed.configureTestingModule({
      imports: [LiquidacionDetailDialog, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { item: MIGRADA } },
        { provide: LiquidacionesService, useValue: new ServicioFalso() },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: AuthService,
          useValue: { hasPermission: () => true, perfil: () => null, esSuperadmin: () => false },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LiquidacionDetailDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const renglones = fixture.componentInstance.renglonesResumen();
    const texto = renglones.map((r) => `${r.etiqueta}: ${r.texto.replace(/ /g, ' ')}`);
    console.log('[historia] resumen de la migrada ->', JSON.stringify(texto));

    const claves = renglones.map((r) => r.clave);
    // No hay renglón "Pagado" (no hay pagos en la lista) ni "Le queda debiendo".
    expect(claves).not.toContain('pagado');
    expect(claves).not.toContain('le_queda_debiendo');
    const cierre = renglones.find((r) => r.clave === 'saldo');
    expect(cierre?.etiqueta).toBe('Saldo a pagar');

    // La columna de plata de arriba abajo: 180.000 − 300.000 = −120.000, y el cierre dice 0.
    // Desde VALOR TOTAL hacia abajo (bruto + bonificaciones − descuentos ya son el total).
    const desdeElTotal = renglones.slice(renglones.findIndex((r) => r.clave === 'valor_total'));
    const cuentan = desdeElTotal.filter((r) => r.cuenta && r.clave !== 'saldo');
    const suma = cuentan.reduce(
      (total, r) => total + (r.signo === '−' ? -1 : 1) * Math.abs(pesos(r.texto)),
      0,
    );
    console.log(`[historia] suma del desglose = ${suma} · cierre "${cierre?.texto}"`);
    expect(suma).toBe(-120000);
    expect(pesos(cierre!.texto)).toBe(0);
  });
});
