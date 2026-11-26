'use strict'
// The physical things the bot does while setting itself up.
const { once } = require('events')
const { Vec3 } = require('vec3')
const { steer, shouldBoost, clearance, direction } = require('./flight')
const { OFF_HAND } = require('./survival')

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const UP = new Vec3(0, 1, 0)
const NEEDS = { obsidian: 28, firework_rocket: 16, flint_and_steel: 1, elytra: 1, totem_of_undying: 2, golden_apple: 4 }

// Frame positions as [across, up], in an order where each block has a neighbour.
const FRAME = [
  [0, 0], [1, 0], [-1, 0], [2, 0],
  [-1, 1], [-1, 2], [-1, 3], [-1, 4],
  [2, 1], [2, 2], [2, 3], [2, 4],
  [0, 4], [1, 4]
]

function createActions (connection, log, survival) {
  const bot = () => {
    if (!connection.onMain || !connection.bot?.entity) throw new Error('disconnected')
    return connection.bot
  }
  const count = (name) => bot().inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0)
  const worn = () => bot().inventory.slots[bot().getEquipmentDestSlot('torso')]
  const find = (name) => bot().inventory.items().find(i => i.name === name)
  const solid = (b) => !!b && b.boundingBox === 'block'
  const lava = (b) => !!b && b.name === 'lava'

  function missing () {
    const out = []
    for (const [name, need] of Object.entries(NEEDS)) {
      let have = count(name)
      if (name === 'elytra' && worn()?.name === 'elytra') have++
      if (name === 'totem_of_undying' && bot().inventory.slots[OFF_HAND]?.name === name) have++
      if (name === 'golden_apple') have += count('enchanted_golden_apple')
      if (have < need) out.push(`${name} ${have}/${need}`)
    }
    return out
  }

  async function dig (block) {
    const b = bot()
    if (!block || block.boundingBox !== 'block') return
    if (!block.diggable) throw new Error(`cannot dig ${block.name}`)
    const pick = b.inventory.items().find(i => /_pickaxe$/.test(i.name))
    await survival.idle()
    if (pick) await b.equip(pick, 'hand')
    await b.dig(block, true)
  }

  // Places `name` into the empty position, against whichever neighbour is solid.
  async function place (name, position) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const b = bot()
      if (b.blockAt(position)?.name.endsWith(name)) return
      const faces = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), UP]
      const offset = faces.find(f => solid(b.blockAt(position.plus(f))))
      const item = find(name)
      if (!offset || !item) throw new Error(`cannot place ${name} here`)
      await survival.idle()
      await b.equip(item, 'hand')
      if (attempt) { b.setControlState('jump', true); await sleep(250) } // helps with high blocks
      await b.placeBlock(b.blockAt(position.plus(offset)), offset.scaled(-1)).catch(e => log('place: ' + e.message))
      b.setControlState('jump', false)
      await sleep(400)
    }
    if (bot().blockAt(position)?.name !== name) throw new Error(`could not place ${name}`)
  }

  // If the kit was handed over as a shulker: place it, empty it, leave it.
  async function unpack () {
    const b = bot()
    const box = b.inventory.items().find(i => /shulker_box$/.test(i.name))
    if (!box) return
    const feet = b.entity.position.floored()
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0]]
      .map(([x, z]) => feet.offset(x, 0, z))
      .find(p => b.blockAt(p)?.name === 'air' && b.blockAt(p.offset(0, 1, 0))?.name === 'air' && solid(b.blockAt(p.offset(0, -1, 0))))
    if (!spot) throw new Error('no room to open the shulker')
    await survival.idle()
    await b.equip(box, 'hand')
    await b.placeBlock(b.blockAt(spot.offset(0, -1, 0)), UP)
    await sleep(500)
    const opened = once(b, 'windowOpen', { signal: AbortSignal.timeout(8000) })
    await b.activateBlock(b.blockAt(spot))
    const [window] = await opened
    await sleep(500)
    for (const item of window.containerItems()) {
      const free = window.firstEmptySlotRange(window.inventoryStart, window.inventoryEnd)
      if (free === null) break
      await b.clickWindow(item.slot, 0, 0)
      await b.clickWindow(free, 0, 0)
    }
    window.close()
  }

  // Chooses the direction needing the least digging, without lava next to it.
  function portalSite () {
    const b = bot()
    const feet = b.entity.position.floored()
    let best = null
    for (const forward of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]) {
      const across = new Vec3(-forward.z, 0, forward.x)
      const origin = feet.plus(forward.scaled(2))
      const cells = FRAME.concat([[0, 1], [0, 2], [0, 3], [1, 1], [1, 2], [1, 3]])
        .map(([a, y]) => origin.plus(across.scaled(a)).offset(0, y, 0))
      const around = cells.flatMap(c => [c, c.plus(forward), c.minus(forward)])
      if (around.some(c => lava(b.blockAt(c)))) continue
      if (![0, 1].every(a => solid(b.blockAt(origin.plus(across.scaled(a)).offset(0, -1, 0))))) continue
      const work = cells.filter(c => solid(b.blockAt(c))).length
      if (!best || work < best.work) best = { origin, across, forward, work }
    }
    return best
  }

  async function buildPortal () {
    const site = portalSite()
    if (!site) throw new Error('no safe spot for a portal here')
    const at = (a, y) => site.origin.plus(site.across.scaled(a)).offset(0, y, 0)
    log('building a portal')
    for (let y = 4; y >= 0; y--) {
      for (const a of [0, 1, -1, 2]) {
        const block = bot().blockAt(at(a, y))
        if (block.name !== 'obsidian' && block.name !== 'nether_portal') await dig(block)
      }
    }
    for (const [a, y] of FRAME) await place('obsidian', at(a, y))
    const lighter = find('flint_and_steel')
    if (!lighter) throw new Error('no flint and steel')
    await survival.idle()
    await bot().equip(lighter, 'hand')
    for (let i = 0; i < 3 && bot().blockAt(at(0, 1)).name !== 'nether_portal'; i++) {
      await bot().activateBlock(bot().blockAt(at(i % 2, 0)), UP)
      await sleep(1000)
    }
    if (bot().blockAt(at(0, 1)).name !== 'nether_portal') throw new Error('the portal did not light')
    return at(0, 1)
  }

  // Walks in a straight line (jumping up steps) until done() or time runs out.
  async function walkTo (target, done, ms = 20000) {
    const b = bot()
    for (const until = Date.now() + ms; Date.now() < until && !done(); await sleep(50)) {
      const p = bot().entity.position
      const goal = target.offset(0.5, 0, 0.5)
      await b.lookAt(goal.offset(0, p.y + 1.6 - goal.y, 0), true)
      const far = Math.hypot(goal.x - p.x, goal.z - p.z) > 0.25
      b.setControlState('forward', far)
      b.setControlState('jump', goal.y - p.y > 0.4 && p.distanceTo(goal) < 2.5)
    }
    b.clearControlStates()
    return done()
  }

  async function enterPortal (block) {
    const from = bot().game.dimension
    const changed = () => connection.bot.game.dimension !== from
    await walkTo(block, () => changed() || bot().blockAt(bot().entity.position)?.name === 'nether_portal')
    for (const until = Date.now() + 20000; Date.now() < until && !changed(); await sleep(250));
    if (!changed()) throw new Error('the portal did not take me anywhere')
    await sleep(5000)
  }

  // Durability left on the worn elytra.
  const wear = () => {
    const item = worn()
    return item ? bot().registry.itemsByName.elytra.maxDurability - (item.durabilityUsed || 0) : 0
  }

  async function takeOff () {
    const b = bot()
    if (worn()?.name !== 'elytra') await b.equip(find('elytra'), 'torso')
    const rocket = find('firework_rocket')
    if (!rocket) throw new Error('out of fireworks')
    if (b.health < 16) throw new Error('health too low to take off')
    if (wear() < 60) throw new Error('elytra is nearly broken')
    await survival.idle()
    await b.equip(rocket, 'hand')
    for (let attempt = 0; attempt < 5; attempt++) {
      await b.look(-Math.PI / 2, 0.2, true)
      b.setControlState('forward', true)
      b.setControlState('jump', true)
      await sleep(150)
      b.setControlState('jump', false)
      // Open the wings just after the top of the jump.
      for (let i = 0; i < 30 && !(b.entity.velocity.y < 0 && !b.entity.onGround); i++) await sleep(25)
      await b.elytraFly().catch(() => {})
      await sleep(150)
      if (b.entity.elytraFlying) {
        const blocked = (p) => { const block = b.blockAt(p); return !block || solid(block) || lava(block) }
        if (clearance(blocked, b.entity.position, direction(-Math.PI / 2, 0.2)) >= 12) b.activateItem()
        b.clearControlStates()
        return true
      }
      await sleep(1000)
    }
    b.clearControlStates()
    return false
  }

  // Flies toward +x until targetX, then glides down. Resolves true once there
  // and standing on the ground.
  async function flyEast (targetX) {
    survival.setFlying(true)
    try {
      // The elytra must be on before its durability is checked.
      await survival.idle()
      if (worn()?.name !== 'elytra') {
        const wings = find('elytra')
        if (!wings) throw new Error('no elytra')
        await bot().equip(wings, 'torso')
      }
      return await glide(targetX)
    } finally {
      survival.setFlying(false) // the chestplate goes back on
    }
  }

  async function glide (targetX) {
    const isBlocked = (p) => { const block = connection.bot.blockAt(p); return !block || solid(block) || lava(block) }
    const isLava = (p) => lava(connection.bot.blockAt(p))
    let lastBoost = 0
    let takeoffs = 0
    for (const until = Date.now() + 10 * 60000; Date.now() < until; await sleep(50)) {
      const b = bot()
      const there = b.entity.position.x >= targetX
      // Hurt or nearly broken wings: get down on safe ground and recover.
      const land = there || b.health < 12 || wear() < 30
      if (!b.entity.elytraFlying) {
        if (there && b.entity.onGround) return true
        if (!b.entity.onGround) { await b.elytraFly().catch(() => {}); continue }
        if (land) {
          if (wear() < 30) throw new Error('elytra is nearly broken')
          await sleep(1000) // eat and heal before going again
          continue
        }
        if (++takeoffs > 15 || !await takeOff()) throw new Error('cannot take off safely here, move me somewhere open')
        lastBoost = Date.now()
        continue
      }
      const course = steer(isBlocked, b.entity.position, { descend: land, isLava })
      await b.look(course.yaw, course.pitch, true)
      if (!survival.busy() && shouldBoost({ speed: b.entity.velocity.norm(), clear: course.clear, sinceBoostMs: Date.now() - lastBoost, rocketActive: b.fireworkRocketDuration > 0, descend: land })) {
        if (b.heldItem?.name !== 'firework_rocket') {
          const rocket = find('firework_rocket')
          if (!rocket) throw new Error('out of fireworks')
          await b.equip(rocket, 'hand')
        }
        b.activateItem()
        lastBoost = Date.now()
      }
    }
    throw new Error('flight took too long')
  }

  async function useNearestBed () {
    const b = bot()
    const bed = b.findBlock({ matching: (block) => /_bed$/.test(block.name), maxDistance: 32 })
    if (!bed) throw new Error('no bed within 32 blocks')
    const near = () => bot().entity.position.distanceTo(bed.position) <= 2.5
    if (!await walkTo(bed.position, near)) throw new Error('could not walk to the bed, clear the way')
    await b.activateBlock(bot().blockAt(bed.position)) // sets the respawn point
    await sleep(1500)
  }

  return {
    sleep,
    now: Date.now,
    dimension: () => bot().game.dimension,
    position: () => ({ pos: bot().entity.position.clone(), dimension: bot().game.dimension }),
    command: (text) => bot().chat(text),
    missing,
    unpack,
    buildPortal,
    enterPortal,
    flyEast,
    useNearestBed
  }
}

module.exports = { createActions, NEEDS, FRAME }
