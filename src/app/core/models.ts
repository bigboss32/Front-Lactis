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

/** Empresa reducida a lo que necesita el selector de la barra. */
export interface EmpresaResumen {
  id: string;
  nombre: string;
}

export interface Perfil {
  id: string;
  nombre: string;
  apellido: string;
  correo: string;
  username: string;
  foto_url: string | null;
  /** Empresa ACTIVA del contexto (la del header X-Empresa-Id o la principal). */
  empresa_id: string | null;
  sucursal_id: string | null;
  /** Roles y permisos SOLO de la empresa activa (más los globales). */
  roles: string[];
  permisos: string[]; // "modulo:accion"
  es_superadmin: boolean;
  /**
   * Empresas a las que puede entrar: sus membresías, o TODAS las activas si es
   * superadmin. Opcional porque un backend viejo no lo manda: consumir con `?? []`.
   */
  empresas?: EmpresaResumen[];
  /**
   * Estado de la suscripción de la empresa ACTIVA (alimenta el banner del
   * layout y el guard del paywall). Null para el superadmin sin empresa;
   * opcional porque un backend viejo no lo manda: consumir con `??`.
   */
  suscripcion?: SuscripcionResumen | null;
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
  // Suscripción (los edita solo el superadmin). Opcionales porque un backend
  // viejo no los manda: consumir con `??`.
  /** Tarifa mensual propia; null = usa la tarifa global del sistema. */
  tarifa_mensual?: Monto | null;
  /** Empresa exenta de pago: no se le cobra ni se bloquea. */
  exenta?: boolean;
  /** Hasta cuándo está pagada; null = período de prueba desde su creación. */
  pagada_hasta?: string | null;
}

// ------------------------------------------------------------- suscripción
export type EstadoSuscripcion = 'exenta' | 'activa' | 'por_vencer' | 'gracia' | 'bloqueada';

/** Bloque `suscripcion` de GET /auth/me: lo mínimo para el banner y el guard. */
export interface SuscripcionResumen {
  estado: EstadoSuscripcion;
  /** Límite EFECTIVO de vigencia (incluye la prueba); null solo para exentas. */
  pagada_hasta: string | null;
  /** Negativo = días vencidos; null solo para exentas. */
  dias_restantes: number | null;
  dias_gracia: number;
  /** Días antes del vencimiento en que se avisa y se puede pagar ya. */
  dias_aviso: number;
  tarifa: Monto;
  tiene_fuente_pago: boolean;
}

/**
 * Tarjeta tokenizada en Wompi con la que se cobra la mensualidad.
 * Los datos públicos son nullables en el backend (dependen de lo que Wompi
 * devuelva al tokenizar); en la práctica siempre vienen, pero el tipo refleja
 * el contrato de FuentePagoRead.
 */
export interface FuentePago {
  id: string;
  marca: string | null;
  ultimos4: string | null;
  exp_mes: string | null;
  exp_anio: string | null;
  customer_email: string | null;
}

/** GET /suscripcion: el detalle completo de la pantalla de suscripción. */
export interface SuscripcionDetalle extends SuscripcionResumen {
  exenta: boolean;
  /** Hay un pago PENDING en curso: no se permite otro hasta que se resuelva. */
  pago_pendiente: boolean;
  fuente_pago: FuentePago | null;
}

export interface PagoSuscripcion {
  id: string;
  referencia: string;
  wompi_transaction_id: string | null;
  monto: Monto;
  moneda: string;
  estado_transaccion: 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR' | string;
  origen: 'manual' | 'automatico' | 'cron' | string;
  /** Con qué se pagó. Los pagos viejos, de cuando solo había tarjeta, son 'CARD'. */
  metodo: 'CARD' | 'PSE' | string;
  /**
   * Solo en PSE y mientras esté PENDING: el portal del banco donde quedó el
   * pago a medias. Sirve para RETOMARLO si cerró la pestaña.
   */
  url_banco: string | null;
  /** Período de vigencia que compró el pago (null si no fue APPROVED). */
  periodo_desde: string | null;
  periodo_hasta: string | null;
  created_at: string;
}

/** Tokens de aceptación de Wompi (JWT frescos, con su página de términos). */
export interface AceptacionWompi {
  acceptance_token: string;
  permalink: string;
}

/** GET /suscripcion/config: llave pública y tokens frescos para tokenizar. */
export interface SuscripcionConfig {
  public_key: string;
  /** URL de tokenización de Wompi: el navegador manda la tarjeta DIRECTO allá. */
  tokenizacion_url: string;
  acceptance: AceptacionWompi;
  personal_data_auth: AceptacionWompi;
}

/** Un banco habilitado para PSE (GET /suscripcion/pse/bancos, viene de Wompi). */
export interface BancoPSE {
  financial_institution_code: string;
  financial_institution_name: string;
}

