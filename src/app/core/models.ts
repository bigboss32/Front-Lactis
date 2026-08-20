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

/**
 * CÓMO SE LE PAGA EL FLETE: por litro (como siempre) o un FIJO POR DÍA.
 *
 * Lo pidió el dueño así: "en el transporte hay un nuevo requerimiento: que sea por
 * litro o que sea por día fijo, es decir, el transporte de leche a fábrica vale 150k
 * independientemente de los litros".
 *
 * Los dos valores son los del backend, tal cual (`MODOS_DE_TRANSPORTE` en
 * Back-Lactis/app/modules/transportadores/models.py). No se traducen ni se abrevian:
 * viajan por el API en los dos sentidos y un "fijo" o un "DIA_FIJO" inventado acá
 * rebota con un 422.
 */
export type ModoTransporte = 'litro' | 'dia_fijo';

export const MODO_POR_LITRO: ModoTransporte = 'litro';
export const MODO_DIA_FIJO: ModoTransporte = 'dia_fijo';

/**
 * ¿Esa tarifa (o ese renglón) se cobra por DÍA COMPLETO?
 *
 * Existe como función y no como comparación suelta porque la pregunta la hacen cinco
 * pantallas y TODAS tienen que contestarla igual: el formulario del transportador, su
 * lista, el comprobante, el avance y las pruebas. Y por el `undefined`: mientras una
 * respuesta vieja —o cacheada— llegue sin el campo, se lee como POR LITRO, que es lo
 * que esas tarifas y esos renglones significaron desde que existen. Adivinar por las
 * cifras ("litros × precio no da el valor") es lo que hace imprimir un comprobante que
 * no cuadra: eso también le pasa a una fila corregida a mano en la base.
 */
export function esDiaFijo(modo: ModoTransporte | string | null | undefined): boolean {
  return modo === MODO_DIA_FIJO;
}

/**
 * Una ruta que hace el transportador, CON LA TARIFA que cobra en ella.
 *
 * El mismo señor puede hacer dos rutas el mismo día y cobrar distinto en cada
 * una (Alex Agudelo hace Nápoles y Mira Valle), así que la ruta no es una
 * etiqueta: entra en la plata. La tarifa que le aplica a un día de recepción es
 * la de SU ruta, y solo si esa ruta no tiene tarifa propia se usa la general del
 * transportador.
 *
 * El `nombre` lo manda el backend aquí mismo para que ninguna pantalla tenga que
 * ir a pedir el catálogo de /rutas aparte solo para poder escribir "Nápoles".
 * Puede venir null si la ruta se borró después de haberla asignado.
 */
export interface TransportadorRuta {
  ruta_id: string;
  nombre: string | null;
  valor_transporte: Monto;
  /**
   * CÓMO se cobra ESTA ruta. `valor_transporte` cambia de significado con él: por
   * litro son $/L (242,76) y en día fijo es lo que vale el día completo (150.000).
   *
   * Por eso los dos campos no se pueden leer ni mandar por separado. Alex puede tener
   * Nápoles por litro y "a fábrica" por día fijo AL MISMO TIEMPO, así que el modo va
   * en cada ruta y no solo en el transportador.
   *
   * Opcional para leer una respuesta vieja como POR LITRO (ver `esDiaFijo`), nunca
   * para mandarlo a medias: el payload manda siempre los dos juntos.
   */
  modo_transporte?: ModoTransporte;
  /**
   * La ruta se BORRÓ después de habérsela asignado, y la tarifa sigue guardada.
   *
   * Opcional porque el backend todavía no manda el campo: mientras llegue en
   * `undefined` la pantalla se ve igual que hoy. Cuando llegue, el renglón sale
   * con una marca discreta "(borrada)" —la tarifa se sigue mostrando, que es plata
   * guardada— porque si no, el dueño se pone a buscar en Rutas una ruta que ya no
   * existe. Ver `ruta_borrada` en LiquidacionDetalle: es el mismo campo.
   */
  ruta_borrada?: boolean;
}

