# Message contract

This is the minimal JSON contract between the phone UI and the teammate system.

## Browser -> server

Session ownership is managed through HTTP. The server is the only component that
can acquire or release the single-user lock. The `sessionId` returned by start
is an owner token: keep it in tab-scoped storage and send it only to these
session endpoints. It is not broadcast over WebSocket.

| Request | Purpose |
| --- | --- |
| `POST /api/session/start` | Acquire the lock; returns `sessionId` |
| `POST /api/session/resume` | Reclaim the current tab's session after refresh |
| `POST /api/session/heartbeat` | Renew the idle timeout; send every 15 seconds |
| `POST /api/session/end` | Release the lock |
| `POST /api/transcribe` | Upload audio; requires the active `sessionId` |

The server releases a session after 60 seconds without an owner heartbeat and
enforces a 3-minute maximum duration. Configure these with
`SESSION_IDLE_TIMEOUT_MS` and `SESSION_MAX_DURATION_MS`.

### transcript event

```json
{
  "type": "transcript",
  "payload": {
    "text": "I would like a crunchy snack.",
    "isFinal": true,
    "timestamp": 1730000000000
  }
}
```

## Server -> browser

### session state

```json
{
  "type": "session-state",
  "payload": {
    "state": "active",
    "startedAt": 1730000000000
  }
}
```

### display event

```json
{
  "type": "inkblot",
  "payload": {
    "seed": "wizard-42",
    "message": "Tubi is showing an inkblot."
  }
}
```

### transcript event

```json
{
  "type": "transcript",
  "payload": {
    "text": "I would like a crunchy snack.",
    "source": "fake-backend"
  }
}
```

## Teammate -> server

The teammate system can connect outbound to the same server and send events like these:

```json
{
  "type": "display",
  "payload": {
    "kind": "result",
    "snack": "Crispy Cranberry Crunch"
  }
}
```

```json
{
  "type": "display",
  "payload": {
    "kind": "inkblot",
    "seed": "wizard-42"
  }
}
```

```json
{
  "type": "state",
  "payload": {
    "speaking": true
  }
}
```
