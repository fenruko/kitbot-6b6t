'use strict'
// Always on: wears the best armour it has, keeps a totem in the off hand and
// eats gapples when hurt.
const FOODS = ['golden_carrot', 'cooked_beef', 'cooked_porkchop', 'bread', 'cooked_chicken']
const GAPPLES = ['golden_apple', 'enchanted_golden_apple']
const OFF_HAND = 45
const MATERIALS = ['leather', 'golden', 'chainmail', 'iron', 'turtle', 'diamond', 'netherite']
const PIECES = { head: 'helmet', torso: 'chestplate', legs: 'leggings', feet: 'boots' }

const rank = (item, piece) => {
  const m = item && new RegExp(`^(\\w+?)_${piece}$`).exec(item.name)
  return m ? MATERIALS.indexOf(m[1]) : -1
}

// The next piece to put on, as { slot, item }, or null. While flying the chest
// slot is left to the elytra.
function chooseArmor (worn, items, flying) {
  for (const [slot, piece] of Object.entries(PIECES)) {
    if (slot === 'torso' && flying) continue
    let best = null
    for (const item of items) {
      if (rank(item, piece) > rank(best || worn[slot], piece)) best = item
    }
    if (best) return { slot, item: best }
  }
  return null
}

// What to eat now, or null.
function chooseFood ({ health, food }, items) {
  const pick = (names) => names.map(n => items.find(i => i.name === n)).find(Boolean) || null
  if (health <= 14) {
    const gapple = pick(health <= 8 ? [...GAPPLES].reverse() : GAPPLES)
    if (gapple) return gapple
  }
  if (food < 18) return pick(FOODS) || (food < 8 ? pick(GAPPLES) : null)
  return null
}

function createSurvival (connection, log) {
  let eating = null
  let equipping = null
  let flying = false
  const live = () => connection.onMain && connection.bot?.entity && connection.bot.isAlive ? connection.bot : null
  // Never move items around while a chest is open or an item is on the cursor.
  const handsFree = (bot) => !bot.currentWindow && !bot.inventory.selectedItem

  function equip (bot, item, destination) {
    equipping = bot.equip(item, destination)
      .catch(e => log('equip: ' + e.message))
      .finally(() => { equipping = null })
  }

  // One item move per tick: totem first, then armour.
  function gear () {
    const bot = live()
    if (!bot || equipping || eating || !handsFree(bot)) return
    if (bot.inventory.slots[OFF_HAND]?.name !== 'totem_of_undying') {
      const spare = bot.inventory.items().find(i => i.name === 'totem_of_undying')
      if (spare) return equip(bot, spare, 'off-hand')
    }
    const worn = {}
    for (const slot of Object.keys(PIECES)) worn[slot] = bot.inventory.slots[bot.getEquipmentDestSlot(slot)]
    const armor = chooseArmor(worn, bot.inventory.items(), flying)
    if (armor) equip(bot, armor.item, armor.slot)
  }

  function eat () {
    const bot = live()
    if (eating || equipping || !bot || !handsFree(bot)) return
    const food = chooseFood(bot, bot.inventory.items())
    if (!food) return
    eating = (async () => {
      await bot.equip(food, 'hand')
      await bot.consume()
    })().catch(e => log('eat: ' + e.message)).finally(() => { eating = null })
  }

  const timer = setInterval(() => { gear(); eat() }, 150)
  timer.unref?.()
  return {
    busy: () => !!eating,
    idle: async () => { while (eating || equipping) await (eating || equipping) },
    setFlying: (value) => { flying = value },
    stop: () => clearInterval(timer)
  }
}

module.exports = { createSurvival, chooseFood, chooseArmor, OFF_HAND }
