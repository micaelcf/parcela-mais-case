#!/usr/bin/env bash
# Waits until https://parcela.localhost:8443/api/health answers through Caddy, verified against
# the local CA `bun run up` creates. Fails early if the `up` process (pid in $1) has exited, and
# prints its log ($2) on failure.
set -euo pipefail

pid="$1"
log="$2"
ca=.local/caddy/caddy/pki/authorities/local/root.crt
deadline=$((SECONDS + 300))

while ((SECONDS < deadline)); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "::error::bun run up exited before the stack was ready"
    cat "$log"
    exit 1
  fi
  if [[ -f "$ca" ]] && curl -fsS --cacert "$ca" https://parcela.localhost:8443/api/health; then
    echo
    echo "stack ready after ${SECONDS}s"
    exit 0
  fi
  sleep 3
done

echo "::error::the stack wasn't ready within 300 s"
cat "$log"
exit 1
