module.exports = {
    MSG_JOIN: "join",
    MSG_INPUT: "input",
    MSG_PING: "ping",
    MSG_PONG: "pong",
    MSG_SNAPSHOT: "snapshot",
    MSG_WELCOME: "welcome",
    MSG_DEATH: "death",   // 👈 вот это новое
    encode: JSON.stringify,
    decode: (s) => { try { return JSON.parse(s) } catch { return null } }
}
