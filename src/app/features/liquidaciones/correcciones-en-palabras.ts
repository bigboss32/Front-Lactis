import { Monto } from '../../core/models';
import { comoFecha, enHoraDeColombia } from '../../shared/date-utils';
import { CantidadPipe, pesosExactos } from '../../shared/pipes';
import { AnticipoCambiadoEnCorreccion, Correccion } from './liquidaciones.service';

/**
 * LAS CORRECCIONES DE UNA QUINCENA, DICHAS COMO LAS DICE EL DUEÑO.
 *
 * Por qué vive en su propio archivo y no dentro del diálogo del detalle: ESTAS FRASES
 * TIENEN UN GEMELO EN EL PAPEL. La letra chica del comprobante en PDF
 * (`_notas_de_la_correccion`, en el backend) dice exactamente esto mismo, y el dueño
 * pone las dos hojas sobre la mesa al lado de la pantalla para emparejarlas. Si la
 * pantalla dijera "se quitó un anticipo" donde el papel dice "el adelanto del 05/06/2026
 * ya NO se descuenta en esta quincena", el productor y el dueño estarían leyendo dos
 * documentos distintos del mismo hecho. Separadas del diálogo, estas frases se prueban
 * solas y se pueden comparar renglón por renglón con las del backend.
 *
 * El vocabulario es el de la quesera y no el de la base de datos: "adelanto" (nunca
 * "anticipo_id"), "lo que hay que entregarle" (nunca "neto"), "el día del 12/06/2026"
 * (nunca "detalle agregado").
 */

/** Cuando el servidor no guardó quién corrigió. No se inventa un nombre. */
export const SIN_NOMBRE = 'no quedó anotado quién';

/** Cuando la corrección no trae ningún desglose: movió cifras y nada más. */
export const SIN_DESGLOSE = 'se corrigieron las cifras';

/**
 * UNA CIFRA QUE LA CORRECCIÓN MOVIÓ, con las dos puntas.
 *
 * Los montos van CRUDOS (como llegan del backend) y no formateados: los pinta la
 * plantilla con el pipe `money`, que es el mismo formateador del resumen de abajo. Si
 * acá se formatearan a mano, esta pantalla podría terminar diciendo "$ 1.250,5" donde
 * el resumen dice "$ 1.250,50".
 */
export interface CifraDeLaCorreccion {
  etiqueta: string;
  antes: Monto;
  despues: Monto;
}

/** Una corrección ya lista para leerse en pantalla. */
export interface RenglonDeCorreccion {
  id: string;
  /** El número que aparece en el folio del papel: v2, v3… */
  version: number;
  /** '06/09/2026 10:04', en hora de Colombia (ver `enHoraDeColombia`). */
  cuando: string;
  /** El nombre de quien corrigió, o `SIN_NOMBRE`. */
  quien: string;
  motivo: string;
  /** Qué cambió, en frases: un día que entró, un precio que se movió, un adelanto. */
  cambios: string[];
  /** Las cifras que DE VERDAD se movieron. Ver `cifrasQueSeMovieron`. */
  cifras: CifraDeLaCorreccion[];
  /**
   * Ninguna de las cifras del comprobante se movió.
   *
   * Pasa de verdad: corregirle el valor a un adelanto que en esa misma corrección SALE
   * de la quincena no mueve un peso de este papel —el adelanto se va— pero sí queda
   * escrito, porque la quincena siguiente va a descontar la cifra corregida. Sin esta
   * marca, el renglón mostraría dos cifras iguales y se leería como un error.
   */
  sinMovimiento: boolean;
  /**
   * Las correcciones VIEJAS no anotaron cuánto sumaban los adelantos (la operación de
   * moverlos es posterior). Cuando esa corrección sí tocó un adelanto, el renglón lo
   * dice con todas sus letras en vez de mostrar un cero: un cero ahí afirmaría que no
   * había ningún adelanto descontado, y eso sería inventar plata.
   */
  notaAdelantos: string | null;
}

