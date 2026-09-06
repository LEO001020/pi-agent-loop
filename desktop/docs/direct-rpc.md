# Direct RPC gateway

Pi can connect to a managed remote runtime without starting an SSH process. This
mode is intended for teams that already operate a secure gateway in front of
`pi --mode rpc`.

SSH remains the recommended connection for personal servers because it needs no
additional service.

## Security contract

- The endpoint must use `wss://`. Plain `ws://` is rejected.
- The client sends `Authorization: Bearer <token>` during the WebSocket upgrade.
- Credentials embedded in the URL are rejected.
- The token is stored in the operating-system keychain. It is never serialized
  into Pi settings or logs.
- The gateway must authenticate and authorize the requested workspace. The
  desktop client cannot enforce server-side filesystem boundaries.

## Wire protocol

The gateway starts one Pi RPC process for the authenticated connection:

```sh
pi --mode rpc --approve
```

It then proxies records without changing their JSON:

- each WebSocket text message from the app is one JSONL record for Pi stdin;
- each complete JSONL record from Pi stdout is one WebSocket text message;
- Pi stderr may be logged by the gateway but must not be mixed into the JSONL
  stream;
- closing either side terminates the Pi process and the WebSocket;
- binary frames are accepted by the desktop client for compatibility, but text
  frames are the required gateway format.

The current connection does not negotiate a custom protocol. A gateway should
reject unsupported clients during authentication or close with an explanatory
WebSocket reason.

## Operational requirements

Use TLS certificates trusted by the operating system, short-lived scoped bearer
tokens, request and connection limits, and one isolated Pi process per
connection. Never expose a raw TCP or `socat` bridge to the public internet.
