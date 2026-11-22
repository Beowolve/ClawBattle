FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS build
WORKDIR /app
COPY packages/dashboard/package.json packages/dashboard/package-lock.json ./packages/dashboard/
RUN npm ci --prefix packages/dashboard --ignore-scripts
COPY packages/dashboard/ ./packages/dashboard/
COPY prompts/ ./prompts/
COPY baselines/human_stats.json ./baselines/
COPY config/model-aliases.json ./config/
COPY package.json ./
WORKDIR /app/packages/dashboard
RUN npm run build

FROM nginx:1.31.8-alpine@sha256:fed7e14be83cbd2661a75cdc5b872d936cf155d46c327084d30b8df19ae88d72
COPY --from=build /app/packages/dashboard/dist /usr/share/nginx/html
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
