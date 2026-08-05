import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';

import { CrudService } from '../../core/api.service';
import { Liquidacion, Monto } from '../../core/models';

export interface GenerarLiquidacionesPayload {
  periodo_inicio: string; // ISO 'YYYY-MM-DD'
  periodo_fin: string; // ISO 'YYYY-MM-DD'
  tipo: 'proveedor' | 'transportador' | 'ambos';
  proveedor_id?: string | null;
}

/**
 * UN TERCERO AL QUE LA CORRIDA NO LE GENERÓ LIQUIDACIÓN, y por qué.
 * Es el `LiquidacionOmitida` del backend.
 *
 * Hay dos motivos hoy: el PERÍODO CRUZADO —el servidor no deja nacer una liquidación
 * montada sobre otra del mismo tercero, porque encimadas dejan sin cobrar lo que quedó
 * debiendo en la primera— y el FLETE SIN TARIFA, que saldría en $0. Antes cualquiera de
 * los dos tumbaba la corrida entera y dejaba sin comprobante a los que no tenían nada que
 * ver; hoy el servidor SALTA a ese tercero y sigue con los demás.
 *
 * Y POR ESO ESTA LISTA TIENE QUE VERSE. Si se salta a alguien en silencio, el dueño
 * cree que ya liquidó a todos, cierra la quincena, y el proveedor le reclama después su
 * leche sin comprobante: es plata que quedó sin liquidar, no un detalle de la corrida.
 */
export interface OmitidoAlGenerar {
  /** El valor técnico ('proveedor' / 'transportador'). Acá solo es respaldo de `cuenta`. */
  tipo: 'proveedor' | 'transportador' | null;
  /**
   * 'leche' o 'flete': cuál de las dos cuentas del tercero se quedó sin comprobante.
   *
   * Lo manda el servidor ya en las palabras del dueño —el mismo par con que el candado de
   * Recepción diaria nombra las dos liquidaciones— y por eso no se deriva del `tipo` acá:
   * si la pantalla lo tradujera por su cuenta, el día que el backend agregue una tercera
   * cuenta esta diría cualquier cosa.
   */
  cuenta: string | null;
  tercero_id: string | null;
  /** El nombre con que el dueño lo conoce: "Henri C". Es lo primero que busca. */
  tercero_nombre: string | null;
  /**
   * EL MOTIVO TAL COMO LO ESCRIBE EL SERVIDOR, sin reescribirlo acá.
   *
   * Viene redactado y completo, con nombres, cifras y fechas, y con la salida que tiene el
   * dueño: el del cruce nombra la otra liquidación y su período y dice las dos salidas
   * (ajustar las fechas, o anular esa liquidación si se va a rehacer); el del flete dice
   * cuántos litros quedaron esperando y que hay que ponerle la tarifa. Es el mismo texto
   * que antes salía como error. Traducirlo en la pantalla sería tener dos versiones del
   * mismo motivo, y la de acá quedaría vieja el día que el servidor agregue otra razón.
   */
  motivo: string | null;
}

/** Resultado completo de la corrida: lo que se generó Y a quién no se le generó. */
export interface ResultadoGenerar {
  generadas: Liquidacion[];
  omitidos: OmitidoAlGenerar[];
  /**
   * EL SERVIDOR RESPONDIÓ EL SOBRE CON LAS DOS PARTES, PERO LA LISTA DE OMITIDOS NO
   * APARECIÓ CON NINGUNO DE LOS NOMBRES CONOCIDOS.
   *
   * Existe porque el silencio es el peor final posible de esta pantalla: si el campo se
   * llamara distinto, la lista saldría vacía, el dueño leería "se generaron 5" y cerraría
   * la quincena creyendo que liquidó a todos. Con esto no se puede decir "no quedó nadie
   * afuera" —no se sabe— y la pantalla lo dice en voz alta.
   *
   * Falso con la forma VIEJA (el arreglo pelado de liquidaciones): ahí no había lista que
   * buscar, porque un cruce tumbaba la corrida entera con un error.
   */
  omitidosSinLeer: boolean;
}

