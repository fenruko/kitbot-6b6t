'use strict'
// Runs the bot, pulls new commits from GitHub and restarts when it is idle.
const { spawn, execFile } = require('child_process')
const path = require('path')
const { loadEnvFile } = require('./src/config')
const { log } = require('./src/log')

const ROOT = __dirname
const env = loadEnvFile(path.join(ROOT, '.env'))
const autoUpdate = (env.AUTO_UPDATE || 'true').toLowerCase() === 'true'
const interval = Math.max(Number(env.UPDATE_INTERVAL) || 60, Number(env.UPDATE_MIN_SECONDS) || 30) * 1000
const verifyWait = Math.max(Number(env.VERIFY_RETRY) || 1800, 60) * 1000
const script = env.BOT_SCRIPT || path.join(ROOT, 'src', 'bot.js')

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { cwd: ROOT, timeout: 300000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (error, stdout, stderr) => error ? reject(new Error((stderr || error.message).trim())) : resolve(stdout.trim()))
})
const git = (...args) => run('git', args)
const install = () => run('npm', ['install', '--no-save', '--omit=dev', '--no-audit', '--no-fund'])

let child = null
let restartTimer = null
let updating = false
let wantUpdate = false
let killTimer = null
let failedCommit = ''
let stopping = false

function startBot () {
  clearTimeout(restartTimer)
  if (stopping || child) return
  child = spawn(process.execPath, [script], { cwd: ROOT, stdio: ['pipe', 'inherit', 'inherit', 'ipc'] })
  child.stdin.on('error', () => {})
  child.on('exit', async (code) => {
    child = null
    clearTimeout(killTimer)
    if (stopping) return
    if (wantUpdate) return pull()
    // 2: verification (retrying early lengthens 6b6t's wait). 3: needs a fix.
    const wait = code === 2 ? verifyWait : code === 3 ? 60 * 60000 : 30000
    log(`bot exited (${code}), restarting in ${wait / 1000}s`)
    restartTimer = setTimeout(startBot, wait)
  })
}
// Host console input is passed through to the bot.
process.stdin.on('data', (data) => child?.stdin.write(data))

async function pull () {
  updating = true
  try {
    const before = await git('rev-parse', 'HEAD')
    await git('pull', '--ff-only')
    const changed = await git('diff', '--name-only', before, 'HEAD')
    if (/^package(-lock)?\.json$/m.test(changed)) {
      log('dependencies changed, installing')
      await install()
    }
    log('updated to ' + (await git('rev-parse', '--short', 'HEAD')))
    if (/^start\.js$/m.test(changed)) log('start.js changed: restart the server once to apply it')
  } catch (e) {
    failedCommit = await git('rev-parse', '@{u}').catch(() => '')
    log('update failed, keeping current code: ' + e.message)
  }
  wantUpdate = false
  updating = false
  startBot()
}

async function check () {
  if (updating || wantUpdate) return
  try {
    await git('fetch', '--quiet')
    const upstream = await git('rev-parse', '@{u}')
    if (upstream === failedCommit) return
    if (Number(await git('rev-list', '--count', 'HEAD..@{u}')) === 0) return
    log('new commit found, updating when the bot is idle')
    wantUpdate = true
    if (!child) {
      clearTimeout(restartTimer)
      return pull()
    }
    child.send('update', () => {})
    killTimer = setTimeout(() => child?.kill(), 10 * 60000)
  } catch (e) {
    log('update check failed: ' + e.message.split('\n')[0])
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true
    child?.kill(signal)
    setTimeout(() => process.exit(0), 1500)
  })
}

async function main () {
  try {
    require.resolve('mineflayer')
  } catch {
    log('installing libraries')
    await install()
  }
  startBot()
  if (!autoUpdate) return
  setInterval(check, interval)
  check()
}
main().catch((e) => { log(e.message); process.exit(1) })
