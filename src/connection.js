'use strict'
// Gets an offline account through 6b6t's login server and lobby onto main, and
// keeps it there. The 6b6t-specific facts (server identities, the protocol
// quirks on server switches, the portals) were learned from
// https://github.com/NOSLEEPSMOKE/6b6t-join-bot
const Module = require('module')
const { EventEmitter } = require('events')
const { log } = require('./log')
const { clean } = require('./commands')

// prismarine-chat 1.13.0 passes a BigInt to writeInt32BE on some 1.21.11 chat,
// which silently freezes the connection. Patch it before mineflayer loads.
const compile = Module.prototype._compile
Module.prototype._compile = function (content, filename, ...rest) {
  if (/[\\/]prismarine-chat[\\/]index\.js$/.test(filename)) {
    content = content.split('buf.writeInt32BE(num,').join('buf.writeInt32BE(Number(num),')
  }
  return compile.call(this, content, filename, ...rest)
}
const mineflayer = require('mineflayer')

const VERSION = '1.21.11'
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const CONFIG_PACKETS = new Set(['settings', 'cookie_response', 'custom_payload', 'finish_configuration',
  'keep_alive', 'pong', 'resource_pack_receive', 'select_known_packs', 'custom_click_action', 'accept_code_of_conduct'])
const MOVEMENT = new Set(['position', 'position_look', 'look', 'flying', 'player_input', 'entity_action', 'teleport_confirm'])

function classify (playLogins, gameMode, maxPlayers, brand = '') {
  if (playLogins === 1) return 'auth'
  if (/limbo/i.test(brand) || maxPlayers === 1) return 'queue'
  if (gameMode === 'survival' && maxPlayers === 1000) return 'main'
  if (gameMode === 'adventure') return 'lobby'
  return 'unknown'
}

