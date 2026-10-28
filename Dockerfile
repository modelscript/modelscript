# ==============================================================================
# Unified multi-stage Dockerfile for all ModelScript services.
# Each service is a named target: api, web, ide.
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
COPY apps/desktop/package.json apps/desktop/
COPY apps/docs/package.json apps/docs/
COPY apps/ide/package.json apps/ide/
COPY apps/ide/github-fs/package.json apps/ide/github-fs/
COPY apps/web/package.json apps/web/

# Packages manifests
COPY packages/cad/package.json packages/cad/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/diagram/package.json packages/diagram/
COPY packages/dsl/package.json packages/dsl/
COPY packages/embed/package.json packages/embed/
COPY packages/examples/drone-chassis/package.json packages/examples/drone-chassis/
COPY packages/examples/pscad-microgrid/package.json packages/examples/pscad-microgrid/
COPY packages/exchange/package.json packages/exchange/
COPY packages/ide/package.json packages/ide/
COPY packages/lsp/package.json packages/lsp/
COPY packages/mcp/package.json packages/mcp/
COPY packages/react/package.json packages/react/
COPY packages/runtime/package.json packages/runtime/
COPY packages/simulate/package.json packages/simulate/

# Languages manifests
COPY languages/adams/package.json languages/adams/
COPY languages/aspen/package.json languages/aspen/
COPY languages/autosar/package.json languages/autosar/
COPY languages/c/package.json languages/c/
COPY languages/ccsds/package.json languages/ccsds/
COPY languages/cfd/package.json languages/cfd/
COPY languages/csv/package.json languages/csv/
COPY languages/easy5/package.json languages/easy5/
COPY languages/eclipse/package.json languages/eclipse/
COPY languages/energyplus/package.json languages/energyplus/
COPY languages/epanet/package.json languages/epanet/
COPY languages/fea/package.json languages/fea/
COPY languages/fortran/package.json languages/fortran/
COPY languages/gensys/package.json languages/gensys/
COPY languages/gtsuite/package.json languages/gtsuite/
COPY languages/ibis/package.json languages/ibis/
COPY languages/jsbsim/package.json languages/jsbsim/
COPY languages/lps/package.json languages/lps/
COPY languages/modelica/package.json languages/modelica/
COPY languages/modelscript/package.json languages/modelscript/
COPY languages/olga/package.json languages/olga/
COPY languages/opendrive/package.json languages/opendrive/
COPY languages/opendss/package.json languages/opendss/
COPY languages/openscenario/package.json languages/openscenario/
COPY languages/owl2/package.json languages/owl2/
COPY languages/plcopen/package.json languages/plcopen/
COPY languages/pscad/package.json languages/pscad/
COPY languages/psse/package.json languages/psse/
COPY languages/relap5/package.json languages/relap5/
COPY languages/reqif/package.json languages/reqif/
COPY languages/rocets/package.json languages/rocets/
COPY languages/sbml/package.json languages/sbml/
COPY languages/scad/package.json languages/scad/
COPY languages/sima/package.json languages/sima/
COPY languages/simpack/package.json languages/simpack/
COPY languages/simulink/package.json languages/simulink/
COPY languages/spice/package.json languages/spice/
COPY languages/ssp/package.json languages/ssp/
COPY languages/step/package.json languages/step/
COPY languages/swmm/package.json languages/swmm/
COPY languages/sysml2/package.json languages/sysml2/
COPY languages/touchstone/package.json languages/touchstone/
COPY languages/urdf/package.json languages/urdf/
COPY languages/verilog-a/package.json languages/verilog-a/
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

# ==============================================================================
# API
# ==============================================================================
FROM deps AS build-api-false
COPY scripts scripts
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
RUN mkdir -p /app/apps/api/data /app/apps/api/uploads /app/apps/api/public/thumbnails /app/apps/api/storage \
  && chown -R node:node /app
