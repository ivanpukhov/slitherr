# Architecture

## Runtime model

The server is authoritative: clients send intent (`join`, steering angle, boost,
respawn and virtual-credit actions), while movement, collisions, food pickup,
balances and leaderboard positions are calculated inside `World`.

```text
WebSocket clients
      │ compact JSON messages
      ▼
connection gateway ── rate limit / heartbeat / validation
      │
      ▼
authoritative World ── fixed tick loop (40 Hz by default)
      │
      ├─ SpatialHash for nearby players and food
      ├─ collision and movement simulation
      └─ bounded in-memory event counters
      │
      ▼
AOI snapshots (15 Hz by default) ──► each client
```

HTTP is intentionally small. `/healthz` is suitable for a container probe and
`/stats` reports aggregate process state. Gameplay uses the same listener through
WebSocket upgrade.

## Area of interest

Sending the complete world on every frame becomes expensive as the number of
objects grows. `SpatialHash` divides the map into 128-pixel cells. For every
player, the snapshot loop queries only cells intersecting the configured view
radius and then performs an exact distance check. Collision detection uses the
same index with a smaller radius.

This changes the usual broad-phase search from comparing every object with every
other object to looking at a small local candidate set.

## Timing

- simulation: 40 ticks/second;
- snapshots: 15 messages/second per active player;
- heartbeat: every 10 seconds;
- input: at most 60 messages/second, with a 10 ms steering interval;
- frame delta: capped at 100 ms so a stalled event loop cannot create a huge jump.

Simulation and network frequencies are independent. This allows the server to
keep movement stable while reducing outbound bandwidth.

## State and persistence

Player and world state are ephemeral. A process restart starts a new match. The
recent kill buffer is bounded to 100 events and never writes player activity to a
repository file.

The balance/bet protocol represents in-game credits only. There is no wallet,
blockchain, payment provider or real-money withdrawal in this repository.

## Trust boundaries

The gateway limits payloads to 16 KiB, disables WebSocket compression, accepts a
single join per connection, trims names and caps message frequency. The server
does not trust client coordinates, length, score or balance.

For an internet-facing deployment, add origin checks, distributed rate limiting,
authentication and a shared state layer before running multiple instances.
