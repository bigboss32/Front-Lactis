import { leerLitros, litrosComoSeEscriben } from './litros-escritos';

/**
 * LOS LITROS QUE SE ESCRIBEN EN LA CELDA (con el teclado o con el lápiz digital) LLEGAN COMO
 * TEXTO. Un número mal leído es leche mal anotada, así que lo que se acepta es corto y
 * conocido, y lo ambiguo se rechaza en vez de adivinarse.
 */
const valor = (texto: string): number | string => {
  const lectura = leerLitros(texto);
  return lectura.tipo === 'litros' ? lectura.valor : lectura.tipo === 'vacio' ? 'vacío' : lectura.motivo;
};

describe('leerLitros: lo que se acepta', () => {
  it('un entero', () => {
    expect(valor('52')).toBe(52);
    expect(valor('  166 ')).toBe(166);
    expect(valor('007')).toBe(7);
  });

  it('decimales con coma, y con punto cuando tiene 1 o 2 cifras', () => {
    expect(valor('52,5')).toBe(52.5);
    expect(valor('52,25')).toBe(52.25);
    expect(valor('52.5')).toBe(52.5);
    expect(valor('52.25')).toBe(52.25);
    expect(valor('0,5')).toBe(0.5);
  });

  it('el punto de a tres cifras son miles, como en todo el sistema', () => {
    expect(valor('1.500')).toBe(1500);
    expect(valor('1.500,5')).toBe(1500.5);
    expect(valor('12.345.678')).toBe(12345678);
    expect(valor('52.125')).toBe(52125);
  });

  it('con la unidad pegada o suelta, y con los espacios que mete el reconocedor del lápiz', () => {
    expect(valor('52 L')).toBe(52);
    expect(valor('52L')).toBe(52);
    expect(valor('52 l')).toBe(52);
    expect(valor('52 lts')).toBe(52);
    expect(valor('52 Litros')).toBe(52);
    expect(valor('1 500')).toBe(1500);
    expect(valor('1 500,5 L')).toBe(1500.5);
    expect(valor('52 L')).toBe(52);
  });

  it('la unidad "litros" o "lts" también puede ir pegada al número ("52lts", "52litros", "1.500litros")', () => {
    expect(valor('52lts')).toBe(52);
    expect(valor('52litros')).toBe(52);
    expect(valor('1.500litros')).toBe(1500);
  });

  it('la unidad con punto final ("52 lts.", "52 L.", "1.500 litros.") también se lee', () => {
    expect(valor('52 lts.')).toBe(52);
    expect(valor('52 L.')).toBe(52);
    expect(valor('1.500 litros.')).toBe(1500);
  });
});

describe('leerLitros: lo que NO se acepta', () => {
  it('nada escrito, o solo la unidad, es vacío (quien llama decide)', () => {
    expect(valor('')).toBe('vacío');
    expect(valor('   ')).toBe('vacío');
    expect(valor('L')).toBe('vacío');
    expect(leerLitros(null).tipo).toBe('vacio');
    expect(leerLitros(undefined).tipo).toBe('vacio');
  });

  it('cero y negativos: los litros tienen que ser más de 0', () => {
    expect(valor('0')).toBe('Los litros tienen que ser más de 0');
    expect(valor('0,00')).toBe('Los litros tienen que ser más de 0');
    expect(valor('-5')).toContain('no son litros');
  });

  it('lo ambiguo no se adivina: "1,500" y más de dos decimales', () => {
    expect(valor('1,500')).toContain('llevan máximo 2 decimales');
    expect(valor('52,125')).toContain('llevan máximo 2 decimales');
    expect(valor('52.1234')).toContain('llevan máximo 2 decimales');
  });

  it('con miles también son dos decimales como máximo: "1.500,555" no se acepta ni se redondea', () => {
    expect(leerLitros('1.500,555').tipo).toBe('invalido');
    expect(leerLitros('1.500,5').tipo).toBe('litros');
    expect(leerLitros('1.500,55').tipo).toBe('litros');
  });

  it('"0.500" no es quinientos litros: el primer grupo de miles no empieza en 0', () => {
    expect(valor('0.500')).toContain('llevan máximo 2 decimales');
    expect(valor('0,5')).toBe(0.5);
  });

  it('los espacios solo separan miles: "52 5" no se lee como 525', () => {
    expect(valor('52 5')).toContain('no son litros');
    expect(valor('5 2 5')).toContain('no son litros');
    expect(valor('1 5 00')).toContain('no son litros');
    expect(valor('12 34')).toContain('no son litros');
    expect(valor('1 500')).toBe(1500);
    expect(valor('12 345')).toBe(12345);
  });

  it('con espacios, el primer grupo de miles tampoco empieza en 0: "0 500" no es quinientos litros', () => {
    expect(valor('0 500')).toContain('no son litros');
    expect(valor('012 345')).toContain('no son litros');
    expect(valor('1 500')).toBe(1500);
  });

  it('la "l" minúscula pegada ("5l") no se acepta: puede ser un 1 mal leído por el lápiz', () => {
    expect(valor('5l')).toContain('no son litros');
    expect(valor('52l')).toContain('no son litros');
  });

  it('texto que no es un número', () => {
    expect(valor('abc')).toBe('«abc» no son litros: escriba solo el número, por ejemplo 52 o 52,5');
    expect(valor('5a2')).toContain('no son litros');
    expect(valor('1e3')).toContain('no son litros');
    expect(valor('.5')).toContain('no son litros');
    expect(valor('5.')).toContain('no son litros');
    expect(valor('5,,5')).toContain('no son litros');
    expect(valor('$ 52')).toContain('no son litros');
  });

  it('demasiado grande para la columna (10 cifras enteras)', () => {
    expect(valor('9999999999')).toBe(9999999999);
    expect(valor('10000000000')).toContain('demasiado grande');
  });
});

describe('litrosComoSeEscriben: la inversa', () => {
  it('coma decimal, sin miles y sin ceros que sobran', () => {
    expect(litrosComoSeEscriben('166.00')).toBe('166');
    expect(litrosComoSeEscriben('52.50')).toBe('52,5');
    expect(litrosComoSeEscriben('52.25')).toBe('52,25');
    expect(litrosComoSeEscriben(1446)).toBe('1446');
    expect(litrosComoSeEscriben('1500.5')).toBe('1500,5');
  });

  it('sin litros no hay nada que escribir', () => {
    expect(litrosComoSeEscriben(null)).toBe('');
    expect(litrosComoSeEscriben(undefined)).toBe('');
    expect(litrosComoSeEscriben('')).toBe('');
    expect(litrosComoSeEscriben('abc')).toBe('');
  });

  it('lo que sale se vuelve a leer igual (ida y vuelta)', () => {
    for (const litros of ['166.00', '52.50', '0.25', '1500.5', '81.99', '9999.99', '1.00']) {
      const lectura = leerLitros(litrosComoSeEscriben(litros));
      expect(lectura).toEqual({ tipo: 'litros', valor: Number(litros) });
    }
  });
});
