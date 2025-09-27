// src/logger.js
const fs = require('fs')
const { Client } = require('pg')
class KillLogger {
    constructor() {
        this.file = fs.createWriteStream(process.env.KILLS_LOG_PATH || 'kills.log', { flags: 'a' })
        this.pg = null
        if (process.env.DATABASE_URL) {
            this.pg = new Client({ connectionString: process.env.DATABASE_URL })
            this.pg.connect().catch(() => { this.pg = null })
        }
    }
    async log(ev) {
        this.file.write(JSON.stringify(ev) + "\n")
        if (this.pg) {
            try {
                await this.pg.query(
                    'insert into kills(match_id,tick,ts,killer_id,victim_id,x,y,victim_length,killer_length,reason,raw_snapshot) values($1,$2,now(),$3,$4,$5,$6,$7,$8,$9,$10)',
                    [ev.matchId || 'default', ev.tick || 0, ev.killer, ev.victim, ev.x, ev.y, ev.victimLength || 0, ev.killerLength || 0, ev.reason || 'head_vs_body', ev.raw || {}]
                )
            } catch {}
        }
    }
}
module.exports = { KillLogger }
