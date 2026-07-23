/**
 * Modelos TypeScript espejo de los schemas Pydantic del backend.
 * Los montos Decimal llegan como string en JSON; se tipan como `number | string`
 * y las vistas los formatean con los pipes `money` / `litros`.
 */

export type Monto = number | string;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface AuditFields {
  id: string;
  estado: string;
  created_at: string;
  updated_at: string;
}

export interface TenantFields extends AuditFields {
  empresa_id: string;
}

// ------------------------------------------------------------------- auth
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface Perfil {
  id: string;
  nombre: string;
  apellido: string;
  correo: string;
  username: string;
  foto_url: string | null;
  empresa_id: string | null;
  sucursal_id: string | null;
  roles: string[];
  permisos: string[]; // "modulo:accion"
  es_superadmin: boolean;
}

// ---------------------------------------------------------------- empresas
export interface Empresa extends AuditFields {
  nombre: string;
  nit: string;
  direccion: string | null;
  ciudad: string | null;
  departamento: string | null;
  pais: string;
  telefono: string | null;
  correo: string | null;
  logo_url: string | null;
}

export interface Sucursal extends TenantFields {
  nombre: string;
  tipo: 'planta' | 'centro_acopio' | 'punto_venta' | string;
  direccion: string | null;
  telefono: string | null;
  responsable: string | null;
}

// ---------------------------------------------------------------- usuarios
export interface PermisoRbac extends AuditFields {
  modulo: string;
  accion: string;
  descripcion: string | null;
}

export interface Rol extends AuditFields {
  nombre: string;
  descripcion: string | null;
  es_sistema: boolean;
  permisos: PermisoRbac[];
}

export interface RolResumen {
  id: string;
  nombre: string;
}

export interface Usuario extends AuditFields {
  nombre: string;
  apellido: string;
  documento: string | null;
  correo: string;
  telefono: string | null;
  username: string;
  foto_url: string | null;
  empresa_id: string | null;
  sucursal_id: string | null;
  ultimo_acceso: string | null;
  bloqueado: boolean;
  roles: RolResumen[];
}

// --------------------------------------------------------------- empleados
export interface Empleado extends TenantFields {
  nombre: string;
  apellido: string;
  documento: string | null;
  cargo: string | null;
  telefono: string | null;
  direccion: string | null;
  fecha_ingreso: string | null;
  salario: number | null;
  valor_dia: number | null;
}

/** Pago de nómina a un empleado (pago por jornal). */
export interface PagoEmpleado extends TenantFields {
  empleado_id: string;
  empleado_nombre: string;
  fecha: string;
  periodo: string | null;
  dias_trabajados: number;
  valor_dia: number;
  anticipos: number;
  total: number;
  observaciones: string | null;
}

// ------------------------------------------------------------------- leche
export interface Ruta extends TenantFields {
  nombre: string;
  municipio: string | null;
  descripcion: string | null;
}

export interface Transportador extends TenantFields {
  nombre: string;
  documento: string | null;
  telefono: string | null;
  ruta_id: string | null;
  valor_transporte: Monto;
}

export interface Proveedor extends TenantFields {
  nombre: string;
  documento: string | null;
  vereda: string | null;
  municipio: string | null;
  telefono: string | null;
  precio_litro: Monto;
  ruta_id: string | null;
  observaciones: string | null;
}

export interface Recepcion extends TenantFields {
  fecha: string;
  proveedor_id: string;
  proveedor_nombre: string | null;
  transportador_id: string | null;
  ruta_id: string | null;
  sucursal_id: string | null;
  cantidad_litros: Monto;
  precio_litro: Monto;
  bonificaciones: Monto;
  descuentos: Monto;
  valor_bruto: Monto;
  valor_transporte: Monto;
  valor_neto: Monto;
  observaciones: string | null;
  liquidacion_id: string | null;
}

export interface ResumenDia {
  fecha: string;
  total_litros: Monto;
  valor_bruto: Monto;
  valor_transporte: Monto;
  valor_neto: Monto;
  recepciones: number;
}

export interface ResumenPeriodo {
  desde: string;
  hasta: string;
  total_litros: Monto;
  valor_bruto: Monto;
  valor_transporte: Monto;
  valor_neto: Monto;
  precio_promedio: Monto;
  dias: ResumenDia[];
}

