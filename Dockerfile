# --- Frontend build ---
FROM node:24-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Backend build ---
FROM golang:1.26-alpine AS backend
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /server .

# --- Runtime ---
FROM alpine:3.20
RUN apk add --no-cache tzdata ca-certificates && adduser -D -u 10001 app
WORKDIR /app
COPY --from=backend /server /app/server
COPY --from=frontend /app/frontend/dist /app/static
ENV STATIC_DIR=/app/static \
    DB_PATH=/data/app.db \
    UPLOADS_DIR=/data/uploads \
    PORT=8080
RUN mkdir -p /data && chown app:app /data
USER app
VOLUME ["/data"]
EXPOSE 8080
CMD ["/app/server"]
