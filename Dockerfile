FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/frontend/build ./frontend/build
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 6000
CMD ["node", "server.js"]
