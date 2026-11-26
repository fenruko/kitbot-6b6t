'use strict'
const readline = require('readline')
const { loadEnvFile, readConfig } = require('./config')
const { log, hide } = require('./log')

loadEnvFile()
const config = readConfig()
if (!config.username || !config.password || !config.owner) {
  log('set BOT_USERNAME, BOT_PASSWORD and OWNER in .env')
  process.exit(3)
}
hide(config.password)

const { Connection } = require('./connection')
const { State } = require('./state')
const { parseLine, handle } = require('./commands')
const { createWorld } = require('./world')
const { createDelivery } = require('./delivery')

const state = new State(config.dataFile)
const connection = new Connection(config)
const world = createWorld(connection)

// Messages go out one at a time so the server does not treat them as spam.
const outbox = []
function tell (name, text) { if (outbox.length < 30) outbox.push(`/msg ${name} ${text}`) }
setInterval(() => {
  if (connection.ready() && outbox.length) connection.bot.chat(outbox.shift())
}, 2000)

const delivery = createDelivery({
  world, state, config, tell, log, notifyOwner: (text) => tell(config.owner, text)
})

let busy = false
let ready = false
let updateWanted = false
const lastCommand = new Map()

connection.on('ready', () => { ready = true; log('on main, ready') })
connection.on('down', () => { ready = false; outbox.length = 0 })
connection.on('fatal', (code) => {
  log(code === 2 ? 'verification needed: open the link above, then wait' : 'cannot continue, fix the problem above')
  process.exit(code)
})
connection.on('line', (line) => {
  delivery.onServerLine(line)
  // While delivering, keep a record of what the server says so patterns can be added.
  if (busy && !line.includes('»')) log('[server] ' + line)
  const request = parseLine(line, config)
  if (!request) {
    if (line.includes('!kit') && !line.includes('»')) log('unrecognised message format: ' + line)
    return
  }
  const key = request.from.toLowerCase()
  if (key === config.username.toLowerCase()) return
  if (Date.now() - (lastCommand.get(key) || 0) < 5000) return
  lastCommand.set(key, Date.now())
  const reply = handle(request, { state, config, isOwner: key === config.owner.toLowerCase(), stock: world.stock })
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
  const m = /^!(\w+)(?:\s+(\S+))?/.exec(text)
  if (!m) return
  const request = { from: config.owner, command: m[1], arg: m[2] || '', whisper: true }
  log(handle(request, { state, config, isOwner: true, stock: world.stock }) || 'unknown command')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { connection.bot?.quit(); setTimeout(() => process.exit(0), 500) })
}
process.on('unhandledRejection', (e) => log('error: ' + (e?.message || e)))

connection.connect()