export interface Transportador extends TenantFields {
  nombre: string;
  documento: string | null;
  telefono: string | null;
  /**
   * Tarifa GENERAL por litro: la que se usa cuando el día no tiene ruta, o
   * cuando la ruta que hizo no tiene tarifa propia en `rutas`. No es un
   * duplicado de las de abajo: es el único valor posible cuando no hay ruta de
   * dónde sacar la tarifa.
   */
  valor_transporte: Monto;
  /**
   * El modo de esa tarifa GENERAL. El de cada ruta va en su propia fila.
   *
   * Un fijo general se cobra POR DÍA Y POR RUTA igual que el de una ruta: si ese día
   * recogió en dos rutas sin tarifa propia, son DOS fijos; y si en una ruta recogió de
   * cinco proveedores, ese día sigue valiendo UNO.
   */
  modo_transporte?: ModoTransporte;
  /** Sus rutas con tarifa propia. Vacío = solo cobra la tarifa general. */
  rutas: TransportadorRuta[];
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
 * ¿Por este día ya salió plata, y por eso tiene CAMPOS trabados?
 *
 * Basta UN abono: si al proveedor se le pagó la mitad de la quincena y después
 * le cambian los litros, ese pago queda contra un total que ya no existe.
 *
 * OJO con lo que esto significa hoy: ya NO es "el día no se puede editar". El
 * candado del backend es por CAMPO, así que un día con la leche pagada y el
 * flete sin liquidar tiene campos trabados Y campos corregibles a la vez. Para
 * saber si un campo puntual se puede tocar está `campoTrabado`; esta función
 * sirve para lo otro: decidir si el día lleva el ícono de candado.
 */
export function diaTrabadoPorPago(estado: EstadoLiquidacionDia): boolean {
  return estado === 'pagada' || estado === 'parcial';
}

/**
 * Los campos de una recepción, con el mismo nombre que usa el backend.
 *
 * Son las llaves que llegan en `campos_bloqueados` / `campos_editables`. Se
 * escriben igual a propósito: la regla de a quién le mueve la plata cada campo
 * vive en UN solo lugar (`_CAMPOS_DE_LA_LECHE` y `_CAMPOS_DEL_FLETE` en
 * Back-Lactis/app/modules/recepcion/service.py) y la pantalla solo la obedece.
 * Si se repitiera aquí, mañana las dos versiones dirían cosas distintas y la
 * pantalla ofrecería lo que el servidor va a negar.
 */
export type CampoRecepcion =
  | 'fecha'
  | 'proveedor_id'
  | 'cantidad_litros'
  | 'precio_litro'
  | 'bonificaciones'
  | 'descuentos'
  | 'transportador_id'
  | 'ruta_id'
  | 'sucursal_id'
  | 'observaciones'
  | 'estado';

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
  /** La liquidación del FLETE, que es otra y de otra persona. */
  liquidacion_transporte_id: string | null;
  /** Ver EstadoLiquidacionDia: null = todavía no está en ninguna liquidación. */
  liquidacion_estado: EstadoLiquidacionDia;

