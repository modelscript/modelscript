# ---- Dependencies ----
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/tree-sitter-modelica/package.json packages/tree-sitter-modelica/grammar.js packages/tree-sitter-modelica/binding.gyp packages/tree-sitter-modelica/
COPY packages/tree-sitter-modelica/bindings packages/tree-sitter-modelica/bindings
COPY packages/morsel/package.json packages/morsel/
# Stub out other workspace packages so npm ci doesn't fail
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
RUN npm ci

# ---- Build ----
FROM deps AS build
COPY scripts scripts
COPY packages/core packages/core
COPY packages/tree-sitter-modelica packages/tree-sitter-modelica
COPY packages/morsel packages/morsel
RUN node scripts/download-msl.js && cp scripts/ModelicaStandardLibrary_v4.1.0.zip packages/morsel/public/
RUN npm run build -w packages/core && npm run build -w packages/morsel

# ---- Production ----
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/packages/morsel/build packages/morsel/build
COPY --from=build /app/packages/morsel/package.json packages/morsel/
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm install --omit=dev -w packages/morsel --ignore-scripts

EXPOSE 3000
ENV NODE_ENV=production
CMD ["npx", "react-router-serve", "./packages/morsel/build/server/index.js"]