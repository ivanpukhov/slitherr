// src/spatial.js
class SpatialHash {
    constructor(cellSize) {
        this.cellSize = cellSize
        this.cells = new Map()
    }
    key(x, y) {
        const cx = Math.floor(x / this.cellSize)
        const cy = Math.floor(y / this.cellSize)
        return cx + ":" + cy
    }
    keysForAABB(x, y, r) {
        const minx = Math.floor((x - r) / this.cellSize)
        const maxx = Math.floor((x + r) / this.cellSize)
        const miny = Math.floor((y - r) / this.cellSize)
        const maxy = Math.floor((y + r) / this.cellSize)
        const out = []
        for (let cx = minx; cx <= maxx; cx++) {
            for (let cy = miny; cy <= maxy; cy++) out.push(cx + ":" + cy)
        }
        return out
    }
    add(id, x, y) {
        const k = this.key(x, y)
        let s = this.cells.get(k)
        if (!s) { s = new Set(); this.cells.set(k, s) }
        s.add(id)
        return k
    }
    removeKey(id, key) {
        if (!key) return
        const s = this.cells.get(key)
        if (!s) return
        s.delete(id)
        if (s.size === 0) this.cells.delete(key)
    }
    query(x, y, r) {
        const keys = this.keysForAABB(x, y, r)
        const res = new Set()
        for (const k of keys) {
            const s = this.cells.get(k)
            if (!s) continue
            for (const v of s) res.add(v)
        }
        return res
    }
}
module.exports = { SpatialHash }
