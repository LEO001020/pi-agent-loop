#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${PI_LOOP_NODE:-}" ]; then
  NODE=$PI_LOOP_NODE
elif command -v node >/dev/null 2>&1; then
  NODE=$(command -v node)
elif [ -x /root/node22/bin/node ]; then
  NODE=/root/node22/bin/node
else
  printf '%s\n' 'Node.js >=22.19.0 is required; set PI_LOOP_NODE to its absolute executable.' >&2
  exit 2
fi
export PATH="$(dirname -- "$NODE"):$PATH"
exec "$NODE" "$ROOT/bin/pi-agent-loop.mjs" "$@"
