#!/usr/bin/env python3
"""Extract a version section from CHANGELOG.md for GitHub Release body.

Usage:
  python3 scripts/changelog-for-release.py 0.1.0
  python3 scripts/changelog-for-release.py v0.1.0

Output (stdout): only the version title + CHANGELOG section (what changed).
Install / Gatekeeper notes live in README — not repeated on every Release.

Exit 1 if the version section is missing (fail the release job intentionally).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHANGELOG = ROOT / "CHANGELOG.md"

# One short footer (no full download table / install essay every release).
FOOTER = """
---

### macOS: one command after installing

These builds are not Apple-notarized (community MIT app), so macOS blocks them
on first launch. After dragging **Pi.app** into Applications, run:

```
xattr -dr com.apple.quarantine /Applications/Pi.app
```

Once only. Right-click → Open no longer works: Apple removed that override in
macOS 15 Sequoia and tightened it further in macOS 26 Tahoe.

---

Assets are attached below. Install and develop notes: [README](https://github.com/AJSubrizi/Pi-App#readme) · Full history: [CHANGELOG.md](https://github.com/AJSubrizi/Pi-App/blob/main/CHANGELOG.md)
"""


def normalize_version(raw: str) -> str:
    v = raw.strip()
    if v.startswith("v") or v.startswith("V"):
        v = v[1:]
    return v


def extract_section(text: str, version: str) -> str | None:
    """Return body under ## [version] ... until next ## [ or EOF."""
    pat = re.compile(
        rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## \[|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    m = pat.search(text)
    if not m:
        return None
    return m.group(1).strip()


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: changelog-for-release.py <semver|vX.Y.Z>", file=sys.stderr)
        return 2
    version = normalize_version(sys.argv[1])
    if not CHANGELOG.is_file():
        print(f"error: missing {CHANGELOG}", file=sys.stderr)
        return 1
    text = CHANGELOG.read_text(encoding="utf-8")
    section = extract_section(text, version)
    if not section:
        print(
            f"error: no CHANGELOG section for [{version}]. "
            f"Add `## [{version}] - YYYY-MM-DD` before tagging.",
            file=sys.stderr,
        )
        return 1

    out = f"# Pi v{version}\n\n{section}\n{FOOTER}"
    if not out.endswith("\n"):
        out += "\n"
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass
    try:
        sys.stdout.write(out)
    except UnicodeEncodeError:
        sys.stdout.buffer.write(out.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
