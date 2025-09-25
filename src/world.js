// src/world.js
const { SpatialHash } = require('./spatial')
// src/world.js
const { v4: randomUUID } = require('uuid')

function rnd(a, b) { return a + Math.random() * (b - a) }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v }
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy }

class World {
    constructor(cfg, killLogger) {
        this.cfg = cfg
        this.killLogger = killLogger
        this.players = new Map()
        this.foods = new Map()
        this.playerCells = new Map()
        this.foodCells = new Map()
        this.playerSpatial = new SpatialHash(cfg.sectorSize)
        this.foodSpatial = new SpatialHash(cfg.sectorSize)
        this.nextFoodId = 1
        this.tickId = 0
        for (let i = 0; i < cfg.initialFood; i++) this.spawnFood()
    }

    spawnFoodAt(x, y, value = 1) {
        const id = "f" + (this.nextFoodId++)
        const f = { id, x, y, v: value }
        this.foods.set(id, f)
        const key = this.foodSpatial.add(id, x, y)
        this.foodCells.set(id, key)
    }

    spawnFood() {
        this.spawnFoodAt(rnd(0, this.cfg.width), rnd(0, this.cfg.height), 1)
    }

    addPlayer(ws, name, skin) {
        const id = randomUUID()
        const p = {
            id,
            ws,
            name: name || "",
            skin: skin || "default",
            x: rnd(0, this.cfg.width),
            y: rnd(0, this.cfg.height),
            angle: rnd(0, Math.PI * 2),
            speed: this.cfg.baseSpeed,
            length: this.cfg.baseLength,
            alive: true,
            boost: false,
            path: [],
            pathLen: 0,
            lastDrop: 0,
            lastSeenTick: 0,
            lastInputTs: 0,
            msgCountWindow: 0,
            lastMsgWindowTs: Date.now(),
            r: this.cfg.headRadius
        }
        this.players.set(id, p)
        const key = this.playerSpatial.add(id, p.x, p.y)
        this.playerCells.set(id, key)
        return p
    }

    removePlayer(id) {
        const p = this.players.get(id)
        if (!p) return
        this.playerSpatial.removeKey(id, this.playerCells.get(id))
        this.playerCells.delete(id)
        this.players.delete(id)
    }

    respawn(p) {
        p.x = rnd(0, this.cfg.width)
        p.y = rnd(0, this.cfg.height)
        p.angle = rnd(0, Math.PI * 2)
        p.length = this.cfg.baseLength
        p.alive = true
        p.boost = false
        p.path = []
        p.pathLen = 0
        p.r = this.cfg.headRadius
    }

    handleInput(p, data) {
        const now = Date.now()
        if (now - p.lastInputTs < this.cfg.inputMinIntervalMs) return
        p.lastInputTs = now
        if (typeof data.angle === 'number') {
            const da = data.angle - p.angle
            const clampDA = clamp(da, -this.cfg.maxTurn, this.cfg.maxTurn)
            p.angle = p.angle + clampDA
        }
        if (typeof data.boost === 'boolean') p.boost = data.boost
    }

    stepMovement(dt) {
        for (const p of this.players.values()) {
            if (!p.alive) continue

            // скорость
            const speed = p.boost
                ? this.cfg.baseSpeed * this.cfg.boostMultiplier
                : this.cfg.baseSpeed

            // обновляем позицию головы
            p.x += Math.cos(p.angle) * speed * dt
            p.y += Math.sin(p.angle) * speed * dt

            // границы карты
            if (p.x < 0) p.x = 0
            if (p.y < 0) p.y = 0
            if (p.x > this.cfg.width) p.x = this.cfg.width
            if (p.y > this.cfg.height) p.y = this.cfg.height

            // записываем точку пути, если голова прошла достаточно расстояния
            const last = p.path[p.path.length - 1]
            if (
                !last ||
                dist2(last.x, last.y, p.x, p.y) >
                this.cfg.pathPointSpacing * this.cfg.pathPointSpacing
            ) {
                p.path.push({ x: p.x, y: p.y })
            }

            // считаем максимальное количество сегментов для хвоста
            const maxSegments = Math.floor(p.length / this.cfg.segmentSpacing)
            if (p.path.length > maxSegments) {
                p.path = p.path.slice(p.path.length - maxSegments)
            }

            // ограничитель (безопасность, если что-то пошло не так)
            if (p.path.length > this.cfg.maxPathPoints) {
                p.path = p.path.slice(p.path.length - this.cfg.maxPathPoints)
            }

            // буст — отнимаем длину и дропаем еду
            if (p.boost) {
                p.length -= this.cfg.boostLengthDrain * dt
                if (p.length < this.cfg.minLength) p.length = this.cfg.minLength

                if (Date.now() - p.lastDrop > this.cfg.boostDropIntervalMs) {
                    p.lastDrop = Date.now()
                    const tx = p.path.length > 3 ? p.path[0].x : p.x
                    const ty = p.path.length > 3 ? p.path[0].y : p.y
                    this.spawnFoodAt(tx, ty, 1)
                }
            }

            // радиус головы
            p.r =
                this.cfg.headRadius +
                Math.min(12, Math.sqrt(p.length) * 0.3)
        }
    }

