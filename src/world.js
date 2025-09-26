// src/world.js
const { SpatialHash } = require('./spatial')
const { v4: randomUUID } = require('uuid')

const {
    MSG_BALANCE,
    MSG_CASHOUT_CONFIRMED,
    encode
} = require('./protocol')

const SKIN_PRESETS = {
    default: ['#38bdf8'],
    emerald: ['#34d399'],
    crimson: ['#ef4444'],
    amber: ['#f59e0b'],
    violet: ['#a855f7'],
    obsidian: ['#475569'],
    mint: ['#14b8a6']
}

function rnd(a, b) { return a + Math.random() * (b - a) }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v }
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy }
function normalizeAngle(a) {
    let angle = a
    while (angle <= -Math.PI) angle += Math.PI * 2
    while (angle > Math.PI) angle -= Math.PI * 2
    return angle
}

function projectToCircle(cx, cy, radius, x, y) {
    const dx = x - cx
    const dy = y - cy
    const dist = Math.hypot(dx, dy)
    if (dist === 0) return { x: cx, y: cy }
    if (dist <= radius) return { x, y }
    const scale = radius / dist
    return {
        x: cx + dx * scale,
        y: cy + dy * scale
    }
}

function randomPointInCircle(cx, cy, radius) {
    const t = Math.random() * Math.PI * 2
    const r = radius * Math.sqrt(Math.random())
    return {
        x: cx + Math.cos(t) * r,
        y: cy + Math.sin(t) * r
    }
}

function resamplePath(points, spacing) {
    if (!points || points.length === 0) return []
    if (points.length === 1) return [{ x: points[0].x, y: points[0].y }]
    const output = [{ x: points[0].x, y: points[0].y }]
    let prev = points[0]
    let carry = 0
    for (let i = 1; i < points.length; i++) {
        const current = points[i]
        let dx = current.x - prev.x
        let dy = current.y - prev.y
        let segLength = Math.hypot(dx, dy)
        if (segLength === 0) continue
        while (carry + segLength >= spacing) {
            const remain = spacing - carry
            const t = remain / segLength
            const nx = prev.x + dx * t
            const ny = prev.y + dy * t
            output.push({ x: nx, y: ny })
            prev = { x: nx, y: ny }
            dx = current.x - prev.x
            dy = current.y - prev.y
            segLength = Math.hypot(dx, dy)
            carry = 0
        }
        carry += segLength
        prev = current
    }
    const last = points[points.length - 1]
    const tail = output[output.length - 1]
    if (!tail || tail.x !== last.x || tail.y !== last.y) {
        output.push({ x: last.x, y: last.y })
    }
    return output
}

function computePathLength(points) {
    let sum = 0
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1]
        const cur = points[i]
        sum += Math.hypot(cur.x - prev.x, cur.y - prev.y)
    }
    return sum
}

