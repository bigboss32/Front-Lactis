import { Routes } from '@angular/router';

export const USUARIOS_ROUTES: Routes = [
  {
    path: '',
    title: 'Usuarios | Lactis',
    loadComponent: () => import('./usuario-list.page').then((m) => m.UsuarioListPage),
  },
];
