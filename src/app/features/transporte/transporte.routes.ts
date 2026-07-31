import { Routes } from '@angular/router';

/** Rutas del módulo de transporte (la turbo). */
export const TRANSPORTE_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'viajes' },
  {
    path: 'resumen',
    title: 'Resumen de transporte | Lactis',
    loadComponent: () => import('./resumen.page').then((m) => m.TransporteResumenPage),
  },
  {
    path: 'viajes',
    title: 'Viajes | Lactis',
    loadComponent: () => import('./viaje-list.page').then((m) => m.ViajeListPage),
  },
  {
    // El id llega al componente por input (withComponentInputBinding en app.config).
    path: 'viajes/:id',
    title: 'Detalle del viaje | Lactis',
    loadComponent: () => import('./viaje-detail.page').then((m) => m.ViajeDetailPage),
  },
  {
    path: 'cartera',
    title: 'Cartera de fletes | Lactis',
    loadComponent: () => import('./cartera-fletes.page').then((m) => m.CarteraFletesPage),
  },
  {
    path: 'vehiculos',
    title: 'Vehículos | Lactis',
    loadComponent: () => import('./vehiculo-list.page').then((m) => m.VehiculoListPage),
  },
  {
    path: 'mantenimiento',
    title: 'Mantenimiento | Lactis',
    loadComponent: () => import('./mantenimiento.page').then((m) => m.MantenimientoPage),
  },
];
