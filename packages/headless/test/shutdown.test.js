// Run with: node --test test/shutdown.test.js   (after `npm run build`; imports the compiled lib/shutdown.js)
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const { spawn } = require('child_process')
const path = require('path')
const { installServeSignalHandlers, exitCodeFor, SERVE_STOP_TIMEOUT_MS } = require('../lib/shutdown')

// ---- unit tests with a fake child and a fake process ----
const fakeChild = () => {
  const child = new EventEmitter()
  child.pid = 4242
  child.exitCode = null
  child.signalCode = null
  child.kill = test.mock.fn(() => true)
  return child
}
const fakeProc = () => {
  const proc = new EventEmitter()
  proc.exit = test.mock.fn()
  return proc
}

test('exitCodeFor: code wins, signal maps to 128+n', () => {
  assert.equal(exitCodeFor(0, null), 0)
  assert.equal(exitCodeFor(3, null), 3)
  assert.equal(exitCodeFor(null, 'SIGTERM'), 143)
  assert.equal(exitCodeFor(null, 'SIGINT'), 130)
  assert.equal(exitCodeFor(null, null), 1)
})

test('default hard cap is 10 s', () => {
  assert.equal(SERVE_STOP_TIMEOUT_MS, 10_000)
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`${signal} is forwarded to the backend and the wrapper exits with its code`, () => {
    const child = fakeChild()
    const proc = fakeProc()
    const closeClient = test.mock.fn()
    installServeSignalHandlers({ child, proc, closeClient, hardCapMs: 10_000 })

    proc.emit(signal)
    assert.equal(child.kill.mock.calls.length, 1)
    assert.deepEqual(child.kill.mock.calls[0].arguments, [signal])
    assert.equal(closeClient.mock.calls.length, 1)
    assert.equal(proc.exit.mock.calls.length, 0, 'must wait for the backend before exiting')

    child.emit('exit', 0, null)
    assert.deepEqual(
      proc.exit.mock.calls.map(c => c.arguments),
      [[0]]
    )
  })
}

test('repeated signals do not re-forward or exit early', () => {
  const child = fakeChild()
  const proc = fakeProc()
  installServeSignalHandlers({ child, proc, hardCapMs: 10_000 })
  proc.emit('SIGTERM')
  proc.emit('SIGINT')
  proc.emit('SIGTERM')
  assert.equal(child.kill.mock.calls.length, 1)
  assert.equal(proc.exit.mock.calls.length, 0)
})

test('SIGKILLs the backend after the hard cap, then exits 1', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const child = fakeChild()
  const proc = fakeProc()
  installServeSignalHandlers({ child, proc, hardCapMs: 10_000 })
  proc.emit('SIGTERM')

  t.mock.timers.tick(9_999)
  assert.equal(child.kill.mock.calls.length, 1)
  t.mock.timers.tick(1)
  assert.deepEqual(child.kill.mock.calls[1].arguments, ['SIGKILL'])
  assert.equal(proc.exit.mock.calls.length, 0)

  child.emit('exit', null, 'SIGKILL')
  assert.deepEqual(
    proc.exit.mock.calls.map(c => c.arguments),
    [[1]]
  )
})

test('no SIGKILL when the backend exits inside the cap', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const child = fakeChild()
  const proc = fakeProc()
  installServeSignalHandlers({ child, proc, hardCapMs: 10_000 })
  proc.emit('SIGTERM')
  child.emit('exit', 0, null)
  t.mock.timers.tick(60_000)
  assert.equal(child.kill.mock.calls.length, 1)
  assert.equal(proc.exit.mock.calls.length, 1)
})

test('exits with the backend code when it dies on its own', () => {
  const child = fakeChild()
  const proc = fakeProc()
  installServeSignalHandlers({ child, proc })
  child.emit('exit', 3, null)
  assert.deepEqual(
    proc.exit.mock.calls.map(c => c.arguments),
    [[3]]
  )
})

test('signal after the backend already exited exits immediately without kill', () => {
  const child = fakeChild()
  child.exitCode = 0
  const proc = fakeProc()
  installServeSignalHandlers({ child, proc })
  proc.emit('SIGTERM')
  assert.equal(child.kill.mock.calls.length, 0)
  assert.deepEqual(
    proc.exit.mock.calls.map(c => c.arguments),
    [[0]]
  )
})

// ---- end-to-end: real wrapper-like process + real child process ----
const HARNESS = path.join(__dirname, 'fixtures', 'serve-harness.js')

const isAlive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const runHarness = (mode, env = {}) =>
  new Promise((resolve, reject) => {
    const harness = spawn(process.execPath, [HARNESS], {
      env: { ...process.env, FAKE_BACKEND_MODE: mode, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let childPid
    const done = new Promise(res => harness.once('exit', (code, signal) => res({ code, signal })))
    harness.stdout.on('data', d => {
      out += d
      const m = out.match(/CHILD (\d+)/)
      if (m && !childPid) {
        childPid = Number(m[1])
        resolve({ harness, childPid, done })
      }
    })
    harness.once('error', reject)
    setTimeout(() => reject(new Error('harness did not start')), 10_000).unref()
  })

test('e2e: SIGTERM to the wrapper stops a graceful backend (no orphan) and exits 0', async () => {
  const { harness, childPid, done } = await runHarness('graceful')
  assert.ok(isAlive(childPid))
  harness.kill('SIGTERM')
  const { code } = await done
  assert.equal(code, 0)
  assert.equal(isAlive(childPid), false, 'backend must not be left running')
})

test('e2e: SIGINT to the wrapper stops a graceful backend (no orphan) and exits 0', async () => {
  const { harness, childPid, done } = await runHarness('graceful')
  harness.kill('SIGINT')
  const { code } = await done
  assert.equal(code, 0)
  assert.equal(isAlive(childPid), false)
})

test('e2e: a backend that ignores SIGTERM is SIGKILLed after the cap and the wrapper exits 1', async () => {
  const started = Date.now()
  const { harness, childPid, done } = await runHarness('stubborn', { HARNESS_CAP_MS: '600' })
  harness.kill('SIGTERM')
  const { code } = await done
  assert.equal(code, 1)
  assert.equal(isAlive(childPid), false)
  assert.ok(Date.now() - started >= 600)
})

test('e2e: wrapper exits with the backend code when the backend crashes', async () => {
  const { done } = await runHarness('crash')
  const { code } = await done
  assert.equal(code, 3)
})
