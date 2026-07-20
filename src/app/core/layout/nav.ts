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
    title: 'Reventa de queso',
    icon: 'swap_horiz',
    items: [
      { label: 'Resumen', icon: 'insights', route: '/reventa/resumen', modulo: 'reventa' },
      { label: 'Compras', icon: 'agriculture', route: '/reventa/compras', modulo: 'reventa' },
      { label: 'Ventas', icon: 'point_of_sale', route: '/reventa/ventas', modulo: 'reventa' },
      { label: 'Ajustes de inventario', icon: 'recycling', route: '/reventa/ajustes', modulo: 'reventa' },
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
      { label: 'Sucursales', icon: 'store', route: '/sucursales', modulo: 'sucursales' },
      { label: 'Usuarios', icon: 'manage_accounts', route: '/usuarios', modulo: 'usuarios' },
      { label: 'Roles y permisos', icon: 'admin_panel_settings', route: '/roles', modulo: 'roles' },
      { label: 'Auditoría', icon: 'history', route: '/auditoria', modulo: 'auditoria' },
    ],
  },
];
