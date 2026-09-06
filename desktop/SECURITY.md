# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a vulnerability

If you find a security issue in this desktop shell (token leakage, unsafe process spawn, local secrets exposure, etc.), please report it **privately** via a GitHub Security Advisory on the project repository.

Include:

- Clear description  
- Steps to reproduce  
- Impact if known  

Do **not** open a public issue for sensitive vulnerabilities until a fix is available.

## Local security notes

- Prefer **Pi’s own auth and config** under `~/.pi/agent` for provider credentials  
- App-side secrets (if any) prefer the **OS secret store** (Keychain / Credential Manager / Secret Service), with a mode-`0600` file fallback under the app data root  
- Do not commit `secrets.json`, API keys, or agent homes  
- High-trust modes (e.g. always-approve / YOLO-style flows) can run tools without per-step prompts — enable only on trusted workspaces  
- Support / Doctor exports should never ship raw secrets or keychain material  
