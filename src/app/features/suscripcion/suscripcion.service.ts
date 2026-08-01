import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom, timeout } from 'rxjs';

import { ApiService, ListOpts } from '../../core/api.service';
import {
  BancoPSE,
  FuentePago,
  Page,
  PagarPsePayload,
  PagoSuscripcion,
  ResultadoPagoSuscripcion,
  ResultadoPse,
  SuscripcionConfig,
  SuscripcionDetalle,
} from '../../core/models';

/**
 * Etiquetas legibles de los estados de la suscripción. El backend maneja
 * `por_vencer` (con guion bajo); el chip de estado colorea por la etiqueta.
 */
export const ETIQUETAS_ESTADO_SUSCRIPCION: Record<string, string> = {
  exenta: 'exenta',
  activa: 'activa',
  por_vencer: 'por vencer',
  gracia: 'gracia',
  bloqueada: 'bloqueada',
};

/** Ídem para el estado que Wompi le da a cada pago (viene en MAYÚSCULAS). */
export const ETIQUETAS_ESTADO_PAGO: Record<string, string> = {
  PENDING: 'pendiente',
  APPROVED: 'aprobado',
  DECLINED: 'rechazado',
  VOIDED: 'anulado',
  ERROR: 'error',
};

/** Con qué se pagó. Los pagos de antes de PSE vienen todos como 'CARD'. */
export const ETIQUETAS_METODO_PAGO: Record<string, string> = {
  CARD: 'tarjeta',
  PSE: 'PSE',
};

/** Y para el origen del cobro. */
export const ETIQUETAS_ORIGEN_PAGO: Record<string, string> = {
  manual: 'manual',
  automatico: 'automático',
  cron: 'programado',
};

/** Body de POST /suscripcion/fuente-pago (los dos tokens de aceptación de Wompi). */
export interface FuentePagoPayload {
  token: string;
  customer_email: string;
  acceptance_token: string;
  accept_personal_auth: string;
}

/** Datos que se tokenizan navegador→Wompi. El PAN JAMÁS pasa por nuestro backend. */
export interface DatosTarjeta {
  /** Solo dígitos, sin espacios. */
  numero: string;
  cvc: string;
  /** 'MM' */
  exp_mes: string;
  /** 'AA' (dos dígitos, como los pide Wompi). */
  exp_anio: string;
  titular: string;
}

/**
 * Error de la PASARELA (tokenización en Wompi), ya traducido a un mensaje
 * legible. Se distingue del HttpErrorResponse de nuestro backend para que el
 * diálogo muestre el mensaje de Wompi tal cual en vez del texto de respaldo.
 */
export class ErrorPasarela extends Error {}

/**
 * Techo de tiempo PROPIO para la llamada a Wompi: la petición va a una URL
 * externa y el interceptor no la instrumenta (ni token, ni timeout, ni
 * reintentos — ver la guarda `esApiPropia` de auth.interceptor.ts), así que
 * sin esto una tokenización con mala señal quedaría colgada para siempre.
 */
const MS_LIMITE_WOMPI = 30_000;

