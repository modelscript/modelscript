# ==============================================================================
# Unified multi-stage Dockerfile for all ModelScript services.
# Each service is a named target: api, morsel, web, ide.
# Usage: docker compose build (targets configured in docker-compose.yml)
#
# Optimization: Set PREBUILT=true when the build context already contains
# compiled dist/ directories (e.g. from CI). This skips TypeScript compilation
# and linting inside Docker, cutting build time significantly.
# ==============================================================================

ARG PREBUILT=false

# ---- Shared Alpine base with native build tools ----
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY languages/modelica/tree-sitter-modelica/package.json languages/modelica/tree-sitter-modelica/grammar.js languages/modelica/tree-sitter-modelica/binding.gyp languages/modelica/tree-sitter-modelica/
COPY languages/modelica/tree-sitter-modelica/bindings languages/modelica/tree-sitter-modelica/bindings
COPY languages/modelica/tree-sitter-modelica/src languages/modelica/tree-sitter-modelica/src
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY packages/morsel/package.json packages/morsel/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/lsp/package.json packages/lsp/
COPY packages/vscode/package.json packages/vscode/
COPY packages/ide/package.json packages/ide/
COPY packages/cosim/package.json packages/cosim/
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
# Build native addon from committed parser source
RUN cd languages/modelica/tree-sitter-modelica && npx node-gyp rebuild

# ==============================================================================
# API
# ==============================================================================
FROM deps AS build-api-false
COPY packages/core packages/core
COPY languages/modelica/tree-sitter-modelica languages/modelica/tree-sitter-modelica
COPY packages/cosim packages/cosim
COPY packages/api packages/api
RUN npm run clean -w packages/core && npx tsc -p packages/core \
    && npm run clean -w packages/cosim && npx tsc -p packages/cosim \
    && npm run clean -w packages/api && npx tsc -p packages/api

FROM deps AS build-api-true
COPY packages/core/dist packages/core/dist
COPY packages/cosim/dist packages/cosim/dist
COPY packages/api/dist packages/api/dist

FROM build-api-${PREBUILT} AS build-api

FROM node:22-alpine AS api
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/cosim/package.json packages/cosim/
COPY languages/modelica/tree-sitter-modelica/package.json languages/modelica/tree-sitter-modelica/grammar.js languages/modelica/tree-sitter-modelica/binding.gyp languages/modelica/tree-sitter-modelica/
COPY languages/modelica/tree-sitter-modelica/bindings languages/modelica/tree-sitter-modelica/bindings
COPY packages/api/package.json packages/api/
COPY packages/morsel/package.json packages/morsel/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/lsp/package.json packages/lsp/
COPY packages/vscode/package.json packages/vscode/
COPY packages/ide/package.json packages/ide/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts
COPY --from=deps /app/languages/modelica/tree-sitter-modelica/src languages/modelica/tree-sitter-modelica/src
COPY --from=deps /app/languages/modelica/tree-sitter-modelica/build languages/modelica/tree-sitter-modelica/build
COPY --from=deps /app/node_modules/@modelscript/tree-sitter-modelica node_modules/@modelscript/tree-sitter-modelica
COPY --from=build-api /app/packages/core/dist packages/core/dist
COPY --from=build-api /app/packages/cosim/dist packages/cosim/dist
COPY --from=build-api /app/packages/api/dist packages/api/dist
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "packages/api/dist/main.js"]

# ==============================================================================
# Morsel
# ==============================================================================
FROM deps AS build-morsel-false
COPY scripts scripts
COPY packages/core packages/core
COPY languages/modelica/tree-sitter-modelica languages/modelica/tree-sitter-modelica
COPY packages/morsel packages/morsel
RUN node scripts/download-msl.cjs && cp scripts/ModelicaStandardLibrary_v4.1.0.zip packages/morsel/public/
RUN npm run clean -w packages/core && npx tsc -p packages/core \
    && npm run build -w packages/morsel

