FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache ca-certificates
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY services/ ./services/
COPY data/ ./data/
COPY --from=builder /app/frontend/build ./frontend/build
EXPOSE 9000
CMD ["node", "server.js"]