@Injectable({ providedIn: 'root' })
export class SuscripcionService {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);

  /** Estado completo de la suscripción de la empresa activa. */
  resumen(): Observable<SuscripcionDetalle> {
    return this.api.get<SuscripcionDetalle>('/suscripcion');
  }

  /** Historial de pagos (más recientes primero). */
  pagos(opts: ListOpts = {}): Observable<Page<PagoSuscripcion>> {
    return this.api.get<Page<PagoSuscripcion>>('/suscripcion/pagos', opts);
  }

  /** Llave pública y tokens de aceptación FRESCOS (son JWT con expiración). */
  config(): Observable<SuscripcionConfig> {
    return this.api.get<SuscripcionConfig>('/suscripcion/config');
  }

  /** Guarda (o reemplaza) la tarjeta ya tokenizada como fuente de pago. */
  guardarFuentePago(payload: FuentePagoPayload): Observable<FuentePago> {
    return this.api.post<FuentePago>('/suscripcion/fuente-pago', payload);
  }

  eliminarFuentePago(): Observable<void> {
    return this.api.delete('/suscripcion/fuente-pago');
  }

  /** Cobra la mensualidad YA con la tarjeta guardada. DECLINED también es 200. */
  pagar(): Observable<ResultadoPagoSuscripcion> {
    return this.api.post<ResultadoPagoSuscripcion>('/suscripcion/pagar');
  }

  /**
   * Bancos habilitados para PSE. Se piden FRESCOS cada vez que se abre el
   * formulario: los bancos entran, salen y se ponen en mantenimiento, y una
   * lista vieja mandaría a la persona a un banco que hoy no funciona.
   */
  bancosPse(): Observable<BancoPSE[]> {
    return this.api.get<BancoPSE[]>('/suscripcion/pse/bancos');
  }

  /**
   * Arranca un pago por PSE. NO cobra nada: crea la transacción (que nace
   * PENDING) y devuelve la URL del portal del banco, que es a donde hay que
   * mandar a la persona para que lo apruebe.
   */
  pagarPse(payload: PagarPsePayload): Observable<ResultadoPse> {
    return this.api.post<ResultadoPse>('/suscripcion/pse/pagar', payload);
  }

  /** ¿Las llaves son de pruebas? Manda la llave pública, no el entorno de Angular. */
  esSandbox(config: SuscripcionConfig): boolean {
    return config.public_key.startsWith('pub_test_');
  }

  /**
   * Tokeniza la tarjeta DIRECTO contra Wompi con la llave pública y devuelve
   * el token. Es la única petición de la app que sale a un dominio externo:
   * así el número de la tarjeta jamás toca nuestro backend (ni se loguea).
   *
   * Cualquier fallo se traduce aquí a un ErrorPasarela legible; tokenizar no
   * guarda nada en nuestro sistema, así que reintentar siempre es seguro.
   */
  async tokenizarTarjeta(config: SuscripcionConfig, datos: DatosTarjeta): Promise<string> {
    let respuesta: { data?: { id?: string } };
    try {
      respuesta = await firstValueFrom(
        this.http
          .post<{ data?: { id?: string } }>(
            config.tokenizacion_url,
            {
              number: datos.numero,
              cvc: datos.cvc,
              exp_month: datos.exp_mes,
              exp_year: datos.exp_anio,
              card_holder: datos.titular,
            },
            { headers: { Authorization: `Bearer ${config.public_key}` } },
          )
          .pipe(timeout(MS_LIMITE_WOMPI)),
      );
    } catch (err) {
      throw new ErrorPasarela(traducirErrorWompi(err));
    }
    const token = respuesta.data?.id;
    if (!token) {
      throw new ErrorPasarela('La pasarela no devolvió el token de la tarjeta. Vuelve a intentar.');
    }
    return token;
  }
}

/**
 * Traduce el fallo de la tokenización a un mensaje para el usuario. Wompi
 * responde 422 con `{error: {type: 'INPUT_VALIDATION_ERROR', messages:
 * {campo: [textos]}}}` y esos textos ya vienen en español, así que se muestran
 * tal cual; el resto de casos se agrupa en "pasarela caída" o "sin señal".
 */
function traducirErrorWompi(err: unknown): string {
  if (err instanceof HttpErrorResponse && err.status > 0) {
    const error = err.error?.error;
    if (error?.type === 'INPUT_VALIDATION_ERROR') {
      const mensajes = Object.values(
        (error.messages ?? {}) as Record<string, string[]>,
      ).flat();
      if (mensajes.length > 0) return mensajes.join(' ');
      return 'La pasarela rechazó los datos de la tarjeta. Revísalos y vuelve a intentar.';
    }
    return 'La pasarela de pagos respondió con un error. Vuelve a intentar en unos segundos.';
  }
  // TimeoutError de rxjs o status 0: no hubo respuesta. Nada quedó a medias.
  return 'No fue posible contactar la pasarela de pagos. Revisa la señal y vuelve a intentar.';
}
