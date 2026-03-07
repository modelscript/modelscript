# ---- Build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/web/package.json packages/web/
# Stub out other workspace packages so npm ci doesn't fail
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY packages/morsel/package.json packages/morsel/
COPY packages/cli/package.json packages/cli/
COPY packages/tree-sitter-modelica/package.json packages/tree-sitter-modelica/
RUN npm ci --ignore-scripts
COPY packages/web packages/web
RUN npm run build -w packages/web

# ---- Production ----
FROM nginx:alpine
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
