'use strict'
// Everything delivery.js needs from the game, on top of the live mineflayer bot.
const { once } = require('events')

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const REACH = 4.5
const isShulker = (item) => !!item && /shulker_box$/.test(item.name)
const isContainer = (name) => name === 'chest' || name === 'trapped_chest' || name === 'barrel'

function createWorld (connection) {
  let lastStock = null
  const bot = () => {
    // Stays usable during main-to-main server switches, which a teleport can cause.
    if (!connection.onMain || !connection.bot?.entity) throw new Error('disconnected')
    return connection.bot
  }

  const containers = () => {
    const b = bot()
    const eye = b.entity.position.offset(0, 1.62, 0)
    return b.findBlocks({ matching: (block) => isContainer(block.name), maxDistance: 6, count: 32 })
      .filter(p => p.offset(0.5, 0.5, 0.5).distanceTo(eye) <= REACH)
      .map(p => b.blockAt(p))
  }

  async function open (block) {
    const b = bot()
    const opened = once(b, 'windowOpen', { signal: AbortSignal.timeout(8000) })
    await b.activateBlock(block)
    const [window] = await opened
    await sleep(500) // contents arrive just after the window
    return window
  }

  const world = {
    sleep,
    now: Date.now,
    isShulker,
    stock: () => lastStock,
    command: (text) => bot().chat(text),
    position: () => {
      const b = bot()
      return { pos: b.entity.position.clone(), dimension: b.game.dimension }
    },
    health: () => bot().health,
    online: (name) => Object.keys(bot().players).find(n => n.toLowerCase() === name.toLowerCase()) || null,
    nearby: (name) => {
      const b = bot()
      const real = world.online(name)
      const entity = real && b.players[real].entity
      return entity && entity.position.distanceTo(b.entity.position) <= 6 ? entity : null
    },
    atBase: () => containers().length > 0,
    // Anything in the inventory, armour or off hand.
    carrying: () => bot().inventory.slots.some(Boolean),
    shulkers: () => {
      const b = bot()
      const held = b.inventory.items().filter(isShulker)
      if (isShulker(b.inventory.selectedItem)) held.push(b.inventory.selectedItem)
      return held.length
    },

    // Moves exactly one shulker from a nearby container into the inventory.
    async takeKit () {
      let seen = 0
      let taken = false
      for (const block of containers()) {
        const window = await open(block)
        try {
          const kits = window.containerItems().filter(isShulker)
          seen += kits.length
          if (!taken && kits.length) {
            const free = window.firstEmptySlotRange(window.inventoryStart, window.inventoryEnd)
            if (free === null) throw new Error('bot inventory is full')
            await bot().clickWindow(kits[0].slot, 0, 0)
            await bot().clickWindow(free, 0, 0)
            taken = true
            seen--
          }
        } finally {
          window.close()
        }
        await sleep(300)
      }
      lastStock = seen
      return taken && world.shulkers() === 1
    },

    async putBack () {
      for (const block of containers()) {
        if (!world.shulkers()) return true
        const window = await open(block)
        try {
          for (const item of window.items().filter(isShulker)) {
            const free = window.firstEmptySlotRange(0, window.inventoryStart)
            if (free === null) break
            await bot().clickWindow(item.slot, 0, 0)
            await bot().clickWindow(free, 0, 0)
            if (lastStock !== null) lastStock++
          }
        } finally {
          window.close()
        }
        await sleep(300)
      }
      return world.shulkers() === 0
    },

    // Throws the kit at the player and reports who picked it up:
    // 'target', 'self', 'other' or 'nobody'.
    async dropKit (name, waitMs = 15000) {
      const b = bot()
      const target = world.nearby(name)
      const item = b.inventory.items().find(isShulker)
      if (!target || !item) throw new Error('nothing to drop or nobody to give it to')
      await b.lookAt(target.position.offset(0, 0.5, 0), true)
      let who = 'nobody'
      const onCollect = (collector, collected) => {
        if (collected?.name !== 'item') return
        const stack = collected.getDroppedItem?.()
        if (stack && !isShulker(stack)) return
        if (collector === b.entity) who = 'self'
        else who = collector?.username?.toLowerCase() === name.toLowerCase() ? 'target' : 'other'
      }
      b.on('playerCollect', onCollect)
      try {
        await b.tossStack(item)
        const until = Date.now() + waitMs
        while (who === 'nobody' && Date.now() < until && connection.onMain) await sleep(200)
        if (world.shulkers()) who = 'self'
        return who
      } finally {
        b.removeListener('playerCollect', onCollect)
      }
    },

    // /kill, then wait until we are alive again.
    async suicide () {
      const b = bot()
      if (world.shulkers()) throw new Error('refusing to /kill while holding a kit')
      const died = once(b, 'death', { signal: AbortSignal.timeout(15000) })
      b.chat('/kill')
      await died
      const until = Date.now() + 30000
      while (Date.now() < until) {
        await sleep(500)
        if (connection.ready() && connection.bot.isAlive) break
      }
      await sleep(3000) // let the chunks around the bed load
    }
  }
  return world
}

module.exports = { createWorld }
