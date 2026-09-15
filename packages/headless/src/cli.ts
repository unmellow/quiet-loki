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

async function withRuntime(fn: (rt: Awaited<ReturnType<typeof startRuntime>>) => Promise<void>) {
  const dataDir = process.env.QUIET_HEADLESS_DATA_DIR
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
  .description('Headless Quiet Loki (Loki-only) for Day 2 create/join/#general')
  .option('--data-dir <path>', 'app data directory', process.env.QUIET_HEADLESS_DATA_DIR)

program
  .command('create')
  .description('Create a new Loki-only community')
  .requiredOption('-n, --name <name>', 'community name')
  .requiredOption('-u, --username <username>', 'nickname')
  .action(async opts => {
    process.env.QUIET_HEADLESS_DATA_DIR = program.opts().dataDir || process.env.QUIET_HEADLESS_DATA_DIR
    await withRuntime(rt => cmdCreate(rt, opts.name, opts.username))
  })

program
  .command('invite')
  .description('Print quiet-loki:// invite for the current community')
  .action(async () => {
    process.env.QUIET_HEADLESS_DATA_DIR = program.opts().dataDir || process.env.QUIET_HEADLESS_DATA_DIR
    await withRuntime(rt => cmdInvite(rt))
  })

program
  .command('join')
  .description('Join via quiet-loki:// invite')
  .requiredOption('-i, --invite <url>', 'quiet-loki://join#… invite')
  .requiredOption('-u, --username <username>', 'nickname')
  .action(async opts => {
    process.env.QUIET_HEADLESS_DATA_DIR = program.opts().dataDir || process.env.QUIET_HEADLESS_DATA_DIR
    await withRuntime(rt => cmdJoin(rt, opts.invite, opts.username))
  })

program
  .command('send')
  .description('Send a message to #general')
  .argument('<text>', 'message body')
  .action(async text => {
    process.env.QUIET_HEADLESS_DATA_DIR = program.opts().dataDir || process.env.QUIET_HEADLESS_DATA_DIR
    await withRuntime(rt => cmdSend(rt, text))
  })

program
  .command('messages')
  .description('List recent #general messages (listens briefly) or fetch by id')
  .option('--ids <ids>', 'comma-separated message ids')
  .action(async opts => {
    process.env.QUIET_HEADLESS_DATA_DIR = program.opts().dataDir || process.env.QUIET_HEADLESS_DATA_DIR
    const ids = opts.ids ? String(opts.ids).split(',').filter(Boolean) : []
    await withRuntime(rt => cmdMessages(rt, ids))
  })

program
  .command('status')
  .description('Show headless session / env')
  .action(async () => {
    process.env.QUIET_HEADLESS_DATA_DIR = program.opts().dataDir || process.env.QUIET_HEADLESS_DATA_DIR
    await withRuntime(rt => cmdStatus(rt))
  })

program
  .command('serve')
  .description('Keep backend running (for long receive loops)')
  .action(async () => {
    process.env.QUIET_HEADLESS_DATA_DIR = program.opts().dataDir || process.env.QUIET_HEADLESS_DATA_DIR
    const rt = await startRuntime({ dataDir: program.opts().dataDir })
    console.error(`headless backend up on 127.0.0.1:${rt.port} (QUIET_HEADLESS=1). Ctrl-C to stop.`)
    await cmdStatus(rt)
    await new Promise(() => {
      /* run until signal */
    })
  })

program.parseAsync(process.argv).catch(err => {
  console.error(err?.stack || err)
  process.exit(1)
})
