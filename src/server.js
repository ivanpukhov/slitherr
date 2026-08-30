require('dotenv').config()

const http = require('node:http')

const WebSocket = require('ws')

const { createConfig } = require('./config')
const { EventBuffer } = require('./events')
const {
    decode,
    encode,
    MSG_CASHOUT_REQUEST,
    MSG_ERROR,
    MSG_INPUT,
    MSG_JOIN,
    MSG_PING,
    MSG_PONG,
    MSG_RESPAWN,
    MSG_SET_BET,
    MSG_SNAPSHOT,
    MSG_WELCOME,
} = require('./protocol')
const { World } = require('./world')

const json = (response, status, payload) => {
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    })
    response.end(JSON.stringify(payload))
}

const allowedSkins = new Set([
    'default',
    'emerald',
    'crimson',
    'amber',
    'violet',
    'obsidian',
    'mint',
])

const sanitizeName = (value) => String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24)
const sanitizeSkin = (value) => {
    const skin = String(value || 'default').trim()
    return allowedSkins.has(skin) ? skin : 'default'
}

function createGameServer(overrides = {}) {
    const cfg = createConfig(overrides)
    const events = new EventBuffer(100)
    const world = new World(cfg, events)
    const sockets = new Map()
    const intervals = []
    const startedAt = Date.now()

    const server = http.createServer((request, response) => {
        if (request.method === 'GET' && request.url === '/healthz') {
            return json(response, 200, { status: 'ok' })
        }
        if (request.method === 'GET' && request.url === '/stats') {
            return json(response, 200, {
                uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
                players: world.players.size,
                food: world.foods.size,
                tick: world.tickId,
                kills: events.killCount,
            })
        }
        return json(response, 404, { error: 'not_found' })
    })
    const wss = new WebSocket.Server({
        server,
        maxPayload: 16 * 1024,
        perMessageDeflate: false,
    })

    const send = (socket, payload) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(encode(payload))
    }

    wss.on('connection', (socket) => {
        socket.isAlive = true
        socket.lastJoinTs = 0

        socket.on('pong', () => {
            socket.isAlive = true
        })

        socket.on('message', (data) => {
            const message = decode(data)
            if (!message || typeof message.type !== 'string') return

            if (message.type === MSG_PING) {
                send(socket, { type: MSG_PONG, t: message.t })
                return
            }

            if (message.type === MSG_JOIN) {
                if (sockets.has(socket)) {
                    send(socket, { type: MSG_ERROR, code: 'already_joined' })
                    return
                }
                const now = Date.now()
                if (now - socket.lastJoinTs < cfg.joinThrottleMs) return
                socket.lastJoinTs = now
                const player = world.addPlayer(
                    socket,
                    sanitizeName(message.name),
                    sanitizeSkin(message.skin),
                )
                sockets.set(socket, player.id)
                send(socket, {
                    type: MSG_WELCOME,
                    id: player.id,
                    width: cfg.width,
                    height: cfg.height,
                    radius: world.radius,
                    minLength: cfg.minLength,
                    baseLength: cfg.baseLength,
                    balance: player.balance,
                    currentBet: player.currentBet,
                })
                return
            }

            const id = sockets.get(socket)
            const player = id ? world.players.get(id) : null
            if (!player) return

            const now = Date.now()
            if (now - player.lastMsgWindowTs > 1000) {
                player.lastMsgWindowTs = now
                player.msgCountWindow = 0
            }
            player.msgCountWindow += 1
            if (player.msgCountWindow > cfg.maxMsgsPerSec) return

            if (message.type === MSG_INPUT) world.handleInput(player, message)
            if (message.type === MSG_SET_BET) {
                const result = world.placeBet(player, message.amount)
                if (!result?.ok) send(socket, { type: MSG_ERROR, code: result?.error || 'bet_failed' })
            }
            if (message.type === MSG_RESPAWN) world.respawn(player)
            if (message.type === MSG_CASHOUT_REQUEST) {
                const result = world.cashOut(player)
                if (!result?.ok) {
                    send(socket, { type: MSG_ERROR, code: result?.error || 'cashout_failed' })
                } else {
                    setTimeout(() => socket.close(1000, 'cashout'), 100)
                }
            }
        })

        socket.on('close', () => {
            const id = sockets.get(socket)
            sockets.delete(socket)
            if (id) world.removePlayer(id)
        })
    })

    const startLoops = () => {
        intervals.push(setInterval(() => {
            wss.clients.forEach((socket) => {
                if (socket.isAlive === false) return socket.terminate()
                socket.isAlive = false
                socket.ping()
            })
        }, cfg.heartbeatIntervalMs))

        let lastTick = Date.now()
        intervals.push(setInterval(() => {
            const now = Date.now()
            const deltaSeconds = Math.min((now - lastTick) / 1000, 0.1)
            lastTick = now
            world.tick(deltaSeconds)
        }, Math.floor(1000 / cfg.tickRate)))

        intervals.push(setInterval(() => {
            const leaderboard = Array.from(world.players.values())
                .filter((player) => player.alive)
                .sort((left, right) => right.length - left.length)
                .slice(0, 10)
                .map((player) => ({ name: player.name, length: Math.floor(player.length) }))

            for (const player of world.players.values()) {
                const area = world.aoiFor(player)
                send(player.ws, {
                    type: MSG_SNAPSHOT,
                    tick: world.tickId,
                    you: {
                        id: player.id,
                        x: player.x,
                        y: player.y,
                        angle: player.angle,
                        length: player.length,
                        alive: player.alive,
                        balance: Math.max(0, Math.floor(player.balance || 0)),
                        currentBet: Math.max(0, Math.floor(player.currentBet || 0)),
                        totalBalance: Math.max(
                            0,
                            Math.floor((player.balance || 0) + (player.currentBet || 0)),
                        ),
                    },
                    players: area.players,
                    foods: area.foods,
                    leaderboard,
                })
            }
        }, Math.floor(1000 / cfg.snapshotRate)))
    }

    const start = () => new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(cfg.port, cfg.host, () => {
            server.off('error', reject)
            startLoops()
            resolve(server.address())
        })
    })

    const close = () => new Promise((resolve) => {
        intervals.splice(0).forEach(clearInterval)
        wss.clients.forEach((socket) => socket.terminate())
        wss.close(() => server.close(resolve))
    })

    return { cfg, close, events, server, start, world, wss }
}

if (require.main === module) {
    const game = createGameServer()
    game.start().then((address) => {
        console.log(`Slitherr server is listening on ws://${address.address}:${address.port}`)
    }).catch((error) => {
        console.error(error.message)
        process.exitCode = 1
    })

    const shutdown = async () => {
        await game.close()
        process.exit(0)
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
}

module.exports = { createGameServer, sanitizeName, sanitizeSkin }
