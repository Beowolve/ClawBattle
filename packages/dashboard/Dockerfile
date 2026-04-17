FROM node:22-slim AS build
WORKDIR /app
COPY packages/dashboard/package.json ./packages/dashboard/
RUN cd packages/dashboard && npm install
COPY packages/dashboard/ ./packages/dashboard/
COPY prompts/ ./prompts/
COPY package.json ./
WORKDIR /app/packages/dashboard
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/packages/dashboard/dist /usr/share/nginx/html
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
