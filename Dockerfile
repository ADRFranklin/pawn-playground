# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /server ./cmd/server/


FROM alpine:3.22

RUN addgroup -S pawnpg && adduser -S -G pawnpg pawnpg

WORKDIR /app

COPY --from=builder /server /app/server

RUN mkdir -p /data && chown pawnpg:pawnpg /data

USER pawnpg

EXPOSE 7070

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:7070/ > /dev/null || exit 1

ENTRYPOINT ["/app/server"]
CMD ["--addr", ":7070", "--db", "/data/playground.db"]