// Exit codes start.js understands: 2 verification, 3 needs the user to fix something.
function fatalKick (text) {
  if (/verify|anti bot|prove you'?re a human|vpn\/proxy|verification link/i.test(text)) return 2
  if (/wrong password|incorrect password|own the mojang account|choose another username|connected account limit|unsupported minecraft version|outdated (client|server)/i.test(text)) return 3
  return 0
}

class Connection extends EventEmitter {
  constructor (config) {
    super()
    this.config = config
    this.bot = null
    this.onMain = false
    this.failures = 0
  }

  ready () { return this.onMain && !!this.bot?.entity && this.bot._client.state === 'play' }

  connect () {
    const host = this.config.servers[this.failures % this.config.servers.length]
    log(`connecting to ${host}`)
    const bot = this.bot = mineflayer.createBot({
      host,
      username: this.config.username,
      auth: 'offline',
      version: VERSION,
      physicsEnabled: false,
      logErrors: false,
      hideErrors: true
    })
    const c = bot._client
    const session = { logins: 0, brand: '', switching: false, loginSent: false, kind: '', fatal: 0, readyTimer: null }
    const alive = () => this.bot === bot && !session.ended
    this.guard(c, session)

    c.on('start_configuration', () => {
      session.brand = ''
      session.switching = true
      bot.physicsEnabled = false
      bot.clearControlStates?.()
    })
    c.on('minecraft:brand', (brand) => { session.brand = String(brand) })

    bot.on('login', () => {
      session.logins++
      session.switching = false
      session.kind = classify(session.logins, bot.game.gameMode, Number(bot.game.maxPlayers), session.brand)
      log(`server: ${session.kind}`)
      clearTimeout(session.readyTimer)
      this.onMain = session.kind === 'main'
      this.enablePhysics(bot, alive, session.logins, session)
      if (session.kind === 'lobby') this.walkToPortal(bot, alive, session)
      if (this.onMain) {
        this.failures = 0
        session.readyTimer = setTimeout(() => { if (alive() && this.onMain) this.emit('ready') }, 8000)
      }
    })

    bot.on('messagestr', (raw, position) => {
      const line = clean(raw)
      if (!line || position === 'game_info') return
      if (session.kind === 'auth') {
        log('[server] ' + line)
        if (!session.loginSent && /\/login/i.test(line)) this.login(bot, alive, session)
        if (/logged in|successfully/i.test(line)) this.walkToPortal(bot, alive, session)
        const code = /wrong password|incorrect password/i.test(line) ? 3 : 0
        if (code) { session.fatal = code; bot.quit() }
        return
      }
      if (this.onMain) this.emit('line', line)
    })
    bot.once('spawn', () => setTimeout(() => {
      if (alive() && session.kind === 'auth' && !session.loginSent) this.login(bot, alive, session)
    }, 2500))

    bot.on('kicked', (reason) => {
      const text = typeof reason === 'string' ? reason : JSON.stringify(reason)
      log('kicked: ' + text.slice(0, 800))
      session.fatal = fatalKick(text)
    })
    bot.on('error', (e) => log('connection error: ' + e.message))

    // 6b6t sends something every few seconds; silence means a dead socket.
    let lastPacket = Date.now()
    c.on('packet', () => { lastPacket = Date.now() })
    const watchdog = setInterval(() => {
      const stuck = !this.onMain && Date.now() - session.startedAt > 10 * 60000
      if (Date.now() - lastPacket > 45000 || stuck) {
        log('connection looks stuck, reconnecting')
        bot.end('stuck')
      }
    }, 5000)
    session.startedAt = Date.now()

    bot.once('end', (reason) => {
      session.ended = true
      clearInterval(watchdog)
      clearTimeout(session.readyTimer)
      this.onMain = false
      this.emit('down')
      if (session.fatal) return this.emit('fatal', session.fatal)
      this.failures++
      const wait = Math.min(300000, 15000 * 2 ** Math.min(this.failures - 1, 5))
      log(`disconnected (${reason}), retrying in ${wait / 1000}s`)
      setTimeout(() => this.connect(), wait)
    })
  }

  // 6b6t moves the client back to the configuration state on every server
  // switch. mineflayer does not expect that, so stray play packets are dropped.
  guard (c, session) {
    c.setMaxListeners(100)
    const write = c.write.bind(c)
    c.write = (name, params) => {
      if (c.state === 'configuration' && !CONFIG_PACKETS.has(name)) return
      if (session.switching && c.state === 'play' && MOVEMENT.has(name)) return
      return write(name, params)
    }
    c.on('cookie_request', (p) => write('cookie_response', { key: p.cookie }))
    c.on('add_resource_pack', (p) => {
      write('resource_pack_receive', { uuid: p.uuid, result: 3 })
      write('resource_pack_receive', { uuid: p.uuid, result: 0 })
    })
  }

  login (bot, alive, session) {
    if (!alive() || session.kind !== 'auth') return
    session.loginSent = true
    bot.chat('/login ' + this.config.password)
    log('sent /login')
    setTimeout(() => this.walkToPortal(bot, alive, session), 15000)
  }

  // Physics stays off until the floor exists, or the bot falls through it.
  async enablePhysics (bot, alive, logins, session) {
    const until = Date.now() + 10000
    while (alive() && session.logins === logins) {
      const below = bot.entity && bot.blockAt(bot.entity.position.offset(0, -1, 0))
      if (below?.boundingBox === 'block' || Date.now() > until) break
      await sleep(100)
    }
    if (alive() && session.logins === logins && session.kind !== 'queue') bot.physicsEnabled = true
  }

  // The login server and lobby each have a portal a short straight walk away.
  async walkToPortal (bot, alive, session) {
    const logins = session.logins
    if (session.walking === logins || !['auth', 'lobby'].includes(session.kind)) return
    session.walking = logins
    const current = () => alive() && session.logins === logins && !session.switching
    await sleep(1500)
    let portal = null
    for (const until = Date.now() + 45000; current() && !portal && Date.now() < until; await sleep(500)) {
      portal = bot.entity && bot.findBlock({ matching: bot.registry.blocksByName.nether_portal.id, maxDistance: 32 })
    }
    if (current() && portal) {
      log('walking into the portal')
      const goal = portal.position.offset(0.5, 0, 0.5)
      const startY = bot.entity.position.y
      for (const until = Date.now() + 30000; current() && Date.now() < until; await sleep(50)) {
        const p = bot.entity.position
        if (p.y < startY - 3) break
        bot.lookAt(goal.offset(0, p.y + 1.6 - goal.y, 0), true).catch(() => {})
        bot.setControlState('forward', Math.hypot(goal.x - p.x, goal.z - p.z) > 0.25)
        bot.setControlState('jump', goal.y - p.y > 0.6 && p.distanceTo(goal) > 2)
      }
      if (alive()) bot.clearControlStates()
    }
    if (current()) {
      log('did not get through the portal, reconnecting')
      bot.end('portal')
    }
  }
}

module.exports = { Connection, classify, fatalKick }
