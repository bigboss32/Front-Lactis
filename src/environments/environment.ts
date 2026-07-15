// Entorno de DESARROLLO. Las peticiones a /api/v1 las redirige proxy.conf.json
// al backend local (http://localhost:8080).
export const environment = {
  production: false,
  apiBase: '/api/v1',
  // Los archivos subidos se sirven en la raíz del backend (/uploads), no bajo /api/v1.
  uploadsBase: '/uploads',
};
