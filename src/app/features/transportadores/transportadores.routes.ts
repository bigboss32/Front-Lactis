import { Routes } from '@angular/router';

export const TRANSPORTADORES_ROUTES: Routes = [
  {
    path: '',
    title: 'Transportadores | Lactis',
    loadComponent: () =>
      import('./transportador-list.page').then((m) => m.TransportadorListPage),
  },
];