const litrosPipe = new CantidadPipe();

/** Los litros como los pinta la tabla del detalle: dos decimales y la unidad. */
const enLitros = (valor: Monto): string => litrosPipe.transform(valor, 'L', 2);

/** Una cifra puede llegar en texto (Decimal del backend) o no llegar. */
const numero = (valor: Monto | null | undefined): number => Number(valor ?? 0);

/** La cifra existe de verdad: null y undefined significan "no se sabe", no cero. */
const hayCifra = (valor: Monto | null | undefined): boolean =>
  valor !== null && valor !== undefined && valor !== '';

/**
 * QUÉ CAMBIÓ, en frases y no en JSON.
 *
 * Son las mismas frases del papel, en el mismo orden (días, precios, adelantos): el
 * dueño lee el renglón de la pantalla y la letra chica del comprobante y tienen que
 * decir lo mismo.
 */
export function cambiosDeLaCorreccion(correccion: Correccion): string[] {
  const frases: string[] = [];

  for (const dia of correccion.dias_agregados ?? []) {
    frases.push(
      `entró el día del ${comoFecha(dia.fecha)} (${enLitros(dia.litros)} a ` +
        `${pesosExactos(dia.precio_litro)} = ${pesosExactos(dia.valor)})`,
    );
  }

  for (const precio of correccion.precios_corregidos ?? []) {
    frases.push(
      `el día del ${comoFecha(precio.fecha)} pasó de ${pesosExactos(precio.precio_antes)} a ` +
        `${pesosExactos(precio.precio_despues)} el litro`,
    );
  }

  for (const adelanto of correccion.anticipos_cambiados ?? []) {
    frases.push(fraseDelAdelanto(adelanto));
  }

  return frases;
}

/**
 * UN ADELANTO QUE SE MOVIÓ, dicho con la diferencia que importa.
 *
 * SACAR y ANULAR se parecen en la pantalla y NO son lo mismo en la plata del productor:
 * el que sale sigue vivo y se le descuenta en la quincena siguiente; el anulado nunca
 * existió y no se le descuenta en ninguna. Es la misma distinción que el diálogo de
 * corregir le hace confirmar al dueño antes de guardar, y el papel la imprime con estas
 * palabras: acá se repiten literalmente para que las dos hojas se puedan emparejar.
 */
function fraseDelAdelanto(adelanto: AnticipoCambiadoEnCorreccion): string {
  const fecha = comoFecha(adelanto.fecha);
  const valor = pesosExactos(adelanto.valor);
  switch (adelanto.accion) {
    case 'entro':
      return `se le descontó el adelanto del ${fecha} (${valor})`;
    case 'salio':
      return (
        `el adelanto del ${fecha} (${valor}) ya NO se descuenta en esta quincena: ` +
        'se le descuenta en la siguiente'
      );
    case 'borrado':
      return (
        `el adelanto del ${fecha} (${valor}) se ANULÓ: no existió, y no se le descuenta ` +
        'en ninguna quincena'
      );
    default:
      // El valor de antes puede faltar en un renglón viejo: ahí no se puede decir "pasó
      // de" sin inventarse la cifra de la que venía.
      return hayCifra(adelanto.valor_antes)
        ? `el adelanto del ${fecha} pasó de ${pesosExactos(adelanto.valor_antes)} a ${valor}`
        : `el adelanto del ${fecha} quedó en ${valor}`;
  }
}

/**
 * LAS CIFRAS QUE DE VERDAD SE MOVIERON, y solo esas.
 *
 * ESTE FUE UN DEFECTO DEL PAPEL Y NO SE PUEDE REPETIR EN LA PANTALLA: el comprobante
 * cerraba siempre con "el VALOR TOTAL pasó de X a Y", y en una corrección de PURO
 * ADELANTO el valor total no se mueve —lo que cambia es el descuento—, así que el papel
 * decía "pasó de $500.000 a $500.000" y se callaba los $150.000 que sí cambiaron. Justo
 * la cifra por la que el productor va a reclamar.
 *
 * Por eso se miran las tres y se muestran las que se movieron: si cambiaron dos, salen
 * las dos, porque el dueño suma la columna de arriba abajo y necesita las dos puntas.
 */
