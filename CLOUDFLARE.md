# Desplegar Lactis en Cloudflare Pages

El frontend ya está configurado para producción: apunta al backend en Render
(`https://back-lactis.onrender.com`) y trae el routing SPA para Cloudflare.

## Opción A — Conectar el repositorio de GitHub (recomendado)

1. En el panel de Cloudflare → **Workers & Pages → Create → Pages → Connect to Git**.
2. Elige el repositorio de este frontend (`Front-Lactis`).
3. Configura la compilación **exactamente así**:

   | Campo | Valor |
   |---|---|
   | Framework preset | `Angular` (o `None`) |
   | Build command | `npm run build` |
   | Build output directory | `dist/lactis/browser` |
   | Root directory | *(dejar vacío)* |

4. En **Environment variables** agrega (para que use Node 22):
   - `NODE_VERSION` = `22`
   (También se toma del archivo `.nvmrc` que ya está en el repo.)
5. **Save and Deploy**. Cada `git push` redepliega solo.

Tu sitio quedará en `https://<proyecto>.pages.dev` (ej. `https://lactis.pages.dev`).

## Opción B — Subida directa con Wrangler (sin Git)

```bash
npm run build
npx wrangler pages deploy dist/lactis/browser --project-name lactis
```

## Ya resuelto en el código

- **Routing SPA**: `public/_redirects` (`/* /index.html 200`) — recargar en
  cualquier ruta (ej. `/reventa`) funciona.
- **API en producción**: `src/environments/environment.prod.ts` apunta a Render.
  En desarrollo (`npm start`) usa el proxy local (`proxy.conf.json` → 8080).
- **CORS**: el backend ya permite los dominios `*.pages.dev`.
  ⚠️ Requiere que el backend `Back-Lactis` se haya redeployado en Render con
  ese cambio (git push a Back-Lactis).

## Nota

Cloudflare Pages es un hosting **estático**: no hay proxy `/api`. Por eso el
frontend llama directo a Render por HTTPS. Si cambias de dominio de backend,
edita `src/environments/environment.prod.ts` y vuelve a compilar.
