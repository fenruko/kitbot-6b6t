'use strict'
// First-time setup, saved after every stage so a restart carries on:
// owner -> kit -> portal -> fly -> exit -> home -> bed -> done
const STAGES = ['owner', 'kit', 'portal', 'fly', 'exit', 'home', 'bed', 'done']

function createJourney ({ actions, state, config, tell, log }) {
  let goRequested = false
  let accepted = false
  let failures = 0
  let deaths = 0
  let deathsAtStart = 0

  const stage = () => state.data.setup
  function move (next) {
    if (deaths !== deathsAtStart) return
    state.data.setup = next
    state.data.setupError = ''
    state.save()
    failures = 0
    log('setup stage: ' + next)
  }
  const say = (text) => { log(text); tell(config.owner, text) }
  const inNether = () => actions.dimension().includes('nether')

  function accept () {
    actions.command(`/tpy ${config.owner}`)
    accepted = true
  }

  const steps = {
    async owner () {
      if (!accepted) return
      accepted = false
      move('kit')
      await actions.sleep(5000)
      say('drop me the kit, then whisper !go')
    },
    async kit () {
      if (!goRequested) return
      goRequested = false
      await actions.unpack()
      const lacking = actions.missing()
      if (lacking.length) return say('missing: ' + lacking.join(', '))
      move('portal')
    },
    async portal () {
      if (!inNether()) await actions.enterPortal(await actions.buildPortal())
      move('fly')
    },
    async fly () {
      if (!inNether()) return move('portal')
      await actions.flyEast(config.flyTargetX)
      move('exit')
    },
    async exit () {
      if (inNether()) await actions.enterPortal(await actions.buildPortal())
      move('home')
    },
    async home () {
      const wait = state.data.tpaReadyAt - actions.now()
      if (wait > 0) await actions.sleep(wait)
      const start = actions.position()
      actions.command(`/tpa ${config.owner}`)
      state.data.tpaReadyAt = actions.now() + config.tpaCooldownMs
      state.save()
      say(`sent you a /tpa, accept with /tpy ${config.username}`)
      for (const until = actions.now() + 70000; actions.now() < until; await actions.sleep(500)) {
        const now = actions.position()
        if (now.dimension !== start.dimension || now.pos.distanceTo(start.pos) > 16) {
          await actions.sleep(5000)
          return move('bed')
        }
      }
    },
    async bed () {
      await actions.useNearestBed()
      actions.command(`/delhome ${config.homeName}`) // /sethome asks before replacing
      await actions.sleep(2000)
      actions.command(`/sethome ${config.homeName}`)
      await actions.sleep(2000)
      move('done')
      say('setup done. Put kit shulkers in chests beside my bed.')
    }
  }

  async function tick () {
    if (stage() === 'done' || state.data.setupError) return
    deathsAtStart = deaths
    try {
      await steps[stage()]()
    } catch (e) {
      if (e.message === 'disconnected') throw e
      log(`setup ${stage()} failed: ${e.message}`)
      if (++failures >= 3) {
        state.data.setupError = e.message
        state.save()
        say(`stuck at ${stage()}: ${e.message}. Whisper !retry or !skip`)
      } else {
        await actions.sleep(5000)
      }
    }
  }

  return {
    tick,
    done: () => stage() === 'done',
    // Dying means respawning at spawn without the kit.
    died () {
      if (stage() === 'done' || stage() === 'owner') return
      deaths++
      const running = deathsAtStart
      deathsAtStart = deaths
      move('owner')
      deathsAtStart = running
      say('I died during setup. Send me a /tpa again.')
    },
    // A system line naming the owner and a teleport is their incoming request.
    onServerLine (line) {
      if (stage() !== 'owner' || line.includes('»') || !config.owner) return
      const words = line.toLowerCase().split(/[^a-z0-9_]+/)
      if (words.includes(config.owner.toLowerCase()) && /teleport|tpa|\/tpy/i.test(line) && !/whisper/i.test(line)) accept()
    },
    command (name) {
      deathsAtStart = deaths
      switch (name) {
        case 'accept': accept(); return 'accepting.'
        case 'go': goRequested = true; return 'checking the kit.'
        case 'retry': state.data.setupError = ''; failures = 0; state.save(); return 'retrying.'
        case 'skip': {
          if (stage() === 'done') return 'setup is already done.'
          move(STAGES[STAGES.indexOf(stage()) + 1])
          return 'now at ' + stage()
        }
        // Redo only the bed and /sethome, e.g. after skipping them. Also works once setup is done.
        case 'bed': move('bed'); return 'going to the bed.'
        case 'setup': move('owner'); return 'setup restarted, send me a /tpa.'
        case 'stage': return `${stage()}${state.data.setupError ? ' (stuck: ' + state.data.setupError + ')' : ''}`
        default: return null
      }
    }
  }
}

module.exports = { createJourney, STAGES }
