import {
  HttpClient,
  HttpContext,
  HttpEventType,
  HttpParams,
  HttpResponse,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, filter, map } from 'rxjs';

import { environment } from '../../environments/environment';
import { SOLO_LECTURA } from './errores-red';
import { Page } from './models';

export const API_BASE = environment.apiBase;
/** Base para archivos subidos (adjuntos, fotos). Cuelga de la raíz del backend, no de /api/v1. */
export const UPLOADS_BASE = environment.uploadsBase;

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/** Parámetros estándar de los listados paginados del backend. */
export interface ListOpts extends QueryParams {
  page?: number;
  page_size?: number;
  search?: string | null;
  estado?: string | null;
}

function toHttpParams(params?: QueryParams): HttpParams {
  let httpParams = new HttpParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined && value !== '') {
      httpParams = httpParams.set(key, String(value));
    }
  }
  return httpParams;
}

/** Ajustes que cambian cómo trata el interceptor esta petición. */
export interface OpcionesPeticion {
  /**
   * Este POST CONSULTA, no guarda (previsualizaciones, cálculos con cuerpo).
   * Sin esto, el interceptor deduce "escritura" del verbo y muestra mensajes de
   * plata ("revisa si el registro quedó guardado") en pantallas que no guardan
   * nada. Ver SOLO_LECTURA en core/errores-red.ts.
   */
  soloLectura?: boolean;
}

