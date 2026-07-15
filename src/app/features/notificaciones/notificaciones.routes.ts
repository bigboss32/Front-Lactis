import { Routes } from '@angular/router';

export const NOTIFICACIONES_ROUTES: Routes = [
  {
    path: '',
    title: 'Notificaciones | Lactis',
    loadComponent: () => import('./notificacion-list.page').then((m) => m.NotificacionListPage),
  },
];
