import { Routes } from '@angular/router';

export const REVENTA_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./reventa-shell.page').then((m) => m.ReventaShellPage),
    children: [
      { path: '', redirectTo: 'resumen', pathMatch: 'full' },
      {
        path: 'resumen',
        title: 'Compra y venta de queso · Resumen | Lactis',
        loadComponent: () => import('./resumen.page').then((m) => m.ReventaResumenPage),
      },
      {
        path: 'compras',
        title: 'Compra y venta de queso · Compras | Lactis',
        loadComponent: () => import('./compras.page').then((m) => m.ReventaComprasPage),
      },
      {
        path: 'ventas',
        title: 'Compra y venta de queso · Ventas | Lactis',
        loadComponent: () => import('./ventas.page').then((m) => m.ReventaVentasPage),
      },
      {
        path: 'ajustes',
        title: 'Compra y venta de queso · Ajustes | Lactis',
        loadComponent: () => import('./ajustes.page').then((m) => m.ReventaAjustesPage),
      },
    ],
  },
];
