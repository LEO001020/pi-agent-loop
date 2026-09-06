#!/usr/bin/env bash
# Generate Tauri app icons + tray icons from two separate sources.
# Do NOT mix pipelines:
#   App dock / .exe / .icns  ←  icon (1).png | icon-source.png | icon.png
#   Menu bar / system tray  ←  docs/svg/logo.svg  (black template, retina 36px)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICONS="$ROOT/src-tauri/icons"
SVG="$ROOT/docs/svg/logo.svg"
# Prefer explicit master artwork; fall back to existing icon.png / icon-source.png
SRC_APP=""
for candidate in \
  "$ICONS/icon (1).png" \
  "$ICONS/icon-source.png" \
  "$ICONS/icon.png"
do
  if [[ -f "$candidate" ]]; then
    SRC_APP="$candidate"
    break
  fi
done

if [[ -z "$SRC_APP" ]]; then
  echo "Missing app icon source: icon (1).png, icon-source.png, or icon.png" >&2
  exit 1
fi
if [[ ! -f "$SVG" ]]; then
  echo "Missing tray source: docs/svg/logo.svg" >&2
  exit 1
fi

command -v sips >/dev/null || { echo "sips required (macOS)" >&2; exit 1; }
IM=""
if command -v magick >/dev/null 2>&1; then
  IM=magick
elif command -v convert >/dev/null 2>&1; then
  IM=convert
fi

# Keep a stable master copy for regenerations (skip no-op self-copy)
if [[ "$(cd "$(dirname "$SRC_APP")" && pwd)/$(basename "$SRC_APP")" != "$ICONS/icon-source.png" ]]; then
  cp "$SRC_APP" "$ICONS/icon-source.png"
fi
MASTER_RAW="$ICONS/icon-source.png"
# Squircle-masked master used for dock / .app icons (transparent corners so
# the mark reads round next to other macOS Dock apps, including debug binaries).
MASTER="$ICONS/icon-squircle.png"

