FROM node:22-slim
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
WORKDIR /app
COPY packages/runner/package.json ./packages/runner/
RUN cd packages/runner && npm install
COPY packages/ ./packages/
ENTRYPOINT ["node", "packages/runner/cli.js"]
