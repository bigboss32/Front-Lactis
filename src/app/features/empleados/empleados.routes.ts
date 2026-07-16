import { Routes } from '@angular/router';

export const EMPLEADOS_ROUTES: Routes = [
  {
    path: '',
    title: 'Empleados | Lactis',
    loadComponent: () => import('./empleado-list.page').then((m) => m.EmpleadoListPage),
  },
];
