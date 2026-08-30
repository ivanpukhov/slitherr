const assert = require('node:assert/strict')
const { once } = require('node:events')
const { after, before, describe, it } = require('node:test')

const WebSocket = require('ws')

const { createGameServer } = require('../src/server')

const waitForType = (socket, type) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 1500)
    const onMessage = (raw) => {
        const message = JSON.parse(raw.toString())
        if (message.type !== type) return
        clearTimeout(timeout)
        socket.off('message', onMessage)
        resolve(message)
    }
    socket.on('message', onMessage)
})

describe('game server', () => {
    const game = createGameServer({
        host: '127.0.0.1',
        port: 0,
        initialFood: 10,
        targetFood: 10,
        tickRate: 20,
        snapshotRate: 10,
    })
    let baseUrl
    let socketUrl

    before(async () => {
        const address = await game.start()
        baseUrl = `http://127.0.0.1:${address.port}`
        socketUrl = `ws://127.0.0.1:${address.port}`
    })

    after(async () => {
        await game.close()
    })

    it('reports health and bounded runtime statistics', async () => {
        assert.deepEqual(await (await fetch(`${baseUrl}/healthz`)).json(), { status: 'ok' })
        const stats = await (await fetch(`${baseUrl}/stats`)).json()
        assert.equal(stats.players, 0)
        assert.equal(stats.food, 10)
        assert.equal(typeof stats.tick, 'number')
    })

    it('accepts one join per socket and sanitizes display names', async () => {
        const socket = new WebSocket(socketUrl)
        await once(socket, 'open')

        const welcomePromise = waitForType(socket, 'welcome')
        socket.send(JSON.stringify({
            type: 'join',
            name: `  ${'x'.repeat(40)}  `,
            skin: 'emerald',
        }))
        const welcome = await welcomePromise
        assert.equal(typeof welcome.id, 'string')
        assert.equal(game.world.players.get(welcome.id).name.length, 24)
        assert.equal(game.world.players.get(welcome.id).skin, 'emerald')

        const errorPromise = waitForType(socket, 'error')
        socket.send(JSON.stringify({ type: 'join', name: 'second-player' }))
        assert.equal((await errorPromise).code, 'already_joined')
        assert.equal(game.world.players.size, 1)

        socket.close()
        await once(socket, 'close')
    })
})