    rebuildSpatial() {
        for (const [id, key] of this.playerCells) this.playerSpatial.removeKey(id, key)
        this.playerCells.clear()
        for (const p of this.players.values()) {
            const key = this.playerSpatial.add(p.id, p.x, p.y)
            this.playerCells.set(p.id, key)
        }
    }

    stepFoodPickup() {
        for (const p of this.players.values()) {
            if (!p.alive) continue
            const near = this.foodSpatial.query(p.x, p.y, this.cfg.foodPickupRadius)
            for (const id of near) {
                const f = this.foods.get(id)
                if (!f) continue
                if (dist2(p.x, p.y, f.x, f.y) <= this.cfg.foodPickupRadius * this.cfg.foodPickupRadius) {
                    this.foodSpatial.removeKey(id, this.foodCells.get(id))
                    this.foodCells.delete(id)
                    this.foods.delete(id)
                    p.length += f.v
                    if (this.foods.size < this.cfg.targetFood) this.spawnFood()
                }
            }
        }
    }

    stepCollisions() {
        const candidates = []
        for (const p of this.players.values()) {
            if (!p.alive) continue
            const set = this.playerSpatial.query(p.x, p.y, this.cfg.collisionQueryRadius)
            candidates.length = 0
            for (const id of set) {
                if (id === p.id) continue
                const q = this.players.get(id)
                if (!q || !q.alive) continue
                candidates.push(q)
            }
            for (const q of candidates) {
                const step = this.cfg.segmentSampleStep
                for (let i = 0; i < q.path.length; i += step) {
                    const seg = q.path[i]
                    if (!seg) continue
                    const r = this.cfg.bodyRadius + Math.min(10, Math.sqrt(q.length) * 0.2)
                    if (dist2(p.x, p.y, seg.x, seg.y) <= (p.r + r) * (p.r + r)) {
                        this.kill(p, q)
                        break
                    }
                }
            }
        }
    }



    kill(victim, killer) {
        if (!victim.alive) return
        victim.alive = false

        // разбрасываем еду
        const pieces = Math.max(5, Math.floor(victim.length / 2))
        for (let i = 0; i < pieces; i++) {
            const a = rnd(0, Math.PI * 2)
            const d = rnd(0, this.cfg.deathScatterRadius)
            const x = clamp(victim.x + Math.cos(a) * d, 0, this.cfg.width)
            const y = clamp(victim.y + Math.sin(a) * d, 0, this.cfg.height)
            this.spawnFoodAt(x, y, 1)
        }

        // лог
        this.killLogger.log({
            killer: killer.id,
            victim: victim.id,
            x: victim.x,
            y: victim.y,
            tick: this.tickId,
            victimLength: Math.floor(victim.length),
            killerLength: Math.floor(killer.length),
            reason: 'head_vs_body'
        })

        if (victim.ws && victim.ws.readyState === 1) {
            victim.ws.send(JSON.stringify({
                type: "death",
                killerName: killer.name,
                yourScore: Math.floor(victim.length)
            }))
        }

    }

    tick(dt) {
        this.tickId++
        if (this.foods.size < this.cfg.targetFood && Math.random() < this.cfg.foodSpawnChance) this.spawnFood()
        this.stepMovement(dt)
        this.rebuildSpatial()
        this.stepFoodPickup()
        this.stepCollisions()
    }

    aoiFor(p) {
        const r = this.cfg.viewRadius
        const px = p.x
        const py = p.y
        const players = []
        const foods = []
        const ps = this.playerSpatial.query(px, py, r)
        for (const id of ps) {
            const o = this.players.get(id)
            if (!o) continue
            if (dist2(px, py, o.x, o.y) <= r * r) {
                players.push({
                    id: o.id,
                    x: o.x,
                    y: o.y,
                    angle: o.angle,
                    length: Math.floor(o.length),
                    alive: o.alive,
                    name: o.name,
                    skin: o.skin,
                    path: o.path   // <--- добавляем весь путь
                })
            }
        }
        const fs = this.foodSpatial.query(px, py, r)
        for (const id of fs) {
            const f = this.foods.get(id)
            if (!f) continue
            if (dist2(px, py, f.x, f.y) <= r * r) foods.push({ id: f.id, x: f.x, y: f.y })
        }
        return { players, foods }
    }
}

module.exports = { World }
