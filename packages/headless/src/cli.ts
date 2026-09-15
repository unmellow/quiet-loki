#!/usr/bin/env node
import { Command } from 'commander'
import {
  cmdCreate,
  cmdInvite,
  cmdJoin,
  cmdMessages,
  cmdSend,
  cmdStatus,
  startRuntime,
  stopRuntime,
} from './runtime'

async function withRuntime(dataDir: string | undefined, fn: (rt: Awaited<ReturnType<typeof startRuntime>>) => Promise<void>) {
  const rt = await startRuntime({ dataDir })
  try {
    await fn(rt)
  } finally {
    await stopRuntime(rt)
  }
}

const program = new Command()
program
  .name('quiet-loki-headless')
  .description('Headless Quiet Loki — forks backend-bundle (same as desktop), no Electron')
  .option('--data-dir <path>', 'app data directory')

program
  .command('create')
  .requiredOption('-n, --name <name>', 'community name')
  .requiredOption('-u, --username <username>', 'nickname')
  .action(async opts => {
    await withRuntime(program.opts().dataDir, rt => cmdCreate(rt, opts.name, opts.username))
  })

program
  .command('invite')
  .action(async () => {
    await withRuntime(program.opts().dataDir, rt => cmdInvite(rt))
  })

program
  .command('join')
  .requiredOption('-i, --invite <url>', 'quiet-loki://join#… invite')
  .requiredOption('-u, --username <username>', 'nickname')
  .action(async opts => {
    await withRuntime(program.opts().dataDir, rt => cmdJoin(rt, opts.invite, opts.username))
  })

program
  .command('send')
  .argument('<text>', 'message body')
  .action(async text => {
    await withRuntime(program.opts().dataDir, rt => cmdSend(rt, text))
  })

program
  .command('messages')
  .option('--ids <ids>', 'comma-separated message ids')
  .action(async opts => {
    const ids = opts.ids ? String(opts.ids).split(',').filter(Boolean) : []
    await withRuntime(program.opts().dataDir, rt => cmdMessages(rt, ids))
  })

program
  .command('status')
  .action(async () => {
    await withRuntime(program.opts().dataDir, rt => cmdStatus(rt))
  })

program
  .command('serve')
  .description('Keep backend-bundle running')
  .action(async () => {
    const rt = await startRuntime({ dataDir: program.opts().dataDir })
    console.error(`headless backend-bundle up PID=${rt.child.pid} socket=127.0.0.1:${rt.port}. Ctrl-C to stop.`)
    await cmdStatus(rt)
    process.on('SIGINT', async () => {
      await stopRuntime(rt)
      process.exit(0)
    })
    await new Promise(() => undefined)
  })

program.parseAsync(process.argv).catch(err => {
  console.error(err?.stack || err)
  process.exit(1)
})
