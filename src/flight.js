'use strict'
// Elytra steering through the nether: look a short way ahead in several
// directions, take the clearest one that still heads toward +x, and use a
// firework when slow. Angles are mineflayer's (yaw -PI/2 = +x, pitch up > 0).
const { Vec3 } = require('vec3')

const EAST = -Math.PI / 2
const YAWS = [0, 0.35, -0.35, 0.75, -0.75, 1.2, -1.2, 1.8, -1.8, 2.5, -2.5, Math.PI]
const PITCHES = [0, 0.2, -0.2, 0.45, -0.45, 0.8]
const RANGE = 32

const direction = (yaw, pitch) =>
  new Vec3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))

// How far the path is free, keeping a margin around the bot on every side.
function clearance (isBlocked, pos, dir) {
  const side = new Vec3(-dir.z, 0, dir.x).normalize()
  for (let d = 1; d <= RANGE; d++) {
    const p = pos.plus(dir.scaled(d))
    const margin = d <= 3 ? 0.6 : 1.5
    for (const o of [0, margin, -margin]) {
      const q = p.plus(side.scaled(o))
      for (const dy of d <= 3 ? [0, 0.9] : [-1.5, 0, 0.9, 2]) {
        if (isBlocked(q.offset(0, dy, 0))) return d - 1
      }
    }
  }
  return RANGE
}

// Share of the path that has lava somewhere below it.
function lavaRisk (isLava, pos, dir) {
  let hits = 0
  for (let d = 4; d <= 24; d += 4) {
    const p = pos.plus(dir.scaled(d))
    for (let down = 1; down <= 24; down += 2) {
      if (isLava(p.offset(0, -down, 0))) { hits++; break }
    }
  }
  return hits / 6
}

// Returns { yaw, pitch, clear }. Safety comes first, heading east second.
function steer (isBlocked, pos, { cruiseY = 70, descend = false, isLava = () => false } = {}) {
  const wantPitch = descend ? -0.2 : Math.max(-0.3, Math.min(0.3, (cruiseY - pos.y) / 40))
  let best = null
  for (const dy of YAWS) {
    for (const dp of PITCHES) {
      const yaw = EAST + dy
      const pitch = Math.max(-0.8, Math.min(0.8, wantPitch + dp))
      const dir = direction(yaw, pitch)
      const clear = clearance(isBlocked, pos, dir)
      const risk = lavaRisk(isLava, pos, dir) * (descend ? 60 : 15)
      const tooClose = clear < 10 ? (10 - clear) * 10 : 0
      const score = clear * 2 - tooClose - risk - Math.abs(dy) * 10 - Math.abs(dp) * 8
      if (!best || score > best.score) best = { yaw, pitch, clear, score }
    }
  }
  return best
}

// Slow and steady: only boost with plenty of open space ahead.
function shouldBoost ({ speed, clear, sinceBoostMs, rocketActive, descend }) {
  return !descend && !rocketActive && speed < 0.7 && clear >= 20 && sinceBoostMs > 2000
}

module.exports = { steer, shouldBoost, clearance, lavaRisk, direction, EAST }