/**
 * Body de POST /suscripcion/pse/pagar. Son los datos que exige PSE: el banco
 * al que se manda a la persona y el documento con el que el banco la
 * identifica.
 */
export interface PagarPsePayload {
  banco: string;
  /** PSE lo maneja así: '0' natural, '1' jurídica. */
  tipo_persona: '0' | '1';
  tipo_documento: 'CC' | 'CE' | 'NIT' | 'TI' | 'PP';
  documento: string;
  /**
   * Los dos van al `customer_data` que PSE exige. Si no se mandan, el backend
   * los completa con lo que sepa del usuario o de la empresa.
   */
  nombre_completo?: string;
  telefono?: string;
}

/**
 * Respuesta de POST /suscripcion/pse/pagar. No hay resultado todavía: el pago
 * nace PENDING y `url_banco` es a donde hay que mandar a la persona para que
 * lo apruebe. El resultado llega después por el webhook.
 */
export interface ResultadoPse {
  pago: PagoSuscripcion;
  url_banco: string | null;
  suscripcion: SuscripcionDetalle;
}

/**
 * Respuesta de POST /suscripcion/actualizar-estado: qué contestó la pasarela
 * sobre el pago que estaba en curso.
 */
export interface ActualizarEstadoRespuesta {
  suscripcion: SuscripcionDetalle;
  /** ¿El pago que estaba pendiente se resolvió? */
  cambio: boolean;
  /** Cómo quedó, o null si no había nada en curso. */
  estado_pago: string | null;
}

/** Respuesta de POST /suscripcion/pagar (DECLINED también llega aquí, con 200). */
export interface ResultadoPagoSuscripcion {
  pago: PagoSuscripcion;
  suscripcion: SuscripcionDetalle;
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
  /** Empresa PRINCIPAL (a la que entra sin elegir otra en el selector). */
  empresa_id: string | null;
  sucursal_id: string | null;
  ultimo_acceso: string | null;
  bloqueado: boolean;
  /** Roles en la empresa activa del contexto (todos, para el superadmin sin header). */
  roles: RolResumen[];
  /** Nombres de las empresas de las que es miembro. Opcional: backend viejo no lo manda. */
  empresas?: string[];
}

/** Fila de GET /usuarios/{id}/empresas: una membresía con sus roles. */
export interface MembresiaEmpresa {
  empresa_id: string;
  empresa_nombre: string;
  roles: RolResumen[];
}

