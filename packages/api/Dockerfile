FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
COPY docker/debian-snapshot.sources /etc/apt/sources.list.d/debian.sources
RUN --mount=type=bind,source=docker/install-chromium.sh,target=/tmp/install-chromium.sh \
    sh /tmp/install-chromium.sh
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY packages/api/package.json packages/api/package-lock.json ./packages/api/
COPY packages/core/package.json packages/core/package-lock.json ./packages/core/
RUN npm ci --prefix packages/api --omit=dev --ignore-scripts \
    && npm ci --prefix packages/core --omit=dev --ignore-scripts
COPY packages/ ./packages/
CMD ["node", "packages/api/server.js"]
