import { EstadoLiquidacionDia, LiquidacionDevueltaABorrador, Recepcion } from '../../core/models';

/** Una de las dos liquidaciones de un día, como estaba al abrirlo y como quedó. */
interface PlataDelDia {
  cual: 'de la leche' | 'del flete';
  estado: EstadoLiquidacionDia;
  /** El `_traba_el_dia` del backend para ESTA liquidación. */
  trabada: boolean;
  id: string | null;
  idDespues: string | null | undefined;
  estadoDespues: EstadoLiquidacionDia | undefined;
}

/**
 * QUÉ LE PASÓ A LA LIQUIDACIÓN DEL DÍA AL GUARDARLO O BORRARLO, dicho solo si pasó.
 *
 * SI LA RESPUESTA TRAE `liquidaciones_devueltas_a_borrador`, ESO ES EL HECHO y el aviso
 * sale de ahí. Es lo único que ve la liquidación a la que el día ENTRA: se le cambia el
 * transportador a uno cuyo viaje de esa fecha ya está en un comprobante aprobado, el PUT
 * mete el día en ese comprobante y lo devuelve a borrador, y desde el día de antes —que
 * no tenía flete— no había cómo saberlo. Con la lista vacía no volvió ninguna, y no se
 * dice que volvió.
 *
 * Sin ese campo (una respuesta vieja, o al borrar, que no tiene respuesta) se deduce con
 * la regla del backend, citada y no copiada de memoria: después de escribir,
 * `RecepcionService._recuadrar` recorre las dos liquidaciones que tenían el día (leche y
 * flete) y SE SALTA la que `_traba_el_dia` declara en firme —a esa solo le pone al día el
 * flete informativo—; a las demás las recuadra, y `LiquidacionService.recuadrar` devuelve
 * a borrador TODA aprobada que recuadra, cambie o no una cifra. `leche_pagada` /
 * `flete_pagado` son ese mismo `_traba_el_dia`, así que con el día de antes se sabe cuál
 * se tocó.
 *
 * El caso que mentía: el día de Beto, en una quincena 'aprobada' cuya deuda ya se cobró en
 * la siguiente. Se le corrigen las observaciones, el PUT da 200, la liquidación sigue
 * aprobada y en su versión 1, y el aviso decía "volvió a borrador porque cambiaron sus
 * litros". Ni volvió, ni cambiaron los litros.
 *
 * Con respuesta pero sin el campo, manda el estado de cada liquidación DESPUÉS del
 * recuadre: si la misma sigue 'aprobada', no volvió a borrador aunque el día de antes
 * dijera que se iba a recuadrar (alguien la trabó entre abrir y guardar).
 */
export function avisoDelGuardado(
  antes: Recepcion | null | undefined,
  despues: Recepcion | null = null,
): string | null {
  const devueltas = despues?.liquidaciones_devueltas_a_borrador;
  if (devueltas) {
    // El recálculo de un borrador no entra en la lista (no vuelve a ningún lado): eso se
    // sigue deduciendo del día de antes, y solo si no volvió ninguna.
    return avisoDeLasDevueltas(devueltas) ?? (antes ? avisoDelRecalculo(antes) : null);
  }
  if (!antes) return null;
  const volvieron = tocadas(antes, despues).filter(
    (plata) =>
      plata.estado === 'aprobada' &&
      !(despues && plata.idDespues === plata.id && plata.estadoDespues === 'aprobada'),
  );
  if (volvieron.length === 2) return AMBAS_VOLVIERON;
  if (volvieron.length === 1) return volvioUna(volvieron[0].cual);
  return avisoDelRecalculo(antes);
}

const AMBAS_VOLVIERON =
  'Las liquidaciones de la leche y del flete de este día volvieron a borrador: ' +
  'revíselas y apruébelas otra vez.';

const volvioUna = (cual: string): string =>
  `La liquidación ${cual} de este día volvió a borrador: revísela y apruébela otra vez.`;

/** Las liquidaciones del día que el guardado recuadra: las que no están en firme. */
function tocadas(antes: Recepcion, despues: Recepcion | null = null): PlataDelDia[] {
  const platas: PlataDelDia[] = [
    {
      cual: 'de la leche',
      estado: antes.liquidacion_estado_leche,
      trabada: antes.leche_pagada,
      id: antes.liquidacion_id,
      idDespues: despues?.liquidacion_id,
      estadoDespues: despues?.liquidacion_estado_leche,
    },
    {
      cual: 'del flete',
      estado: antes.liquidacion_estado_flete,
      trabada: antes.flete_pagado,
      id: antes.liquidacion_transporte_id,
      idDespues: despues?.liquidacion_transporte_id,
      estadoDespues: despues?.liquidacion_estado_flete,
    },
  ];
  return platas.filter((plata) => !plata.trabada);
}

function avisoDelRecalculo(antes: Recepcion): string | null {
  const recalculadas = tocadas(antes).filter((plata) => plata.estado === 'borrador');
  if (recalculadas.length === 2) return 'Se recalcularon las dos liquidaciones de este día.';
  if (recalculadas.length === 1) return 'Se recalculó la liquidación de este día.';
  return null;
}

/**
 * El aviso armado con la lista del servidor. `tipo` es el de la liquidación: 'proveedor'
 * es la de la leche y 'transportador' la del flete. Puede haber dos del flete —la que el
 * día deja y la que el día entra al cambiarle el transportador—, y se cuentan las dos.
 */
function avisoDeLasDevueltas(devueltas: LiquidacionDevueltaABorrador[]): string | null {
  const unicas = [...new Map(devueltas.map((l) => [l.id, l])).values()];
  if (unicas.length === 0) return null;
  const flete = unicas.filter((l) => l.tipo === 'transportador').length;
  const leche = unicas.length - flete;
  if (unicas.length === 1) return volvioUna(flete ? 'del flete' : 'de la leche');
  if (leche === 1 && flete === 1) return AMBAS_VOLVIERON;
  const partes = [leche ? `${leche} de la leche` : '', flete ? `${flete} del flete` : ''];
  return (
    `Volvieron a borrador ${unicas.length} liquidaciones de este día ` +
    `(${partes.filter((parte) => parte !== '').join(' y ')}): revíselas y apruébelas otra vez.`
  );
}
