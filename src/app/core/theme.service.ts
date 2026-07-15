import { Injectable, effect, signal } from '@angular/core';

const THEME_KEY = 'qe.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly dark = signal<boolean>(this.temaInicial());

  constructor() {
    effect(() => {
      document.documentElement.classList.toggle('dark', this.dark());
      localStorage.setItem(THEME_KEY, this.dark() ? 'dark' : 'light');
    });
  }

  toggle(): void {
    this.dark.update((value) => !value);
  }

  private temaInicial(): boolean {
    const guardado = localStorage.getItem(THEME_KEY);
    if (guardado) return guardado === 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }
}
