'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { State } = require('../src/state')
const { parseLine, handle } = require('../src/commands')
const { createDelivery } = require('../src/delivery')
const { classify, fatalKick } = require('../src/connection')
const { readConfig } = require('../src/config')

const config = { ...readConfig({ BOT_USERNAME: 'KitBot', OWNER: 'Boss' }), queueMax: 3, dailyLimit: 20 }
const newState = (now) => new State(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-')), 's.json'), now)

test('whispers parse, public chat cannot spoof them', () => {
  assert.deepStrictEqual(parseLine('Steve whispers: !kit', config), { from: 'Steve', command: 'kit', arg: '', whisper: true })
  assert.strictEqual(parseLine('From Steve: !queue', config).command, 'queue')
  assert.strictEqual(parseLine('Evil » Boss whispers: !pause', config), null)
  assert.strictEqual(parseLine('Steve » !kit', config), null)
  assert.strictEqual(parseLine('Boss » !pause', { ...config, publicCommands: true }).whisper, false)
})

test('one kit per player, queue limit, owner commands, persistence', () => {
  const state = newState()
  assert.ok(state.request('A', config).ok)
  assert.strictEqual(state.request('a', config).reason, 'queued')
  state.request('B', config)
  state.request('C', config)
  assert.strictEqual(state.request('D', config).reason, 'full')
  state.next()
  state.finish('served')
  assert.strictEqual(new State(state.file).request('A', config).reason, 'served')
  const ctx = { state, config, isOwner: false, stock: () => 1 }
  assert.strictEqual(handle({ from: 'X', command: 'pause', whisper: true }, ctx), null)
  handle({ from: 'Boss', command: 'pause', whisper: true }, { ...ctx, isOwner: true })
  assert.ok(state.data.paused)
})

test('daily limit counts people still waiting', () => {
  const state = newState()
  assert.ok(state.request('A', { ...config, dailyLimit: 1 }).ok)
  assert.strictEqual(state.request('B', { ...config, dailyLimit: 1 }).reason, 'daily')
})

test('crash recovery', () => {
  const state = newState()
  state.request('A', config)
  state.next()
  state.stage('travelling')
  state.recover()
  assert.deepStrictEqual(state.data.queue, ['A'])
  state.next()
  state.stage('dropping')
  state.recover()
  assert.ok(state.data.served.a)
})

// A fake world: base at the origin, the player 10000 blocks away.
function fake ({ accept = true, present = true, pickup = 'target', dieOnWay = false, gear = false } = {}) {
  let time = 1e9
  const w = { gear, x: 0, held: 0, stock: 2, log: [], killedHolding: false }
  Object.assign(w, {
    now: () => time,
    sleep: async (ms) => { time += ms },
    online: () => 'A',
    health: () => 20,
    atBase: () => w.x === 0,
    carrying: () => !!w.gear,
    shulkers: () => w.held,
    position: () => ({ dimension: 'overworld', pos: { x: w.x, distanceTo: (o) => Math.abs(w.x - o.x) } }),
    command: (c) => {
      w.log.push(c)
      if (c.startsWith('/tpa ') && accept) { w.x = dieOnWay ? 20 : 10000; if (dieOnWay) w.held = 0 }
      if (c.startsWith('/home')) w.x = 0
    },
    nearby: () => (present && w.x === 10000 ? {} : null),
    takeKit: async () => { if (!w.stock) return false; w.stock--; w.held = 1; return true },
    putBack: async () => { w.stock += w.held; w.held = 0; return true },
    dropKit: async () => { if (pickup !== 'self') w.held = 0; return pickup },
    suicide: async () => { w.killedHolding ||= w.held > 0; w.log.push('/kill'); w.x = 0 }
  })
  return w
}

async function runDelivery (options) {
  const world = fake(options)
  const state = newState(world.now)
  state.request('A', config)
  state.next()
  const delivery = createDelivery({ world, state, config, tell: () => {}, log: () => {}, notifyOwner: () => {} })
  await delivery.deliver('A')
  assert.strictEqual(world.killedHolding, false)
  return { world, state }
}

test('successful delivery: tpa, drop, kill', async () => {
  const { world, state } = await runDelivery()
  assert.deepStrictEqual(world.log, ['/tpa A', '/kill'])
  assert.strictEqual(world.stock, 1)
  assert.ok(state.data.served.a)
})

test('carrying a totem: goes back with /home, never /kill', async () => {
  const { world } = await runDelivery({ gear: true })
  assert.deepStrictEqual(world.log, ['/tpa A', '/home base'])
})

test('chests at the player do not count as home', async () => {
  const world = fake({ gear: true })
  world.atBase = () => true
  const state = newState(world.now)
  state.request('A', config)
  state.next()
  await createDelivery({ world, state, config, tell: () => {}, log: () => {}, notifyOwner: () => {} }).deliver('A')
  assert.deepStrictEqual(world.log, ['/tpa A', '/home base'])
})

test('not accepted: kit goes back, player not marked served', async () => {
  const { world, state } = await runDelivery({ accept: false })
  assert.deepStrictEqual(world.log, ['/tpa A', '/tpcancel'])
  assert.strictEqual(world.stock, 2)
  assert.ok(!state.data.served.a)
  assert.strictEqual(state.data.current, null)
})

test('player missing on arrival: /home with the kit, no /kill', async () => {
  const { world, state } = await runDelivery({ present: false })
  assert.deepStrictEqual(world.log, ['/tpa A', '/home base'])
  assert.strictEqual(world.stock, 2)
  assert.ok(!state.data.served.a)
})

test('player never picks it up: /home, no /kill', async () => {
  const { world } = await runDelivery({ pickup: 'self' })
  assert.ok(!world.log.includes('/kill'))
  assert.strictEqual(world.stock, 2)
})

test('kit lost on the way counts as served', async () => {
  const { state } = await runDelivery({ dieOnWay: true })
  assert.ok(state.data.served.a)
})

test('out of kits pauses and keeps the player queued', async () => {
  const world = fake()
  world.stock = 0
  const state = newState(world.now)
  state.request('A', config)
  state.next()
  await createDelivery({ world, state, config, tell: () => {}, log: () => {}, notifyOwner: () => {} }).deliver('A')
  assert.ok(state.data.paused)
  assert.deepStrictEqual(state.data.queue, ['A'])
})

test('server detection and kick types', () => {
  assert.strictEqual(classify(1, 'adventure', 1), 'auth')
  assert.strictEqual(classify(2, 'adventure', 10000), 'lobby')
  assert.strictEqual(classify(3, 'survival', 1000), 'main')
  assert.strictEqual(fatalKick('Please verify at https://verify.6b6t.org/abc'), 2)
  assert.strictEqual(fatalKick('Connected account limit'), 3)
  assert.strictEqual(fatalKick('logging in too fast'), 0)
})
