import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';
import { MAT_TOOLTIP_DEFAULT_OPTIONS } from '@angular/material/tooltip';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { PaginadorEspanol } from './shared/paginador-espanol';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
    // Selector de calendario (mat-datepicker) con formato de fecha dd/mm/aaaa.
    provideNativeDateAdapter(),
    { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
    // Paginador de tablas con textos en español.
    { provide: MatPaginatorIntl, useClass: PaginadorEspanol },
    // Diálogos: enfoca el primer campo al abrir (más ágil para teclear).
    { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: { autoFocus: 'first-tabbable' } },
    // Tooltips: SIN gestos táctiles. En Android/iOS, Material desactiva los gestos
    // nativos del elemento que tiene matTooltip para poder abrirlo con pulsación
    // larga, y para eso le pone `touch-action: none` en línea
    // (@angular/material/tooltip: _disableNativeGesturesIfNecessary). El efecto es
    // que ese elemento NO deja desplazar la página con el dedo: en Inicio, las
    // siete tarjetas de acceso rápido cubren el 37% de la pantalla y bloqueaban el
    // scroll de la tablet; solo se podía arrastrar en los huecos entre tarjetas.
    // En escritorio no pasa (Material solo hace esto cuando la plataforma no
    // soporta mouse), por eso el fallo únicamente se veía en tablet y celular.
    // Con 'off' se pierde el tooltip por pulsación larga en táctil, que de todas
    // formas casi nadie descubre, y se recupera el scroll en toda la aplicación.
    {
      provide: MAT_TOOLTIP_DEFAULT_OPTIONS,
      useValue: { showDelay: 0, hideDelay: 0, touchendHideDelay: 1500, touchGestures: 'off' },
    },
  ],
};
