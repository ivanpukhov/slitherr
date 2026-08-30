# WebSocket protocol

Messages are UTF-8 JSON objects with a `type` field.

## Client to server

| Type | Fields | Notes |
| --- | --- | --- |
| `join` | `name`, `skin` | One successful join per socket; name is limited to 24 chars |
| `input` | `angle`, `boost` | Steering intent; coordinates are never accepted |
| `ping` | `t` | Echoed as `pong` for latency measurement |
| `respawn` | — | Respawns a dead player if the session is still active |
| `set_bet` | `amount` | Moves virtual credits into the current match |
| `cashout_request` | — | Returns virtual match credits and closes the session |

## Server to client

| Type | Purpose |
| --- | --- |
| `welcome` | Player id, world dimensions and initial credit state |
| `snapshot` | AOI players/food, own state, tick and leaderboard |
| `pong` | Latency response |
| `balance` | Authoritative virtual-credit update |
| `death` | Killer display name and final length |
| `cashout_confirmed` | Final virtual-credit balance |
| `error` | Stable machine-readable error code |

## Join example

```json
{ "type": "join", "name": "Aida", "skin": "emerald" }
```

The first response:

```json
{
  "type": "welcome",
  "id": "77754b62-7d8c-45bd-8eb8-823421019ce8",
  "width": 4000,
  "height": 4000,
  "radius": 2000,
  "minLength": 10,
  "baseLength": 20,
  "balance": 1000,
  "currentBet": 0
}
```
