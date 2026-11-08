#!/bin/sh
set -eu

: "${NANO_PORTAL_BUS_URL:?set NANO_PORTAL_BUS_URL to the bus address}"

/app/nanoportal-server &
backend_pid=$!

nginx -g 'daemon off;' &
nginx_pid=$!

shutdown() {
    kill -TERM "$backend_pid" "$nginx_pid" 2>/dev/null || true
}

trap shutdown INT TERM

while true; do
    if ! kill -0 "$backend_pid" 2>/dev/null; then
        wait "$backend_pid"
        backend_status=$?
        kill -TERM "$nginx_pid" 2>/dev/null || true
        wait "$nginx_pid" || true
        exit "$backend_status"
    fi

    if ! kill -0 "$nginx_pid" 2>/dev/null; then
        wait "$nginx_pid"
        nginx_status=$?
        kill -TERM "$backend_pid" 2>/dev/null || true
        wait "$backend_pid" || true
        exit "$nginx_status"
    fi

    sleep 1
done
