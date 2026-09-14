# syntax=docker/dockerfile:1

# 1. Build the React SPA (outputs into internal/assets/dist)
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2. Build the Go binary, embedding the SPA. Pure-Go SQLite driver => static binary.
FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
COPY --from=web /app/internal/assets/dist ./internal/assets/dist
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /cortex ./cmd/cortex

# 3. Minimal runtime
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /cortex /cortex
ENV CORTEX_ADDR=:8080 CORTEX_DB_PATH=/data/cortex.db
EXPOSE 8080
VOLUME ["/data"]
USER nonroot:nonroot
ENTRYPOINT ["/cortex"]
