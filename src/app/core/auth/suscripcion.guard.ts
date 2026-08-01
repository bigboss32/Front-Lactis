import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CanActivateChildFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

/**
 * Guard del PAYWALL (el de sesión es `authGuard`; el de permiso, `permisoGuard`).
 *
 * Cuando la suscripción de la empresa activa está BLOQUEADA (venció y se agotó
 * la gracia), toda navegación se desvía a /suscripcion para regularizar el
 * pago. Va como `canActivateChild` en la ruta padre '' y no guard por guard en
 * cada módulo: el bloqueo es del sistema entero, no de un módulo, y así una
 * ruta nueva nace protegida sin que nadie tenga que acordarse.
 *
 * El estado sale del PERFIL (bloque `suscripcion` de /auth/me), que ya está
 * cacheado por authGuard: no cuesta una petición extra por navegación. El
 * backend es la verdad final —si el perfil está viejo, la primera petición
 * devuelve 403 `suscripcion_vencida` y el interceptor recarga el perfil y
 * redirige—; este guard solo evita pasearse por pantallas que van a fallar.
 */

/**
 * Rutas que el bloqueo deja pasar, por URL y no por permiso:
 * - /suscripcion es el paywall mismo (a donde se redirige): sin la excepción
 *   habría un bucle de redirecciones infinito.
 * - /perfil son los datos del propio usuario, que no son de la empresa.
 * El backend exime igual el módulo suscripcion, así que el paywall funciona.
 */
const RUTAS_EXENTAS = ['/suscripcion', '/perfil'];

/** Cuánto dura el aviso, igual que el resto de avisos informativos del sistema. */
const MS_AVISO = 6000;

export const suscripcionGuard: CanActivateChildFn = async (_route, state) => {
  // inject() debe llamarse ANTES del primer await: después se pierde el
  // contexto de inyección (misma razón que en authGuard y permisoGuard).
  const auth = inject(AuthService);
  const router = inject(Router);
  const snackbar = inject(MatSnackBar);

  const url = state.url.split('?')[0];
  if (RUTAS_EXENTAS.some((ruta) => url === ruta || url.startsWith(ruta + '/'))) {
    return true;
  }

  const perfil = await auth.ensurePerfil();
  // Sin perfil no hay con qué decidir; de la sesión se encarga authGuard.
  if (!perfil) return true;
  // El superadmin nunca se bloquea: es quien puede arreglar la suscripción.
  if (perfil.es_superadmin) return true;
  // Backend viejo sin el bloque, exenta, activa, por vencer o en gracia: pasa.
  if ((perfil.suscripcion?.estado ?? null) !== 'bloqueada') return true;

  snackbar.open(
    'La suscripción de la empresa está vencida. Regulariza el pago para continuar.',
    'OK',
    { duration: MS_AVISO },
  );
  // UrlTree y nunca `false`: cancela la navegación en curso y redirige
  // (mismo motivo que en permisoGuard).
  return router.createUrlTree(['/suscripcion']);
};
