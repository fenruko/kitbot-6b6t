'use strict'
const test = require('node:test')
const assert = require('node:assert')
const { Vec3 } = require('vec3')
const { Physics, PlayerState } = require('prismarine-physics')
const mcData = require('minecraft-data')('1.21.11')
const Block = require('prismarine-block')('1.21.11')
const { steer, shouldBoost } = require('../src/flight')

// Floor, ceiling, and pillars every 40 blocks.
const solid = (p) => p.y < 32 || p.y > 110 || (((p.x % 40) + 40) % 40 < 5 && Math.abs(((p.z % 30) + 30) % 30 - 15) < 5)
// A lava lake under part of the route.
const lavaAt = (p) => p.y >= 32 && p.y < 34 && p.x > 600 && p.x < 900 && p.z < 40
const stone = mcData.blocksByName.netherrack.defaultState
const world = {
  getBlock (pos) {
    const block = Block.fromStateId(solid(pos.floored()) ? stone : 0, 0)
    block.position = pos.floored()
    return block
  }
}

test('flies 2100 blocks east through a simulated cave', () => {
  const bot = {
    version: '1.21.11',
    entity: { position: new Vec3(2, 70, 2), velocity: new Vec3(1, 0, 0), onGround: false, isInWater: false, isInLava: false, isInWeb: false, isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: true, yaw: -Math.PI / 2, pitch: 0, effects: {}, attributes: {} },
    jumpTicks: 0,
    jumpQueued: false,
    fireworkRocketDuration: 0,
    inventory: { slots: [] },
    getEquipmentDestSlot: () => 6
  }
  bot.inventory.slots[6] = { name: 'elytra' }
  const physics = Physics(mcData, world)
  const controls = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
  let rockets = 0
  let lastBoost = -100
  let course = null
  let ticks = 0
  let crashes = 0
  for (; ticks < 9000 && bot.entity.position.x < 2100; ticks++) {
    course = steer(solid2, bot.entity.position, { isLava: (p) => lavaAt(p.floored()) })
    bot.entity.yaw = course.yaw
    bot.entity.pitch = course.pitch
    if (shouldBoost({ speed: bot.entity.velocity.norm(), clear: course.clear, sinceBoostMs: (ticks - lastBoost) * 50, rocketActive: bot.fireworkRocketDuration > 0 })) {
      bot.fireworkRocketDuration = 25
      rockets++
      lastBoost = ticks
    }
    physics.simulatePlayer(new PlayerState(bot, controls), world).apply(bot)
    if (bot.entity.isCollidedHorizontally || bot.entity.onGround) crashes++
  }
  console.log(`# reached x=${Math.round(bot.entity.position.x)} in ${ticks} ticks, ${rockets} rockets, ${crashes} collision ticks`)
  assert.ok(bot.entity.position.x >= 2100)
  assert.strictEqual(crashes, 0)
})

function solid2 (p) { return solid(p.floored()) }
