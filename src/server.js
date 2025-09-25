// src/server.js
const http = require('http')
const WebSocket = require('ws')
const {
    decode,
    encode,
    MSG_JOIN,
    MSG_INPUT,
    MSG_PING,
    MSG_PONG,
    MSG_SNAPSHOT,
    MSG_WELCOME
} = require('./protocol')
const { World } = require('./world')
const { KillLogger } = require('./logger')

const cfg = {
    port: process.env.PORT ? parseInt(process.env.PORT) : 8080,

    // размеры карты
    width: 4000,
    height: 4000,
    sectorSize: 128,

    // еда
    initialFood: 800,
    targetFood: 1200,
    foodSpawnChance: 0.5,
    foodPickupRadius: 18,
    deathScatterRadius: 80,

    // змея
    headRadius: 8,
    bodyRadius: 6,
    baseLength: 20,
    minLength: 10,
    baseSpeed: 160,
    boostMultiplier: 1.7,
    boostLengthDrain: 3,
    boostDropIntervalMs: 120,

    // хвост
    pathPointSpacing: 6,
    maxPathPoints: 1200,
    segmentSpacing: 6, // ✨ расстояние между сегментами
    collisionQueryRadius: 300,
    segmentSampleStep: 3,

    // видимость
    viewRadius: 900,

    // геймплей
    tickRate: 30,
    snapshotRate: 12,
    maxTurn: 0.18,
    inputMinIntervalMs: 10,

    // анти-спам и пинг
    maxMsgsPerSec: 60,
    heartbeatIntervalMs: 10000,
    joinThrottleMs: 2000
}

const server = http.createServer()
const wss = new WebSocket.Server({ server })
const kills = new KillLogger()
const world = new World(cfg, kills)

const sockets = new Map()

function send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) ws.send(encode(obj))
}

function nowMs() {
    return Date.now()
}

wss.on('connection', (ws) => {
    ws.isAlive = true
    ws.lastJoinTs = 0

    ws.on('pong', () => {
        ws.isAlive = true
    })

    ws.on('message', (data) => {
        const msg = decode(data)
        if (!msg) return

        const entry = sockets.get(ws)

        if (msg.type === MSG_PING) {
            send(ws, { type: MSG_PONG, t: msg.t })
            return
        }

        if (msg.type === MSG_JOIN) {
            const t = nowMs()
            if (t - ws.lastJoinTs < cfg.joinThrottleMs) return
            ws.lastJoinTs = t
            const p = world.addPlayer(ws, msg.name || "", msg.skin || "")
            sockets.set(ws, p.id)
            send(ws, {
                type: MSG_WELCOME,
                id: p.id,
                width: cfg.width,
                height: cfg.height
            })
            return
        }

        if (!entry) return
        const id = entry
        const p = world.players.get(id)
        if (!p) return

        const now = nowMs()
        if (now - p.lastMsgWindowTs > 1000) {
            p.lastMsgWindowTs = now
            p.msgCountWindow = 0
        }
        p.msgCountWindow++
        if (p.msgCountWindow > cfg.maxMsgsPerSec) return

        if (msg.type === MSG_INPUT) world.handleInput(p, msg)
    })

    ws.on('close', () => {
        const id = sockets.get(ws)
        sockets.delete(ws)
        if (id) world.removePlayer(id)
    })
})

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate()
        ws.isAlive = false
        ws.ping()
    })
}, cfg.heartbeatIntervalMs)

let lastTick = nowMs()
setInterval(() => {
    const now = nowMs()
    const dt = (now - lastTick) / 1000
    lastTick = now
    world.tick(dt)
}, Math.floor(1000 / cfg.tickRate))

setInterval(() => {
    // считаем топ по длине
    const leaderboard = Array.from(world.players.values())
        .filter(p => p.alive)
        .sort((a, b) => b.length - a.length)
        .slice(0, 10)
        .map(p => ({ name: p.name, length: Math.floor(p.length) }))

    for (const p of world.players.values()) {
        const aoi = world.aoiFor(p)
        send(p.ws, {
            type: MSG_SNAPSHOT,
            tick: world.tickId,
            you: {
                id: p.id,
                x: p.x,
                y: p.y,
                angle: p.angle,
                length: Math.floor(p.length),
                alive: p.alive
            },
            players: aoi.players,
            foods: aoi.foods,
            leaderboard // 👈 добавили сюда
        })
    }
}, Math.floor(1000 / cfg.snapshotRate))


server.listen(cfg.port)