/**
 * Los nombres con que la respuesta puede traer las liquidaciones creadas y los saltados.
 *
 * El PRIMERO de cada lista es el del contrato de hoy (`GenerarLiquidacionesResultado` del
 * backend: `generadas` y `omitidas`). Los demás son tolerancia, y no sobran: si el nombre
 * no coincidiera, la lista saldría vacía y la pantalla se quedaría muda sobre plata sin
 * liquidar. Cuando ninguno coincide, eso se marca y se dice en voz alta (ver
 * `omitidosSinLeer`), que es lo único honesto. La forma de cada elemento se normaliza
 * aparte, en `omitidoDeCrudo`.
 */
const CLAVES_GENERADAS = ['generadas', 'liquidaciones', 'creadas', 'items'] as const;
const CLAVES_OMITIDOS = ['omitidas', 'omitidos', 'saltados', 'no_generadas'] as const;

function primeraLista(cuerpo: Record<string, unknown>, claves: readonly string[]): unknown[] {
  for (const clave of claves) {
    const valor = cuerpo[clave];
    if (Array.isArray(valor)) return valor;
  }
  return [];
}

function textoDe(fila: Record<string, unknown>, claves: readonly string[]): string | null {
  for (const clave of claves) {
    const valor = fila[clave];
    if (typeof valor === 'string' && valor.trim()) return valor.trim();
  }
  return null;
}

/** Un omitido con los campos puestos donde la pantalla los busca. */
function omitidoDeCrudo(crudo: unknown): OmitidoAlGenerar {
  const fila = (crudo ?? {}) as Record<string, unknown>;
  const tipo = textoDe(fila, ['tipo']);
  return {
    tipo: tipo === 'proveedor' || tipo === 'transportador' ? tipo : null,
    cuenta: textoDe(fila, ['cuenta']),
    tercero_id: textoDe(fila, ['tercero_id', 'proveedor_id', 'transportador_id', 'id']),
    tercero_nombre: textoDe(fila, [
      'tercero_nombre',
      'proveedor_nombre',
      'transportador_nombre',
      'nombre',
    ]),
    motivo: textoDe(fila, ['motivo', 'razon', 'detalle', 'mensaje', 'error']),
  };
}

/**
 * Acomoda la respuesta de "Generar" venga como venga.
 *
 * El contrato de hoy es el sobre con `generadas` y `omitidas`. La tolerancia no es por
 * gusto: este endpoint ACABA de cambiar de forma —antes respondía el arreglo pelado de
 * liquidaciones y un cruce venía como error— y lo que se lee acá no es una pantalla, es
 * plata sin liquidar. Con la forma vieja sigue funcionando, y con una que no se entienda
 * no se calla: se marca en `omitidosSinLeer` y la pantalla lo dice.
 */
export function resultadoGenerarDeCrudo(crudo: unknown): ResultadoGenerar {
  if (Array.isArray(crudo)) {
    return { generadas: crudo as Liquidacion[], omitidos: [], omitidosSinLeer: false };
  }
  if (!crudo || typeof crudo !== 'object') {
    return { generadas: [], omitidos: [], omitidosSinLeer: false };
  }
  const cuerpo = crudo as Record<string, unknown>;
  const clave = CLAVES_OMITIDOS.find((c) => Array.isArray(cuerpo[c]));
  return {
    generadas: primeraLista(cuerpo, CLAVES_GENERADAS) as Liquidacion[],
    omitidos: clave ? (cuerpo[clave] as unknown[]).map(omitidoDeCrudo) : [],
    omitidosSinLeer: clave === undefined,
  };
}

/** Un pago parcial contra una liquidación: los mismos campos que un abono de reventa. */
export interface PagoPayload {
  fecha: string; // ISO 'YYYY-MM-DD'
  valor: number;
  observaciones: string | null;
}

/** Pre-liquidación: pide cómo va un tercero sin generar ni guardar nada. */
export interface PrevisualizarPayload {
  periodo_inicio: string; // ISO 'YYYY-MM-DD'
  periodo_fin: string; // ISO 'YYYY-MM-DD'
  tipo: 'proveedor' | 'transportador';
  tercero_id: string;
}

