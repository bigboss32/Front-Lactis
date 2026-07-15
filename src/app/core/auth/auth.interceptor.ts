import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { API_BASE } from '../api.service';
import { AuthService } from './auth.service';

const SIN_TOKEN = ['/auth/login', '/auth/refresh', '/auth/recuperar-password', '/auth/reset-password'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Solo adjuntamos credenciales a peticiones a nuestra propia API.
  // En producción API_BASE es absoluta (https://back-lactis.onrender.com/api/v1);
  // en desarrollo es relativa ('/api/v1') servida por el proxy local.
  const esApiPropia = req.url.startsWith(API_BASE) || req.url.startsWith('/api');
  if (!esApiPropia || SIN_TOKEN.some((p) => req.url.includes(p))) {
    return next(req);
  }

  const conCredenciales = (request: HttpRequest<unknown>, token: string | null) => {
    let headers = request.headers;
    if (token) headers = headers.set('Authorization', `Bearer ${token}`);
    const empresa = auth.empresaActiva();
    if (empresa && auth.esSuperadmin()) headers = headers.set('X-Empresa-Id', empresa);
    return request.clone({ headers });
  };

  return next(conCredenciales(req, auth.accessToken)).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status !== 401) return throwError(() => error);
      // Access token vencido: intentar refresh (compartido) y reintentar una vez
      return from(auth.refrescar()).pipe(
        switchMap((nuevoToken) => {
          if (!nuevoToken) {
            router.navigate(['/login'], {
              queryParams: { returnUrl: router.url === '/login' ? null : router.url },
            });
            return throwError(() => error);
          }
          return next(conCredenciales(req, nuevoToken));
        }),
      );
    }),
  );
};
