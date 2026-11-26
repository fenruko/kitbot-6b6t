'use strict'
// One delivery from start to finish. The rule that matters: never /kill while
// holding a kit or gear, because it would drop on the ground.

const TPA_WAIT_MS = 70000 // 60s to accept plus the teleport countdown
const HOME_WAIT_MS = 30000

function createDelivery ({ world, state, config, tell, log, notifyOwner }) {
  let denied = false

  async function waitFor (test, ms, step = 500) {
    const until = world.now() + ms
    while (world.now() < until) {
      const value = test()
      if (value) return value
      await world.sleep(step)
    }
    return test()
  }

  const movedFrom = (start) => () => {
    const now = world.position()
    return now.dimension !== start.dimension || now.pos.distanceTo(start.pos) > 16
  }

  async function waitCooldown (key) {
    const wait = state.data[key] - world.now()
    if (wait > 0) {
      log(`waiting ${Math.ceil(wait / 1000)}s for the ${key === 'tpaReadyAt' ? '/tpa' : '/home'} cooldown`)
      await world.sleep(wait)
    }
  }

  // /home until a stock chest is in reach. PvP mode blocks it for 60s.
  // "away" forces /home: chests near a player must not pass for our base.
  async function goHome (away, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      if (!away && world.atBase()) return true
      await waitCooldown('homeReadyAt')
      const start = world.position()
      world.command(`/home ${config.homeName}`)
      if (await waitFor(movedFrom(start), HOME_WAIT_MS)) {
        away = false
        state.data.homeReadyAt = world.now() + config.homeCooldownMs
        state.save()
        await waitFor(() => world.atBase(), 10000)
      } else {
        log('/home did not move me; trying again in a minute')
        await world.sleep(60000)
      }
    }
    return !away && world.atBase()
  }

  // Makes sure the bot stands at base carrying nothing.
  async function reset (away = false) {
    if (!await goHome(away)) return false
    if (world.shulkers() && !await world.putBack()) return false
    return true
  }

  function halt (why) {
    state.data.paused = true
    state.save()
    log('PAUSED: ' + why)
    notifyOwner('paused: ' + why)
  }

  async function deliver (name) {
    denied = false
    if (!world.online(name)) return state.finish('drop')
    if (!await reset()) {
      state.finish('requeue')
      return halt('I am not at base or cannot put a kit away. Check the bed, home and chests.')
    }
    await waitCooldown('tpaReadyAt')
    if (!world.online(name)) return state.finish('drop')

    state.stage('taking')
    if (!await world.takeKit()) {
      state.finish('requeue')
      return halt('out of kits')
    }

    state.stage('travelling')
    const start = world.position()
    world.command(`/tpa ${name}`)
    state.data.tpaReadyAt = world.now() + config.tpaCooldownMs
    state.save()
    tell(name, 'sent you a /tpa. Type /tpy ' + config.username + ' within 60 seconds.')

    const moved = movedFrom(start)
    const outcome = await waitFor(() => denied ? 'denied' : moved() ? 'moved' : null, TPA_WAIT_MS)
    if (outcome !== 'moved') {
      world.command('/tpcancel')
      await world.putBack()
      state.finish('drop')
      return tell(name, 'no teleport, so you left the queue. Whisper !kit to try again.')
    }

    if (!world.shulkers()) {
      // Died or was robbed on the way: count it, so a trap cannot be repeated.
      log(`kit lost on the way to ${name}`)
      state.finish('served')
      if (!await reset(movedFrom(start)())) halt('lost a kit and could not get home')
      return
    }

    const health = world.health()
    const here = await waitFor(() => world.nearby(name), 10000)
    if (!here || world.health() < health) {
      log(here ? 'took damage on arrival, leaving' : `${name} is not here, leaving`)
      const home = await reset(true)
      state.finish(home && !world.shulkers() ? 'drop' : 'served')
      if (!home) halt('could not get home after a failed delivery')
      return
    }

    state.stage('dropping')
    let who = 'self'
    for (let i = 0; i < 3 && who === 'self' && world.nearby(name); i++) {
      who = await world.dropKit(name)
      if (who === 'self') await world.sleep(2000)
    }
    log(`kit for ${name}: picked up by ${who}`)

    if (world.shulkers()) {
      tell(name, 'you did not take the kit. Whisper !kit to try again.')
      state.finish('drop')
      if (!await reset(true)) halt('could not get home with a kit')
      return
    }

    // The kit has left the bot, so it counts even if the pickup was not seen.
    state.finish('served')
    tell(name, 'enjoy your kit.')
    await world.sleep(1500)
    // /kill would drop totems, gapples and anything else, so use /home then.
    const useKill = !world.carrying()
    if (useKill) await world.suicide()
    if (!await reset(!useKill)) halt('did not respawn at base. Is the bed still there?')
  }

  return {
    deliver,
    reset,
    onServerLine: (line) => { if (config.tpaDeniedPattern?.test(line)) denied = true }
  }
}

module.exports = { createDelivery }