export interface PreLiquidacionDetalle {
  fecha: string;
  litros: Monto;
  precio_litro: Monto;
  valor: Monto;
  /**
   * La ruta del renglón en la del transportador: sus renglones son por día Y
   * ruta, así que un día en que hizo dos rutas a tarifas distintas viene partido
   * en dos. Opcionales: la del proveedor no las trae. Ver `LiquidacionDetalle` en
   * core/models.ts, que es la misma idea en el comprobante ya generado.
   */
  ruta_id?: string | null;
  ruta_nombre?: string | null;
  /**
   * La ruta ya está borrada del catálogo. Opcional porque el backend todavía no
   * manda el campo; ver `ruta_borrada` en core/models.ts, es el mismo.
   */
  ruta_borrada?: boolean;
}

export interface PreLiquidacionAnticipo {
  fecha: string;
  valor: Monto;
  observaciones: string | null;
}

export interface PreLiquidacion {
  tipo: 'proveedor' | 'transportador';
  tercero_id: string;
  tercero_nombre: string;
  tercero_detalle: string | null;
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
  /**
   * Lo que el tercero quedó debiendo de quincenas pasadas, YA RESTADO del `saldo`.
   *
   * OPCIONAL, y el servidor NO la manda en el avance: el avance no genera nada ni aparta
   * ninguna deuda, así que no puede prometer un descuento que todavía no tiene dueño (la
   * deuda se cobra en el momento de generar, y ahí se decide cuál liquidación se la cobra).
   * Lo que sí manda es `deuda_pendiente`, que es la misma plata SIN restar. Ver
   * `saldo_anterior` en core/models.ts, que es este mismo campo en el comprobante ya
   * generado, donde sí está restado.
   *
   * El renglón de la pantalla solo sale si la columna CUADRA con él
   * (`saldo_anterior` restado da el `saldo`): un renglón "− $120.000" encima de un saldo
   * que no lo tiene restado descuadra el desglose contra la cifra grande, y el dueño lo
   * suma a mano. Ver `cobraSaldoAnterior` en preliquidacion.dialog.ts.
   */
  saldo_anterior?: Monto;
  /**
   * LO QUE EL TERCERO QUEDÓ DEBIENDO DE QUINCENAS PASADAS Y EL AVANCE TODAVÍA NO RESTA.
   *
   * En positivo, cero cuando no debe nada. Es la cifra con la que el PDF preliminar
   * escribe su aviso, y la pantalla tiene que decir LO MISMO CON LAS MISMAS PALABRAS:
   * el dueño manda el papel mirando la pantalla, y si la pantalla promete "saldo
   * $250.000" mientras el papel avisa que van a salir $130.000 porque el tercero debe
   * $120.000, la discusión con el proveedor la pierde él.
   *
   * OPCIONAL en el tipo aunque el backend ya la manda siempre (cero cuando no debe nada):
   * así una respuesta vieja no deja la pantalla mostrando "$ NaN", y mientras no llegue la
   * pantalla advierte que el saldo estimado puede bajar —no puede prometer que no hay
   * deuda, porque no lo sabe—. Ver `avisoDeLaDeuda` en preliquidacion.dialog.ts.
   */
  deuda_pendiente?: Monto;
  saldo: Monto;
  detalles: PreLiquidacionDetalle[];
  anticipos_detalle: PreLiquidacionAnticipo[];
}

@Injectable({ providedIn: 'root' })
export class LiquidacionesService extends CrudService<Liquidacion> {
  constructor() {
    super('/liquidaciones');
  }

  /**
   * Genera las liquidaciones del período: devuelve las creadas Y a quién se saltó.
   *
   * La respuesta se normaliza (`resultadoGenerarDeCrudo`) porque la corrida dejó de ser
   * "todo o nada": un tercero con un período cruzado ya no tumba a los demás, se salta
   * y viaja en la lista de omitidos. Quien llama tiene que mostrar las DOS partes —lo
   * generado y lo que quedó sin liquidar—; ver `GenerarQuincenaDialog`.
   */
  generar(payload: GenerarLiquidacionesPayload): Observable<ResultadoGenerar> {
    return this.api
      .post<unknown>(`${this.base}/generar`, payload)
      .pipe(map(resultadoGenerarDeCrudo));
  }

