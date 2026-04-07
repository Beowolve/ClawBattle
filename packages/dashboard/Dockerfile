FROM node:22-slim AS build
WORKDIR /app
COPY packages/dashboard/package.json ./
RUN npm install
COPY packages/dashboard/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
