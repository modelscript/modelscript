# ==============================================================================
# Unified multi-stage Dockerfile for all ModelScript services.
# Each service is a named target: api, morsel, web, ide.
# Usage: docker compose build (targets configured in docker-compose.yml)
# ==============================================================================

# ---- Generate tree-sitter parser source (needs glibc for tree-sitter binary) ----
FROM node:22-slim AS generate
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/tree-sitter-modelica/package.json packages/tree-sitter-modelica/grammar.js packages/tree-sitter-modelica/binding.gyp packages/tree-sitter-modelica/
COPY packages/tree-sitter-modelica/bindings packages/tree-sitter-modelica/bindings
# Stub all workspace packages so npm ci resolves the lockfile
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY packages/morsel/package.json packages/morsel/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/lsp/package.json packages/lsp/
COPY packages/vscode/package.json packages/vscode/
COPY packages/ide/package.json packages/ide/
RUN npm ci --ignore-scripts
RUN cd node_modules/tree-sitter-cli && node install.js
RUN cd packages/tree-sitter-modelica && npx tree-sitter generate --abi=14

# ---- Shared Alpine base with native build tools ----
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/tree-sitter-modelica/package.json packages/tree-sitter-modelica/grammar.js packages/tree-sitter-modelica/binding.gyp packages/tree-sitter-modelica/tree-sitter-modelica.wasm packages/tree-sitter-modelica/
COPY packages/tree-sitter-modelica/bindings packages/tree-sitter-modelica/bindings
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY packages/morsel/package.json packages/morsel/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/lsp/package.json packages/lsp/
COPY packages/vscode/package.json packages/vscode/
COPY packages/ide/package.json packages/ide/
RUN npm ci --ignore-scripts
# Copy generated parser source from Debian stage and build native addon
COPY --from=generate /app/packages/tree-sitter-modelica/src packages/tree-sitter-modelica/src
RUN cd packages/tree-sitter-modelica && npx node-gyp rebuild

# ==============================================================================
# API
# ==============================================================================
FROM deps AS build-api
COPY packages/core packages/core
COPY packages/tree-sitter-modelica packages/tree-sitter-modelica
COPY packages/api packages/api
# Skip lint in Docker (already enforced in CI); run clean + tsc directly
RUN npm run clean -w packages/core && npx tsc -p packages/core \
    && npm run clean -w packages/api && npx tsc -p packages/api

FROM node:22-alpine AS api
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/tree-sitter-modelica/package.json packages/tree-sitter-modelica/grammar.js packages/tree-sitter-modelica/binding.gyp packages/tree-sitter-modelica/
COPY packages/tree-sitter-modelica/bindings packages/tree-sitter-modelica/bindings
COPY packages/api/package.json packages/api/
COPY packages/morsel/package.json packages/morsel/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/lsp/package.json packages/lsp/
COPY packages/vscode/package.json packages/vscode/
COPY packages/ide/package.json packages/ide/
RUN npm ci --omit=dev --ignore-scripts
COPY --from=deps /app/packages/tree-sitter-modelica/src packages/tree-sitter-modelica/src
COPY --from=deps /app/packages/tree-sitter-modelica/build packages/tree-sitter-modelica/build
COPY --from=deps /app/node_modules/@modelscript/tree-sitter-modelica node_modules/@modelscript/tree-sitter-modelica
COPY --from=build-api /app/packages/core/dist packages/core/dist
COPY --from=build-api /app/packages/api/dist packages/api/dist
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "packages/api/dist/main.js"]

# ==============================================================================
# Morsel
# ==============================================================================
FROM deps AS build-morsel
COPY scripts scripts
COPY packages/core packages/core
COPY packages/tree-sitter-modelica packages/tree-sitter-modelica
COPY packages/morsel packages/morsel
RUN node scripts/download-msl.cjs && cp scripts/ModelicaStandardLibrary_v4.1.0.zip packages/morsel/public/
# Skip lint in Docker (already enforced in CI); run clean + tsc for core
RUN npm run clean -w packages/core && npx tsc -p packages/core \
    && npm run build -w packages/morsel

FROM node:22-alpine AS morsel
WORKDIR /app
COPY --from=build-morsel /app/packages/morsel/build packages/morsel/build
COPY --from=build-morsel /app/packages/morsel/package.json packages/morsel/
COPY --from=build-morsel /app/package.json /app/package-lock.json ./
RUN npm install --omit=dev -w packages/morsel --ignore-scripts
EXPOSE 3000
ENV NODE_ENV=production
CMD ["npx", "react-router-serve", "./packages/morsel/build/server/index.js"]

# ==============================================================================
# Web
# ==============================================================================
FROM deps AS build-web
COPY packages/core packages/core
COPY packages/web packages/web
# Skip lint in Docker (already enforced in CI); run clean + tsc for core
RUN npm run clean -w packages/core && npx tsc -p packages/core \
    && npm run build -w packages/web

FROM nginx:alpine AS web
COPY --from=build-web /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

# ==============================================================================
# IDE
# ==============================================================================
FROM deps AS build-ide
COPY scripts scripts
COPY packages/core packages/core
COPY packages/tree-sitter-modelica packages/tree-sitter-modelica
COPY packages/lsp packages/lsp
COPY packages/vscode packages/vscode
COPY packages/ide packages/ide
COPY packages/morsel packages/morsel
# Skip lint in Docker (already enforced in CI); run clean + tsc for core
RUN npm run clean -w packages/core && npx tsc -p packages/core \
    && npm run build -w packages/lsp \
    && npm run build -w packages/vscode \
    && npm run build -w packages/ide

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
COPY packages/tree-sitter-modelica/package.json packages/tree-sitter-modelica/grammar.js packages/tree-sitter-modelica/binding.gyp packages/tree-sitter-modelica/
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build-ide /app/packages/ide/dist packages/ide/dist
COPY --from=build-ide /app/packages/ide/vscode-web packages/ide/vscode-web
COPY --from=build-ide /app/packages/ide/github-fs/dist packages/ide/github-fs/dist
COPY --from=build-ide /app/packages/vscode/dist packages/vscode/dist
COPY --from=build-ide /app/packages/vscode/syntaxes packages/vscode/syntaxes
COPY --from=build-ide /app/packages/vscode/language-configuration.json packages/vscode/
COPY --from=build-ide /app/packages/morsel/public packages/morsel/public
COPY --from=build-ide /app/node_modules/@vscode node_modules/@vscode
EXPOSE 3200
ENV NODE_ENV=production
ENV PORT=3200
CMD ["node", "packages/ide/dist/server.js"]
