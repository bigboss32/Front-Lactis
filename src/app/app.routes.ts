import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { Layout } from './core/layout/layout';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Iniciar sesión | Lactis',
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: '',
    component: Layout,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: 'Dashboard | Lactis',
        loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'perfil',
        title: 'Mi perfil | Lactis',
        loadComponent: () => import('./features/perfil/perfil.page').then((m) => m.PerfilPage),
      },
      // ------------------------------------------------------------- leche
      {
        path: 'proveedores',
        loadChildren: () => import('./features/proveedores/proveedores.routes').then((m) => m.PROVEEDORES_ROUTES),
      },
      {
        path: 'transportadores',
        loadChildren: () => import('./features/transportadores/transportadores.routes').then((m) => m.TRANSPORTADORES_ROUTES),
      },
      {
        path: 'rutas',
        loadChildren: () => import('./features/rutas/rutas.routes').then((m) => m.RUTAS_ROUTES),
      },
      {
        path: 'recepciones',
        loadChildren: () => import('./features/recepciones/recepciones.routes').then((m) => m.RECEPCIONES_ROUTES),
      },
      {
        path: 'liquidaciones',
        loadChildren: () => import('./features/liquidaciones/liquidaciones.routes').then((m) => m.LIQUIDACIONES_ROUTES),
      },
      {
        path: 'anticipos',
        loadChildren: () => import('./features/liquidaciones/anticipos.routes').then((m) => m.ANTICIPOS_ROUTES),
      },
      // --------------------------------------------------------- operación
      {
        path: 'produccion',
        loadChildren: () => import('./features/produccion/produccion.routes').then((m) => m.PRODUCCION_ROUTES),
      },
      {
        path: 'inventario',
        loadChildren: () => import('./features/inventario/inventario.routes').then((m) => m.INVENTARIO_ROUTES),
      },
      // --------------------------------------------------------- comercial
      {
        path: 'reventa',
        loadChildren: () => import('./features/reventa/reventa.routes').then((m) => m.REVENTA_ROUTES),
      },
      {
        path: 'clientes',
        loadChildren: () => import('./features/clientes/clientes.routes').then((m) => m.CLIENTES_ROUTES),
      },
      {
        path: 'ventas',
        loadChildren: () => import('./features/ventas/ventas.routes').then((m) => m.VENTAS_ROUTES),
      },
      {
        path: 'gastos',
        loadChildren: () => import('./features/gastos/gastos.routes').then((m) => m.GASTOS_ROUTES),
      },
      // ---------------------------------------------------------- finanzas
      {
        path: 'caja',
        loadChildren: () => import('./features/caja/caja.routes').then((m) => m.CAJA_ROUTES),
      },
      {
        path: 'bancos',
        loadChildren: () => import('./features/bancos/bancos.routes').then((m) => m.BANCOS_ROUTES),
      },
      {
        path: 'contabilidad',
        loadChildren: () => import('./features/contabilidad/contabilidad.routes').then((m) => m.CONTABILIDAD_ROUTES),
      },
      // ----------------------------------------------------- administración
      {
        path: 'empleados',
        loadChildren: () => import('./features/empleados/empleados.routes').then((m) => m.EMPLEADOS_ROUTES),
      },
      {
        path: 'empresas',
        loadChildren: () => import('./features/empresas/empresas.routes').then((m) => m.EMPRESAS_ROUTES),
      },
      {
        path: 'sucursales',
        loadChildren: () => import('./features/sucursales/sucursales.routes').then((m) => m.SUCURSALES_ROUTES),
      },
      {
        path: 'usuarios',
        loadChildren: () => import('./features/usuarios/usuarios.routes').then((m) => m.USUARIOS_ROUTES),
      },
      {
        path: 'roles',
        loadChildren: () => import('./features/roles/roles.routes').then((m) => m.ROLES_ROUTES),
      },
      {
        path: 'auditoria',
        loadChildren: () => import('./features/auditoria/auditoria.routes').then((m) => m.AUDITORIA_ROUTES),
      },
      {
        path: 'notificaciones',
        loadChildren: () => import('./features/notificaciones/notificaciones.routes').then((m) => m.NOTIFICACIONES_ROUTES),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
