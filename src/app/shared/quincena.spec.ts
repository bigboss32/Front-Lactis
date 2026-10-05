import {
  diasDeLaQuincena,
  etiquetaDelMes,
  mesVecino,
  quincenaDeLaFecha,
  quincenaExacta,
  rangoQuincena,
} from './quincena';

/**
 * LA QUINCENA, CON LAS FECHAS DE VERDAD: la 1.ª es del 1 al 15 y la 2.ª del 16 a fin de mes,
 * sea de 28, 29, 30 o 31 días. Es la cuenta que usan Generar liquidaciones y el filtro del
 * listado; si una de las dos se corriera un día, el listado mostraría otra quincena de la
 * que se acaba de liquidar.
 */
describe('quincena: las fechas de cada una', () => {
  it('septiembre: 1 al 15 y 16 al 30', () => {
    expect(rangoQuincena(2026, 8, 1)).toEqual({ inicio: '2026-09-01', fin: '2026-09-15' });
    expect(rangoQuincena(2026, 8, 2)).toEqual({ inicio: '2026-09-16', fin: '2026-09-30' });
  });

  it('octubre llega al 31', () => {
    expect(rangoQuincena(2026, 9, 2)).toEqual({ inicio: '2026-10-16', fin: '2026-10-31' });
  });

  it('febrero: 28 días en 2026 y 29 en 2028 (bisiesto)', () => {
    expect(rangoQuincena(2026, 1, 2).fin).toBe('2026-02-28');
    expect(rangoQuincena(2028, 1, 2).fin).toBe('2028-02-29');
  });

  it('un mes fuera de 0–11 pasa al año vecino: la 2.ª "de mes −1" de enero es de diciembre', () => {
    expect(rangoQuincena(2026, -1, 2)).toEqual({ inicio: '2025-12-16', fin: '2025-12-31' });
    expect(rangoQuincena(2026, 12, 1)).toEqual({ inicio: '2027-01-01', fin: '2027-01-15' });
  });

  it('"días X al Y" sale de las mismas fechas', () => {
    expect(diasDeLaQuincena(2026, 8, 1)).toBe('1 al 15');
    expect(diasDeLaQuincena(2026, 8, 2)).toBe('16 al 30');
    expect(diasDeLaQuincena(2026, 9, 2)).toBe('16 al 31');
    expect(diasDeLaQuincena(2026, 1, 2)).toBe('16 al 28');
    expect(diasDeLaQuincena(2028, 1, 2)).toBe('16 al 29');
  });
});

describe('quincena: el mes', () => {
  it('se nombra con su año', () => {
    expect(etiquetaDelMes({ anio: 2026, mes: 8 })).toBe('septiembre 2026');
  });

  it('el vecino cruza el año en los dos sentidos', () => {
    expect(mesVecino({ anio: 2026, mes: 11 }, 1)).toEqual({ anio: 2027, mes: 0 });
    expect(mesVecino({ anio: 2026, mes: 0 }, -1)).toEqual({ anio: 2025, mes: 11 });
    expect(mesVecino({ anio: 2026, mes: 8 }, -1)).toEqual({ anio: 2026, mes: 7 });
    expect(mesVecino({ anio: 2026, mes: 8 }, 0)).toEqual({ anio: 2026, mes: 8 });
  });
});

describe('quincena: ¿estas fechas son justo una quincena?', () => {
  const dia = (anio: number, mes: number, d: number) => new Date(anio, mes, d);

  it('reconoce la 1.ª y la 2.ª de su mes', () => {
    expect(quincenaExacta(dia(2026, 8, 1), dia(2026, 8, 15))).toEqual({ anio: 2026, mes: 8, quincena: 1 });
    expect(quincenaExacta(dia(2026, 8, 16), dia(2026, 8, 30))).toEqual({ anio: 2026, mes: 8, quincena: 2 });
  });

  it('la 2.ª de febrero es hasta el 28, o hasta el 29 en bisiesto', () => {
    expect(quincenaExacta(dia(2026, 1, 16), dia(2026, 1, 28))).toEqual({ anio: 2026, mes: 1, quincena: 2 });
    expect(quincenaExacta(dia(2026, 1, 16), dia(2026, 1, 29))).toBeNull(); // 29/02/2026 no existe: es 1 de marzo
    expect(quincenaExacta(dia(2028, 1, 16), dia(2028, 1, 29))).toEqual({ anio: 2028, mes: 1, quincena: 2 });
  });

  it('un rango que se queda corto, se pasa o cruza de mes NO es una quincena', () => {
    expect(quincenaExacta(dia(2026, 8, 1), dia(2026, 8, 14))).toBeNull();
    expect(quincenaExacta(dia(2026, 8, 2), dia(2026, 8, 15))).toBeNull();
    expect(quincenaExacta(dia(2026, 8, 16), dia(2026, 8, 29))).toBeNull();
    expect(quincenaExacta(dia(2026, 8, 1), dia(2026, 9, 15))).toBeNull();
    expect(quincenaExacta(dia(2026, 8, 1), dia(2026, 8, 30))).toBeNull(); // el mes entero
  });

  it('con una fecha vacía o al revés no hay quincena', () => {
    expect(quincenaExacta(null, null)).toBeNull();
    expect(quincenaExacta(dia(2026, 8, 1), null)).toBeNull();
    expect(quincenaExacta(null, dia(2026, 8, 15))).toBeNull();
    expect(quincenaExacta(dia(2026, 8, 15), dia(2026, 8, 1))).toBeNull();
  });

  it('no le importa la hora del día', () => {
    expect(
      quincenaExacta(new Date(2026, 8, 1, 0, 0), new Date(2026, 8, 15, 23, 59)),
    ).toEqual({ anio: 2026, mes: 8, quincena: 1 });
  });
});

describe('quincena: la quincena de una fecha', () => {
  it('del 1 al 15 es la 1.ª y del 16 en adelante la 2.ª; el corte está entre el 15 y el 16', () => {
    expect(quincenaDeLaFecha(new Date(2026, 8, 1))).toEqual({ anio: 2026, mes: 8, quincena: 1 });
    expect(quincenaDeLaFecha(new Date(2026, 8, 15, 23, 59))).toEqual({ anio: 2026, mes: 8, quincena: 1 });
    expect(quincenaDeLaFecha(new Date(2026, 8, 16))).toEqual({ anio: 2026, mes: 8, quincena: 2 });
    expect(quincenaDeLaFecha(new Date(2026, 8, 30))).toEqual({ anio: 2026, mes: 8, quincena: 2 });
  });

  it('trae el año y el mes de la fecha, el mes contado desde 0 (enero = 0, diciembre = 11)', () => {
    expect(quincenaDeLaFecha(new Date(2027, 0, 1))).toEqual({ anio: 2027, mes: 0, quincena: 1 });
    expect(quincenaDeLaFecha(new Date(2026, 11, 31))).toEqual({ anio: 2026, mes: 11, quincena: 2 });
  });

  it('sin fecha es la de hoy', () => {
    expect(quincenaDeLaFecha()).toEqual(quincenaDeLaFecha(new Date()));
  });
});
