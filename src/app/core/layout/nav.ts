/** Navegación lateral: cada ítem se muestra solo con permiso `modulo:consultar`. */
export interface NavItem {
  label: string;
  icon: string;
  route: string;
  modulo: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: '',
    items: [{ label: 'Dashboard', icon: 'dashboard', route: '/dashboard', modulo: 'reportes' }],
  },
  {
    title: 'Leche',
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
    items: [
      { label: 'Producción', icon: 'factory', route: '/produccion', modulo: 'produccion' },
      { label: 'Inventario', icon: 'inventory_2', route: '/inventario', modulo: 'inventario' },
    ],
  },
  {
    title: 'Comercial',
    items: [
      { label: 'Compra y venta de queso', icon: 'swap_horiz', route: '/reventa', modulo: 'reventa' },
      { label: 'Ventas', icon: 'point_of_sale', route: '/ventas', modulo: 'ventas' },
      { label: 'Clientes', icon: 'group', route: '/clientes', modulo: 'clientes' },
      { label: 'Gastos', icon: 'receipt_long', route: '/gastos', modulo: 'gastos' },
    ],
  },
  {
    title: 'Finanzas',
    items: [
      { label: 'Caja', icon: 'savings', route: '/caja', modulo: 'caja' },
      { label: 'Bancos', icon: 'account_balance', route: '/bancos', modulo: 'bancos' },
      { label: 'Contabilidad', icon: 'calculate', route: '/contabilidad', modulo: 'contabilidad' },
    ],
  },
  {
    title: 'Administración',
    items: [
      { label: 'Empresas', icon: 'business', route: '/empresas', modulo: 'empresas' },
      { label: 'Sucursales', icon: 'store', route: '/sucursales', modulo: 'sucursales' },
      { label: 'Usuarios', icon: 'manage_accounts', route: '/usuarios', modulo: 'usuarios' },
      { label: 'Roles y permisos', icon: 'admin_panel_settings', route: '/roles', modulo: 'roles' },
      { label: 'Auditoría', icon: 'history', route: '/auditoria', modulo: 'auditoria' },
    ],
  },
];
