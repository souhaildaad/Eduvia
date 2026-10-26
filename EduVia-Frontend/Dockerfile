# Étape 1 : build Angular
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

# Étape 2 : servir avec Nginx
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist/EduVia-Frontend/browser /usr/share/nginx/html

EXPOSE 80
