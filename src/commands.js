'use strict'
// 6b6t sends chat as plain server lines. The exact whisper format has not been
// captured yet, so several common ones are accepted; WHISPER_PATTERN overrides.
const NAME = '([A-Za-z0-9_]{1,16})'
const RANK = '(?:\\[[^\\]»]{1,20}\\] )?'
const WHISPERS = [
  new RegExp(`^${RANK}${NAME} whispers(?: to you)?: (.*)$`, 'i'),
  new RegExp(`^${RANK}${NAME} whispers (!.*)$`, 'i'),
  new RegExp(`^From ${RANK}${NAME}: (.*)$`, 'i'),
  new RegExp(`^\\[${RANK}${NAME} -> (?:me|you)\\] (.*)$`, 'i')
]
const PUBLIC = new RegExp(`^${RANK}${NAME} » (.*)$`)

// Removes colour codes and the server's custom-font icons.
const clean = (s) => String(s)
  .replace(/§[0-9a-fk-orx]/gi, '')
  .replace(/[-�]|[\u{F0000}-\u{10FFFF}]/gu, '')
  .trim()

// Returns { from, command, arg, whisper } or null.
function parseLine (line, { whisperPattern, publicCommands } = {}) {
  const text = clean(line)
  let match = null
  let whisper = true
  for (const re of whisperPattern ? [whisperPattern] : WHISPERS) {
    match = re.exec(text)
    if (match) break
  }
  if (!match && publicCommands) {
    match = PUBLIC.exec(text)
    whisper = false
  }
  if (!match) return null
  const cmd = /^!(\w+)(?:\s+(\S+))?(?:\s+(\S+))?/.exec(match[2].trim())
  if (!cmd) return null
  return { from: match[1], command: cmd[1].toLowerCase(), arg: cmd[2] || '', arg2: cmd[3] || '', whisper }
}

const REFUSALS = {
  current: 'your kit is on the way.',
  served: 'you already got your kit.',
  daily: 'no kits left for today, try tomorrow.',
  full: 'the queue is full, try later.'
}

// Handles one command and returns the reply text (or null for silence).
const VALID_NAME = /^[A-Za-z0-9_]{1,16}$/

// !wl                  list        !wl add <name>   or   !wl <name>
// !wl list             list        !wl remove <name>
// Also !allow <name>, !unallow <name>, !whitelist.
function whitelist (command, arg, arg2, state) {
  let action = 'add'
  let name = arg
  if (command === 'unallow') action = 'remove'
  else if (command === 'whitelist' || command === 'wl') {
    if (!arg || arg === 'list') action = 'list'
    else if (/^(add|remove|rm|del)$/i.test(arg)) { action = /^add$/i.test(arg) ? 'add' : 'remove'; name = arg2 }
  }
  if (action === 'list') {
    const names = state.data.whitelist
    return names.length ? `whitelist (${names.length}): ${names.join(', ')}` : 'the whitelist is empty. Add someone with !wl add <name>'
  }
  if (!name) return `usage: !wl ${action} <name>`
  if (!VALID_NAME.test(name)) return `"${name}" is not a valid Minecraft name.`
  if (action === 'add') return state.allow(name) ? `${name} added to the whitelist.` : `${name} is already on the whitelist.`
  return state.unallow(name) ? `${name} removed from the whitelist.` : `${name} is not on the whitelist.`
}

function handle ({ from, command, arg, arg2, whisper }, { state, config, isOwner, stock, carried }) {
  switch (command) {
    case 'kit': {
      if (state.data.paused) return 'kit delivery is paused.'
      if (config.whitelistOnly && !isOwner && !state.allowed(from)) return 'kits are for whitelisted players only.'
      const r = state.request(from, config)
      if (r.ok) {
        const base = `queued, position ${r.position}.`
        return isOwner || state.allowed(from)
          ? `${base} Accept my /tpa with /tpy, or /tpa ${config.username} to come to me, even from spawn.`
          : `${base} Stay past 5000 blocks from spawn and accept my /tpa with /tpy.`
      }
      if (r.reason === 'queued') return `you are already queued, position ${r.position}.`
      return REFUSALS[r.reason]
    }
    case 'queue': {
      const pos = state.position(from)
      return pos ? `your position is ${pos}.` : `you are not queued. ${state.data.queue.length} waiting.`
    }
    case 'leave':
      return state.leave(from) ? 'removed from the queue.' : 'you are not queued.'
    case 'help':
      return 'commands: !kit !queue !leave'
  }
  // Owner commands are only honoured from a whisper or the host console.
  if (!whisper || !isOwner) return null
  switch (command) {
    case 'pause': state.data.paused = true; state.save(); return 'paused.'
    case 'resume': state.data.paused = false; state.save(); return 'resumed.'
    case 'allow': case 'unallow': case 'whitelist': case 'wl': return whitelist(command, arg, arg2, state)
    case 'inv': {
      const items = carried ? carried() : []
      return items.length ? 'carrying: ' + items.join(', ') : 'carrying nothing.'
    }
    case 'reset': return state.reset(arg) ? `${arg} can get a kit again.` : `${arg} has not had a kit.`
    case 'status':
      return `queue ${state.data.queue.length}, today ${state.today()}, stock ${stock() ?? 'unknown'}, ${state.data.paused ? 'paused' : 'running'}`
    default: return null
  }
}

module.exports = { parseLine, handle, clean }
