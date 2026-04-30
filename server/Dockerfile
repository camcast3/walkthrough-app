FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o walkthrough-server .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/walkthrough-server .

# Defaults — override via env vars or flags in k8s
ENV DB_PATH=/data/progress.sqlite
ENV WALKTHROUGHS_DIR=/walkthroughs
ENV STATIC_DIR=/static
ENV LISTEN_ADDR=:8080

EXPOSE 8080

ENTRYPOINT ["/app/walkthrough-server"]
