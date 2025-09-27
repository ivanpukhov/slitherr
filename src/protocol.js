module.exports = {
    MSG_JOIN: "join",
    MSG_INPUT: "input",
    MSG_PING: "ping",
    MSG_PONG: "pong",
    MSG_SNAPSHOT: "snapshot",
    MSG_WELCOME: "welcome",
    MSG_DEATH: "death",   // 👈 вот это новое
    MSG_SET_BET: "set_bet",
    MSG_BALANCE: "balance",
    MSG_RESPAWN: "respawn",
    MSG_CASHOUT_REQUEST: "cashout_request",
    MSG_CASHOUT_CONFIRMED: "cashout_confirmed",
    MSG_ERROR: "error",
    encode: JSON.stringify,
    decode: (s) => { try { return JSON.parse(s) } catch { return null } }
}
