import { Routes } from '@angular/router';

export const ANTICIPOS_ROUTES: Routes = [
  {
    path: '',
    title: 'Anticipos | Lactis',
    loadComponent: () => import('./anticipo-list.page').then((m) => m.AnticipoListPage),
  },
];
