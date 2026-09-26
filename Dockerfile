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
FROM node:24-alpine AS deps
RUN apk add --no-cache python3 make g++ zip unzip
ENV NODE_OPTIONS="--max-old-space-size=8192"
WORKDIR /app
COPY package.json package-lock.json ./

# Apps manifests
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY apps/docs/package.json apps/docs/
COPY apps/ide/package.json apps/ide/
COPY apps/ide/github-fs/package.json apps/ide/github-fs/
COPY apps/morsel/package.json apps/morsel/
COPY apps/site/package.json apps/site/
COPY apps/web/package.json apps/web/

# Packages manifests
COPY packages/cad/package.json packages/cad/
COPY packages/diagram/package.json packages/diagram/
COPY packages/dsl/package.json packages/dsl/
COPY packages/examples/drone-chassis/package.json packages/examples/drone-chassis/
COPY packages/exchange/package.json packages/exchange/
COPY packages/ide/package.json packages/ide/
COPY packages/lsp/package.json packages/lsp/
COPY packages/mcp/package.json packages/mcp/
COPY packages/runtime/package.json packages/runtime/
COPY packages/simulate/package.json packages/simulate/

# Languages manifests
COPY languages/cfd/package.json languages/cfd/
COPY languages/csv/package.json languages/csv/
COPY languages/fea/package.json languages/fea/
COPY languages/modelica/package.json languages/modelica/
COPY languages/modelica/src languages/modelica/src
COPY languages/owl2/package.json languages/owl2/
COPY languages/scad/package.json languages/scad/
COPY languages/ssp/package.json languages/ssp/
COPY languages/step/package.json languages/step/
COPY languages/sysml2/package.json languages/sysml2/
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

# ==============================================================================
# API
# ==============================================================================
FROM deps AS build-api-false
COPY packages packages
COPY languages languages
COPY apps/api apps/api
RUN npx nx build @modelscript/api


FROM deps AS build-api-true
COPY packages packages
COPY languages languages
COPY apps/api apps/api

FROM build-api-${PREBUILT} AS build-api

FROM node:24-alpine AS api
WORKDIR /app
COPY --from=deps /app/package.json /app/package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/languages/modelica/src languages/modelica/src
COPY --from=build-api /app/packages packages
COPY --from=build-api /app/languages languages
COPY --from=build-api /app/apps/api apps/api
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "apps/api/dist/main.js"]

# ==============================================================================
# Morsel
# ==============================================================================
FROM deps AS build-morsel-false
COPY scripts scripts
COPY packages packages
COPY languages languages
COPY apps/morsel apps/morsel
RUN node scripts/download-msl.cjs && node scripts/download-sysml2.cjs
RUN npx nx build @modelscript/morsel


FROM deps AS build-morsel-true
COPY apps/morsel/package.json apps/morsel/
COPY apps/morsel/package.json apps/morsel/buil[d] /app/apps/morsel/build/

FROM build-morsel-${PREBUILT} AS build-morsel

FROM node:24-alpine AS morsel
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
COPY packages packages
COPY languages languages
COPY apps/web apps/web
RUN npx nx build @modelscript/web


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
FROM node:24-alpine AS download-model
RUN apk add --no-cache curl bash
WORKDIR /app/apps/ide
COPY apps/ide/models/Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm models/
COPY apps/ide/scripts/download-model.sh scripts/download-model.sh
RUN bash scripts/download-model.sh

FROM deps AS build-ide-false
COPY scripts scripts
COPY packages packages
COPY languages languages
COPY apps/ide apps/ide
COPY apps/morsel apps/morsel
RUN npx nx build @modelscript/ide


FROM deps AS build-ide-true
COPY apps/ide/dist apps/ide/dist
COPY apps/ide/vscode-web apps/ide/vscode-web
COPY apps/ide/github-fs/dist apps/ide/github-fs/dist
COPY apps/morsel/public apps/morsel/public

FROM build-ide-${PREBUILT} AS build-ide

FROM node:24-alpine AS ide
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/ide/package.json apps/ide/
COPY apps/api/package.json apps/api/
COPY apps/morsel/package.json apps/morsel/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY packages/dsl/package.json packages/dsl/
COPY packages/runtime/package.json packages/runtime/
COPY packages/lsp/package.json packages/lsp/
COPY languages/modelica/package.json languages/modelica/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts
COPY --from=build-ide /app/apps/ide/dist apps/ide/dist
COPY --from=build-ide /app/apps/ide/vscode-web apps/ide/vscode-web
COPY --from=build-ide /app/apps/ide/github-fs/dist apps/ide/github-fs/dist
COPY --from=build-ide /app/apps/morsel/public apps/morsel/public
COPY --from=build-ide /app/node_modules/@vscode node_modules/@vscode
COPY --from=download-model /app/apps/ide/models apps/ide/models
EXPOSE 3003
ENV NODE_ENV=production
ENV PORT=3003
CMD ["node", "apps/ide/dist/server.js"]

# ==============================================================================
# CLI / GitLab CI Runner
# ==============================================================================
FROM deps AS build-cli-false
COPY packages packages
COPY languages languages
COPY apps/cli apps/cli
RUN npx nx build @modelscript/cli


FROM deps AS build-cli-true
COPY packages packages
COPY languages languages
COPY apps/cli apps/cli

FROM build-cli-${PREBUILT} AS build-cli

FROM node:24-alpine AS cli
WORKDIR /app
COPY --from=deps /app/package.json /app/package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/languages/modelica/src languages/modelica/src
COPY --from=build-cli /app/packages packages
COPY --from=build-cli /app/languages languages
COPY --from=build-cli /app/apps/cli apps/cli
ENV NODE_ENV=production
# The container will run as an executable CLI
ENTRYPOINT ["node", "apps/cli/dist/main.js"]
