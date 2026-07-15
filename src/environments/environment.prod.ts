// Entorno de PRODUCCIÓN (Cloudflare Pages). Al ser un sitio estático no hay
// proxy, así que se apunta directamente al backend desplegado en Render.
export const environment = {
  production: true,
  apiBase: 'https://back-lactis.onrender.com/api/v1',
  // Los archivos subidos se sirven en la raíz del backend (/uploads), no bajo /api/v1.
  uploadsBase: 'https://back-lactis.onrender.com/uploads',
};
