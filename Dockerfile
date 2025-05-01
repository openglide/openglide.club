# syntax=docker/dockerfile:1
FROM alpine:latest AS base
RUN apk update && apk add --upgrade --no-cache go ca-certificates && update-ca-certificates

# Templ 
FROM ghcr.io/a-h/templ:v0.3.865 AS templ
COPY --chown=65532:65532 . /app
WORKDIR /app
RUN ["templ", "generate"]

# Sqlc
FROM alpine AS sqlc
COPY --from=sqlc/sqlc /workspace/sqlc /usr/bin/sqlc
COPY --chown=65532:65532 . /app
WORKDIR /app
RUN ["sqlc", "generate"]

# Build
FROM golang:1.24-alpine AS go-build 
WORKDIR /app
COPY --from=sqlc /app /app
COPY --from=templ /app /app
COPY go.mod go.sum ./
ADD https://github.com/dobicinaitis/tailwind-cli-extra/releases/download/v1.7.11/tailwindcss-extra-linux-x64 tailwindcss 
RUN chmod +x tailwindcss && ./tailwindcss -i ./css/tailwind.css -o ./static/css/styles.css
RUN go mod download
RUN --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 GOOS=linux go build -o ./openglide main.go

# Application
FROM alpine:latest 
WORKDIR /app
COPY --from=base /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=go-build /app/openglide .
EXPOSE 3000
CMD ["/app/openglide"]