export interface LiquidacionDetalle {
  fecha: string;
  litros: Monto;
  precio_litro: Monto;
  valor: Monto;
}

export interface Liquidacion extends TenantFields {
  tipo: 'proveedor' | 'transportador' | string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  transportador_id: string | null;
  transportador_nombre: string | null;
  periodo_inicio: string;
  periodo_fin: string;
  total_litros: Monto;
  precio_promedio: Monto;
  valor_bruto: Monto;
  bonificaciones: Monto;
  descuentos: Monto;
  valor_transporte: Monto;
  anticipos: Monto;
  valor_total: Monto;
  saldo: Monto;
  observaciones: string | null;
  detalles: LiquidacionDetalle[];
}

export interface Anticipo extends TenantFields {
  tipo: 'proveedor' | 'transportador' | 'empleado' | string;
  proveedor_id: string | null;
  transportador_id: string | null;
  empleado_id: string | null;
  proveedor_nombre: string | null;
  tercero_nombre: string | null;
  fecha: string;
  valor: Monto;
  observaciones: string | null;
  liquidacion_id: string | null;
  pago_empleado_id: string | null;
  aplicado: boolean;
}

// -------------------------------------------------------------- producción
export interface TipoQueso extends TenantFields {
  nombre: string;
  descripcion: string | null;
  precio_referencia: Monto;
}

export interface Produccion extends TenantFields {
  fecha: string;
  tipo_queso_id: string;
  tipo_queso_nombre: string | null;
  sucursal_id: string | null;
  cantidad: Monto;
  peso_kg: Monto;
  litros_usados: Monto;
  rendimiento: Monto;
  merma: Monto;
  observaciones: string | null;
}

// -------------------------------------------------------------- inventario
export interface Producto extends TenantFields {
  nombre: string;
  categoria: 'leche' | 'insumo' | 'empaque' | 'producto_terminado' | string;
  unidad: string;
  stock_minimo: Monto;
  costo_unitario: Monto;
  tipo_queso_id: string | null;
}

export interface ProductoStock extends Producto {
  stock_actual: Monto;
  bajo_minimo: boolean;
}

export interface MovimientoInventario extends TenantFields {
  producto_id: string;
  producto_nombre: string | null;
  sucursal_id: string | null;
  fecha: string;
  tipo: 'entrada' | 'salida' | 'ajuste' | string;
  cantidad: Monto;
  costo_unitario: Monto;
  referencia: string | null;
  observaciones: string | null;
}

export interface KardexEntry {
  fecha: string;
  tipo: string;
  cantidad: Monto;
  costo_unitario: Monto;
  referencia: string | null;
  saldo: Monto;
}

export interface Kardex {
  producto_id: string;
  producto_nombre: string;
  unidad: string;
  stock_actual: Monto;
  movimientos: KardexEntry[];
}

// ------------------------------------------------------------------ ventas
export interface Cliente extends TenantFields {
  nombre: string;
  documento: string | null;
  telefono: string | null;
  correo: string | null;
  direccion: string | null;
  ciudad: string | null;
  observaciones: string | null;
}

export interface VentaDetalle {
  producto_id: string;
  descripcion: string | null;
  cantidad: Monto;
  precio_unitario: Monto;
  total: Monto;
}

export interface Venta extends TenantFields {
  numero: number;
  tipo: 'factura' | 'remision' | string;
  cliente_id: string;
  cliente_nombre: string | null;
  fecha: string;
  subtotal: Monto;
  descuento: Monto;
  total: Monto;
  pagado: Monto;
  saldo: Monto;
  observaciones: string | null;
  detalles: VentaDetalle[];
}

export interface Pago extends TenantFields {
  venta_id: string;
  fecha: string;
  valor: Monto;
  metodo: string;
  referencia: string | null;
  observaciones: string | null;
}

export interface CarteraCliente {
  cliente_id: string;
  cliente_nombre: string;
  ventas_pendientes: number;
  total_facturado: Monto;
  total_pagado: Monto;
  saldo: Monto;
}

// ------------------------------------------------------------------ gastos
export interface CategoriaGasto extends TenantFields {
  nombre: string;
  descripcion: string | null;
}

