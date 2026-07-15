import { Routes } from '@angular/router';

export const BANCOS_ROUTES: Routes = [
  {
    path: '',
    title: 'Bancos | Lactis',
    loadComponent: () => import('./bancos.page').then((m) => m.BancosPage),
  },
];
