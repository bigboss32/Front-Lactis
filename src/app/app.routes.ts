import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { permisoGuard } from './core/auth/permiso.guard';
import { suscripcionGuard } from './core/auth/suscripcion.guard';
import { Layout } from './core/layout/layout';

/**
 * Rutas de la aplicación.
 *
 * authGuard (en la ruta padre) exige SESIÓN; permisoGuard exige el PERMISO
 * `modulo:consultar` del módulo al que pertenece la pantalla, con el mismo
 * nombre de módulo que usa NAV_GROUPS (core/layout/nav.ts) y que el catálogo del
 * backend (app/core/permissions.py, tupla MODULOS).
 *
 * permisoGuard va en `canMatch` —no en `canActivate`— en todas las rutas con
 * loadChildren: el router necesita las rutas hijas para emparejar la URL, así
 * que con canActivate se descargaba el chunk del módulo ANTES de comprobar el
 * permiso y el cliente acababa bajándose el índice de módulos que no contrató.
 * canMatch se evalúa antes de cargar nada. En las rutas con loadComponent
 * (dashboard) se queda canActivate, que ahí no adelanta ninguna descarga.
 *
 * Van SIN permisoGuard, a propósito: /login (todavía no hay sesión), /inicio
 * (bienvenida sin datos, es el sitio al que se devuelve a quien no tiene
 * permiso), /perfil (los datos del propio usuario), /suscripcion (el paywall;
 * ver el comentario en su ruta) y el comodín de "no encontrado".
 */
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
    // El paywall va aquí, en canActivateChild, y no guard por guard en cada
    // módulo: el bloqueo por suscripción vencida es del sistema entero, así
    // que toda ruta hija —incluida una que se añada mañana— nace protegida.
    // Sus excepciones (/suscripcion, /perfil) viven dentro del propio guard.
    canActivateChild: [suscripcionGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
      {
        path: 'inicio',
        title: 'Inicio | Lactis',
        loadComponent: () => import('./features/inicio/inicio.page').then((m) => m.InicioPage),
      },
      {
        path: 'dashboard',
        title: 'Estadísticas | Lactis',
        // canActivate (no canMatch) porque es loadComponent: no hay tabla de
        // rutas hija que emparejar, así que el chunk solo se pide si pasa.
        canActivate: [permisoGuard('reportes')],
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
        canMatch: [permisoGuard('proveedores')],
        loadChildren: () => import('./features/proveedores/proveedores.routes').then((m) => m.PROVEEDORES_ROUTES),
      },
      {
        path: 'transportadores',
        canMatch: [permisoGuard('transportadores')],
        loadChildren: () => import('./features/transportadores/transportadores.routes').then((m) => m.TRANSPORTADORES_ROUTES),
      },
      {
        path: 'rutas',
        canMatch: [permisoGuard('rutas')],
        loadChildren: () => import('./features/rutas/rutas.routes').then((m) => m.RUTAS_ROUTES),
      },
      {
        path: 'recepciones',
        canMatch: [permisoGuard('recepcion')],
        loadChildren: () => import('./features/recepciones/recepciones.routes').then((m) => m.RECEPCIONES_ROUTES),
      },
      {
        path: 'liquidaciones',
        canMatch: [permisoGuard('liquidaciones')],
        loadChildren: () => import('./features/liquidaciones/liquidaciones.routes').then((m) => m.LIQUIDACIONES_ROUTES),
      },
      {
        // Los anticipos son parte de liquidaciones: mismo módulo de permisos
        // aquí y en el backend (app/modules/liquidaciones/router.py).
        path: 'anticipos',
        canMatch: [permisoGuard('liquidaciones')],
        loadChildren: () => import('./features/liquidaciones/anticipos.routes').then((m) => m.ANTICIPOS_ROUTES),
      },
      // --------------------------------------------------------- operación
      {
        path: 'produccion',
        canMatch: [permisoGuard('produccion')],
        loadChildren: () => import('./features/produccion/produccion.routes').then((m) => m.PRODUCCION_ROUTES),
      },
      {
        path: 'inventario',
        canMatch: [permisoGuard('inventario')],
        loadChildren: () => import('./features/inventario/inventario.routes').then((m) => m.INVENTARIO_ROUTES),
      },
      // --------------------------------------------------------- comercial
      {
        path: 'reventa',
        canMatch: [permisoGuard('reventa')],
        loadChildren: () => import('./features/reventa/reventa.routes').then((m) => m.REVENTA_ROUTES),
      },
      {
        path: 'clientes',
        canMatch: [permisoGuard('clientes')],
        loadChildren: () => import('./features/clientes/clientes.routes').then((m) => m.CLIENTES_ROUTES),
      },
      {
        path: 'ventas',
        canMatch: [permisoGuard('ventas')],
        loadChildren: () => import('./features/ventas/ventas.routes').then((m) => m.VENTAS_ROUTES),
      },
      {
        path: 'gastos',
        canMatch: [permisoGuard('gastos')],
        loadChildren: () => import('./features/gastos/gastos.routes').then((m) => m.GASTOS_ROUTES),
      },
      // --------------------------------------------------------- transporte
      {
        path: 'transporte',
        canMatch: [permisoGuard('transporte')],
        loadChildren: () => import('./features/transporte/transporte.routes').then((m) => m.TRANSPORTE_ROUTES),
      },
      // ---------------------------------------------------------- finanzas
      {
        path: 'caja',
        canMatch: [permisoGuard('caja')],
        loadChildren: () => import('./features/caja/caja.routes').then((m) => m.CAJA_ROUTES),
      },
      {
        path: 'bancos',
        canMatch: [permisoGuard('bancos')],
        loadChildren: () => import('./features/bancos/bancos.routes').then((m) => m.BANCOS_ROUTES),
      },
      {
        path: 'contabilidad',
        canMatch: [permisoGuard('contabilidad')],
        loadChildren: () => import('./features/contabilidad/contabilidad.routes').then((m) => m.CONTABILIDAD_ROUTES),
      },
      // ----------------------------------------------------- administración
      {
        path: 'empleados',
        canMatch: [permisoGuard('empleados')],
        loadChildren: () => import('./features/empleados/empleados.routes').then((m) => m.EMPLEADOS_ROUTES),
      },
      {
        path: 'empresas',
        canMatch: [permisoGuard('empresas')],
        loadChildren: () => import('./features/empresas/empresas.routes').then((m) => m.EMPRESAS_ROUTES),
      },
      {
        // SIN permisoGuard, a propósito (anti-bucle): es el PAYWALL. Cuando la
        // empresa está bloqueada, suscripcionGuard desvía aquí TODA navegación;
        // si esta ruta exigiera `suscripcion:consultar`, al usuario sin ese
        // permiso permisoGuard lo devolvería a /inicio y suscripcionGuard lo
        // traería de vuelta: bucle /suscripcion↔/inicio infinito. La página
        // misma le explica a quién pedir el pago y el backend protege los
        // datos igual (GET /suscripcion responde 403 sin el permiso).
        path: 'suscripcion',
        loadChildren: () => import('./features/suscripcion/suscripcion.routes').then((m) => m.SUSCRIPCION_ROUTES),
      },
      {
        path: 'sucursales',
        canMatch: [permisoGuard('sucursales')],
        loadChildren: () => import('./features/sucursales/sucursales.routes').then((m) => m.SUCURSALES_ROUTES),
      },
      {
        path: 'usuarios',
        canMatch: [permisoGuard('usuarios')],
        loadChildren: () => import('./features/usuarios/usuarios.routes').then((m) => m.USUARIOS_ROUTES),
      },
      {
        path: 'roles',
        canMatch: [permisoGuard('roles')],
        loadChildren: () => import('./features/roles/roles.routes').then((m) => m.ROLES_ROUTES),
      },
      {
        path: 'auditoria',
        canMatch: [permisoGuard('auditoria')],
        loadChildren: () => import('./features/auditoria/auditoria.routes').then((m) => m.AUDITORIA_ROUTES),
      },
      {
        path: 'notificaciones',
        canMatch: [permisoGuard('notificaciones')],
        loadChildren: () => import('./features/notificaciones/notificaciones.routes').then((m) => m.NOTIFICACIONES_ROUTES),
      },
    ],
  },
  // Red de seguridad del canMatch: si algún guard llegara a devolver `false` en
  // vez de un UrlTree, el router seguiría buscando y caería aquí; '' redirige a
  // /inicio, que es justo a donde queremos mandarlo (sin el aviso, eso sí).
  { path: '**', redirectTo: '' },
];
