import { Recepcion } from '../../core/models';
import { avisoDelGuardado } from './aviso-del-guardado';

/**
 * EL AVISO DESPUÉS DE GUARDAR UN DÍA SOLO DICE LO QUE PASÓ DE VERDAD.
 *
 * La regla es la del backend: `RecepcionService._recuadrar` se salta la liquidación que
 * `_traba_el_dia` deja en firme (`leche_pagada` / `flete_pagado`) y recuadra las demás, y
 * `recuadrar` devuelve a borrador toda aprobada que toca. Y si hay respuesta del PUT,
 * manda su estado de después.
 */

const dia = (c: Partial<Recepcion>): Recepcion =>
  ({
    id: 'r-1',
    liquidacion_id: 'l-leche',
    liquidacion_transporte_id: null,
    liquidacion_estado: 'aprobada',
    liquidacion_estado_leche: 'aprobada',
    liquidacion_estado_flete: null,
    leche_pagada: false,
    flete_pagado: false,
    candado_aviso: null,
    ...c,
  }) as Recepcion;

const VOLVIO_LA_LECHE =
  'La liquidación de la leche de este día volvió a borrador: revísela y apruébela otra vez.';

describe('avisoDelGuardado', () => {
  it('el día de Beto: aprobada con la deuda ya cobrada, solo se tocaron las observaciones', () => {
    // El PUT da 200, la liquidación sigue aprobada: no hay nada que avisar.
    const antes = dia({ leche_pagada: true, candado_aviso: 'Lo que Beto Cobrada quedó…' });
    const despues = dia({ leche_pagada: true, observaciones: 'corregido' });

    expect(avisoDelGuardado(antes, despues)).toBeNull();
    // Y sin la respuesta, la regla del backend dice lo mismo: esa se la salta.
    expect(avisoDelGuardado(antes)).toBeNull();
  });

  it('aprobada sin nada trabado: vuelve a borrador, y la respuesta lo confirma', () => {
    const antes = dia({});
    const despues = dia({ liquidacion_estado: 'borrador', liquidacion_estado_leche: 'borrador' });

    expect(avisoDelGuardado(antes, despues)).toBe(VOLVIO_LA_LECHE);
    // Al borrar no hay respuesta: el backend solo deja borrar si nada está trabado.
    expect(avisoDelGuardado(antes, null)).toBe(VOLVIO_LA_LECHE);
  });

  it('si la respuesta dice que sigue aprobada, no se dice que volvió', () => {
    // Alguien la trabó entre abrir el día y guardarlo: el recuadre se la saltó.
    expect(avisoDelGuardado(dia({}), dia({ leche_pagada: true }))).toBeNull();
  });

  it('el día que se sale de la quincena también la devuelve a borrador', () => {
    // Otra fecha fuera del período: el día queda suelto y la de antes se recuadra sin él.
    const despues = dia({
      liquidacion_id: null,
      liquidacion_estado: null,
      liquidacion_estado_leche: null,
    });
    expect(avisoDelGuardado(dia({}), despues)).toBe(VOLVIO_LA_LECHE);
  });

  it('nombra cuál de las dos, y las dos cuando son las dos', () => {
    const conFlete = {
      liquidacion_transporte_id: 'l-flete',
      liquidacion_estado_flete: 'aprobada' as const,
    };
    // La leche pagada (se la salta) y el flete aprobado: vuelve el del flete.
    expect(avisoDelGuardado(dia({ ...conFlete, leche_pagada: true }))).toBe(
      'La liquidación del flete de este día volvió a borrador: revísela y apruébela otra vez.',
    );
    expect(avisoDelGuardado(dia(conFlete))).toBe(
      'Las liquidaciones de la leche y del flete de este día volvieron a borrador: revíselas ' +
        'y apruébelas otra vez.',
    );
  });

  it('en borrador se recalcula, salvo que esté trabada', () => {
    const borrador = { liquidacion_estado: 'borrador' as const, liquidacion_estado_leche: 'borrador' as const };
    expect(avisoDelGuardado(dia(borrador))).toBe('Se recalculó la liquidación de este día.');
    // El borrador cuya deuda ya se cobró en otra también queda en firme: no se recalcula.
    expect(avisoDelGuardado(dia({ ...borrador, leche_pagada: true }))).toBeNull();
  });

  // -------------------------------------------------------------------------------
  // CON `liquidaciones_devueltas_a_borrador` EN LA RESPUESTA, ESO ES EL HECHO.
  // -------------------------------------------------------------------------------
  it('el día que ENTRA en un comprobante del flete ya aprobado: la lista lo dice y el aviso lo nombra', () => {
    // La leche pagada (no se toca) y el flete sin liquidar. El PUT le cambia el
    // transportador a uno cuyo viaje de ese día ya está en el comprobante F2, aprobado:
    // el día entra ahí y F2 vuelve a borrador. Desde el día de antes no se veía.
    const antes = dia({
      liquidacion_estado: 'pagada',
      liquidacion_estado_leche: 'pagada',
      leche_pagada: true,
    });
    const despues = dia({
      liquidacion_estado: 'pagada',
      liquidacion_estado_leche: 'pagada',
      liquidacion_estado_flete: 'borrador',
      liquidacion_transporte_id: 'l-f2',
      leche_pagada: true,
      liquidaciones_devueltas_a_borrador: [{ id: 'l-f2', tipo: 'transportador' }],
    });

    expect(avisoDelGuardado(antes, despues)).toBe(
      'La liquidación del flete de este día volvió a borrador: revísela y apruébela otra vez.',
    );
    // Sin el campo (una respuesta vieja) no hay cómo saberlo, y no se inventa.
    const vieja: Recepcion = { ...despues };
    delete vieja.liquidaciones_devueltas_a_borrador;
    expect(avisoDelGuardado(antes, vieja)).toBeNull();
  });

  it('con la lista vacía no se dice que volvió, aunque el día de antes lo hiciera creer', () => {
    // Aprobada sin nada trabado: la deducción diría "volvió a borrador"; el servidor dice
    // que ninguna volvió, y manda él.
    const despues = dia({ liquidaciones_devueltas_a_borrador: [] });

    expect(avisoDelGuardado(dia({}), despues)).toBeNull();
    // Un borrador sí se recalculó: eso no va en la lista y se sigue diciendo.
    const borrador = {
      liquidacion_estado: 'borrador' as const,
      liquidacion_estado_leche: 'borrador' as const,
    };
    expect(
      avisoDelGuardado(dia(borrador), dia({ ...borrador, liquidaciones_devueltas_a_borrador: [] })),
    ).toBe('Se recalculó la liquidación de este día.');
  });

  it('un día NUEVO que cae en una quincena aprobada: sin día de antes, la lista basta', () => {
    const creado = dia({
      liquidaciones_devueltas_a_borrador: [{ id: 'l-leche', tipo: 'proveedor' }],
    });

    expect(avisoDelGuardado(undefined, creado)).toBe(VOLVIO_LA_LECHE);
  });

  it('la que deja y la que entra, las dos del flete: se cuentan las dos', () => {
    const despues = dia({
      liquidaciones_devueltas_a_borrador: [
        { id: 'l-f1', tipo: 'transportador' },
        { id: 'l-f2', tipo: 'transportador' },
      ],
    });

    expect(avisoDelGuardado(dia({}), despues)).toBe(
      'Volvieron a borrador 2 liquidaciones de este día (2 del flete): revíselas y ' +
        'apruébelas otra vez.',
    );
    // Y la leche con el flete, con la frase de siempre.
    expect(
      avisoDelGuardado(
        dia({}),
        dia({
          liquidaciones_devueltas_a_borrador: [
            { id: 'l-leche', tipo: 'proveedor' },
            { id: 'l-f2', tipo: 'transportador' },
          ],
        }),
      ),
    ).toBe(
      'Las liquidaciones de la leche y del flete de este día volvieron a borrador: revíselas ' +
        'y apruébelas otra vez.',
    );
  });

  it('un día nuevo o suelto no tiene liquidación que avisar', () => {
    expect(avisoDelGuardado(undefined, dia({}))).toBeNull();
    expect(
      avisoDelGuardado(
        dia({ liquidacion_id: null, liquidacion_estado: null, liquidacion_estado_leche: null }),
      ),
    ).toBeNull();
  });
});
