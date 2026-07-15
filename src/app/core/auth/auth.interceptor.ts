import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { AuthService } from './auth.service';

const SIN_TOKEN = ['/auth/login', '/auth/refresh', '/auth/recuperar-password', '/auth/reset-password'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!req.url.startsWith('/api') || SIN_TOKEN.some((p) => req.url.includes(p))) {
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
