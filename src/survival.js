'use strict'
// Always on: keeps a totem in the off hand and eats gapples when hurt.
const FOODS = ['golden_carrot', 'cooked_beef', 'cooked_porkchop', 'bread', 'cooked_chicken']
const GAPPLES = ['golden_apple', 'enchanted_golden_apple']
const OFF_HAND = 45

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
  let equipping = false
  const live = () => connection.onMain && connection.bot?.entity && connection.bot.isAlive ? connection.bot : null
  // Never move items around while a chest is open or an item is on the cursor.
  const handsFree = (bot) => !bot.currentWindow && !bot.inventory.selectedItem

  async function totem () {
    const bot = live()
    if (!bot || equipping || !handsFree(bot)) return
    if (bot.inventory.slots[OFF_HAND]?.name === 'totem_of_undying') return
    const spare = bot.inventory.items().find(i => i.name === 'totem_of_undying')
    if (!spare) return
    equipping = true
    try { await bot.equip(spare, 'off-hand') } catch (e) { log('totem: ' + e.message) } finally { equipping = false }
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

  const timer = setInterval(() => { totem(); eat() }, 150)
  timer.unref?.()
  return {
    busy: () => !!eating,
    idle: async () => { while (eating) await eating },
    stop: () => clearInterval(timer)
  }
}

module.exports = { createSurvival, chooseFood, OFF_HAND }
