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
COPY apps/api/package.json apps/api/
COPY apps/morsel/package.json apps/morsel/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY packages/lsp/package.json packages/lsp/
COPY extensions/vscode/package.json extensions/vscode/
COPY apps/ide/package.json apps/ide/
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
COPY apps/api apps/api
RUN npm run clean -w packages/core && npx tsc -p packages/core \
    && npm run clean -w packages/cosim && npx tsc -p packages/cosim \
    && npm run clean -w apps/api && npx tsc -p apps/api

FROM deps AS build-api-true
COPY packages/core/dist packages/core/dist
COPY packages/cosim/dist packages/cosim/dist
COPY apps/api/dist apps/api/dist

FROM build-api-${PREBUILT} AS build-api

FROM node:22-alpine AS api
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/cosim/package.json packages/cosim/
COPY languages/modelica/tree-sitter-modelica/package.json languages/modelica/tree-sitter-modelica/grammar.js languages/modelica/tree-sitter-modelica/binding.gyp languages/modelica/tree-sitter-modelica/
COPY languages/modelica/tree-sitter-modelica/bindings languages/modelica/tree-sitter-modelica/bindings
COPY apps/api/package.json apps/api/
COPY apps/morsel/package.json apps/morsel/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY packages/lsp/package.json packages/lsp/
COPY extensions/vscode/package.json extensions/vscode/
COPY apps/ide/package.json apps/ide/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts
COPY --from=deps /app/languages/modelica/tree-sitter-modelica/src languages/modelica/tree-sitter-modelica/src
COPY --from=deps /app/languages/modelica/tree-sitter-modelica/build languages/modelica/tree-sitter-modelica/build
COPY --from=deps /app/node_modules/@modelscript/tree-sitter-modelica node_modules/@modelscript/tree-sitter-modelica
COPY --from=build-api /app/packages/core/dist packages/core/dist
COPY --from=build-api /app/packages/cosim/dist packages/cosim/dist
COPY --from=build-api /app/apps/api/dist apps/api/dist
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "apps/api/dist/main.js"]

# ==============================================================================
# Morsel
# ==============================================================================
FROM deps AS build-morsel-false
COPY scripts scripts
COPY packages/core packages/core
COPY languages/modelica/tree-sitter-modelica languages/modelica/tree-sitter-modelica
COPY apps/morsel apps/morsel
RUN node scripts/download-msl.cjs && node scripts/download-sysml2.cjs && cp scripts/ModelicaStandardLibrary_v4.1.0.zip apps/morsel/public/ && cp scripts/SysML-v2-Release-2026-03.zip apps/morsel/public/
RUN npm run clean -w packages/core && npx tsc -p packages/core \
    && npm run build -w apps/morsel

FROM deps AS build-morsel-true
COPY apps/morsel/package.json apps/morsel/
COPY apps/morsel/build apps/morsel/build

FROM build-morsel-${PREBUILT} AS build-morsel

FROM node:22-alpine AS morsel
WORKDIR /app
COPY --from=build-morsel /app/apps/morsel/build apps/morsel/build
COPY --from=build-morsel /app/apps/morsel/package.json apps/morsel/
COPY --from=build-morsel /app/package.json /app/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm install --omit=dev -w apps/morsel --ignore-scripts
EXPOSE 3000
ENV NODE_ENV=production
CMD ["npx", "react-router-serve", "./apps/morsel/build/server/index.js"]

# ==============================================================================
# Web
# ==============================================================================
FROM deps AS build-web-false
COPY packages/core packages/core
COPY apps/web apps/web
RUN npm run clean -w packages/core && npx tsc -p packages/core \
    && npm run build -w apps/web

FROM deps AS build-web-true
COPY apps/web/dist apps/web/dist

FROM build-web-${PREBUILT} AS build-web

FROM nginx:alpine AS web
COPY --from=build-web /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

# ==============================================================================
# IDE
# ==============================================================================

# Download WebLLM model weights (cached layer)
FROM node:22-alpine AS download-model
RUN apk add --no-cache curl bash
WORKDIR /app/apps/ide
COPY apps/ide/models/Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm models/
COPY apps/ide/scripts/download-model.sh scripts/download-model.sh
RUN bash scripts/download-model.sh

FROM deps AS build-ide-false
COPY scripts scripts
COPY packages/core packages/core
COPY languages/modelica/tree-sitter-modelica languages/modelica/tree-sitter-modelica
COPY packages/lsp packages/lsp
COPY extensions/vscode extensions/vscode
COPY apps/ide apps/ide
COPY apps/morsel apps/morsel
RUN npm run clean -w packages/core && npx tsc -p packages/core \
    && npm run build -w packages/lsp \
    && npm run build -w extensions/vscode \
    && npm run build -w apps/ide

FROM deps AS build-ide-true
COPY apps/ide/dist apps/ide/dist
COPY apps/ide/vscode-web apps/ide/vscode-web
COPY apps/ide/github-fs/dist apps/ide/github-fs/dist
COPY extensions/vscode/dist extensions/vscode/dist
COPY extensions/vscode/syntaxes extensions/vscode/syntaxes
COPY extensions/vscode/language-configuration.json extensions/vscode/
COPY apps/morsel/public apps/morsel/public

FROM build-ide-${PREBUILT} AS build-ide

FROM node:22-alpine AS ide
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/ide/package.json apps/ide/
COPY extensions/vscode/package.json extensions/vscode/
COPY apps/api/package.json apps/api/
COPY apps/morsel/package.json apps/morsel/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY packages/core/package.json packages/core/
COPY packages/lsp/package.json packages/lsp/
COPY languages/modelica/tree-sitter-modelica/package.json languages/modelica/tree-sitter-modelica/grammar.js languages/modelica/tree-sitter-modelica/binding.gyp languages/modelica/tree-sitter-modelica/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts
COPY --from=build-ide /app/apps/ide/dist apps/ide/dist
COPY --from=build-ide /app/apps/ide/vscode-web apps/ide/vscode-web
COPY --from=build-ide /app/apps/ide/github-fs/dist apps/ide/github-fs/dist
COPY --from=build-ide /app/extensions/vscode/dist extensions/vscode/dist
COPY --from=build-ide /app/extensions/vscode/syntaxes extensions/vscode/syntaxes
COPY --from=build-ide /app/extensions/vscode/language-configuration.json extensions/vscode/
COPY --from=build-ide /app/apps/morsel/public apps/morsel/public
COPY --from=build-ide /app/node_modules/@vscode node_modules/@vscode
COPY --from=download-model /app/apps/ide/models apps/ide/models
EXPOSE 3003
ENV NODE_ENV=production
ENV PORT=3003
CMD ["node", "apps/ide/dist/server.js"]
