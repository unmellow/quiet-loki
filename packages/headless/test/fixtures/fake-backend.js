// Stand-in for backend-bundle/bundle.cjs. MODE: graceful | stubborn | crash
const mode = process.env.FAKE_BACKEND_MODE || 'graceful'
process.send?.('ready')
if (mode === 'crash') setTimeout(() => process.exit(3), 300)
process.on('SIGTERM', () => {
  if (mode === 'stubborn') return // ignores SIGTERM, only SIGKILL stops it
  setTimeout(() => process.exit(0), 100)
})
process.on('SIGINT', () => {
  if (mode === 'stubborn') return
  setTimeout(() => process.exit(0), 100)
})
setInterval(() => {}, 1000)
