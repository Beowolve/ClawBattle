FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1
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
