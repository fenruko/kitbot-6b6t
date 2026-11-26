'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

// Small .env reader so there is no extra dependency. Real env vars win.
function loadEnvFile (file = path.join(ROOT, '.env'), env = process.env) {
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return env }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    const value = m[2].replace(/^(["'])(.*)\1$/, '$2')
    if (env[m[1]] === undefined) env[m[1]] = value
  }
  return env
}

function readConfig (env = process.env) {
  const num = (key, fallback) => {
    const n = Number(env[key])
    return env[key] && Number.isFinite(n) && n >= 0 ? n : fallback
  }
  const bool = (key, fallback) => env[key] ? env[key].toLowerCase() === 'true' : fallback
  const regex = (key) => env[key] ? new RegExp(env[key], 'i') : null
  return {
    username: (env.BOT_USERNAME || '').trim(),
    password: env.BOT_PASSWORD || '',
    owner: (env.OWNER || '').trim(),
    homeName: env.HOME_NAME || 'base',
    flyTargetX: num('FLY_TARGET_X', 2100),
    tpaCooldownMs: num('TPA_COOLDOWN', 420) * 1000,
    homeCooldownMs: num('HOME_COOLDOWN', 300) * 1000,
    queueMax: num('QUEUE_MAX', 10),
    dailyLimit: num('DAILY_LIMIT', 20),
    onePerPlayer: bool('ONE_KIT_PER_PLAYER', true),
    publicCommands: bool('PUBLIC_COMMANDS', false),
    whisperPattern: regex('WHISPER_PATTERN'),
    tpaDeniedPattern: regex('TPA_DENIED_PATTERN'),
    servers: (env.SERVERS || 'alt.6b6t.org,alt4.6b6t.org,alt5.6b6t.org,alt2.6b6t.org,alt3.6b6t.org')
      .split(',').map(s => s.trim()).filter(Boolean),
    dataFile: env.DATA_FILE || path.join(ROOT, 'data', 'state.json')
  }
}

module.exports = { loadEnvFile, readConfig, ROOT }