export function cifrasQueSeMovieron(correccion: Correccion): CifraDeLaCorreccion[] {
  const cifras: CifraDeLaCorreccion[] = [];

  if (numero(correccion.valor_total_antes) !== numero(correccion.valor_total_despues)) {
    cifras.push({
      etiqueta: 'Valor total',
      antes: correccion.valor_total_antes,
      despues: correccion.valor_total_despues,
    });
  }

  // Los adelantos solo se pueden comparar cuando las DOS cifras están anotadas. Con una
  // en nulo, la resta contra cero diría que el adelanto entró completo desde cero, que
  // es una afirmación sobre plata del productor que nadie hizo. Ver `notaAdelantos`.
  if (hayCifra(correccion.anticipos_antes) && hayCifra(correccion.anticipos_despues)) {
    if (numero(correccion.anticipos_antes) !== numero(correccion.anticipos_despues)) {
      cifras.push({
        etiqueta: 'Adelantos descontados',
        antes: correccion.anticipos_antes as Monto,
        despues: correccion.anticipos_despues as Monto,
      });
    }
  }

  if (numero(correccion.neto_antes) !== numero(correccion.neto_despues)) {
    cifras.push({
      etiqueta: 'Lo que hay que entregarle',
      antes: correccion.neto_antes,
      despues: correccion.neto_despues,
    });
  }

  return cifras;
}

/**
 * LAS CORRECCIONES, DE LA MÁS VIEJA A LA MÁS NUEVA.
 *
 * POR QUÉ EN ESE ORDEN Y NO AL REVÉS: porque es el orden del papel. La letra chica del
 * comprobante imprime v2, después v3, y el productor puede llegar con CUALQUIERA de las
 * hojas; para emparejar la que le muestran, el dueño recorre la lista de la pantalla
 * contra la del papel, y dos listas iguales en orden contrario se cuadran mal. Además la
 * historia se lee como se vivió —"esta quincena valía $500.000; entró un día y pasó a
 * $680.000; después se le descontó un adelanto"— y cada renglón arranca donde terminó el
 * anterior: al revés, el "antes" de arriba es el "después" del de abajo y la cadena se
 * lee saltando.
 *
 * La lista llega ya ordenada así del backend (`correcciones_de`); esta función NO la
 * reordena, solo la traduce. Si el servidor cambiara el orden, el papel cambiaría con
 * él y las dos seguirían iguales.
 */
export function renglonesDeCorrecciones(correcciones: Correccion[]): RenglonDeCorreccion[] {
  return correcciones.map((correccion) => {
    const cambios = cambiosDeLaCorreccion(correccion);
    const cifras = cifrasQueSeMovieron(correccion);
    const tocóAdelantos = (correccion.anticipos_cambiados ?? []).length > 0;
    const sinAnotar =
      !hayCifra(correccion.anticipos_antes) || !hayCifra(correccion.anticipos_despues);
    return {
      id: correccion.id,
      version: Number(correccion.version_nueva ?? 0),
      cuando: enHoraDeColombia(correccion.created_at),
      quien: correccion.corregido_por_nombre?.trim() || SIN_NOMBRE,
      motivo: correccion.motivo,
      cambios: cambios.length ? cambios : [SIN_DESGLOSE],
      cifras,
      sinMovimiento: cifras.length === 0,
      notaAdelantos:
        tocóAdelantos && sinAnotar
          ? 'De esta corrección no quedó anotado cuánto sumaban los adelantos antes y después.'
          : null,
    };
  });
}