python3 - <<'PY' "$MASTER_RAW" "$MASTER"
"""Bake a macOS-like continuous-corner (squircle) mask into the app icon."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFilter

src_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])
src = Image.open(src_path).convert("RGBA")
SIZE = 1024
# Slight inset so baked-squircle Dock icons match neighbors (system-masked
# full-bleed icons read a touch smaller than a 100%-canvas baked mask).
SCALE = 0.92
inner = int(round(SIZE * SCALE))
art = src.resize((inner, inner), Image.Resampling.LANCZOS)
base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
off = (SIZE - inner) // 2
base.paste(art, (off, off))

# Superellipse mask (n≈5) ≈ macOS squircle.
try:
    import numpy as np

    c = (SIZE - 1) / 2.0
    r = (inner / 2.0) * 0.99
    ys, xs = np.ogrid[:SIZE, :SIZE]
    nx = np.abs(xs - c) / r
    ny = np.abs(ys - c) / r
    inside = (nx ** 5) + (ny ** 5) <= 1.0
    mask = Image.fromarray((inside.astype("uint8") * 255), mode="L")
except ImportError:
    # Fallback: rounded-rect at Apple-ish radius (~22.4% of side).
    mask = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(mask)
    rad = int(round(inner * 0.2237))
    draw.rounded_rectangle(
        (off, off, off + inner - 1, off + inner - 1), radius=rad, fill=255
    )

mask = mask.filter(ImageFilter.GaussianBlur(radius=max(1, int(SIZE * 0.003))))
out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
out.paste(base, (0, 0), mask)
out.save(out_path, "PNG")
print(f"squircle master: {out_path} ({SIZE}x{SIZE}, scale={SCALE})")
PY

# App icons (full-color artwork, squircle-masked)
sips -z 512 512 "$MASTER" --out "$ICONS/icon.png" >/dev/null
sips -z 32 32 "$MASTER" --out "$ICONS/32x32.png" >/dev/null
sips -z 64 64 "$MASTER" --out "$ICONS/64x64.png" >/dev/null
sips -z 128 128 "$MASTER" --out "$ICONS/128x128.png" >/dev/null
sips -z 256 256 "$MASTER" --out "$ICONS/128x128@2x.png" >/dev/null

# .icns via iconutil
ICONSET="$ICONS/AppIcon.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for pair in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"
do
  set -- $pair
  sips -z "$1" "$1" "$MASTER" --out "$ICONSET/$2" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$ICONS/icon.icns"
rm -rf "$ICONSET"

if [[ -n "$IM" ]]; then
  $IM "$MASTER" -define icon:auto-resize=256,128,64,48,32,24,16 "$ICONS/icon.ico"
else
  python3 - <<'PY' "$MASTER" "$ICONS/icon.ico"
from pathlib import Path
import sys
from PIL import Image
src = Image.open(sys.argv[1]).convert("RGBA")
sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
imgs = [src.resize(s, Image.Resampling.LANCZOS) for s in sizes]
imgs[0].save(sys.argv[2], format="ICO", sizes=sizes)
print("icon.ico via Pillow")
PY
fi

# ── Tray / menu-bar from logo.svg ───────────────────────────────────────────
# tray-icon crate sizes the NSImage to 18pt tall. Embed 36px (@2x) so retina
# is sharp. Pad content ~14% so the mark doesn't fill the bar as a solid blob.
if [[ -z "$IM" ]]; then
  echo "WARN — ImageMagick missing; skipping tray regenerate (keeping existing tray-*.png)"
else
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
python3 - <<'PY' "$SVG" "$TMP/logo-black.svg"
import re, sys
from pathlib import Path
t = Path(sys.argv[1]).read_text()
t = t.replace("currentColor", "#000000")
t = re.sub(r'\sclass="[^"]*"', "", t)
Path(sys.argv[2]).write_text(t)
PY

$IM -background none -density 400 "$TMP/logo-black.svg" -resize 512x512 "$TMP/hi.png"

python3 - <<'PY' "$TMP" "$ICONS"
from pathlib import Path
import sys
from PIL import Image

tmp, icons = Path(sys.argv[1]), Path(sys.argv[2])
hi = Image.open(tmp / "hi.png").convert("RGBA")
pix = hi.load()
w, h = hi.size
xs, ys = [], []
for y in range(h):
    for x in range(w):
        if pix[x, y][3] > 8:
            xs.append(x)
            ys.append(y)
if not xs:
    raise SystemExit("SVG raster empty — check logo.svg / currentColor")
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
m = 4
crop = hi.crop((max(0, x0 - m), max(0, y0 - m), min(w, x1 + 1 + m), min(h, y1 + 1 + m)))

def pack(src: Image.Image, size: int, pad_ratio: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = max(1, int(round(size * (1.0 - 2 * pad_ratio))))
    cw, ch = src.size
    scale = min(inner / cw, inner / ch)
    nw = max(1, int(round(cw * scale)))
    nh = max(1, int(round(ch * scale)))
    resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
    _r, _g, _b, a = resized.split()
    a = a.point(lambda v: min(255, int(v * 1.15)) if v > 12 else 0)
    black = Image.new("L", resized.size, 0)
    resized = Image.merge("RGBA", (black, black, black, a))
    ox, oy = (size - nw) // 2, (size - nh) // 2
    canvas.alpha_composite(resized, (ox, oy))
    return canvas

outs = {
    "tray-icon.png": (36, 0.14),
    "tray-icon@2x.png": (36, 0.14),
    "tray-icon-18.png": (18, 0.14),
    "tray-16.png": (16, 0.12),
    "tray-32.png": (32, 0.12),
    "tray-source.png": (128, 0.10),
}
for name, (sz, pad) in outs.items():
    im = pack(crop, sz, pad)
    im.save(icons / name, "PNG")
    n = sum(1 for p in im.getdata() if p[3] > 20)
    print(f"{name}: {sz}x{sz} opaque={n}")
    if sz <= 36 and n < 40:
        raise SystemExit(f"{name} looks too empty (opaque={n})")
PY
fi

echo "OK — app icons from: $SRC_APP (squircle-masked for Dock)"
echo "OK — tray icons from: $SVG (36px @2x for 18pt menu bar)"
echo "Remember: dock uses icon*.png/icns/ico; tray uses tray-*.png only."
