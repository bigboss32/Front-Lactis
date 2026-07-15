import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  const perfil = await auth.ensurePerfil();
  if (!perfil) {
    auth.limpiarSesion();
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  return true;
};

/** Protege una ruta exigiendo el permiso `modulo:consultar`. */
export const permissionGuard = (modulo: string, accion = 'consultar'): CanActivateFn => {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    await auth.ensurePerfil();
    return auth.hasPermission(modulo, accion) ? true : router.createUrlTree(['/']);
  };
};