export interface Gasto extends TenantFields {
  fecha: string;
  categoria_id: string;
  categoria_nombre: string | null;
  concepto: string;
  proveedor: string | null;
  /** Opcional: gastos por unidad (ej. flete por kilo). */
  cantidad: Monto | null;
  precio_unitario: Monto | null;
  valor: Monto;
  numero_factura: string | null;
  observaciones: string | null;
  adjunto_url: string | null;
  sucursal_id: string | null;
}

// -------------------------------------------------------------------- caja
export interface MovimientoCaja extends TenantFields {
  caja_id: string;
  tipo: 'ingreso' | 'egreso' | string;
  concepto: string;
  valor: Monto;
  referencia: string | null;
}

export interface CajaDiaria extends TenantFields {
  fecha: string;
  sucursal_id: string | null;
  saldo_inicial: Monto;
  total_ingresos: Monto;
  total_egresos: Monto;
  saldo_final: Monto;
  efectivo_contado: Monto | null;
  diferencia: Monto | null;
  observaciones: string | null;
  movimientos: MovimientoCaja[];
}

// ------------------------------------------------------------------ bancos
export interface CuentaBancaria extends TenantFields {
  banco: string;
  numero_cuenta: string;
  tipo: string;
  titular: string | null;
  saldo_inicial: Monto;
}

export interface CuentaSaldo extends CuentaBancaria {
  saldo_actual: Monto;
}

export interface MovimientoBancario extends TenantFields {
  cuenta_id: string;
  fecha: string;
  tipo: 'ingreso' | 'egreso' | string;
  valor: Monto;
  concepto: string;
  referencia: string | null;
  conciliado: boolean;
  fecha_conciliacion: string | null;
}

// ------------------------------------------------------------- contabilidad
export interface AsientoLibroDiario {
  fecha: string;
  origen: string;
  concepto: string;
  ingreso: Monto;
  egreso: Monto;
  referencia: string | null;
}

export interface LibroDiario {
  desde: string;
  hasta: string;
  total_ingresos: Monto;
  total_egresos: Monto;
  asientos: AsientoLibroDiario[];
}

export interface LineaCategoria {
  categoria: string;
  total: Monto;
}

export interface EstadoResultados {
  desde: string;
  hasta: string;
  ingresos_ventas: Monto;
  costo_leche: Monto;
  costo_transporte: Monto;
  gastos_por_categoria: LineaCategoria[];
  total_gastos: Monto;
  utilidad_bruta: Monto;
  utilidad_neta: Monto;
  margen_neto: Monto;
}

export interface Balance {
  fecha_corte: string;
  saldo_cajas: Monto;
  saldo_bancos: Monto;
  cartera_por_cobrar: Monto;
  liquidaciones_por_pagar: Monto;
  total_disponible: Monto;
}

// ---------------------------------------------------------------- reportes
export interface SerieDia {
  fecha: string;
  valor: Monto;
}

export interface SerieCategoria {
  etiqueta: string;
  valor: Monto;
}

export interface Dashboard {
  fecha: string;
  litros_hoy: Monto;
  litros_quincena: Monto;
  valor_leche_quincena: Monto;
  produccion_kg_mes: Monto;
  ventas_mes: Monto;
  gastos_mes: Monto;
  litros_quincena_anterior: Monto;
  produccion_kg_mes_anterior: Monto;
  ventas_mes_anterior: Monto;
  gastos_mes_anterior: Monto;
  cartera_pendiente: Monto;
  liquidaciones_por_pagar: Monto;
  alertas_no_leidas: number;
  litros_por_dia: SerieDia[];
  ventas_por_dia: SerieDia[];
  gastos_por_categoria: SerieCategoria[];
  produccion_por_tipo: SerieCategoria[];
  top_proveedores: SerieCategoria[];
}

// ------------------------------------------------------------ notificaciones
export interface Notificacion extends TenantFields {
  usuario_id: string | null;
  tipo: string;
  titulo: string;
  mensaje: string;
  referencia: string | null;
  leida: boolean;
}

// --------------------------------------------------------------- auditoría
export interface Auditoria {
  id: string;
  created_at: string;
  empresa_id: string | null;
  usuario_id: string | null;
  ip: string | null;
  modulo: string;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
}

export interface LoginAudit {
  id: string;
  created_at: string;
  usuario_id: string | null;
  username_intentado: string | null;
  exito: boolean;
  motivo: string | null;
  ip: string | null;
  user_agent: string | null;
}