  // ---------------------------------------------------- el candado por campo
  // Un día vive en DOS liquidaciones de dos personas distintas: la leche al
  // proveedor y el flete al transportador. `liquidacion_estado` es el estado de
  // la MÁS TRABADA de las dos y no alcanza para decidir nada campo por campo:
  // con la leche pagada y el flete sin liquidar decía 'pagada', y la pantalla
  // trababa el formulario entero cuando el transportador sí se podía corregir.
  liquidacion_estado_leche: EstadoLiquidacionDia;
  liquidacion_estado_flete: EstadoLiquidacionDia;
  leche_pagada: boolean;
  flete_pagado: boolean;
  /** Los campos que el backend va a rebotar. La pantalla los apaga. */
  campos_bloqueados: CampoRecepcion[];
  /** Los que sí se pueden corregir. */
  campos_editables: CampoRecepcion[];
  /**
   * La explicación ya escrita en español, lista para mostrar ("la leche de este
   * día ya se le pagó a Patricia Laguna: … sí se puede corregir el
   * transportador, porque su flete todavía no se ha liquidado"). Viene del
   * backend para que el aviso y el guardia no se puedan desincronizar. Null
   * cuando no hay nada trabado.
   */
  candado_aviso: string | null;
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
  /**
   * SOLO en el comprobante del transportador: la ruta de ese renglón.
   *
   * Los renglones del transportador son por DÍA Y RUTA, no por día: el mismo
   * señor puede hacer Nápoles a $242,76 y Mira Valle a $300 el mismo martes, y
   * un solo renglón con las dos no cuadraría (litros × precio ≠ valor). Por eso
   * un día puede traer DOS renglones, y sin decir cuál ruta es cada uno la
   * pantalla parecería tener el día repetido.
   *
   * Opcionales las dos: el comprobante del proveedor no las trae, y un renglón
   * viejo (o de un día sin ruta) tampoco.
   */
  ruta_id?: string | null;
  ruta_nombre?: string | null;
  /**
   * La ruta de ese renglón ya está BORRADA del catálogo.
   *
   * Opcional porque el backend todavía no manda el campo (mientras venga en
   * `undefined` el renglón se ve igual que hoy). Cuando llegue, al nombre de la
   * ruta se le pega una marca "(borrada)": el comprobante es de una quincena
   * pasada y la ruta pudo haberse borrado después, así que el renglón tiene que
   * poder decirlo sin que la cifra cambie.
   */
  ruta_borrada?: boolean;
  /**
   * CÓMO SE COBRÓ ESTE RENGLÓN, y sin esto la pantalla no lo puede escribir bien:
   *
   *  · 'litro'    → "219,45 L × $242,76 = $53.273,68", y se verifica multiplicando;
   *  · 'dia_fijo' → NO hay tarifa por litro que escribir (`precio_litro` viaja en CERO,
   *    que es la verdad: ninguna tarifa por litro reproduce $150.000 el día), así que
   *    en esa columna va la palabra "Día completo" y los litros quedan al lado como
   *    información. Se verifica leyéndolo: el día vale $150.000.
   *
   * Se guarda EN EL RENGLÓN, así que un comprobante viejo sigue significando lo mismo
   * el día que a esa ruta le cambien el modo. Opcional para leer una respuesta vieja
   * como por litro; ver `esDiaFijo`.
   */
  modo_transporte?: ModoTransporte;
  /**
   * POR QUÉ UN RENGLÓN DE DÍA FIJO VALE $0,00, que son DOS cosas distintas y la
   * pantalla no las puede confundir:
   *
   *  · true  → ese día completo YA SE COBRÓ en otro comprobante (leche que se anotó
   *    después de liquidar ese día: el viaje costó $150.000 una vez y recoger un
   *    proveedor más no cuesta más). La columna Precio/L escribe "Ya cobrado";
   *  · false → simplemente vale eso. Si el valor es $0,00 es porque la tarifa fija de
   *    esa ruta es de $0,00 —el dueño decidió no cobrar ese viaje— y la columna escribe
   *    "Día completo", igual que cualquier otro día fijo.
   *
   * NO SE DEDUCE DE `valor === 0`: así se deducía y era falso la mitad de las veces.
   * Sobre un fijo de $0,00 que NUNCA se cobró, "Ya cobrado" le afirma al dueño que ya
   * se le pagó al conductor mientras el PDF —que sí usa este campo— dice lo contrario.
   *
   * Opcional para leer una respuesta vieja: sin el campo, ningún renglón dice "Ya
   * cobrado", que es exactamente lo que era cierto antes de que existiera.
   */
  dia_fijo_ya_cobrado?: boolean;
}

/** Un pago parcial (abono) hecho contra una liquidación aprobada. */
export interface PagoLiquidacion {
  id: string;
  fecha: string;
  valor: Monto;
  destinatario?: string | null;
  observaciones: string | null;
}

/**
 * OTRA LIQUIDACIÓN, NOMBRADA DESDE ESTA: el id y su período, nada más.
 *
 * Viaja plana y no como una liquidación completa —eso se llamaría a sí mismo sin fin—
 * porque lo único que la pantalla necesita para decir "se le cobró en la del 16/06/2026
 * al 30/06/2026" es el período y el id para poder abrirla.
 *
 * `periodo_texto` viene YA ARMADO del backend a propósito: si cada pantalla lo
 * formateara, alguna mostraría "2026-06-16" y el dueño no lee fechas así.
 */
export interface LiquidacionReferencia {
  id: string;
  periodo_inicio: string;
  periodo_fin: string;
  /** "16/06/2026 al 30/06/2026", como lo escribe el comprobante en PDF. */
  periodo_texto: string;
}

/**
 * UNA DE LAS QUINCENAS DE DONDE VINO EL `saldo_anterior` que esta liquidación cobra.
 *
 * Es la otra punta del enlace: la liquidación que quedó en negativo apunta a la que se
 * lo cobró (`deuda_trasladada_a`) y la que se lo cobró tiene que poder decir DE DÓNDE
 * salió ese descuento. Sin esto la pantalla muestra un renglón que le quita plata al
 * proveedor sin explicar por qué, y eso es exactamente lo que hace que el dueño
 * desconfíe del sistema entero.
 *
 * Puede haber MÁS DE UNA: si dos quincenas seguidas quedaron en negativo y ninguna se
 * había cobrado, las dos se cobran juntas en la siguiente. LA SUMA DE ESTOS
 * `le_queda_debiendo` DA EXACTO el `saldo_anterior` del resumen: es el desglose de ese
 * renglón, y todo desglose de este proyecto suma la cifra grande al centavo.
 */
