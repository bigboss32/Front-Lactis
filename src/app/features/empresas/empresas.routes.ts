import { Routes } from '@angular/router';

export const EMPRESAS_ROUTES: Routes = [
  {
    path: '',
    title: 'Empresas | Lactis',
    loadComponent: () => import('./empresa-list.page').then((m) => m.EmpresaListPage),
  },
];
