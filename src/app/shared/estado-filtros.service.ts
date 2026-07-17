import { DestroyRef, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl } from '@angular/forms';
import { debounceTime } from 'rxjs';

/**
 * Recuerda los filtros de cada pantalla dentro de la sesión del navegador.
 * Al entrar restaura lo último usado y guarda cada cambio automáticamente,
 * para no tener que reconfigurar los filtros y el rango de fechas cada vez.
 *
 * Uso (en ngOnInit, antes de la primera carga):
 *   this.estadoFiltros.vincular('recepciones',
 *     { buscar: this.buscar, rutaId: this.rutaId, desde: this.desde, hasta: this.hasta },
 *     this.destroyRef);
 */
@Injectable({ providedIn: 'root' })
export class EstadoFiltrosService {
  private readonly prefijo = 'qe.filtros.';

  vincular(
    clave: string,
    controles: Record<string, AbstractControl>,
    destroyRef: DestroyRef,
  ): void {
    this.restaurar(clave, controles);
    for (const control of Object.values(controles)) {
      control.valueChanges
        .pipe(debounceTime(250), takeUntilDestroyed(destroyRef))
        .subscribe(() => this.guardar(clave, controles));
    }
  }

  private restaurar(clave: string, controles: Record<string, AbstractControl>): void {
    const crudo = sessionStorage.getItem(this.prefijo + clave);
    if (!crudo) return;
    let datos: Record<string, unknown>;
    try {
      datos = JSON.parse(crudo);
    } catch {
      return;
    }
    for (const [nombre, control] of Object.entries(controles)) {
      if (!(nombre in datos)) continue;
      // No dispara valueChanges: la pantalla hace su primera carga aparte.
      control.setValue(this.deserializar(datos[nombre]), { emitEvent: false });
    }
  }

  private guardar(clave: string, controles: Record<string, AbstractControl>): void {
    const datos: Record<string, unknown> = {};
    for (const [nombre, control] of Object.entries(controles)) {
      datos[nombre] = this.serializar(control.value);
    }
    sessionStorage.setItem(this.prefijo + clave, JSON.stringify(datos));
  }

  /** Las fechas (Date) se guardan como ISO marcadas para reconstruirlas. */
  private serializar(valor: unknown): unknown {
    return valor instanceof Date ? { __fecha: valor.toISOString() } : valor;
  }

  private deserializar(valor: unknown): unknown {
    if (valor && typeof valor === 'object' && '__fecha' in (valor as object)) {
      return new Date((valor as { __fecha: string }).__fecha);
    }
    return valor;
  }
}