export interface DeudaCobrada extends LiquidacionReferencia {
  /** Lo que ESA quincena dejó debiendo, en positivo. */
  le_queda_debiendo: Monto;
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
  /**
   * EL COMPROBANTE TRAE ALGÚN DÍA COBRADO POR DÍA COMPLETO, y por eso el
   * `precio_promedio` de arriba NO SE PUEDE AFIRMAR.
   *
   * Cuando llega en true el backend manda el promedio en CERO a propósito: con días
   * fijos mezclados esa división no reproduce la tarifa de ningún renglón ($150.000 del
   * día más $53.273,68 a $242,76 daría "$363,80/L", que no es la tarifa de nada), y
   * escribirla sería afirmar una tarifa por litro que no existe. La pantalla del
   * transportador NO imprime ese promedio —su comprobante en PDF tampoco lo imprime, y
   * las dos hojas tienen que decir lo mismo—, así que hoy no hay dónde mentir; el día
   * en que alguien agregue ese renglón, ESTA bandera es la que tiene que hacerlo decir
   * "—" y nunca "$ 0,00" el litro. Hay una prueba que lo mide.
   */
  tiene_dias_fijos?: boolean;
  valor_bruto: Monto;
  bonificaciones: Monto;
  descuentos: Monto;
  valor_transporte: Monto;
  anticipos: Monto;
  valor_total: Monto;
  /**
   * LO QUE EL TERCERO QUEDÓ DEBIENDO DE QUINCENAS PASADAS Y SE LE COBRA EN ESTA.
   *
   * Es un descuento del neto, igual que los anticipos: cuando los anticipos que se le
   * entregaron sumaron más que su quincena, el proveedor le quedó debiendo a la
   * quesera, y esa plata se cobra en la siguiente liquidación que se le genere. Antes
   * de esto la pantalla decía "le queda debiendo $X" y ahí moría: era un rótulo, nadie
   * la cobraba.
   *
   * La cuenta queda: neto_a_pagar = valor_total − anticipos − saldo_anterior.
   *
   * OPCIONAL en el tipo aunque el backend ya lo manda siempre: así una respuesta vieja
   * —o un comprobante cacheado— no deja la pantalla mostrando "$ NaN". Es el mismo
   * trato que `ruta_borrada`. El renglón solo sale cuando hay algo que cobrar.
   */
  saldo_anterior?: Monto;
  /**
   * EN LA LIQUIDACIÓN QUE DEJÓ LA DEUDA: el id de la que se la cobró.
   *
   * Null (o ausente) = todavía nadie se la cobró, así que la deuda está PENDIENTE y
   * viaja a la próxima quincena que se le genere. Con id = ya se cobró y no se le
   * vuelve a cobrar; es la marca que hace imposible cobrar dos veces la misma plata,
   * el mismo idioma que ya usan las recepciones (`liquidacion_id` marca el documento
   * que las consumió).
   *
   * Y ES UN CANDADO, no solo una seña: mientras esté puesta, el servidor REBOTA anular
   * y recalcular esta liquidación —cambiarle el total le cambiaría el descuento a un
   * comprobante ya emitido—. La pantalla no puede ofrecer esos botones acá: ver
   * `motivoNoAnular` en liquidacion-detail.dialog.ts.
   */
  deuda_trasladada_a_id?: string | null;
  /**
   * ESA MISMA LIQUIDACIÓN, con su período, para poder nombrarla sin ir a buscarla.
   *
   * Un id no le dice nada al dueño: lo que él necesita leer es "ya se le cobró en la
   * del 16/06/2026 al 30/06/2026", y eso es también lo que tiene que saber si algún día
   * quiere anular esta (primero hay que anular esa). Va al lado del id como
   * `proveedor_nombre` va al lado de `proveedor_id` en todo el proyecto.
   */
  deuda_trasladada_a?: LiquidacionReferencia | null;
  /**
   * DE DÓNDE SALIÓ EL `saldo_anterior`: las quincenas que dejaron esa deuda.
   *
   * Sus `le_queda_debiendo` suman EXACTO el `saldo_anterior`; es lo que le permite a la
   * pantalla explicar el descuento renglón por renglón. Vacía cuando no se cobró nada,
   * que es el caso de casi todos los comprobantes.
   */
  deudas_cobradas?: DeudaCobrada[];
  /** Lo que hay que entregarle al tercero: valor_total − anticipos − saldo_anterior. */
  neto_a_pagar: Monto;
  /** Lo que ya se le entregó, sumando los pagos parciales. */
  pagado: Monto;
  /** Lo que TODAVÍA se le debe. Siempre: neto_a_pagar = pagado + saldo. */
  saldo: Monto;
  /**
   * La vuelta del saldo cuando queda POR DEBAJO de cero: cuánto le quedó debiendo
   * EL TERCERO al negocio, en POSITIVO (cero cuando no debe nada). Pasa cuando los
   * anticipos que ya se le entregaron suman más que lo que produjo la quincena.
   *
   * Viene calculada del backend a propósito: así la pantalla dice "Henri le queda
   * debiendo $4.955,77" sin voltearle el signo a mano, y el comprobante en PDF —que
   * cambia el rótulo por "LE QUEDA DEBIENDO"— dice exactamente lo mismo.
   *
   * Y ESTA CIFRA YA NO ES SOLO UN RÓTULO: se cobra. Cuando se le genere la próxima
   * quincena, esta plata baja como `saldo_anterior` de la nueva y esta liquidación
   * queda marcada con `deuda_trasladada_a_id` apuntando a la que se la cobró. Mientras
   * esa marca esté vacía la deuda está pendiente, y la pantalla lo tiene que decir con
   * esas palabras: una promesa sin fecha es lo que había antes.
   */
  le_queda_debiendo: Monto;
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
   *
   * Estos tres son el RESUMEN de `tramos_flete`: la ruta leída de corrido, la
   * suma de lo que cobra cada tramo por kilo y la suma de los totales. El dato
   * original son los tramos.
   */
  gasto_concepto: string | null;
  gasto_por_kilo: Monto;
  gasto_monto: Monto;
  tramos_flete: VentaTramoFlete[];
  detalles: VentaDetalle[];
}

