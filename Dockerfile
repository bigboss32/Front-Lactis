# Etapa 1: compilar la aplicación Angular
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Build 'development': usa apiBase relativa '/api/v1' (proxy de nginx a la API local),
# a diferencia de 'production' que apunta al backend en Render.
RUN npx ng build --configuration development

# Etapa 2: servir con nginx (proxy /api y /uploads hacia el backend)
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/lactis/browser /usr/share/nginx/html

EXPOSE 80
