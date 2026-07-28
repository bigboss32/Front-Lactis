import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

/**
 * Guard de PERMISO por módulo (el de sesión es `authGuard`, en auth.guard.ts).
 *
 * Por qué existe: el menú lateral y las tarjetas de Inicio ya esconden lo que el
 * usuario no puede ver, pero nada impedía escribir la URL a mano. El cliente que
 * solo tiene el módulo de reventa escribía /ventas y la pantalla se cargaba
 * entera para después romperse con un 403 de la API: no había fuga de datos
 * —el backend sí valida— pero se veía como un fallo del sistema.
 *
 * No manda al login: quien llega aquí TIENE sesión válida, lo que le falta es el
 * permiso. Se le devuelve a una pantalla que sí puede ver y se le explica por qué
 * en un aviso corto.
 */

/**
 * A dónde se devuelve a quien entra donde no debe.
 *
 * /inicio sirve para cualquiera: no carga datos de la API y sus tarjetas de
 * acceso directo se filtran por permiso (con un texto de respaldo cuando no
 * queda ninguna), así que nunca muestra un error.
 */
const RUTA_DE_RESPALDO = '/inicio';

/** Cuánto dura el aviso, igual que el resto de avisos informativos del sistema. */
const MS_AVISO = 4000;

/**
 * Exige el permiso `modulo:accion` para entrar a la ruta.
 *
 * Sirve para las dos posiciones y por eso el tipo es la intersección:
 *
 * - `canMatch` en las rutas con loadChildren. Es lo que hay que usar ahí: el
 *   router necesita la tabla de rutas hija para emparejar la URL, así que con
 *   `canActivate` DESCARGA el chunk del módulo antes de evaluar el permiso —el
 *   cliente que solo contrató reventa se bajaba el índice de rutas de
 *   auditoría al escribir /auditoria a mano—. `canMatch` corta antes de cargar
 *   nada.
 * - `canActivate` en las rutas con loadComponent, donde no hay nada que
 *   emparejar por debajo y el componente solo se pide si el guard pasa.
 *
 * OJO con `canMatch`: si un guard devuelve `false`, el router NO cancela la
 * navegación, sigue probando rutas y acabaría en el comodín. Este guard nunca
 * devuelve `false`: o `true` o un UrlTree, y un UrlTree sí cancela la
 * navegación en curso y redirige, en canMatch igual que en canActivate.
 *
 * Uso en app.routes.ts: `canMatch: [permisoGuard('ventas')]`. El módulo debe
 * ser uno de los del catálogo del backend (app/core/permissions.py, tupla
 * MODULOS), el mismo nombre que usa NAV_GROUPS en core/layout/nav.ts.
 */
export const permisoGuard = (
  modulo: string,
  accion = 'consultar',
): CanActivateFn & CanMatchFn => {
  return async () => {
    // inject() debe llamarse ANTES del primer await: después se pierde el
    // contexto de inyección (misma razón por la que authGuard inyecta arriba).
    const auth = inject(AuthService);
    const router = inject(Router);
    const snackbar = inject(MatSnackBar);

    // authGuard (ruta padre) ya lo trajo, pero pedirlo aquí también hace que el
    // guard funcione solo, sin depender del orden. ensurePerfil() cachea.
    const perfil = await auth.ensurePerfil();
    if (!perfil) {
      // Sin perfil no hay con qué decidir; de la sesión se encarga authGuard.
      return router.createUrlTree(['/login']);
    }

    if (auth.hasPermission(modulo, accion)) return true;

    snackbar.open('No tienes acceso a esa sección', 'OK', { duration: MS_AVISO });
    return router.createUrlTree([RUTA_DE_RESPALDO]);
  };
};
