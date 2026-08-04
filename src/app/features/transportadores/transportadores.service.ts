import { Injectable } from '@angular/core';

import { CrudService } from '../../core/api.service';
import { Transportador, TransportadorRuta } from '../../core/models';

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

/** Una ruta que hace el transportador con su tarifa por litro, tal como la recibe el API. */
export interface TransportadorRutaPayload {
  ruta_id: string;
  valor_transporte: number | string;
}

export interface TransportadorPayload {
  nombre: string;
  documento?: string | null;
  telefono?: string | null;
  /** Tarifa GENERAL: la que se cobra cuando la ruta del día no tiene tarifa propia. */
  valor_transporte: number | string;
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
