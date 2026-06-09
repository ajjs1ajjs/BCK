# ---- Build frontend ----
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- Install backend production deps ----
FROM node:20-alpine AS backend-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts

# ---- Final image ----
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata

# Create non-root user
RUN addgroup -S bck && adduser -S bck -G bck

COPY --from=backend-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY services/ ./services/
COPY --from=frontend-builder /app/build ./frontend/build

RUN chown -R bck:bck /app

USER bck
EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:9000/health || exit 1

CMD ["node", "server.js"]
