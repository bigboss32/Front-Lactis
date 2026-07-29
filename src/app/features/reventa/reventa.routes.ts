import { Routes } from '@angular/router';

export const REVENTA_ROUTES: Routes = [
  // Va ANTES de la shell y fuera de ella: la shell filtra a sus sub-páginas por
  // un rango de fechas que arranca en el mes actual, y las cuentas del libro
  // anterior son viejas por definición (llevan la fecha del documento original),
  // así que ahí dentro la pantalla aparecería vacía.
  {
    path: 'libro-anterior',
    title: 'Compra y venta de queso · Libro anterior | Lactis',
    loadComponent: () => import('./libro-anterior.page').then((m) => m.LibroAnteriorPage),
  },
  // También va fuera de la shell, por la misma razón: cada temporada trae su
  // propio rango de fechas, así que el filtro compartido de la shell no aplica
  // aquí y tenerlo arriba haría creer que recorta la lista.
  {
    path: 'temporadas',
    title: 'Compra y venta de queso · Temporadas | Lactis',
    loadComponent: () => import('./temporadas.page').then((m) => m.ReventaTemporadasPage),
  },
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
