# syntax=docker/dockerfile:1.7

# ---------- deps ----------
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- dev: Vite dev server with HMR (source is bind-mounted) ----------
FROM deps AS dev
ENV VITE_HMR_CLIENT_PORT=80
EXPOSE 5173
CMD ["pnpm", "dev"]

# ---------- build ----------
FROM deps AS build
COPY . .
RUN pnpm build

# ---------- web: nginx serving the SPA and proxying /api ----------
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
