FROM node:22-alpine AS web-build

WORKDIR /src/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

FROM golang:1.24-alpine AS server-build

WORKDIR /src

RUN go env -w GO111MODULE=on
RUN go env -w GOPROXY=https://goproxy.cn,direct

COPY go.mod go.sum ./
RUN go mod download

COPY server/ ./server/
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/nanoportal-server ./server/cmd/nanoportal

FROM alpine:3.22 AS runtime

RUN apk add --no-cache ca-certificates nginx && \
    mkdir -p /run/nginx /app

COPY --from=server-build /out/nanoportal-server /app/nanoportal-server
COPY --from=web-build /src/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/http.d/default.conf
COPY --chmod=755 deploy/entrypoint.sh /entrypoint.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

ENTRYPOINT ["/entrypoint.sh"]