FROM deps AS build-morsel-true
COPY packages/morsel/package.json packages/morsel/
COPY packages/morsel/build packages/morsel/build

FROM build-morsel-${PREBUILT} AS build-morsel

FROM node:22-alpine AS morsel
WORKDIR /app
COPY --from=build-morsel /app/packages/morsel/build packages/morsel/build
COPY --from=build-morsel /app/packages/morsel/package.json packages/morsel/
COPY --from=build-morsel /app/package.json /app/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm install --omit=dev -w packages/morsel --ignore-scripts
EXPOSE 3000
ENV NODE_ENV=production
CMD ["npx", "react-router-serve", "./packages/morsel/build/server/index.js"]

# ==============================================================================
# Web
# ==============================================================================
FROM deps AS build-web-false
COPY packages/core packages/core
COPY packages/web packages/web
RUN npm run clean -w packages/core && npx tsc -p packages/core \
    && npm run build -w packages/web

FROM deps AS build-web-true
COPY packages/web/dist packages/web/dist

FROM build-web-${PREBUILT} AS build-web

FROM nginx:alpine AS web
COPY --from=build-web /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

# ==============================================================================
# IDE
# ==============================================================================

# Download WebLLM model weights (cached layer)
FROM node:22-alpine AS download-model
RUN apk add --no-cache curl bash
WORKDIR /app/packages/ide
COPY packages/ide/models/Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm models/
COPY packages/ide/scripts/download-model.sh scripts/download-model.sh
RUN bash scripts/download-model.sh

FROM deps AS build-ide-false
COPY scripts scripts
COPY packages/core packages/core
COPY languages/modelica/tree-sitter-modelica languages/modelica/tree-sitter-modelica
COPY packages/lsp packages/lsp
COPY packages/vscode packages/vscode
COPY packages/ide packages/ide
COPY packages/morsel packages/morsel
RUN npm run clean -w packages/core && npx tsc -p packages/core \
    && npm run build -w packages/lsp \
    && npm run build -w packages/vscode \
    && npm run build -w packages/ide

FROM deps AS build-ide-true
COPY packages/ide/dist packages/ide/dist
COPY packages/ide/vscode-web packages/ide/vscode-web
COPY packages/ide/github-fs/dist packages/ide/github-fs/dist
COPY packages/vscode/dist packages/vscode/dist
COPY packages/vscode/syntaxes packages/vscode/syntaxes
COPY packages/vscode/language-configuration.json packages/vscode/
COPY packages/morsel/public packages/morsel/public

FROM build-ide-${PREBUILT} AS build-ide

FROM node:22-alpine AS ide
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/ide/package.json packages/ide/
COPY packages/vscode/package.json packages/vscode/
COPY packages/api/package.json packages/api/
COPY packages/morsel/package.json packages/morsel/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/lsp/package.json packages/lsp/
COPY languages/modelica/tree-sitter-modelica/package.json languages/modelica/tree-sitter-modelica/grammar.js languages/modelica/tree-sitter-modelica/binding.gyp languages/modelica/tree-sitter-modelica/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts
COPY --from=build-ide /app/packages/ide/dist packages/ide/dist
COPY --from=build-ide /app/packages/ide/vscode-web packages/ide/vscode-web
COPY --from=build-ide /app/packages/ide/github-fs/dist packages/ide/github-fs/dist
COPY --from=build-ide /app/packages/vscode/dist packages/vscode/dist
COPY --from=build-ide /app/packages/vscode/syntaxes packages/vscode/syntaxes
COPY --from=build-ide /app/packages/vscode/language-configuration.json packages/vscode/
COPY --from=build-ide /app/packages/morsel/public packages/morsel/public
COPY --from=build-ide /app/node_modules/@vscode node_modules/@vscode
COPY --from=download-model /app/packages/ide/models packages/ide/models
EXPOSE 3003
ENV NODE_ENV=production
ENV PORT=3003
CMD ["node", "packages/ide/dist/server.js"]
