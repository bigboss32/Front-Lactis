import { Injectable } from '@angular/core';

import { CrudService } from '../../core/api.service';
import {
  ModoTransporte,
  Monto,
  Transportador,
  TransportadorRuta,
  esDiaFijo,
} from '../../core/models';
import { pesosExactos } from '../../shared/pipes';

/**
 * Las rutas de un transportador ORDENADAS POR NOMBRE, que es como se leen.
 *
 * El API las manda ordenadas por el id de la ruta (un UUID), porque el `order_by`
 * de esa relación solo alcanza a ver columnas de su propia tabla. Un UUID no es un
 * orden: la lista sale barajada y —peor— sale barajada DISTINTO de como el PDF del
 * comprobante imprime los renglones del día, que sí va por nombre de ruta. El
 * dueño compara las dos cosas, así que el orden lo pone la pantalla, una sola vez
 * y en un solo sitio.
 *
 * Con `localeCompare('es-CO')` para que la Ñ y los acentos queden donde una persona
 * los busca.
 */
export function rutasEnOrden(rutas: readonly TransportadorRuta[]): TransportadorRuta[] {
  return [...rutas].sort((a, b) => {
    // Las que llegaron sin nombre van al final: no hay por dónde alfabetizarlas, y
    // entre ellas se quedan en el orden en que las mandó el API (sort es estable).
    if (!a.nombre || !b.nombre) return (a.nombre ? 0 : 1) - (b.nombre ? 0 : 1);
    return a.nombre.localeCompare(b.nombre, 'es-CO');
  });
}

/**
 * LO QUE SE LEE AL LADO DE LA CIFRA, y que le cambia el significado.
 *
 * "$ 242,76 /L" es una cosa y "$ 150.000 por día" es otra: la misma columna, la misma
 * plata escrita igual, y dos cuentas que no se parecen. Sin la unidad, un fijo por día
 * leído como tarifa por litro son $45.000.000 de flete en un día de 300 litros — y en
 * la pantalla las dos cifras se ven idénticas. Por eso la unidad no es adorno y por eso
 * se escribe en UN solo sitio: la lista, el formulario y sus pruebas dicen lo mismo.
 *
 * El espacio del fijo es DURO (U+00A0): "$ 150.000" y "por día" no se pueden separar en
 * dos renglones, porque medio renglón dice otra cosa.
 */
export function unidadDeLaTarifa(modo: ModoTransporte | string | null | undefined): string {
  return esDiaFijo(modo) ? ' por día' : '/L';
}

/**
 * UNA TARIFA COMPLETA, COMO SE LEE: "$ 242,76/L" o "$ 150.000 por día".
 *
 * La cifra sale del MISMO formateador del comprobante y del PDF (`pesosExactos`), con
 * centavos cuando los tiene: una tarifa de $242,76 leída "$ 243" es una cifra que no se
 * paga. Y la unidad va pegada, en la misma cadena, para que ninguna pantalla pueda
 * pintar la plata y olvidarse de decir de qué es.
 *
 * Sirve igual para la tarifa general del transportador y para la de cada una de sus
 * rutas: las dos son "una cifra y un modo", que es justo lo que pide este parámetro.
 */
export function tarifaLegible(
  tarifa: { valor_transporte: Monto; modo_transporte?: ModoTransporte } | null | undefined,
): string {
  if (!tarifa) return '—';
  return pesosExactos(tarifa.valor_transporte) + unidadDeLaTarifa(tarifa.modo_transporte);
}

/** Una ruta que hace el transportador con su tarifa y su modo, como la recibe el API. */
export interface TransportadorRutaPayload {
  ruta_id: string;
  valor_transporte: number | string;
  /**
   * SIEMPRE SE MANDA, y va pegado a `valor_transporte`: son un solo dato en dos campos.
   *
   * El backend trata el modo ausente como "no me toque el modo" justamente para que un
   * cliente viejo no le vuelva 'litro' una ruta que estaba en día fijo SIN cambiarle la
   * cifra (los $150.000 del día pasarían a $150.000 por litro y en pantalla la cifra se
   * vería idéntica). Este diálogo no necesita esa red: muestra las dos cosas en pantalla
   * y manda las dos, así que lo que el usuario ve es exactamente lo que queda guardado.
   */
  modo_transporte: ModoTransporte;
}

export interface TransportadorPayload {
  nombre: string;
  documento?: string | null;
  telefono?: string | null;
  /** Tarifa GENERAL: la que se cobra cuando la ruta del día no tiene tarifa propia. */
  valor_transporte: number | string;
  /** Y su modo, por lo mismo que en cada ruta: la cifra sola no dice qué se cobra. */
  modo_transporte: ModoTransporte;
  estado?: string;
  /**
   * Sus rutas con tarifa. OJO con los tres casos, porque el PUT es parcial y el
   * backend los distingue:
   *   · no mandar el campo → no se le toca ninguna ruta;
   *   · mandar []          → se le quitan TODAS (queda solo con la general);
   *   · mandar filas       → esas quedan y las demás se van.
   * El diálogo manda siempre la lista completa, porque en pantalla el usuario ve
   * todas: si la dejó vacía es porque quiere quitarlas. El caso de "no mandarlo"
   * queda para quien edite un campo suelto —el estado, por ejemplo— sin tener el
   * listado de rutas a la vista.
   */
  rutas?: TransportadorRutaPayload[];
}

@Injectable({ providedIn: 'root' })
export class TransportadoresService extends CrudService<Transportador, TransportadorPayload> {
  constructor() {
    super('/transportadores');
  }
}
