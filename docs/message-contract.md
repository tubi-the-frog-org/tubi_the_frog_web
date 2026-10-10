# Message contract

This is the minimal JSON contract between the phone UI and the teammate system.

## Browser -> server

### session started

```json
{
  "type": "session:start",
  "payload": {
    "sessionId": "session-1730000000000",
    "clientId": "phone-demo-client"
  }
}
```

### transcript

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

### session ended

```json
{
  "type": "session:end"
}
```

## Server -> browser

### session state

```json
{
  "type": "session-state",
  "payload": {
    "state": "active",
    "sessionId": "session-1730000000000",
    "clientId": "phone-demo-client"
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