/** Membresía tal como la recibe PUT /usuarios/{id}/empresas. */
export interface MembresiaEmpresaPayload {
  empresa_id: string;
  rol_ids: string[];
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

/**
 * Estado de la liquidación que manda sobre un día de recepción. Bloquean las
 * que YA TIENEN PAGOS ('parcial' y 'pagada'); en borrador y en aprobada el día
 * se puede corregir y el backend recuadra la liquidación solo (y si estaba
 * aprobada, la devuelve a borrador).
 */
export type EstadoLiquidacionDia = 'borrador' | 'aprobada' | 'parcial' | 'pagada' | null;

/**
 * ¿Este día quedó trabado porque ya salió plata por él?
 *
 * Basta UN abono: si al proveedor se le pagó la mitad de la quincena y después
 * le cambian los litros, ese pago queda contra un total que ya no existe. El
 * backend rebota igual (RecepcionService._exigir_no_pagada); esto es para que
 * la pantalla no ofrezca lo que el servidor va a negar.
 */
export function diaTrabadoPorPago(estado: EstadoLiquidacionDia): boolean {
  return estado === 'pagada' || estado === 'parcial';
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
  /** Ver EstadoLiquidacionDia: null = todavía no está en ninguna liquidación. */
  liquidacion_estado: EstadoLiquidacionDia;
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
  /** Señala el día al corregirle el precio; no se muestra en pantalla. */
  id: string;
  fecha: string;
  litros: Monto;
  precio_litro: Monto;
  valor: Monto;
}

/** Un pago parcial (abono) hecho contra una liquidación aprobada. */
export interface PagoLiquidacion {
  id: string;
  fecha: string;
  valor: Monto;
  observaciones: string | null;
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
  /** Lo que hay que entregarle al tercero: valor_total - anticipos. */
  neto_a_pagar: Monto;
  /** Lo que ya se le entregó, sumando los pagos parciales. */
  pagado: Monto;
  /** Lo que TODAVÍA se le debe. Siempre: neto_a_pagar = pagado + saldo. */
  saldo: Monto;
  observaciones: string | null;
  detalles: LiquidacionDetalle[];
  pagos: PagoLiquidacion[];
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
  /**
   * Ya está descontado en una liquidación o en una nómina. Es una SEÑA, no un
   * candado: desde que el anticipo se puede corregir mientras a esa liquidación
   * no se le haya pagado nada, "aplicado" y "trabado" dejaron de ser lo mismo.
   * Para saber si se puede tocar hay que mirar `bloqueado`.
   */
  aplicado: boolean;
  /** 'borrador' | 'aprobada' | 'parcial' | 'pagada' de la liquidación que lo tiene. */
  liquidacion_estado: string | null;
  /** El candado de verdad: ya salió plata contra este anticipo (o quedó en nómina). */
  bloqueado: boolean;
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
  /**
   * Lo que cuesta LLEVAR el despacho (el flete a Bogotá o a donde sea).
   *
   * NO está dentro de `total`: el cliente no lo paga, lo paga la quesera. Es lo que
   * hace que el kilo puesto en destino valga más que el kilo en la planta, y sale
   * restado en la utilidad por lote de producción.
   */
  gasto_concepto: string | null;
  gasto_por_kilo: Monto;
  gasto_monto: Monto;
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

/**
 * Estado de resultados del período.
 *
 * LA CORRECCIÓN IMPORTANTE: antes se restaba toda la leche que entró en el mes
 * contra todo el queso que se vendió en el mes. Pero la leche del 1 de julio se
 * convierte en queso que puede venderse 60 días después: no son el mismo queso, y
 * la utilidad salía negativa sin que el negocio estuviera perdiendo.
 *
 * Ahora se resta el COSTO DE LO QUE SE VENDIÓ, y la leche comprada queda en un
 * bloque informativo junto con lo que sigue sin venderse.
 */
/**
 * Una producción de la que salió parte del queso vendido en el período.
 *
 * La suma de sus costos ES `costo_queso_vendido`: es la cuenta que el usuario
 * puede seguir para comprobar que la leche sí se está restando.
 */
export interface OrigenDelCosto {
  fecha: string;
  tipo_queso: string;
  origen: 'produccion' | 'existencia';
  /** Kilos de ese lote que se vendieron en el período. */
  kilos: Monto;
  costo: Monto;
}

export interface EstadoResultados {
  desde: string;
  hasta: string;
  /** Total facturado. Los tres renglones de abajo lo suman exacto. */
  ingresos_ventas: Monto;
  queso_vendido: Monto;
  otras_ventas: Monto;
  descuentos: Monto;
  /** Lo que entra en la utilidad, de la cadena de lotes de producción. */
  costo_queso_vendido: Monto;
  transporte_despachos: Monto;
  queso_danado: Monto;
  /** Queso vendido que no salió de ningún lote: no se pudo costear. */
  queso_vendido_sin_costo: Monto;
  /** De qué producciones salió el queso vendido. Suman costo_queso_vendido. */
  origen_del_costo: OrigenDelCosto[];
  /** Informativo: NO entra en la utilidad, porque no es pérdida. */
  costo_leche: Monto;
  costo_transporte: Monto;
  leche_sin_usar: Monto;
  queso_en_bodega: Monto;
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

// -------------------------------------------------------------- transporte
export interface Vehiculo extends TenantFields {
  placa: string;
  /** Alias con el que la finca conoce al vehículo ("la turbo"). */
  nombre: string | null;
  marca: string | null;
  linea: string | null;
  anio: number | null;
  capacidad_kg: Monto | null;
  /** Tarifa base por kilo transportado; cada servicio puede ajustarla. */
  tarifa_kilo: Monto;
  odometro_actual: Monto;
  observaciones: string | null;
}

export interface AbonoFlete {
  id: string;
  fecha: string;
  valor: Monto;
  metodo: string;
  referencia: string | null;
  observaciones: string | null;
}

/** Un flete dentro de un viaje: carga de terceros o queso propio (interno). */
export interface ViajeServicio extends TenantFields {
  viaje_id: string;
  sentido: 'ida' | 'regreso' | string;
  tipo_cobro: 'por_kilo' | 'precio_fijo' | string;
  /** Queso propio: se valora a tarifa para medir rentabilidad, sin cartera. */
  es_interno: boolean;
  cliente_id: string | null;
  cliente_nombre: string | null;
  descripcion: string;
  kilos: Monto | null;
  tarifa_kilo: Monto | null;
  valor_total: Monto;
  abonado: Monto;
  saldo: Monto;
  observaciones: string | null;
  abonos: AbonoFlete[];
}

export interface VehiculoGasto extends TenantFields {
  vehiculo_id: string;
  /** Null = gasto general del vehículo (no atado a un viaje). */
  viaje_id: string | null;
  fecha: string;
  categoria: string;
  concepto: string | null;
  valor: Monto;
  odometro: Monto | null;
  adjunto_url: string | null;
}

/** Viaje del listado, con los agregados que calcula el backend (evita N+1). */
export interface Viaje extends TenantFields {
  numero: number;
  vehiculo_id: string;
  vehiculo_placa: string | null;
  vehiculo_nombre: string | null;
  fecha_salida: string;
  fecha_regreso: string | null;
  origen: string;
  destino: string;
  conductor_nombre: string | null;
  pago_conductor: Monto;
  odometro_salida: Monto | null;
  odometro_regreso: Monto | null;
  observaciones: string | null;
  total_ingresos: Monto;
  ingresos_terceros: Monto;
  ingresos_internos: Monto;
  /** Gastos del viaje INCLUYENDO el pago del conductor. */
  total_gastos_viaje: Monto;
  utilidad: Monto;
  saldo_cartera: Monto;
}

/** Detalle del viaje (= reporte de rentabilidad): servicios y gastos. */
export interface ViajeDetalle extends Viaje {
  servicios: ViajeServicio[];
  gastos: VehiculoGasto[];
}

export interface VehiculoMantenimiento extends TenantFields {
  vehiculo_id: string;
  fecha: string;
  tipo: 'preventivo' | 'correctivo' | string;
  descripcion: string;
  taller: string | null;
  odometro: Monto | null;
  valor: Monto;
  proximo_odometro: Monto | null;
  proxima_fecha: string | null;
  adjunto_url: string | null;
}

export interface VehiculoDocumento extends TenantFields {
  vehiculo_id: string;
  tipo: 'soat' | 'tecnomecanica' | 'seguro' | 'impuesto' | 'otro' | string;
  descripcion: string | null;
  numero: string | null;
  fecha_expedicion: string | null;
  fecha_vencimiento: string;
  valor: Monto;
  adjunto_url: string | null;
}

/** Fila de GET /transporte/cartera (saldos de fletes por cliente). */
export interface CarteraFleteCliente {
  /** Null = cliente ocasional (texto libre), agrupado por nombre. */
  cliente_id: string | null;
  cliente_nombre: string;
  servicios_pendientes: number;
  total_facturado: Monto;
  total_abonado: Monto;
  saldo: Monto;
}

export interface CarteraFleteServicio {
  id: string;
  viaje_id: string;
  viaje_numero: number;
  viaje_fecha: string;
  sentido: string;
  tipo_cobro: string;
  descripcion: string;
  kilos: Monto | null;
  tarifa_kilo: Monto | null;
  valor_total: Monto;
  abonado: Monto;
  saldo: Monto;
  estado: string;
  abonos: AbonoFlete[];
}

export interface CarteraFleteDetalle {
  cliente_id: string | null;
  cliente_nombre: string;
  servicios: CarteraFleteServicio[];
  total_facturado: Monto;
  total_abonado: Monto;
  saldo: Monto;
}

export interface SerieMesTransporte {
  /** 'YYYY-MM' */
  mes: string;
  ingresos: Monto;
  gastos: Monto;
  utilidad: Monto;
}

export interface ResumenTransporte {
  desde: string;
  hasta: string;
  vehiculo_id: string | null;
  viajes_realizados: number;
  kilos_transportados: Monto;
  /** Solo suma viajes con ambos odómetros registrados. */
  kilometros: Monto;
  ingresos_terceros: Monto;
  ingresos_internos: Monto;
  total_ingresos: Monto;
  total_pago_conductores: Monto;
  gastos_por_categoria: Record<string, Monto>;
  total_gastos: Monto;
  total_mantenimientos: Monto;
  total_documentos: Monto;
  utilidad_operativa: Monto;
  utilidad_neta: Monto;
  /** Cartera de HOY (histórica), no del rango consultado. */
  por_cobrar: Monto;
  serie_mensual: SerieMesTransporte[];
}

export interface AlertaDocumento {
  documento_id: string;
  vehiculo_id: string;
  vehiculo_placa: string;
  vehiculo_nombre: string | null;
  tipo: string;
  descripcion: string | null;
  numero: string | null;
  fecha_vencimiento: string;
  /** Negativo = ya venció. */
  dias_restantes: number;
  estado: 'vencido' | 'por_vencer';
}

export interface AlertaMantenimiento {
  mantenimiento_id: string;
  vehiculo_id: string;
  vehiculo_placa: string;
  vehiculo_nombre: string | null;
  tipo: string;
  descripcion: string;
  fecha: string;
  proxima_fecha: string | null;
  proximo_odometro: Monto | null;
  dias_restantes: number | null;
  km_restantes: Monto | null;
  estado: 'vencido' | 'por_vencer';
}

export interface AlertasTransporte {
  documentos: AlertaDocumento[];
  mantenimientos: AlertaMantenimiento[];
}
