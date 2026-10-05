import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';

import { dateToIso } from '../../shared/date-utils';
import { mesVecino } from '../../shared/quincena';
import { GenerarQuincenaDialog } from './generar-quincena.dialog';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * EL MES Y LOS DOS BOTONES DE "GENERAR LIQUIDACIONES".
 *
 * Es el selector que el listado de liquidaciones copió, y desde que las dos pantallas
 * comparten la cuenta de la quincena (`shared/quincena.ts`) hay que medir que Generar se
 * comporta como siempre: las flechas van al mes que dicen, cruzan el año, y cada botón
 * fija las fechas que rotula. Antes ninguna prueba tocaba las flechas.
 */
describe('GenerarQuincenaDialog: el mes y las dos quincenas', () => {
  let fixture: ComponentFixture<GenerarQuincenaDialog>;
  let dialogo: GenerarQuincenaDialog;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GenerarQuincenaDialog, NoopAnimationsModule],
      providers: [
        provideNativeDateAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
        { provide: LiquidacionesService, useValue: {} },
        {
          provide: MatDialogRef,
          useValue: {
            disableClose: false,
            close: () => {},
            backdropClick: () => new Subject<MouseEvent>().asObservable(),
            keydownEvents: () => new Subject<KeyboardEvent>().asObservable(),
          },
        },
        { provide: MatSnackBar, useValue: { open: () => {} } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(GenerarQuincenaDialog);
    dialogo = fixture.componentInstance;
    fixture.detectChanges();
  });

  const el = (): HTMLElement => fixture.nativeElement;
  const texto = (e: Element | null | undefined): string =>
    (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const etiqueta = (): string => texto(el().querySelector('.selector-mes .mes'));
  const flecha = (nombre: 'Mes anterior' | 'Mes siguiente'): HTMLButtonElement =>
    el().querySelector(`button[aria-label="${nombre}"]`)!;
  const botones = (): HTMLButtonElement[] => Array.from(el().querySelectorAll('.q-btn'));
  const tocar = (boton: HTMLButtonElement): void => {
    boton.click();
    fixture.detectChanges();
  };
  const fechas = (): [string | null, string | null] => {
    const v = dialogo.form.getRawValue();
    return [dateToIso(v.periodo_inicio), dateToIso(v.periodo_fin)];
  };

  it('la flecha izquierda va al mes ANTERIOR y la derecha al SIGUIENTE', () => {
    const inicial = dialogo.mesSel();

    tocar(flecha('Mes anterior'));
    expect(dialogo.mesSel()).toEqual(mesVecino(inicial, -1));

    tocar(flecha('Mes siguiente'));
    tocar(flecha('Mes siguiente'));
    expect(dialogo.mesSel()).toEqual(mesVecino(inicial, 1));
  });

  it('las flechas cruzan el año y la etiqueta lo dice', () => {
    dialogo.mesSel.set({ anio: 2026, mes: 0 });
    fixture.detectChanges();
    expect(etiqueta()).toBe('enero 2026');

    tocar(flecha('Mes anterior'));
    expect(etiqueta()).toBe('diciembre 2025');

    tocar(flecha('Mes siguiente'));
    tocar(flecha('Mes siguiente'));
    expect(etiqueta()).toBe('febrero 2026');
  });

  it('cada botón rotula los días del mes que se ve: 28, 29, 30 o 31', () => {
    dialogo.mesSel.set({ anio: 2026, mes: 1 });
    fixture.detectChanges();
    expect(texto(botones()[0])).toContain('días 1 al 15');
    expect(texto(botones()[1])).toContain('días 16 al 28');

    dialogo.mesSel.set({ anio: 2028, mes: 1 });
    fixture.detectChanges();
    expect(texto(botones()[1])).toContain('días 16 al 29');

    dialogo.mesSel.set({ anio: 2026, mes: 9 });
    fixture.detectChanges();
    expect(texto(botones()[1])).toContain('días 16 al 31');
  });

  it('el botón fija las fechas que dice y queda marcado', () => {
    dialogo.mesSel.set({ anio: 2026, mes: 8 });
    fixture.detectChanges();

    tocar(botones()[0]);
    expect(fechas()).toEqual(['2026-09-01', '2026-09-15']);
    expect(botones()[0].getAttribute('aria-pressed')).toBe('true');
    expect(botones()[1].getAttribute('aria-pressed')).toBe('false');

    tocar(botones()[1]);
    expect(fechas()).toEqual(['2026-09-16', '2026-09-30']);
    expect(botones()[1].getAttribute('aria-pressed')).toBe('true');
    expect(botones()[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('con el mes movido por las flechas, el botón aplica a ESE mes', () => {
    dialogo.mesSel.set({ anio: 2026, mes: 8 });
    tocar(flecha('Mes anterior')); // agosto

    tocar(botones()[1]);

    expect(fechas()).toEqual(['2026-08-16', '2026-08-31']);
  });
});