COPY --from=deps --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build-api --chown=node:node /app/packages packages
COPY --from=build-api --chown=node:node /app/languages languages
COPY --from=build-api --chown=node:node /app/apps/api apps/api
USER node
EXPOSE 3000
ENV NODE_ENV=production
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["node", "apps/api/dist/main.js"]

# ==============================================================================
# Web
# ==============================================================================
FROM deps AS build-web-false
COPY scripts scripts
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
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/healthz || exit 1

# ==============================================================================
# IDE
# ==============================================================================

# Download WebLLM model weights (cached layer)
FROM node:24-alpine AS download-model
RUN apk add --no-cache curl bash
WORKDIR /app/apps/ide
COPY apps/ide/scripts/download-model.sh scripts/download-model.sh
RUN bash scripts/download-model.sh

FROM deps AS build-ide-false
COPY scripts scripts
COPY packages packages
COPY languages languages
COPY apps/ide apps/ide
RUN npx nx build @modelscript/ide


FROM deps AS build-ide-true
COPY apps/ide/dist apps/ide/dist
COPY apps/ide/vscode-web apps/ide/vscode-web
COPY apps/ide/github-fs/dist apps/ide/github-fs/dist

FROM build-ide-${PREBUILT} AS build-ide

FROM node:24-alpine AS ide
WORKDIR /app
RUN chown -R node:node /app
COPY --from=deps --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build-ide --chown=node:node /app/packages packages
COPY --from=build-ide --chown=node:node /app/languages languages
COPY --from=build-ide --chown=node:node /app/apps/ide/dist apps/ide/dist
COPY --from=build-ide --chown=node:node /app/apps/ide/vscode-web apps/ide/vscode-web
COPY --from=build-ide --chown=node:node /app/apps/ide/github-fs/dist apps/ide/github-fs/dist
COPY --from=download-model --chown=node:node /app/apps/ide/models apps/ide/models
USER node
EXPOSE 3003
ENV NODE_ENV=production
ENV PORT=3003
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3003/health || exit 1
CMD ["node", "apps/ide/dist/server.js"]

# ==============================================================================
# CLI / GitLab CI Runner
# ==============================================================================
FROM deps AS build-cli-false
COPY scripts scripts
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
COPY --from=build-cli /app/packages packages
COPY --from=build-cli /app/languages languages
COPY --from=build-cli /app/apps/cli apps/cli
ENV NODE_ENV=production
# The container will run as an executable CLI
ENTRYPOINT ["node", "apps/cli/dist/main.js"]

# ==============================================================================
# Hardened Enterprise Intranet Appliance (Single Container for Regulated Utilities)
# ==============================================================================
FROM node:24-alpine AS appliance
WORKDIR /app

# Create unprivileged application user & directories
RUN mkdir -p /app/apps/api/data /app/apps/api/uploads /app/apps/api/public/thumbnails \
  && chown -R node:node /app

COPY --from=deps --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Copy built API backend
COPY --from=build-api --chown=node:node /app/packages packages
COPY --from=build-api --chown=node:node /app/languages languages
COPY --from=build-api --chown=node:node /app/apps/api apps/api

# Copy pre-compiled Web SPA assets and IDE workbench
COPY --from=build-web --chown=node:node /app/apps/web/dist apps/web/dist
COPY --from=build-ide --chown=node:node /app/apps/ide/dist apps/ide/dist
COPY --from=build-ide --chown=node:node /app/apps/ide/vscode-web apps/ide/vscode-web

USER node
EXPOSE 8080

ENV NODE_ENV=production \
    PORT=8080 \
    ENTERPRISE_APPLIANCE=true \
    AIRGAP_ENFORCED=true \
    STATIC_WEB_DIR=/app/apps/web/dist \
    STATIC_IDE_DIR=/app/apps/ide/dist \
    NODE_OPTIONS="--max-old-space-size=4096"

VOLUME ["/app/apps/api/data", "/app/apps/api/uploads"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["node", "apps/api/dist/main.js"]

