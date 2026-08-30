const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { createConfig } = require('../src/config')
const { EventBuffer } = require('../src/events')
const { decode, encode } = require('../src/protocol')
const { SpatialHash } = require('../src/spatial')
const { World } = require('../src/world')

const fakeSocket = () => ({
    readyState: 1,
    messages: [],
    send(payload) {
        this.messages.push(decode(payload))
    },
})

describe('simulation core', () => {
    it('encodes protocol messages and rejects malformed JSON', () => {
        assert.deepEqual(decode(encode({ type: 'ping', t: 42 })), { type: 'ping', t: 42 })
        assert.equal(decode('{broken'), null)
    })

    it('queries nearby objects through the spatial hash', () => {
        const index = new SpatialHash(100)
        index.add('near', 25, 25)
        index.add('far', 800, 800)
        assert.deepEqual([...index.query(20, 20, 80)], ['near'])
    })

    it('keeps the event buffer bounded', () => {
        const events = new EventBuffer(2)
        events.log({ victim: 'one' })
        events.log({ victim: 'two' })
        events.log({ victim: 'three' })
        assert.equal(events.snapshot().killCount, 3)
        assert.deepEqual(events.snapshot().recent.map((event) => event.victim), ['three', 'two'])
    })

    it('keeps virtual credits authoritative on the server', () => {
        const socket = fakeSocket()
        const world = new World(createConfig({ initialFood: 0, targetFood: 0 }), new EventBuffer())
        const player = world.addPlayer(socket, 'Aida', 'emerald')

        assert.equal(player.balance, 1000)
        assert.equal(world.placeBet(player, 250).ok, true)
        assert.equal(player.balance, 750)
        assert.equal(player.currentBet, 250)
        assert.equal(world.cashOut(player).balance, 1000)
        assert.equal(world.players.has(player.id), false)
    })
})