function trimPathToLength(player, maxLength) {
    const target = Math.max(0, maxLength)
    while (player.path.length > 1 && player.pathLen > target) {
        const first = player.path[0]
        const second = player.path[1]
        const segLen = Math.hypot(second.x - first.x, second.y - first.y)
        if (!Number.isFinite(segLen) || segLen === 0) {
            player.path.shift()
            continue
        }
        const excess = player.pathLen - target
        if (excess >= segLen - 1e-6) {
            player.path.shift()
            player.pathLen -= segLen
            if (player.pathLen < 0) player.pathLen = 0
        } else {
            const ratio = excess / segLen
            player.path[0] = {
                x: first.x + (second.x - first.x) * ratio,
                y: first.y + (second.y - first.y) * ratio
            }
            player.pathLen -= excess
            if (player.pathLen < 0) player.pathLen = 0
            break
        }
    }
}

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
        this.foodPalette = [
            '#ffd166', '#fca311', '#ff5e57', '#4cd137', '#00e5ff', '#7d5fff',
            '#ff8bd2', '#b7fbff', '#caffbf', '#fdffb6', '#ffd6a5', '#bdb2ff'
        ]
        this.nextFoodId = 1
        this.tickId = 0
        this.centerX = cfg.width / 2
        this.centerY = cfg.height / 2
        this.radius = Math.min(cfg.width, cfg.height) / 2
        this.maxTurnRate = typeof cfg.maxTurnRate === 'number'
            ? cfg.maxTurnRate
            : cfg.maxTurn * cfg.tickRate

        this.initialBalance = 1000

        for (let i = 0; i < cfg.initialFood; i++) this.spawnFood()
    }

    send(ws, payload) {
        if (!ws || ws.readyState !== 1) return
        try {
            ws.send(encode(payload))
        } catch (err) {
            // ignore send errors
        }
    }

    notifyBalance(p) {
        if (!p || !p.ws) return
        const balance = Math.max(0, Math.floor(p.balance || 0))
        const currentBet = Math.max(0, Math.floor(p.currentBet || 0))
        const total = balance + currentBet
        this.send(p.ws, {
            type: MSG_BALANCE,
            balance,
            currentBet,
            total
        })
    }

    skinPalette(skin) {
        return SKIN_PRESETS[skin] || SKIN_PRESETS.default
    }

    spawnFoodAt(x, y, value = 1, options = {}) {
        const pos = projectToCircle(this.centerX, this.centerY, this.radius, x, y)
        const id = "f" + (this.nextFoodId++)
        const palette = options.palette || this.foodPalette
        const color = options.color || palette[Math.floor(Math.random() * palette.length)]
        const big = Boolean(options.big)
        const createdAt = Date.now()
        const pulse = typeof options.pulse === 'number' ? options.pulse : Math.random() * Math.PI * 2
        const f = { id, x: pos.x, y: pos.y, v: value, color, big, pulse, createdAt }
        this.foods.set(id, f)
        const key = this.foodSpatial.add(id, f.x, f.y)
        this.foodCells.set(id, key)
    }

    spawnFood() {
        const p = randomPointInCircle(this.centerX, this.centerY, this.radius)
        this.spawnFoodAt(p.x, p.y, 1)
    }

    addPlayer(ws, name, skin) {
        const id = randomUUID()
        const spawn = randomPointInCircle(this.centerX, this.centerY, this.radius * 0.95)
        const p = {
            id,
            ws,
            name: name || "",
            skin: skin || "default",
            x: spawn.x,
            y: spawn.y,
            angle: rnd(0, Math.PI * 2),
            speed: this.cfg.baseSpeed,
            length: this.cfg.baseLength,
            alive: true,
            boost: false,
            path: [{ x: spawn.x, y: spawn.y }],
            pathLen: 0,
            pathCarry: 0,
            lastDrop: 0,
            lastSeenTick: 0,
            lastInputTs: 0,
            msgCountWindow: 0,
            lastMsgWindowTs: Date.now(),
            r: this.cfg.headRadius,
            balance: this.initialBalance,
            currentBet: 0,
            cashedOut: false
        }
        p.dir = p.angle
        p.targetAngle = p.angle
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
        if (!p || p.cashedOut || p.alive) return
        const spawn = randomPointInCircle(this.centerX, this.centerY, this.radius * 0.95)
        p.x = spawn.x
        p.y = spawn.y
        p.angle = rnd(0, Math.PI * 2)
        p.targetAngle = p.angle
        p.dir = p.angle
        p.length = this.cfg.baseLength
        p.alive = true
        p.boost = false
        p.path = [{ x: p.x, y: p.y }]
        p.pathLen = 0
        p.pathCarry = 0
        p.r = this.cfg.headRadius
        const key = this.playerSpatial.add(p.id, p.x, p.y)
        this.playerCells.set(p.id, key)
    }

    handleInput(p, data) {
        if (!p || !p.alive || p.cashedOut) return
        const now = Date.now()
        if (now - p.lastInputTs < this.cfg.inputMinIntervalMs) return
        p.lastInputTs = now
        if (typeof data.angle === 'number') {
            const desired = normalizeAngle(data.angle)
            if (Number.isFinite(desired)) {
                p.targetAngle = desired
            }
        }
        if (typeof data.boost === 'boolean') {
            const canBoost = p.length > this.cfg.minLength + 1e-6
            p.boost = data.boost && canBoost
        }
    }

    stepMovement(dt) {
        for (const p of this.players.values()) {
            if (!p.alive) continue

            const desiredAngle = typeof p.targetAngle === 'number' ? p.targetAngle : p.angle
            const diff = normalizeAngle(desiredAngle - p.angle)
            const maxTurn = this.maxTurnRate * dt
            const turn = clamp(diff, -maxTurn, maxTurn)
            p.angle = normalizeAngle(p.angle + turn)

            // скорость
            const growth = Math.max(0, p.length - this.cfg.baseLength)
            const slowRatio = Math.pow(
                1 / (1 + growth / this.cfg.speedLengthSoftCap),
                this.cfg.speedLengthExponent
            )
            const lengthFactor = this.cfg.speedMinFactor + (1 - this.cfg.speedMinFactor) * slowRatio
            const baseSpeed = this.cfg.baseSpeed * lengthFactor
            const speed = p.boost ? baseSpeed * this.cfg.boostMultiplier : baseSpeed
            p.speed = speed

            // обновляем позицию головы
            p.x += Math.cos(p.angle) * speed * dt
            p.y += Math.sin(p.angle) * speed * dt
            p.dir = p.angle

            // границы карты (круглый мир)
            const border = projectToCircle(this.centerX, this.centerY, Math.max(0, this.radius - p.r), p.x, p.y)
            p.x = border.x
            p.y = border.y

            // обновляем полилинию хвоста
            const spacing = this.cfg.segmentSpacing
            if (!Array.isArray(p.path) || p.path.length === 0) {
                p.path = [{ x: p.x, y: p.y }]
                p.pathLen = 0
                p.pathCarry = 0
            } else {
                const previousHead = p.path[p.path.length - 1]
                const dx = p.x - previousHead.x
                const dy = p.y - previousHead.y
                const distance = Math.hypot(dx, dy)
                if (distance > 0) {
                    let consumed = 0
                    while (p.pathCarry + (distance - consumed) >= spacing) {
                        const step = spacing - p.pathCarry
                        consumed += step
                        const t = consumed / distance
                        const nx = previousHead.x + dx * t
                        const ny = previousHead.y + dy * t
                        p.path.push({ x: nx, y: ny })
                        p.pathLen += step
                        p.pathCarry = 0
                    }
                    const remainder = distance - consumed
                    if (remainder > 1e-6) {
                        p.pathCarry += remainder
                        p.pathLen += remainder
                    } else {
                        p.pathCarry = 0
                    }
                    const lastPoint = p.path[p.path.length - 1]
                    if (!lastPoint || Math.hypot(lastPoint.x - p.x, lastPoint.y - p.y) > 1e-5) {
                        p.path.push({ x: p.x, y: p.y })
                    } else {
                        lastPoint.x = p.x
                        lastPoint.y = p.y
                    }
                } else {
                    const headPoint = p.path[p.path.length - 1]
                    if (headPoint) {
                        headPoint.x = p.x
                        headPoint.y = p.y
                    } else {
                        p.path.push({ x: p.x, y: p.y })
                    }
                }
            }

            // обрезаем хвост по целевой длине
            const desiredPathLength = Math.max(spacing * 2, p.length)
            trimPathToLength(p, desiredPathLength)

            // ограничитель (безопасность, если что-то пошло не так)
            if (p.path.length > this.cfg.maxPathPoints) {
                p.path = p.path.slice(p.path.length - this.cfg.maxPathPoints)
                p.pathLen = computePathLength(p.path)
            }

            // буст — отнимаем длину и дропаем еду
            if (p.boost) {
                p.length -= this.cfg.boostLengthDrain * dt
                if (p.length < this.cfg.minLength) p.length = this.cfg.minLength

                if (Date.now() - p.lastDrop > this.cfg.boostDropIntervalMs) {
                    p.lastDrop = Date.now()
                    const tx = p.path.length > 3 ? p.path[0].x : p.x
                    const ty = p.path.length > 3 ? p.path[0].y : p.y
                    this.spawnFoodAt(tx, ty, 1, { palette: this.skinPalette(p.skin) })
                }

                if (p.length <= this.cfg.minLength + 1e-3) {
                    p.boost = false
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
        victim.boost = false

        const dropPath = victim.path.slice()
        victim.path = []
        victim.pathLen = 0
        victim.pathCarry = 0

        const bounty = Math.max(0, Math.floor(victim.currentBet || 0))
        victim.currentBet = 0

        const cellKey = this.playerCells.get(victim.id)
        this.playerSpatial.removeKey(victim.id, cellKey)
        this.playerCells.delete(victim.id)

        if (killer && bounty > 0) {
            const killerBet = Math.max(0, Math.floor(killer.currentBet || 0))
            killer.currentBet = killerBet + bounty
            this.notifyBalance(killer)
        }
        this.notifyBalance(victim)

        const totalValue = Math.max(1, Math.floor(victim.length))
        const palette = this.skinPalette(victim.skin)
        const anchors = dropPath.length ? dropPath : [{ x: victim.x, y: victim.y }]
        const spacing = Math.max(6, this.cfg.segmentSpacing * 1.1)
        const sampled = resamplePath(anchors, spacing)
        const points = sampled.length ? sampled : anchors
        const pieces = Math.max(1, Math.ceil(totalValue / this.cfg.deathFoodChunkValue))
        const stride = Math.max(1, Math.floor(points.length / pieces))

        let remaining = totalValue
        for (let i = points.length - 1; i >= 0 && remaining > 0; i -= stride) {
            const target = points[i]
            const base = Math.max(3, Math.round(totalValue / pieces))
            const value = Math.min(remaining, Math.round(base * rnd(0.8, 1.3)))
            const clamped = projectToCircle(this.centerX, this.centerY, this.radius, target.x, target.y)
            this.spawnFoodAt(clamped.x, clamped.y, value, {
                palette,
                big: value >= this.cfg.bigFoodThreshold
            })
            remaining -= value
        }

        let index = points.length - 1
        while (remaining > 0 && points.length) {
            const target = points[index]
            const clamped = projectToCircle(this.centerX, this.centerY, this.radius, target.x, target.y)
            const value = Math.min(remaining, 2)
            this.spawnFoodAt(clamped.x, clamped.y, value, { palette })
            remaining -= value
            index = (index - 1 + points.length) % points.length
        }

        this.killLogger.log({
            killer: killer ? killer.id : null,
            victim: victim.id,
            x: victim.x,
            y: victim.y,
            tick: this.tickId,
            victimLength: Math.floor(victim.length),
            killerLength: killer ? Math.floor(killer.length) : 0,
            reason: 'head_vs_body',
            bounty
        })

        if (victim.ws && victim.ws.readyState === 1) {
            this.send(victim.ws, {
                type: "death",
                killerName: killer ? killer.name : "",
                yourScore: Math.floor(victim.length)
            })
        }
    }

    placeBet(p, amount) {
        if (!p || p.cashedOut) {
            return { ok: false, error: 'cashout' }
        }
        const raw = Number(amount)
        if (!Number.isFinite(raw)) {
            return { ok: false, error: 'invalid_amount' }
        }
        const bet = Math.floor(raw)
        if (bet <= 0) {
            return { ok: false, error: 'invalid_amount' }
        }
        if (p.currentBet > 0) {
            return { ok: false, error: 'bet_exists' }
        }
        const balance = Math.max(0, Math.floor(p.balance || 0))
        const finalBet = Math.min(bet, balance)
        if (finalBet <= 0) {
            return { ok: false, error: 'insufficient_balance' }
        }
        p.balance = balance - finalBet
        p.currentBet = finalBet
        this.notifyBalance(p)
        return {
            ok: true,
            balance: Math.max(0, Math.floor(p.balance)),
            currentBet: Math.max(0, Math.floor(p.currentBet)),
            total: Math.max(0, Math.floor(p.balance + p.currentBet))
        }
    }

    cashOut(p) {
        if (!p || p.cashedOut) {
            return { ok: false, error: 'cashout' }
        }
        const refund = Math.max(0, Math.floor(p.currentBet || 0))
        if (refund > 0) {
            p.balance = Math.max(0, Math.floor(p.balance || 0)) + refund
        } else {
            p.balance = Math.max(0, Math.floor(p.balance || 0))
        }
        p.currentBet = 0
        p.cashedOut = true
        p.alive = false
        p.boost = false
        p.path = []
        p.pathLen = 0
        p.pathCarry = 0
        const cellKey = this.playerCells.get(p.id)
        this.playerSpatial.removeKey(p.id, cellKey)
        this.playerCells.delete(p.id)
        this.players.delete(p.id)
        this.notifyBalance(p)
        const finalBalance = Math.max(0, Math.floor(p.balance))
        if (p.ws) {
            this.send(p.ws, {
                type: MSG_CASHOUT_CONFIRMED,
                balance: finalBalance
            })
        }
        return { ok: true, balance: finalBalance }
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
            if (!o.alive) continue
            if (dist2(px, py, o.x, o.y) <= r * r) {
                players.push({
                    id: o.id,
                    x: o.x,
                    y: o.y,
                    angle: o.angle,
                    length: o.length,
                    alive: o.alive,
                    name: o.name,
                    skin: o.skin,
                    path: o.path,
                    dir: o.dir || o.angle,
                    speed: o.speed || this.cfg.baseSpeed
                })
            }
        }
        const fs = this.foodSpatial.query(px, py, r)
        for (const id of fs) {
            const f = this.foods.get(id)
            if (!f) continue
            if (dist2(px, py, f.x, f.y) <= r * r) foods.push({
                id: f.id,
                x: f.x,
                y: f.y,
                v: f.v,
                color: f.color,
                big: f.big,
                pulse: f.pulse,
                createdAt: f.createdAt
            })
        }
        return { players, foods }
    }
}

module.exports = { World }
