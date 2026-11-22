FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build
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
