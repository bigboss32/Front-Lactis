import {
  Directive,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
  input,
} from '@angular/core';

import { AuthService } from './auth.service';

/**
 * Muestra el contenido solo si el usuario tiene el permiso indicado.
 * Uso: <button *hasPermission="'proveedores:crear'">Nuevo</button>
 */
@Directive({ selector: '[hasPermission]' })
export class HasPermissionDirective {
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);
  private readonly auth = inject(AuthService);

  readonly hasPermission = input.required<string>();

  constructor() {
    effect(() => {
      this.auth.perfil(); // re-evalúa cuando cambia el perfil
      const [modulo, accion] = this.hasPermission().split(':');
      this.container.clear();
      if (this.auth.hasPermission(modulo, accion ?? 'consultar')) {
        this.container.createEmbeddedView(this.template);
      }
    });
  }
}
