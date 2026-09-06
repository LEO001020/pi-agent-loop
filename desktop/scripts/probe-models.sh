#!/usr/bin/env bash
# Probe which Pi CLI CLI models are actually selectable + usable.
# Usage: ./scripts/probe-models.sh [extra-model-ids...]
set -uo pipefail

PI_BIN="${PI_BIN:-$(command -v pi || true)}"
if [[ -z "${PI_BIN}" ]]; then
  echo "ERROR: pi CLI not found on PATH" >&2
  exit 1
fi

TIMEOUT_SECS="${TIMEOUT_SECS:-45}"
OUT_DIR="${OUT_DIR:-/tmp/pi-model-probe}"
mkdir -p "$OUT_DIR"

echo "== Pi CLI =="
echo "bin: $PI_BIN"
"$PI_BIN" --version 2>/dev/null || true
echo

echo "== pi models (official list) =="
"$PI_BIN" models 2>&1 | tee "$OUT_DIR/models-list.txt"
echo

echo "== models_cache.json keys =="
CACHE="${PI_AGENT_HOME:-$HOME/.pi}/models_cache.json"
if [[ -f "$CACHE" ]]; then
  python3 - <<PY | tee "$OUT_DIR/cache-keys.txt"
import json
from pathlib import Path
p = Path("$CACHE")
d = json.loads(p.read_text())
print("fetched_at:", d.get("fetched_at"))
print("origin:", d.get("origin"))
models = d.get("models") or {}
print("count:", len(models))
for mid, body in models.items():
    info = (body or {}).get("info") or {}
    print(f"  - {mid}: name={info.get('name')!r} hidden={info.get('hidden')} supported_in_api={info.get('supported_in_api')}")
PY
else
  echo "(no $CACHE)"
fi
echo

# Candidates: catalog defaults + common historical aliases + any CLI args
DEFAULT_CANDIDATES=(
  pi-4.5
  pi-build
  pi-4
  pi-4-fast
  pi-4.1
  pi-4-latest
  pi-3
  pi-2
  pi-code
  pi-code-fast-1
)
CANDIDATES=("${DEFAULT_CANDIDATES[@]}" "$@")

# de-dupe
declare -A SEEN=()
UNIQUE=()
for m in "${CANDIDATES[@]}"; do
  [[ -n "${SEEN[$m]:-}" ]] && continue
  SEEN[$m]=1
  UNIQUE+=("$m")
done

echo "== Live probe (pi -m <id> -p ...) =="
printf "%-20s %-10s %s\n" "MODEL" "STATUS" "NOTE"
printf "%-20s %-10s %s\n" "-----" "------" "----"

RESULTS_JSON="$OUT_DIR/results.json"
echo "[" > "$RESULTS_JSON"
first=1

for m in "${UNIQUE[@]}"; do
  log="$OUT_DIR/${m//\//_}.log"
  # shellcheck disable=SC2086
  if command -v timeout >/dev/null 2>&1; then
    timeout "$TIMEOUT_SECS" "$PI_BIN" -m "$m" -p "Reply with exactly one line: MODEL_OK=$m" --output-format plain >"$log" 2>&1
    code=$?
  else
    "$PI_BIN" -m "$m" -p "Reply with exactly one line: MODEL_OK=$m" --output-format plain >"$log" 2>&1
    code=$?
  fi

  body=$(tr '\n' ' ' <"$log" | sed 's/  */ /g' | head -c 240)
  status="fail"
  note=""
  if grep -qi "unknown model id\|Couldn't set model\|Invalid params" "$log"; then
    status="invalid"
    note="CLI rejects model id"
  elif grep -q "MODEL_OK=$m" "$log"; then
    status="ok"
    note="live reply matched"
  elif [[ $code -eq 124 ]]; then
    status="timeout"
    note="exceeded ${TIMEOUT_SECS}s"
  elif [[ $code -eq 0 ]]; then
    status="ok?"
    note="exit0 but marker missing: ${body}"
  else
    status="error"
    note="exit=$code ${body}"
  fi

  printf "%-20s %-10s %s\n" "$m" "$status" "$note"

  if [[ $first -eq 0 ]]; then echo "," >> "$RESULTS_JSON"; fi
  first=0
  python3 - <<PY >> "$RESULTS_JSON"
import json
print(json.dumps({"model":"$m","status":"$status","exit":$code,"note":"""$note"""} , ensure_ascii=False), end="")
PY
done

echo >> "$RESULTS_JSON"
echo "]" >> "$RESULTS_JSON"

echo
echo "Logs: $OUT_DIR"
echo "JSON: $RESULTS_JSON"
