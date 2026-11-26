'use strict'
// Optional SOCKS5 proxy, so the bot connects from an address you can also browse from.
// PROXY=socks5://[user:pass@]host:port
function parseProxy (url) {
  const u = new URL(url)
  if (!/^socks5h?:$/.test(u.protocol)) throw new Error('PROXY must look like socks5://host:port')
  return {
    host: u.hostname,
    port: Number(u.port) || 1080,
    type: 5,
    userId: decodeURIComponent(u.username) || undefined,
    password: decodeURIComponent(u.password) || undefined
  }
}

// Returns a minecraft-protocol `connect` function that tunnels through the proxy.
function socksConnect (url, host, port = 25565) {
  const proxy = parseProxy(url)
  const { SocksClient } = require('socks') // only needed when PROXY is set
  return (client) => {
    SocksClient.createConnection({ proxy, command: 'connect', destination: { host, port }, timeout: 15000 })
      .then(({ socket }) => {
        client.setSocket(socket)
        client.emit('connect')
      })
      .catch((e) => client.emit('error', e))
  }
}

module.exports = { parseProxy, socksConnect }
