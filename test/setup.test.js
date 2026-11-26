'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Vec3 } = require('vec3')
const { State } = require('../src/state')
const { createJourney } = require('../src/journey')
const { steer, EAST } = require('../src/flight')
const { FRAME } = require('../src/actions')
const { readConfig } = require('../src/config')

const config = readConfig({ BOT_USERNAME: 'KitBot', OWNER: 'Boss' })
const newState = () => new State(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-')), 's.json'))

function setup () {
  let dimension = 'overworld'
  let x = 0
  let time = 1e9
  const commands = []
  const actions = {
    now: () => time,
    sleep: async (ms) => { time += ms },
    unpack: async () => {},
    missing: () => [],
    dimension: () => dimension,
    position: () => ({ dimension, pos: { x, distanceTo: (o) => Math.abs(x - o.x) } }),
    command: (c) => { commands.push(c); if (c.startsWith('/tpa ')) x = 99999 },
    buildPortal: async () => ({}),
    enterPortal: async () => { dimension = dimension === 'overworld' ? 'the_nether' : 'overworld' },
    flyEast: async () => { x = 2100 },
    useNearestBed: async () => {}
  }
  const state = newState()
  const journey = createJourney({ actions, state, config, tell: () => {}, log: () => {} })
  return { actions, state, journey, commands }
}

test('whole setup journey in order', async () => {
  const { journey, state, commands } = setup()
  await journey.tick()
  assert.strictEqual(state.data.setup, 'owner')
  journey.onServerLine('Evil » Boss wants to teleport /tpy')
  journey.onServerLine('Stranger wants to teleport to you.')
  assert.deepStrictEqual(commands, [])
  journey.onServerLine('Boss wants to teleport to you.')
  await journey.tick()
  journey.command('go')
  for (let i = 0; i < 6; i++) await journey.tick()
  assert.ok(journey.done())
  assert.deepStrictEqual(commands, ['/tpy Boss', '/tpa Boss', '/delhome base', '/sethome base'])
})

test('repeated failure stops and waits for the owner', async () => {
  const { journey, state, actions } = setup()
  actions.buildPortal = async () => { throw new Error('no spot') }
  state.data.setup = 'portal'
  for (let i = 0; i < 5; i++) await journey.tick()
  assert.strictEqual(state.data.setupError, 'no spot')
  journey.command('skip')
  assert.strictEqual(state.data.setup, 'fly')
  journey.died()
  assert.strictEqual(state.data.setup, 'owner')
})

test('dying inside a step sends setup back to the start', async () => {
  const { journey, state, actions } = setup()
  state.data.setup = 'portal'
  actions.enterPortal = async () => journey.died()
  await journey.tick()
  assert.strictEqual(state.data.setup, 'owner')
})

test('portal frame: 14 blocks, each touching ground or an earlier block', () => {
  assert.strictEqual(new Set(FRAME.map(String)).size, 14)
  FRAME.forEach(([a, y], i) => {
    assert.ok(y === 0 || FRAME.slice(0, i).some(([b, z]) => Math.abs(a - b) + Math.abs(y - z) === 1), `${a},${y}`)
  })
})

test('steering heads east when clear and turns around a wall', () => {
  const open = steer(() => false, new Vec3(0, 70, 0))
  assert.ok(Math.abs(open.yaw - EAST) < 1e-9 && open.pitch === 0)
  const wall = steer((p) => p.x > 10 && p.x < 14 && p.z < 6, new Vec3(0, 70, 0))
  assert.ok(wall.yaw !== EAST || wall.pitch !== 0)
  assert.ok(wall.clear > 10)
})

test('gapples when hurt, normal food when hungry, nothing when fine', () => {
  const { chooseFood } = require('../src/survival')
  const items = [{ name: 'bread' }, { name: 'golden_apple' }, { name: 'enchanted_golden_apple' }]
  assert.strictEqual(chooseFood({ health: 12, food: 20 }, items).name, 'golden_apple')
  assert.strictEqual(chooseFood({ health: 5, food: 20 }, items).name, 'enchanted_golden_apple')
  assert.strictEqual(chooseFood({ health: 20, food: 10 }, items).name, 'bread')
  assert.strictEqual(chooseFood({ health: 20, food: 20 }, items), null)
})

test('wears the best armour, leaving the chest to the elytra in flight', () => {
  const { chooseArmor } = require('../src/survival')
  const items = [{ name: 'iron_helmet' }, { name: 'diamond_helmet' }, { name: 'netherite_chestplate' }]
  assert.strictEqual(chooseArmor({}, items, false).item.name, 'diamond_helmet')
  const helmeted = { head: { name: 'diamond_helmet' }, torso: { name: 'elytra' } }
  assert.strictEqual(chooseArmor(helmeted, items, false).item.name, 'netherite_chestplate')
  assert.strictEqual(chooseArmor(helmeted, items, true), null)
})

test('flight puts the elytra on before checking it', async () => {
  const { createActions } = require('../src/actions')
  const slots = []
  slots[6] = { name: 'netherite_chestplate' }
  const flags = []
  const bot = {
    entity: { position: new Vec3(3000, 70, 0), onGround: true, elytraFlying: false },
    health: 20,
    registry: { itemsByName: { elytra: { maxDurability: 432 } } },
    getEquipmentDestSlot: () => 6,
    inventory: { slots, items: () => [{ name: 'elytra' }] },
    equip: async (item) => { slots[6] = item }
  }
  const survival = { idle: async () => {}, busy: () => false, setFlying: (v) => flags.push(v) }
  const actions = createActions({ onMain: true, bot }, () => {}, survival)
  assert.strictEqual(await actions.flyEast(2100), true)
  assert.strictEqual(slots[6].name, 'elytra')
  assert.deepStrictEqual(flags, [true, false])
})

test('!bed redoes the bed stage after setup is done', async () => {
  const { journey, state, commands } = setup()
  state.data.setup = 'done'
  journey.command('bed')
  assert.strictEqual(state.data.setup, 'bed')
  await journey.tick()
  assert.strictEqual(state.data.setup, 'done')
  assert.ok(commands.includes('/sethome base'))
})
