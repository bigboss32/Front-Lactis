import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../environments/environment';
import { Page } from './models';

export const API_BASE = environment.apiBase;

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

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  get<T>(path: string, params?: QueryParams): Observable<T> {
    return this.http.get<T>(`${API_BASE}${path}`, { params: toHttpParams(params) });
  }

  post<T>(path: string, body?: unknown, params?: QueryParams): Observable<T> {
    return this.http.post<T>(`${API_BASE}${path}`, body ?? {}, { params: toHttpParams(params) });
  }

  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<T>(`${API_BASE}${path}`, body);
  }

  delete<T = void>(path: string): Observable<T> {
    return this.http.delete<T>(`${API_BASE}${path}`);
  }

  upload<T>(path: string, file: File): Observable<T> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<T>(`${API_BASE}${path}`, form);
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
