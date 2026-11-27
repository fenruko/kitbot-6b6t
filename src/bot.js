'use strict'
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { loadEnvFile, readConfig } = require('./config')
const { log, hide } = require('./log')

loadEnvFile()
const config = readConfig()
if (!config.username || !config.owner || !(config.password || config.registerEmail)) {
  log('set BOT_USERNAME, OWNER and BOT_PASSWORD (or REGISTER_EMAIL for a new account) in .env')
  process.exit(3)
}
// /register is sent only once; the password then arrives by email.
const registerMarker = path.join(path.dirname(config.dataFile), 'register-sent')
if (!config.password && fs.existsSync(registerMarker)) {
  log('already sent /register. Put the emailed password in BOT_PASSWORD and restart.')
  log('To send it again, delete ' + registerMarker)
  process.exit(3)
}
hide(config.password)

const { Connection } = require('./connection')
const { State } = require('./state')
const { parseLine, handle, clean } = require('./commands')
const { createWorld } = require('./world')
const { createDelivery } = require('./delivery')
const { createActions } = require('./actions')
const { createJourney } = require('./journey')
const { createSurvival } = require('./survival')

const state = new State(config.dataFile)
const connection = new Connection(config)
const world = createWorld(connection)

// Messages go out one at a time so the server does not treat them as spam.
const outbox = []
function tell (name, text) { if (outbox.length < 30) outbox.push(`/w ${name} ${text}`) }
setInterval(() => {
  if (connection.ready() && outbox.length) connection.bot.chat(outbox.shift())
}, 2000)

const delivery = createDelivery({
  world, state, config, tell, log, notifyOwner: (text) => tell(config.owner, text)
})

const journey = createJourney({ actions: createActions(connection, log, createSurvival(connection, log)), state, config, tell, log })
const SETUP_COMMANDS = new Set(['accept', 'go', 'retry', 'skip', 'setup', 'stage', 'bed'])
connection.on('death', () => journey.died())

function respond (request, isOwner) {
  if (isOwner && request.whisper && SETUP_COMMANDS.has(request.command)) return journey.command(request.command)
  if (!journey.done() && request.command === 'kit') return 'still setting up, try later.'
  return handle(request, { state, config, isOwner, stock: world.stock, carried: world.carried })
}

let busy = false
let ready = false
let updateWanted = false
const lastCommand = new Map()

connection.on('ready', () => { ready = true; log('on main, ready') })
connection.on('down', () => { ready = false; outbox.length = 0 })
connection.on('registered', () => {
  fs.mkdirSync(path.dirname(registerMarker), { recursive: true })
  fs.writeFileSync(registerMarker, new Date().toISOString())
  log('sent /register. Check your email, put the password in BOT_PASSWORD, then restart.')
})
// 6b6t wants a captcha. Save the link and, if configured, push it to Discord so it can be opened in time.
connection.on('verify', (url) => {
  if (!url) return
  log('VERIFY LINK: ' + url)
  try {
    fs.mkdirSync(path.dirname(config.dataFile), { recursive: true })
    fs.writeFileSync(path.join(path.dirname(config.dataFile), 'verify.txt'), url + '\n' + new Date().toISOString() + '\n')
  } catch {}
  if (config.discordWebhook) {
    fetch(config.discordWebhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: `6b6t verification for **${config.username}**: ${url}\nOpen it from the same network as the bot.` })
    }).catch((e) => log('webhook failed: ' + e.message))
  }
})
connection.on('fatal', (code) => {
  log(code === 2 ? 'verification needed: open the link above, then wait' : 'cannot continue, fix the problem above')
  process.exit(code)
})
connection.on('line', (line) => {
  delivery.onServerLine(line)
  journey.onServerLine(line)
  // While delivering, keep a record of what the server says so patterns can be added.
  if ((busy || !journey.done()) && !line.includes('»')) log('[server] ' + line)
  // Whitelisted players (and the owner) can /tpa to the bot, e.g. from spawn.
  const incoming = !line.includes('»') && /^(?:\[[^\]]{1,20}\] )?([A-Za-z0-9_]{1,16}) wants to teleport to you\./i.exec(clean(line))
  if (incoming && journey.done() && !busy) {
    const who = incoming[1]
    if (who.toLowerCase() === config.owner.toLowerCase() || state.allowed(who)) {
      connection.bot.chat(`/tpy ${who}`)
      log(`accepted /tpa from ${who}`)
    }
  }
  const request = parseLine(line, config)
  if (!request) {
    if (line.includes('!kit') && !line.includes('»')) log('unrecognised message format: ' + line)
    return
  }
  const key = request.from.toLowerCase()
  if (key === config.username.toLowerCase()) return
  if (Date.now() - (lastCommand.get(key) || 0) < 5000) return
  lastCommand.set(key, Date.now())
  const reply = respond(request, key === config.owner.toLowerCase())
  log(`${request.from}: !${request.command}`)
  if (reply) tell(request.from, reply)
})

let recovered = false
async function tick () {
  if (busy) return
  if (updateWanted) {
    log('restarting for update')
    process.exit(75)
  }
  if (!ready || !connection.ready()) return
  busy = true
  try {
    if (!journey.done()) return await journey.tick()
    if (!recovered || (!state.data.paused && world.shulkers())) {
      state.recover()
      // Never carry a leftover kit into the next job.
      if (world.shulkers() && !await delivery.reset()) {
        state.data.paused = true
        state.save()
        log('PAUSED: holding a kit and cannot put it away')
      }
      recovered = true
    }
    if (!state.data.paused) {
      const name = state.next()
      if (name) await delivery.deliver(name)
    }
  } catch (e) {
    log('delivery interrupted: ' + e.message)
    recovered = false
  } finally {
    busy = false
  }
}
setInterval(tick, 3000)

process.on('message', (m) => {
  if (m === 'update') updateWanted = true
})

// Host console: "/..." goes to the server, "!..." runs an owner command.
readline.createInterface({ input: process.stdin }).on('line', (input) => {
  const text = input.trim()
  if (text.startsWith('/') && connection.bot) return connection.bot.chat(text)
  const m = /^!(\w+)(?:\s+(\S+))?(?:\s+(\S+))?/.exec(text)
  if (!m) return
  const request = { from: config.owner, command: m[1].toLowerCase(), arg: m[2] || '', arg2: m[3] || '', whisper: true }
  log(respond(request, true) || 'unknown command')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { connection.bot?.quit(); setTimeout(() => process.exit(0), 500) })
}
process.on('unhandledRejection', (e) => log('error: ' + (e?.message || e)))

connection.connect()
