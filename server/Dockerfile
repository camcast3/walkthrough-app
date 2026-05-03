# Stage 1: Build the SvelteKit webapp
FROM node:22-alpine AS webapp-builder
WORKDIR /webapp
COPY webapp/package.json webapp/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY webapp/ ./
RUN npm run build

# Stage 2: Build the Go server
FROM golang:1.26.2-alpine AS server-builder
WORKDIR /app
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ .
ARG SERVER_VERSION=dev
RUN go build -ldflags "-X main.Version=${SERVER_VERSION}" -o walkthrough-server .

# Stage 3: Final image with webapp and server
FROM alpine:3.23
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=server-builder /app/walkthrough-server .
COPY --from=webapp-builder /webapp/build /static

ENV APP_MODE=server
ENV STATIC_DIR=/static
ENV LISTEN_ADDR=:8080

EXPOSE 8080

ENTRYPOINT ["/app/walkthrough-server"]
