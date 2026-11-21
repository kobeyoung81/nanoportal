FROM kobeyoung81/base-node:26.13.1-alpine3.24-r3 AS web-build

WORKDIR /src/web

COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,id=nanosec-npm,target=/root/.npm \
    npm ci --no-audit --no-fund --prefer-offline

COPY web/ ./
RUN npm run build

FROM kobeyoung81/base-go:1.27.4-alpine3.24-r3 AS server-build

WORKDIR /src

COPY go.mod go.sum ./
RUN --mount=type=cache,id=nanosec-gomod,target=/root/go/pkg/mod \
    --mount=type=cache,id=nanosec-gocache,target=/root/.cache/go-build \
    go mod download

COPY server/ ./server/
ARG VERSION=dev
RUN --mount=type=cache,id=nanosec-gomod,target=/root/go/pkg/mod \
    --mount=type=cache,id=nanosec-gocache,target=/root/.cache/go-build \
    go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/nanoportal-server ./server/cmd/nanoportal

FROM kobeyoung81/base-runtime:alpine3.24.4-r3 AS runtime

# The portal is the one service that serves its own front end, so it is the one
# service that installs a package of its own (the runtime base already brings
# ca-certificates and tzdata).
#
# This RUN comes before the version ARGs on purpose. BuildKit folds the build
# arguments that precede an instruction into its cache key, and VERSION changes
# on every commit: with the ARGs above this line the nginx install re-ran on
# every build (79 s of apk download, measured).
RUN apk add --no-cache nginx && \
    mkdir -p /run/nginx /app && \
    rm -rf /var/cache/apk/* /tmp/*

# Build metadata. All three come from the tagged commit (the version tag, the
# commit sha, and that commit's time), so two builds of one tag describe the same
# moment. `created` must be RFC 3339; the build script passes the commit time.
ARG VERSION=dev
ARG COMMIT=none
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="nanoportal" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://gitee.com/kobeyoung81/nanoportal" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

COPY --from=server-build /out/nanoportal-server /app/nanoportal-server
COPY --from=web-build /src/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/http.d/default.conf
COPY --chmod=755 deploy/entrypoint.sh /entrypoint.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

ENTRYPOINT ["/entrypoint.sh"]
