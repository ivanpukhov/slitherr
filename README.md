# Slitherr Multiplayer Server

Authoritative WebSocket backend для multiplayer snake game. Сервер сам считает
движение, столкновения, еду, длину и внутриигровые кредиты, а каждому клиенту
отправляет только ближайшую область мира.

Главный технический акцент — разделение частоты симуляции и сетевых snapshot,
spatial hash для broad-phase поиска и компактный in-memory runtime без базы данных.

## Что внутри

- фиксированный simulation loop с защитой от больших time delta;
- area-of-interest snapshots вместо рассылки всей карты;
- spatial hash для еды, игроков и collision candidates;
- серверная валидация steering/boost и virtual-credit операций;
- heartbeat, лимит сообщений, 16 KiB max payload и один join на socket;
- top-10 leaderboard и bounded event counters;
- HTTP health/stats endpoints на том же порту;
- чистое завершение процесса и тестируемая server factory.

`bet` и `cashout` в протоколе относятся только к виртуальным игровым кредитам.
Проект не содержит платежей, криптовалюты, кошельков или вывода реальных денег.

## Запуск

Нужен Node.js 20+.

```bash
git clone https://github.com/ivanpukhov/slitherr.git
cd slitherr
npm install
cp .env.example .env
npm start
```

WebSocket endpoint: `ws://127.0.0.1:8080`.

```bash
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/stats
```

Для публичного сервера измените `HOST`, поставьте TLS reverse proxy и добавьте
origin/auth checks под конкретный клиент.

## Конфигурация

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP/WebSocket interface |
| `PORT` | `8080` | Общий порт |
| `WORLD_WIDTH` | `4000` | Ширина мира |
| `WORLD_HEIGHT` | `4000` | Высота мира |
| `INITIAL_FOOD` | `900` | Еда при старте |
| `TARGET_FOOD` | `1400` | Целевое количество еды |
| `TICK_RATE` | `40` | Simulation ticks/sec |
| `SNAPSHOT_RATE` | `15` | Snapshots/sec |
| `INITIAL_CREDITS` | `1000` | Стартовые виртуальные кредиты |

## Архитектура

```text
client intent ──► WebSocket gateway ──► authoritative World
                         │                       │
                  validation/rate limit     SpatialHash
                         │                       │
                         └──── AOI snapshot ◄────┘
```

Подробное описание tick loop, AOI, границ доверия и состояния находится в
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Форматы сообщений и примеры — в
[docs/PROTOCOL.md](docs/PROTOCOL.md).

## Тесты

```bash
npm test
```

Тесты проверяют protocol codec, spatial queries, bounded events, серверный баланс,
health/stats и реальный WebSocket join. В CI они запускаются на каждом push и pull
request.

## Ограничения

Состояние одного матча живёт в одном Node.js процессе. Для горизонтального
масштабирования понадобятся matchmaking, shared session storage и маршрутизация
игроков в конкретный match instance.
