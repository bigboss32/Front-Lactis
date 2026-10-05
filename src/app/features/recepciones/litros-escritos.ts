/**
 * LOS LITROS ESCRITOS A MANO EN UNA CELDA DE LA GRILLA, y cómo se vuelven a escribir.
 *
 * La celda de la grilla es un campo de texto: se teclea o se escribe con el lápiz digital (el
 * de la tablet) y quien lo reconoce entrega TEXTO, no un número. Un número mal leído es leche
 * mal anotada y una liquidación que se mueve, así que la regla es estricta y conocida (la
 * misma de `precioTecleado` para el dinero): LA COMA ES EL DECIMAL y el punto, solo cuando
 * separa miles de a tres cifras.
 *
 *   "52"      → 52          "52,5"   → 52,5       "52.5"   → 52,5  (un punto con 1 o 2 cifras
 *   "1.500"   → 1500        "1.500,5"→ 1500,5                       después es un decimal)
 *   "52 L"    → 52          "  52 "  → 52
 *   "1,500"   → NO: es ambiguo (¿mil quinientos o uno con cinco?) y no se adivina.
 *   "52,125"  → NO: el litro se guarda con dos decimales como máximo.
 *   "52.125"  → 52125: tres cifras tras el punto son miles, como en todo el sistema.
 *
 * Los litros se guardan con dos decimales (Numeric(12, 2)): lo que lleva más no se acepta, no
 * se redondea en silencio.
 */
export type LecturaDeLitros =
  | { tipo: 'litros'; valor: number }
  /** Nada escrito (o solo la unidad). Quien llama decide qué significa. */
  | { tipo: 'vacio' }
  | { tipo: 'invalido'; motivo: string };

/** El techo de la columna: Numeric(12, 2) deja 10 cifras enteras. */
const TOPE = 10_000_000_000;

// El primer grupo no empieza en 0: "0.500" no es quinientos litros (y se rechaza por ambiguo).
const CON_MILES = /^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d{1,2})?$/;
// Con espacios entre los grupos de miles ("1 500"): solo así. "52 5" no es 525.
const CON_ESPACIOS = /^[1-9]\d{0,2}(?:[\s  ]\d{3})+(?:,\d{1,2})?$/;
const SIMPLE = /^\d+(?:[.,]\d{1,2})?$/;
const CON_MAS_DECIMALES = /^\d+[.,]\d{3,}$/;

export function leerLitros(texto: string | null | undefined): LecturaDeLitros {
  const original = (texto ?? '').trim();
  // La unidad al final: "52 litros", "52 lts", "52 L", "52 l". La "l" minúscula pegada ("5l")
  // NO se acepta: un reconocedor de escritura que lee mal un 1 la deja así y sería otro número.
  let limpio = original
    .replace(/\s*(?:litros?|lts?)\.?$/i, '')
    .replace(/(?:\s*L|\s+l)\.?$/, '')
    .trim();
  // Los espacios solo valen como separador de miles ("1 500"); entre cifras sueltas ("52 5")
  // juntarlos daba 525.
  if (/[\s  ]/.test(limpio)) {
    if (!CON_ESPACIOS.test(limpio)) {
      return {
        tipo: 'invalido',
        motivo: `«${original}» no son litros: escriba solo el número, por ejemplo 52 o 52,5`,
      };
    }
    limpio = limpio.replace(/[\s  ]+/g, '');
  }
  if (limpio === '') return { tipo: 'vacio' };

  let numero: number;
  if (CON_MILES.test(limpio)) {
    numero = Number(limpio.replace(/\./g, '').replace(',', '.'));
  } else if (SIMPLE.test(limpio)) {
    numero = Number(limpio.replace(',', '.'));
  } else if (CON_MAS_DECIMALES.test(limpio)) {
    return {
      tipo: 'invalido',
      motivo:
        `«${original}» no se entiende como litros: llevan máximo 2 decimales, con coma ` +
        '(52,5), y los miles se separan con punto (1.500)',
    };
  } else {
    return {
      tipo: 'invalido',
      motivo: `«${original}» no son litros: escriba solo el número, por ejemplo 52 o 52,5`,
    };
  }

  if (!Number.isFinite(numero)) {
    return { tipo: 'invalido', motivo: `«${original}» no son litros` };
  }
  if (numero <= 0) {
    return { tipo: 'invalido', motivo: 'Los litros tienen que ser más de 0' };
  }
  if (numero >= TOPE) {
    return { tipo: 'invalido', motivo: `«${original}» es demasiado grande para unos litros` };
  }
  return { tipo: 'litros', valor: numero };
}

/**
 * Los litros como se escriben en la celda: coma decimal, SIN separador de miles (se edita, no
 * se lee en una columna) y sin ceros que sobran: "166.00" → "166", "52.50" → "52,5".
 * `''` si no hay litros que escribir.
 *
 * Es la inversa de `leerLitros`: lo que sale de acá se vuelve a leer igual.
 */
export function litrosComoSeEscriben(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '';
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '';
  return String(Math.round(numero * 100) / 100).replace('.', ',');
}
