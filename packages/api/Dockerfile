# ---- Dependencies ----
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/tree-sitter-modelica/package.json packages/tree-sitter-modelica/grammar.js packages/tree-sitter-modelica/binding.gyp packages/tree-sitter-modelica/
COPY packages/tree-sitter-modelica/bindings packages/tree-sitter-modelica/bindings
COPY packages/api/package.json packages/api/
# Stub out other workspace packages so npm ci doesn't fail
COPY packages/morsel/package.json packages/morsel/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
RUN npm ci --ignore-scripts
# Manually run tree-sitter-cli install hook (skipped by --ignore-scripts) to fetch the native binary
RUN cd node_modules/tree-sitter-cli && node install.js
# Generate tree-sitter parser and build native addon (separate layer for caching)
RUN cd packages/tree-sitter-modelica && npx tree-sitter generate --abi=14 && npx node-gyp rebuild

# ---- Build ----
FROM deps AS build
COPY packages/core packages/core
COPY packages/tree-sitter-modelica packages/tree-sitter-modelica
COPY packages/api packages/api
RUN npm run build -w packages/core && npm run build -w packages/api

# ---- Production ----
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/tree-sitter-modelica/package.json packages/tree-sitter-modelica/grammar.js packages/tree-sitter-modelica/binding.gyp packages/tree-sitter-modelica/
COPY packages/tree-sitter-modelica/bindings packages/tree-sitter-modelica/bindings
COPY packages/api/package.json packages/api/
COPY packages/morsel/package.json packages/morsel/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
RUN npm ci --omit=dev --ignore-scripts
# Copy pre-built native addon from deps stage
COPY --from=deps /app/packages/tree-sitter-modelica/src packages/tree-sitter-modelica/src
COPY --from=deps /app/packages/tree-sitter-modelica/build packages/tree-sitter-modelica/build
COPY --from=deps /app/node_modules/@modelscript/tree-sitter-modelica node_modules/@modelscript/tree-sitter-modelica
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/api/dist packages/api/dist

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "packages/api/dist/main.js"]
