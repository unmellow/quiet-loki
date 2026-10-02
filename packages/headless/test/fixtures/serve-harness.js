// Runs the same wiring as `cli.js serve` around a fake backend (no socket.io / Electron needed).
const { fork } = require('child_process')
const path = require('path')
const { installServeSignalHandlers } = require('../../lib/shutdown')

const child = fork(path.join(__dirname, 'fake-backend.js'), [], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] })
child.once('message', () => {
  installServeSignalHandlers({
    child,
    closeClient: () => {},
    hardCapMs: Number(process.env.HARNESS_CAP_MS || 10_000),
    log: m => console.error(`harness: ${m}`),
  })
  console.log(`CHILD ${child.pid}`)
})
