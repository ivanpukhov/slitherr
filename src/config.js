const readNumber = (name, fallback) => {
    const value = Number(process.env[name])
    return Number.isFinite(value) ? value : fallback
}

const createConfig = (overrides = {}) => ({
    host: process.env.HOST || '127.0.0.1',
    port: readNumber('PORT', 8080),
    width: readNumber('WORLD_WIDTH', 4000),
    height: readNumber('WORLD_HEIGHT', 4000),
    sectorSize: 128,
    initialFood: readNumber('INITIAL_FOOD', 900),
    targetFood: readNumber('TARGET_FOOD', 1400),
    foodSpawnChance: 0.55,
    foodPickupRadius: 26,
    deathScatterRadius: 140,
    deathFoodChunkValue: 14,
    bigFoodThreshold: 12,
    headRadius: 8,
    bodyRadius: 6,
    baseLength: 20,
    minLength: 10,
    baseSpeed: 160,
    speedMinFactor: 0.42,
    speedLengthSoftCap: 500,
    speedLengthExponent: 0.65,
    boostMultiplier: 1.7,
    boostLengthDrain: 3,
    boostDropIntervalMs: 120,
    pathPointSpacing: 6,
    maxPathPoints: 1200,
    segmentSpacing: 6,
    collisionQueryRadius: 300,
    segmentSampleStep: 3,
    viewRadius: 900,
    tickRate: readNumber('TICK_RATE', 40),
    snapshotRate: readNumber('SNAPSHOT_RATE', 15),
    maxTurn: 0.18,
    maxTurnRate: 7.2,
    inputMinIntervalMs: 10,
    maxMsgsPerSec: 60,
    heartbeatIntervalMs: 10000,
    joinThrottleMs: 2000,
    initialCredits: readNumber('INITIAL_CREDITS', 1000),
    ...overrides,
})

module.exports = { createConfig }
