'use strict'
const fs = require('fs')
const path = require('path')

const lower = (name) => name.toLowerCase()

// Everything that must survive a restart or an update.
class State {
  constructor (file, now = Date.now) {
    this.file = file
    this.now = now
    this.data = { queue: [], served: {}, current: null, paused: false, day: '', dayCount: 0, tpaReadyAt: 0, homeReadyAt: 0, setup: 'owner', setupError: '', whitelist: [] }
    let text = null
    try { text = fs.readFileSync(file, 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
    // A corrupt file throws on purpose: starting empty would hand out kits again.
    if (text !== null) Object.assign(this.data, JSON.parse(text))
  }

  save () {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2))
    fs.renameSync(this.file + '.tmp', this.file)
  }

  today () {
    const day = new Date(this.now()).toISOString().slice(0, 10)
    if (this.data.day !== day) { this.data.day = day; this.data.dayCount = 0 }
    return this.data.dayCount
  }

  position (name) {
    return this.data.queue.findIndex(n => lower(n) === lower(name)) + 1
  }

  // Returns { ok, reason, position }
  request (name, { queueMax, dailyLimit, onePerPlayer }) {
    if (this.data.current && lower(this.data.current.name) === lower(name)) return { ok: false, reason: 'current' }
    if (this.position(name)) return { ok: false, reason: 'queued', position: this.position(name) }
    if (onePerPlayer && this.data.served[lower(name)]) return { ok: false, reason: 'served' }
    const pending = this.data.queue.length + (this.data.current ? 1 : 0)
    if (dailyLimit && this.today() + pending >= dailyLimit) return { ok: false, reason: 'daily' }
    if (this.data.queue.length >= queueMax) return { ok: false, reason: 'full' }
    this.data.queue.push(name)
    this.save()
    return { ok: true, position: this.data.queue.length }
  }

  leave (name) {
    const i = this.position(name) - 1
    if (i < 0) return false
    this.data.queue.splice(i, 1)
    this.save()
    return true
  }

  next () {
    if (this.data.current || !this.data.queue.length) return null
    this.data.current = { name: this.data.queue.shift(), stage: 'start' }
    this.save()
    return this.data.current.name
  }

  stage (stage) {
    if (!this.data.current) return
    this.data.current.stage = stage
    this.save()
  }

  // result: 'served' (kit left the bot), 'drop' (give up), 'requeue'
  finish (result) {
    const cur = this.data.current
    if (!cur) return
    if (result === 'served') {
      this.today()
      this.data.dayCount++
      this.data.served[lower(cur.name)] = this.now()
    } else if (result === 'requeue') {
      this.data.queue.unshift(cur.name)
    }
    this.data.current = null
    this.save()
  }

  // After a crash: once the kit may have been dropped, count it as given.
  recover () {
    const cur = this.data.current
    if (cur) this.finish(cur.stage === 'dropping' ? 'served' : 'requeue')
  }

  allowed (name) {
    return this.data.whitelist.some(n => lower(n) === lower(name))
  }

  // Returns true if the list changed.
  allow (name) {
    if (this.allowed(name)) return false
    this.data.whitelist.push(name)
    this.save()
    return true
  }

  unallow (name) {
    const i = this.data.whitelist.findIndex(n => lower(n) === lower(name))
    if (i < 0) return false
    this.data.whitelist.splice(i, 1)
    this.save()
    return true
  }

  reset (name) {
    const had = !!this.data.served[lower(name)]
    delete this.data.served[lower(name)]
    this.save()
    return had
  }
}

module.exports = { State }