  /**
   * Corrige el precio por litro de UN día de la liquidación.
   *
   * Devuelve la liquidación entera recalculada por el backend —y no solo el día—
   * porque al cambiar el precio también cambian el valor bruto, el promedio, el
   * total y el saldo: pintar solo la fila dejaría el resumen mintiendo.
   *
   * El backend solo lo permite en borrador; la pantalla oculta el campo fuera de
   * ese estado, pero el que dice que no de verdad es el servidor.
   */
  actualizarPrecioDetalle(
    id: string,
    detalleId: string,
    precioLitro: number,
  ): Observable<Liquidacion> {
    return this.api.put<Liquidacion>(`${this.base}/${id}/detalles/${detalleId}`, {
      precio_litro: precioLitro,
    });
  }

  /**
   * Vuelve a cuadrar la liquidación con lo que hay hoy en el sistema.
   *
   * Dos casos, y los dos terminan igual: el comprobante muestra una cifra que ya
   * no corresponde. El primero es el anticipo registrado DESPUÉS de generarla
   * ("Anticipos aplicados $0"); el segundo es la TARIFA del transportador mal
   * tecleada y corregida después en su ficha —los renglones del comprobante son
   * la foto del día en que se generó, así que se quedan con la tarifa vieja—.
   * Volver a "Generar" no arregla ninguno de los dos: las recepciones del período
   * ya están apartadas por esta liquidación.
   *
   * Devuelve la liquidación entera recalculada. Quien la llama compara sus cifras
   * con las que tenía en pantalla para poder decirle al usuario CUÁNTO cambió; la
   * API no manda un "antes" y no le hace falta.
   *
   * Una APROBADA vuelve a borrador: aprobar es un visto bueno sobre unas cifras y
   * si las cifras cambian hay que darlo otra vez (es la misma cuenta que hace el
   * backend cuando se corrige una recepción de una liquidación aprobada). Con
   * plata entregada —pagada, o con un solo abono— el servidor rebota: esa cifra ya
   * está en manos del tercero.
   */
  recalcular(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/recalcular`);
  }

  aprobar(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/aprobar`);
  }

  pagar(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/pagar`);
  }

  /**
   * Registra un pago PARCIAL (abono) contra una liquidación aprobada.
   *
   * Devuelve la liquidación entera —no solo el pago— porque al abonar cambian
   * `pagado`, `saldo`, el estado y el historial a la vez: pintar solo una parte
   * dejaría la pantalla contradiciéndose a la vista.
   *
   * El backend no deja abonar más que el saldo ni pagarle a un borrador.
   */
  registrarPago(id: string, payload: PagoPayload): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/pagos`, payload);
  }

  /** Elimina un pago mal registrado: el backend devuelve el saldo y el estado. */
  eliminarPago(id: string, pagoId: string): Observable<Liquidacion> {
    return this.api.delete<Liquidacion>(`${this.base}/${id}/pagos/${pagoId}`);
  }

  anular(id: string): Observable<Liquidacion> {
    return this.api.post<Liquidacion>(`${this.base}/${id}/anular`);
  }

  descargarPdf(id: string): Observable<void> {
    return this.api.download(`${this.base}/${id}/pdf`, 'liquidacion.pdf');
  }

  /** PDF del recibo como Blob (para compartir por WhatsApp, etc.). */
  pdfBlob(id: string): Observable<Blob> {
    return this.api.getBlob(`${this.base}/${id}/pdf`);
  }

  /**
   * Calcula cómo va un tercero en el período, sin generar la liquidación.
   *
   * `soloLectura`: usa POST porque el filtro va en el cuerpo, pero NO GUARDA
   * NADA (el propio diálogo lo dice). Sin la marca, un fallo de red aquí
   * mostraba "revisa en la lista si el registro quedó guardado" y, sin señal,
   * "vuelve a tocar Guardar" en una pantalla que no tiene botón Guardar.
   */
  previsualizar(payload: PrevisualizarPayload): Observable<PreLiquidacion[]> {
    return this.api.post<PreLiquidacion[]>(`${this.base}/previsualizar`, payload, undefined, {
      soloLectura: true,
    });
  }

  /** PDF preliminar (no oficial) de una pre-liquidación, como Blob. Tampoco guarda nada. */
  previsualizarPdfBlob(payload: PrevisualizarPayload): Observable<Blob> {
    return this.api.postBlob(`${this.base}/previsualizar/pdf`, payload, { soloLectura: true });
  }
}