/**
 * Un tramo del recorrido del despacho: "de la quesera a San Vicente 400" y "de
 * San Vicente a Bogotá 600". El conductor es texto libre; el backend lo canoniza
 * para que la misma persona escrita de dos formas no quede partida en dos.
 */
export interface VentaTramoFlete {
  id: string;
  orden: number;
  origen: string | null;
  destino: string | null;
  conductor: string | null;
  valor_por_kilo: Monto;
  valor_total: Monto;
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
  /** Cuánta plata hay que SACAR por liquidaciones: solo los saldos positivos. */
  liquidaciones_por_pagar: Monto;
  /**
   * LO QUE LOS TERCEROS LE QUEDARON DEBIENDO A LA QUESERA, en positivo y aparte.
   *
   * Es la otra mitad de la pregunta, y va separada porque revuelta con la de arriba
   * RESTABA: $130.000 por pagarle a uno y $120.000 que otro quedó debiendo mostraban
   * "$10.000 por pagar" cuando de la caja tienen que salir $130.000. Y no es plata que el
   * dueño tenga que sacar: se cobra descontándola de la próxima quincena de cada tercero.
   *
   * Opcional porque una respuesta vieja del servidor no la trae, y así la pantalla no
   * muestra "$ NaN" mientras el despliegue se pone al día. Cero en la enorme mayoría de
   * las queseras.
   */
  terceros_le_quedan_debiendo?: Monto;
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
  /**
   * CUÁNTA PLATA TIENE QUE SACAR EL DUEÑO por liquidaciones: solo los saldos positivos.
   *
   * Es la MISMA cuenta que la tarjeta "Aprobadas por pagar" de la lista de liquidaciones
   * (ver `saldoPorPagar` allá): son la misma pregunta y no pueden contestarse distinto en
   * dos pantallas. Antes esta sumaba los negativos con los positivos y las dos decían
   * cifras distintas —$10.000 acá contra $130.000 allá—.
   */
  liquidaciones_por_pagar: Monto;
  /**
   * LO QUE LOS TERCEROS LE QUEDARON DEBIENDO A ÉL, en positivo y en su propia tarjeta.
   *
   * No es plata por pagar: se cobra descontándola de la próxima quincena de cada tercero.
   * Opcional porque una respuesta vieja del servidor no la trae; ausente se lee como cero
   * y la tarjeta no sale, en vez de mostrar "$ NaN".
   */
  terceros_le_quedan_debiendo?: Monto;
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
