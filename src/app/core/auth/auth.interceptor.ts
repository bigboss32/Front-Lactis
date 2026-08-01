import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { API_BASE } from '../api.service';
import {
  conTiempoLimite,
  esPeticionDeSoloLectura,
  intencionDePeticion,
  limiteDeTiempo,
  normalizarErrorDeRed,
  normalizarFallosDeRed,
} from '../errores-red';
import { AuthService, SIN_EMPRESA } from './auth.service';

const SIN_TOKEN = ['/auth/login', '/auth/refresh', '/auth/recuperar-password', '/auth/reset-password'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const snackbar = inject(MatSnackBar);

  // Solo adjuntamos credenciales a peticiones a nuestra propia API.
  // En producción API_BASE es absoluta (https://back-lactis.onrender.com/api/v1);
  // en desarrollo es relativa ('/api/v1') servida por el proxy local.
  const esApiPropia = req.url.startsWith(API_BASE) || req.url.startsWith('/api');
  if (!esApiPropia) return next(req);

  const esRutaDeSesion = SIN_TOKEN.some((p) => req.url.includes(p));
  const intencion = intencionDePeticion(req.method, esRutaDeSesion, esPeticionDeSoloLectura(req));
  // Las peticiones con archivos (subir un adjunto, bajar un PDF) van con un
  // techo mucho más alto: con los 30 s normales, subir la foto de un recibo
  // desde la finca fallaba SIEMPRE.
  const msLimite = limiteDeTiempo(req);

  // Cada intento HTTP lleva su propio límite de tiempo y, si es una lectura, sus
  // reintentos. Va PEGADO a `next(...)` y no al final del pipe a propósito: si
  // envolviera todo el flujo, un reintento volvería a suscribir la cadena
  // completa y podría disparar el refresh del token más de una vez, y el reloj
  // se compartiría entre la petición original, el refresh y el reintento (una
  // petición legítima moriría a mitad de camino).
  const enviar = (request: HttpRequest<unknown>) =>
    next(request).pipe(conTiempoLimite(intencion, msLimite));

  // Login / refresh / recuperar contraseña: sin token ni reintento por 401, pero
  // sí con límite de tiempo y mensaje claro. Es justo donde más se nota el
  // arranque en frío de Render, porque la primera petición del día es el login.
  if (esRutaDeSesion) {
    return enviar(req).pipe(normalizarFallosDeRed(intencion, req.url));
  }

  // La condición del header se calcula UNA vez, al armar la petición, y queda
  // capturada: el catch del 403 no la puede releer, porque para entonces
  // revalidarMembresia() pudo haber cambiado la empresa activa y parecería que
  // la petición nunca llevó header. El header solo va si el backend va a
  // aceptarlo: superadmin (entra a cualquiera) o empresa dentro de las
  // membresías del perfil. La primera llamada a /auth/me va sin header (perfil
  // aún null) y el backend usa la principal: correcto.
  const empresa = auth.empresaActiva();
  const llevaEmpresa =
    !!empresa &&
    !req.context.get(SIN_EMPRESA) &&
    (auth.esSuperadmin() || (auth.perfil()?.empresas?.some((e) => e.id === empresa) ?? false));
  // Un 403 con header puesto puede significar "te quitaron la membresía": solo
  // entonces vale la pena revalidar. El superadmin nunca pierde membresías y la
  // petición SIN_EMPRESA es la revalidación misma (evita la recursión).
  const revalidableAl403 = llevaEmpresa && !auth.esSuperadmin();

  const conCredenciales = (request: HttpRequest<unknown>, token: string | null) => {
    let headers = request.headers;
    if (token) headers = headers.set('Authorization', `Bearer ${token}`);
    if (llevaEmpresa) headers = headers.set('X-Empresa-Id', empresa);
    return request.clone({ headers });
  };

  return enviar(conCredenciales(req, auth.accessToken)).pipe(
    catchError((error: unknown) => {
      // Un TimeoutError de rxjs también llega aquí y no es un HttpErrorResponse:
      // se comprueba el tipo antes de mirar el status.
      //
      // Bloqueo por suscripción vencida. Va ANTES de la rama de membresías: es
      // un 403 con header puesto, pero revalidar la membresía no aporta nada
      // (el usuario sigue siendo miembro; es la EMPRESA la que no pagó) y su
      // aviso "volviste a tu empresa principal" sería mentira. Se excluyen las
      // URLs de /suscripcion por si acaso —el backend exime ese módulo del
      // bloqueo, así que no deberían traer este code— para no redirigir al
      // paywall desde el paywall. El perfil se recarga para que el guard y el
      // banner del layout vean el bloqueo (el backend es la verdad y el perfil
      // quedó viejo), se navega UNA sola vez (los 403 concurrentes de una misma
      // pantalla comprueban router.url) y el error SIEMPRE se propaga para que
      // la pantalla que llamó no se quede esperando.
      if (
        error instanceof HttpErrorResponse &&
        error.status === 403 &&
        error.error?.error?.code === 'suscripcion_vencida' &&
        !req.url.includes('/suscripcion')
      ) {
        if (router.url.startsWith('/suscripcion')) {
          return throwError(() => error);
        }
        return from(auth.recargarPerfil()).pipe(
          switchMap(() => {
            snackbar.open(
              'La suscripción de la empresa está vencida. Regulariza el pago para continuar.',
              'OK',
              { duration: 6000 },
            );
            router.navigate(['/suscripcion']);
            return throwError(() => error);
          }),
        );
      }
      if (error instanceof HttpErrorResponse && error.status === 403 && revalidableAl403) {
        // El error original SIEMPRE se propaga y NUNCA se reintenta la petición
        // contra otra empresa: una escritura reintentada guardaría el registro
        // en la empresa equivocada. La revalidación solo decide si además hay
        // que avisar y sacar al usuario de una empresa que ya no es suya.
        return from(auth.revalidarMembresia()).pipe(
          switchMap((sigueSiendoMiembro) => {
            if (!sigueSiendoMiembro) {
              snackbar.open(
                'Ya no tienes acceso a esa empresa; volviste a tu empresa principal',
                'OK',
                { duration: 6000 },
              );
              router.navigate(['/inicio']);
            }
            return throwError(() => error);
          }),
        );
      }
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      // Access token vencido: intentar refresh (compartido) y reintentar una vez
      return from(auth.refrescar()).pipe(
        // El refresh no llegó a preguntar: sin señal, tiempo agotado o 5xx de
        // Render arrancando en frío. NO se manda al usuario a /login: la sesión
        // sigue viva (auth.refrescar() dejó los tokens intactos) y una
        // navegación aquí cierra el diálogo abierto —MatDialog trae
        // closeOnNavigation: true— y le borra lo que había escrito.
        // Se devuelve el fallo de red ya traducido con intención 'sesion' para
        // que la pantalla diga "sin conexión" y él reintente con el formulario
        // intacto; hablar de "revisa si quedó guardado" sería falso, porque la
        // petición original recibió un 401 y no guardó nada.
        catchError((falloDeRefresh: unknown) =>
          throwError(() =>
            normalizarErrorDeRed(falloDeRefresh, 'sesion', `${API_BASE}/auth/refresh`),
          ),
        ),
        switchMap((nuevoToken) => {
          if (!nuevoToken) {
            // Aquí sí: el refresh token está vencido o revocado de verdad
            // (401/403) y auth.refrescar() ya limpió la sesión.
            router.navigate(['/login'], {
              queryParams: { returnUrl: router.url === '/login' ? null : router.url },
            });
            return throwError(() => error);
          }
          return enviar(conCredenciales(req, nuevoToken));
        }),
      );
    }),
    // Al final del todo, para que traduzca tanto el fallo del primer intento como
    // el del reintento posterior al refresh. Los errores del backend (4xx con su
    // propio detalle) pasan intactos.
    normalizarFallosDeRed(intencion, req.url),
  );
};
