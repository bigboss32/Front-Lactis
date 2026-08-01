import { CHART_COLORS } from '../../shared/chart';

/** Navegación lateral: cada ítem se muestra solo con permiso `modulo:consultar`. */
export interface NavItem {
  label: string;
  icon: string;
  route: string;
  modulo: string;
  /** Si es true, se muestra siempre (sin exigir permiso del módulo). */
  siempre?: boolean;
}

export interface NavGroup {
  title: string;
  /** Ícono del grupo en el encabezado del acordeón (Material Symbols). */
  icon?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: '',
    items: [
      { label: 'Inicio', icon: 'home', route: '/inicio', modulo: 'reportes', siempre: true },
      { label: 'Estadísticas', icon: 'insights', route: '/dashboard', modulo: 'reportes' },
    ],
  },
  {
    title: 'Leche',
    icon: 'water_drop',
    items: [
      { label: 'Recepción diaria', icon: 'water_drop', route: '/recepciones', modulo: 'recepcion' },
      { label: 'Liquidaciones', icon: 'request_quote', route: '/liquidaciones', modulo: 'liquidaciones' },
      { label: 'Anticipos', icon: 'payments', route: '/anticipos', modulo: 'liquidaciones' },
      { label: 'Proveedores', icon: 'agriculture', route: '/proveedores', modulo: 'proveedores' },
      { label: 'Transportadores', icon: 'local_shipping', route: '/transportadores', modulo: 'transportadores' },
      { label: 'Rutas', icon: 'route', route: '/rutas', modulo: 'rutas' },
    ],
  },
  {
    title: 'Operación',
    icon: 'settings',
    items: [
      { label: 'Producción', icon: 'factory', route: '/produccion', modulo: 'produccion' },
      { label: 'Utilidad por lote', icon: 'query_stats', route: '/produccion/lotes', modulo: 'produccion' },
      { label: 'Inventario', icon: 'inventory_2', route: '/inventario', modulo: 'inventario' },
    ],
  },
  {
    title: 'Comercial',
    icon: 'storefront',
    items: [
      { label: 'Ventas', icon: 'point_of_sale', route: '/ventas', modulo: 'ventas' },
      { label: 'Clientes', icon: 'group', route: '/clientes', modulo: 'clientes' },
      { label: 'Gastos', icon: 'receipt_long', route: '/gastos', modulo: 'gastos' },
    ],
  },
  {
    title: 'Finanzas',
    icon: 'account_balance_wallet',
    items: [
      { label: 'Caja', icon: 'savings', route: '/caja', modulo: 'caja' },
      { label: 'Bancos', icon: 'account_balance', route: '/bancos', modulo: 'bancos' },
      { label: 'Contabilidad', icon: 'calculate', route: '/contabilidad', modulo: 'contabilidad' },
    ],
  },
  {
    title: 'Administración',
    icon: 'admin_panel_settings',
    items: [
      { label: 'Empleados', icon: 'badge', route: '/empleados', modulo: 'empleados' },
      { label: 'Empresas', icon: 'business', route: '/empresas', modulo: 'empresas' },
      { label: 'Suscripción', icon: 'card_membership', route: '/suscripcion', modulo: 'suscripcion' },
      { label: 'Sucursales', icon: 'store', route: '/sucursales', modulo: 'sucursales' },
      { label: 'Usuarios', icon: 'manage_accounts', route: '/usuarios', modulo: 'usuarios' },
      { label: 'Roles y permisos', icon: 'admin_panel_settings', route: '/roles', modulo: 'roles' },
      { label: 'Auditoría', icon: 'history', route: '/auditoria', modulo: 'auditoria' },
    ],
  },
];

/**
 * Un negocio aparte (reventa, transporte): contabilidad separada de la quesera.
 * NO están en NAV_GROUPS: en el menú de la quesera los usuarios los confundían
 * con la operación diaria. Se entra por las tarjetas de "Negocios aparte" del
 * Inicio, y el layout SE ADAPTA por el prefijo de la ruta: muestra el menú del
 * negocio (con su "Volver al inicio") y pinta la interfaz con su `color` para
 * que siempre se sepa en qué libro se está parado.
 */
export interface Negocio {
  /** Ruta raíz del negocio; el layout detecta por este prefijo dónde está el usuario. */
  prefijo: string;
  titulo: string;
  icono: string;
  /** Acento que identifica al negocio en la interfaz (el mismo de su tarjeta del Inicio). */
  color: string;
  grupos: NavGroup[];
}

const VOLVER_AL_INICIO: NavItem = {
  label: 'Volver al inicio', icon: 'arrow_back', route: '/inicio', modulo: 'reportes', siempre: true,
};

export const NEGOCIOS: Negocio[] = [
  {
    prefijo: '/reventa',
    titulo: 'Compra y venta de queso',
    icono: 'swap_horiz',
    color: CHART_COLORS[5],
    grupos: [
      {
        title: '',
        items: [
          VOLVER_AL_INICIO,
          { label: 'Resumen', icon: 'insights', route: '/reventa/resumen', modulo: 'reventa' },
          { label: 'Compras', icon: 'agriculture', route: '/reventa/compras', modulo: 'reventa' },
          { label: 'Ventas', icon: 'point_of_sale', route: '/reventa/ventas', modulo: 'reventa' },
          { label: 'Ajustes de inventario', icon: 'recycling', route: '/reventa/ajustes', modulo: 'reventa' },
          { label: 'Ganancia por lote', icon: 'inventory_2', route: '/reventa/lotes', modulo: 'reventa' },
          { label: 'Temporadas', icon: 'event_repeat', route: '/reventa/temporadas', modulo: 'reventa' },
          { label: 'Libro anterior', icon: 'menu_book', route: '/reventa/libro-anterior', modulo: 'reventa' },
        ],
      },
    ],
  },
  {
    prefijo: '/transporte',
    titulo: 'Transporte — la turbo',
    icono: 'local_shipping',
    color: CHART_COLORS[8],
    grupos: [
      {
        title: '',
        items: [
          VOLVER_AL_INICIO,
          { label: 'Viajes', icon: 'local_shipping', route: '/transporte/viajes', modulo: 'transporte' },
          { label: 'Cartera de fletes', icon: 'account_balance_wallet', route: '/transporte/cartera', modulo: 'transporte' },
          { label: 'Vehículos', icon: 'directions_bus', route: '/transporte/vehiculos', modulo: 'transporte' },
          { label: 'Mantenimiento', icon: 'build', route: '/transporte/mantenimiento', modulo: 'transporte' },
          { label: 'Resumen', icon: 'insights', route: '/transporte/resumen', modulo: 'transporte' },
        ],
      },
    ],
  },
];

/**
 * Las páginas de los negocios aparte, con el negocio como prefijo, para que el
 * buscador global (Ctrl+K) las siga ofreciendo en "Ir a" aunque no estén en el
 * menú de la quesera. Se excluye el "Volver al inicio" (es `siempre`).
 */
export const SECCIONES_OCULTAS: NavItem[] = NEGOCIOS.flatMap((n) =>
  n.grupos
    .flatMap((g) => g.items)
    .filter((item) => !item.siempre)
    .map((item) => ({ ...item, label: `${n.titulo} · ${item.label}` })),
);
