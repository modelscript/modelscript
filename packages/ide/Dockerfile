# ---- Dependencies ----
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/tree-sitter-modelica/package.json packages/tree-sitter-modelica/grammar.js packages/tree-sitter-modelica/binding.gyp packages/tree-sitter-modelica/
COPY packages/tree-sitter-modelica/bindings packages/tree-sitter-modelica/bindings
COPY packages/lsp/package.json packages/lsp/
COPY packages/vscode/package.json packages/vscode/
COPY packages/ide/package.json packages/ide/
# Stub out other workspace packages
COPY packages/api/package.json packages/api/
COPY packages/morsel/package.json packages/morsel/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
RUN npm ci

# ---- Build ----
FROM deps AS build
COPY packages/core packages/core
COPY packages/tree-sitter-modelica packages/tree-sitter-modelica
COPY packages/lsp packages/lsp
COPY packages/vscode packages/vscode
COPY packages/ide packages/ide
COPY packages/morsel packages/morsel
RUN npm run build -w packages/core \
    && npm run build -w packages/lsp \
    && npm run build -w packages/vscode \
    && npm run build -w packages/ide

# ---- Production ----
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# Stub package.json for npm ci --omit=dev (only need the runtime workspaces)
COPY packages/ide/package.json packages/ide/
COPY packages/vscode/package.json packages/vscode/
# We still need the root and some stubs because package-lock.json expects them
COPY packages/api/package.json packages/api/
COPY packages/morsel/package.json packages/morsel/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/lsp/package.json packages/lsp/
COPY packages/tree-sitter-modelica/package.json packages/tree-sitter-modelica/grammar.js packages/tree-sitter-modelica/binding.gyp packages/tree-sitter-modelica/
RUN npm ci --omit=dev --ignore-scripts

# Copy IDE server build artifacts
COPY --from=build /app/packages/ide/dist packages/ide/dist
COPY --from=build /app/packages/ide/vscode-web packages/ide/vscode-web
COPY --from=build /app/packages/ide/github-fs/dist packages/ide/github-fs/dist

# Copy VS Code extension
COPY --from=build /app/packages/vscode/dist packages/vscode/dist
COPY --from=build /app/packages/vscode/syntaxes packages/vscode/syntaxes
COPY --from=build /app/packages/vscode/language-configuration.json packages/vscode/

# Copy Morsel's favicon so IDE can serve it
COPY --from=build /app/packages/morsel/public packages/morsel/public

# Provide @vscode/test-web templates from dev dependencies
COPY --from=build /app/node_modules/@vscode node_modules/@vscode

EXPOSE 3200
ENV NODE_ENV=production
ENV PORT=3200
CMD ["node", "packages/ide/dist/server.js"]
