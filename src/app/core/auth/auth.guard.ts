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

// El guard de PERMISO por módulo vive en permiso.guard.ts (`permisoGuard`) y es
// el único que hay: aquí existió un `permissionGuard` casi idéntico, sin usar,
// que se diferenciaba en dos letras y se comportaba distinto (redirigía a '/' y
// no comprobaba que el perfil hubiera llegado). Se borró para que nadie importe
// el equivocado al añadir una ruta.
