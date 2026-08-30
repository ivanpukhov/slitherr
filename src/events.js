class EventBuffer {
    constructor(limit = 100) {
        this.limit = limit
        this.events = []
        this.killCount = 0
    }

    log(event) {
        this.killCount += 1
        this.events.unshift({ ...event, recordedAt: Date.now() })
        if (this.events.length > this.limit) this.events.length = this.limit
    }

    snapshot() {
        return {
            killCount: this.killCount,
            recent: this.events.slice(),
        }
    }
}

module.exports = { EventBuffer }
