'use strict'
const secrets = []
function hide (secret) { if (secret && secret.length >= 3) secrets.push(secret) }
function log (...parts) {
  let line = parts.join(' ')
  for (const s of secrets) line = line.split(s).join('********')
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`)
}
module.exports = { log, hide }