/** El contexto viaja solo dentro de Angular; nunca sale por la red. */
function contextoDe(opciones?: OpcionesPeticion): HttpContext {
  return new HttpContext().set(SOLO_LECTURA, opciones?.soloLectura ?? false);
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  get<T>(path: string, params?: QueryParams): Observable<T> {
    return this.http.get<T>(`${API_BASE}${path}`, { params: toHttpParams(params) });
  }

  post<T>(
    path: string,
    body?: unknown,
    params?: QueryParams,
    opciones?: OpcionesPeticion,
  ): Observable<T> {
    return this.http.post<T>(`${API_BASE}${path}`, body ?? {}, {
      params: toHttpParams(params),
      context: contextoDe(opciones),
    });
  }

  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<T>(`${API_BASE}${path}`, body);
  }

  delete<T = void>(path: string): Observable<T> {
    return this.http.delete<T>(`${API_BASE}${path}`);
  }

  /**
   * Sube un archivo (adjunto de un gasto). Es la petición más larga de la app:
   * una foto de recibo pesa varios MB y desde la finca tarda minutos.
   *
   * `reportProgress` no está para pintar una barra —hoy no la hay— sino para que
   * el observable EMITA mientras sube. El operador `timeout` de rxjs reinicia su
   * reloj en cada emisión, así que con eventos de progreso el límite pasa a
   * significar "la subida se congeló" en vez de "la subida es grande" (sin esto,
   * HttpClient no emite nada hasta terminar y el plazo se aplicaba al total).
   *
   * Como `reportProgress` obliga a `observe: 'events'`, aquí se vuelve a dejar
   * solo la respuesta final: quien llama sigue recibiendo un `Observable<T>` con
   * un único valor, exactamente como antes.
   */
  upload<T>(path: string, file: File): Observable<T> {
    const form = new FormData();
    form.append('file', file);
    return this.http
      .post<T>(`${API_BASE}${path}`, form, { reportProgress: true, observe: 'events' })
      .pipe(
        filter((evento): evento is HttpResponse<T> => evento.type === HttpEventType.Response),
        map((respuesta) => respuesta.body as T),
      );
  }

  /**
   * Sube VARIOS archivos de una vez y va contando cuánto lleva subido.
   *
   * Es la hermana de `upload`, con dos diferencias que importan:
   *
   * 1. Manda todos los archivos en el MISMO campo (`files`), que es lo que
   *    espera un `list[UploadFile]` de FastAPI. Una petición por archivo sería
   *    más simple, pero con señal mala unas pasarían y otras no, y el dueño
   *    quedaría sin saber cuáles de sus cinco fotos alcanzaron a subir.
   * 2. NO se queda solo con la respuesta final: emite el porcentaje mientras
   *    sube. Aquí sí hay barra de progreso, porque una tanda de fotos de celular
   *    puede pesar 30 MB y desde el campo eso son varios minutos; sin barra, la
   *    pantalla parece congelada y la gente vuelve a darle al botón.
   *
   * Emite `{ progreso: 0..100 }` mientras va, y `{ progreso: 100, cuerpo }` al
   * terminar. Quien llama distingue el final por `cuerpo !== undefined`.
   */
  uploadVarios<T>(path: string, files: File[]): Observable<{ progreso: number; cuerpo?: T }> {
    const form = new FormData();
    for (const file of files) form.append('files', file, file.name);
    return this.http
      .post<T>(`${API_BASE}${path}`, form, { reportProgress: true, observe: 'events' })
      .pipe(
        filter(
          (evento) =>
            evento.type === HttpEventType.UploadProgress ||
            evento.type === HttpEventType.Response,
        ),
        map((evento) => {
          if (evento.type === HttpEventType.Response) {
            return { progreso: 100, cuerpo: (evento as HttpResponse<T>).body as T };
          }
          // `total` puede no venir si el servidor no informa el tamaño; en ese
          // caso se deja en 0 y la barra se muestra indeterminada.
          const { loaded, total } = evento as { loaded: number; total?: number };
          return { progreso: total ? Math.round((loaded / total) * 100) : 0 };
        }),
      );
  }

  /** GET de un binario (PDF/Excel) como Blob, para compartir o previsualizar. */
  getBlob(path: string, params?: QueryParams): Observable<Blob> {
    return this.http.get(`${API_BASE}${path}`, {
      params: toHttpParams(params),
      responseType: 'blob',
    });
  }

  /** POST que devuelve un binario (PDF) como Blob. */
  postBlob(path: string, body?: unknown, opciones?: OpcionesPeticion): Observable<Blob> {
    return this.http.post(`${API_BASE}${path}`, body ?? {}, {
      responseType: 'blob',
      context: contextoDe(opciones),
    });
  }

  /** Descarga un binario (PDF/Excel) y dispara el guardado en el navegador. */
  download(path: string, fallbackName: string, params?: QueryParams): Observable<void> {
    return this.http
      .get(`${API_BASE}${path}`, {
        params: toHttpParams(params),
        responseType: 'blob',
        observe: 'response',
      })
      .pipe(
        map((response) => {
          const disposition = response.headers.get('content-disposition') ?? '';
          const match = /filename="?([^";]+)"?/.exec(disposition);
          const name = match?.[1] ?? fallbackName;
          const url = URL.createObjectURL(response.body!);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = name;
          anchor.click();
          URL.revokeObjectURL(url);
        }),
      );
  }
}

/**
 * CRUD genérico contra un recurso paginado del backend.
 * Los servicios de módulo lo extienden indicando la ruta base.
 */
export abstract class CrudService<T, TCreate = Partial<T>, TUpdate = Partial<TCreate>> {
  protected readonly api = inject(ApiService);

  protected constructor(protected readonly base: string) {}

  list(opts: ListOpts = {}): Observable<Page<T>> {
    return this.api.get<Page<T>>(this.base, opts);
  }

  getById(id: string): Observable<T> {
    return this.api.get<T>(`${this.base}/${id}`);
  }

  create(payload: TCreate): Observable<T> {
    return this.api.post<T>(this.base, payload);
  }

  update(id: string, payload: TUpdate): Observable<T> {
    return this.api.put<T>(`${this.base}/${id}`, payload);
  }

  remove(id: string): Observable<void> {
    return this.api.delete(`${this.base}/${id}`);
  }
}
