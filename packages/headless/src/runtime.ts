import { fork, type ChildProcess } from 'child_process'
import fs from 'fs'
import crypto from 'crypto'
import path from 'path'
import getPort from 'get-port'
import { io, Socket } from 'socket.io-client'
import {
  composeInvitationDeepUrl,
  p2pAddressesToPairs,
  parseInvitationLinkDeepUrl,
} from '@quiet/common'
import { v4 as uuidv4 } from 'uuid'
import { defaultDataDir, loadSession, saveSession, type HeadlessSession } from './session'

const SocketActions = {
  START: 'start',
  CREATE_COMMUNITY: 'createCommunity',
  JOIN_COMMUNITY: 'joinCommunity',
  LAUNCH_COMMUNITY: 'launchCommunity',
  CREATE_CHANNEL: 'createChannel',
  SEND_MESSAGE: 'sendMessage',
  GET_MESSAGES: 'getMessages',
  VALIDATE_OR_CREATE_LONG_LIVED_LFA_INVITE: 'validateOrCreateLongLivedLfaInvite',
} as const

const SocketEvents = {
  CHANNELS_STORED: 'channelsStored',
  MESSAGES_STORED: 'messagesStored',
  TOR_INITIALIZED: 'torInitialized',
  COMMUNITY_LAUNCHED: 'communityLaunched',
} as const

const InvitationDataVersion = { v4: 'v4' } as const
const MessageTypeBasic = 1

export type Runtime = {
  child: ChildProcess
  socket: Socket
  dataDir: string
  secret: string
  port: number
  session: HeadlessSession
}

function emitWithAck<T>(socket: Socket, event: string, payload: unknown, timeoutMs = 180_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ack on ${event}`)), timeoutMs)
    // socket.io v4 timeout().emit(event, ...args, ack)
    ;(socket as any).timeout(timeoutMs).emit(event, payload, (err: Error | null, response: T) => {
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(response)
    })
  })
}

function resolveBackendBundle(): string {
  try {
    return path.normalize(require.resolve('backend-bundle'))
  } catch {
    const fallback = path.resolve(__dirname, '../../backend-bundle/bundle.cjs')
    return fallback
  }
}

export async function startRuntime(opts: { dataDir?: string; resourcesPath?: string } = {}): Promise<Runtime> {
  const dataDir = opts.dataDir || process.env.QUIET_HEADLESS_DATA_DIR || defaultDataDir()
  const resourcesPath = opts.resourcesPath || process.env.QUIET_RESOURCES || ''
  const secret = crypto.randomBytes(32).toString('hex')
  const port = await getPort()
  const bundlePath = resolveBackendBundle()

  // Desktop passes -a <appDataPath>; backendManager uses path.join(appDataPath, 'Quiet').
  // AppModule ORBIT/IPFS factories readdirSync that Quiet dir — create it first.
  fs.mkdirSync(path.join(dataDir, 'Quiet'), { recursive: true })

  const forkArgvs = ['-d', `${port}`, '-a', dataDir, '-r', resourcesPath || path.sep, '-p', 'desktop']

  const child = fork(bundlePath, forkArgvs, {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: {
      ...process.env,
      QUIET_HEADLESS: '1',
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--enable-source-maps',
      QSS_ALLOWED: process.env.QSS_ALLOWED ?? 'false',
      QPS_ALLOWED: process.env.QPS_ALLOWED ?? 'false',
      LOKINET_WS_PORT: process.env.LOKINET_WS_PORT || '80',
    },
  })

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('backend did not request socket secret')), 60_000)
    const onMessage = (msg: any) => {
      if (msg && msg.type === 'readyForSecret' && typeof msg.nonce === 'string') {
        clearTimeout(t)
        child.off('message', onMessage)
        child.send({ type: 'set-socket-secret', secret, nonce: msg.nonce })
        resolve()
      }
    }
    child.on('message', onMessage)
    child.on('error', reject)
    child.on('exit', code => {
      if (code != null && code !== 0) reject(new Error(`backend exited early with code ${code}`))
    })
  })

  // Give Nest a moment to call listen() after receiving the secret
  await new Promise(r => setTimeout(r, 1500))

  // Arm ready waiter BEFORE emitting START so we do not miss torInitialized.
  const { socket, ready } = await connectSocket(port, secret)
  await ready

  return { child, socket, dataDir, secret, port, session: loadSession(dataDir) }
}

async function connectSocket(
  port: number,
  secret: string,
  attempts = 40
): Promise<{ socket: Socket; ready: Promise<void> }> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const socket = await new Promise<Socket>((resolve, reject) => {
        const s = io(`http://127.0.0.1:${port}`, {
          extraHeaders: { authorization: `Bearer ${secret}` },
          transports: ['websocket'],
          reconnection: false,
          timeout: 5000,
        })
        const t = setTimeout(() => {
          s.close()
          reject(new Error('socket connect timeout'))
        }, 5000)
        s.on('connect', () => {
          clearTimeout(t)
          resolve(s)
        })
        s.on('connect_error', err => {
          clearTimeout(t)
          s.close()
          reject(err)
        })
      })

      // START unblocks SocketService; ConnectionsManager attaches listeners in its own
      // onModuleInit right after. torInitialized only fires when a community launches,
      // so for a cold create we wait briefly for Nest to finish wiring listeners.
      const ready = new Promise<void>(resolve => {
        let settled = false
        const done = () => {
          if (settled) return
          settled = true
          socket.off(SocketEvents.TOR_INITIALIZED, done)
          socket.off('connectionProcess', onProcess)
          resolve()
        }
        const onProcess = () => done()
        socket.on(SocketEvents.TOR_INITIALIZED, done)
        socket.on('connectionProcess', onProcess)
        socket.emit(SocketActions.START)
        setTimeout(done, 2500)
      })

      return { socket, ready }
    } catch (e) {
      lastErr = e
      await new Promise(r => setTimeout(r, 500))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function stopRuntime(rt: Runtime): Promise<void> {
  try {
    rt.socket.close()
  } catch {
    /* ignore */
  }
  await new Promise<void>(resolve => {
    const t = setTimeout(() => {
      try {
        rt.child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      resolve()
    }, 10_000)
    rt.child.once('exit', () => {
      clearTimeout(t)
      resolve()
    })
    try {
      rt.child.send('close')
    } catch {
      try {
        rt.child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
  })
}

function genCommunityId(): string {
  return Array(16)
    .fill(null)
    .map(() => Math.random().toString(36).charAt(2))
    .join('')
}

export async function cmdCreate(rt: Runtime, name: string, username: string): Promise<void> {
  const id = genCommunityId()
  const res: any = await emitWithAck(rt.socket, SocketActions.CREATE_COMMUNITY, {
    id,
    name,
    username,
    useServer: false,
    tosAccepted: false,
  })
  if (!res?.community || !res.identity) {
    throw new Error(`createCommunity failed: ${JSON.stringify(res)}`)
  }

  const channelRes: any = await emitWithAck(rt.socket, SocketActions.CREATE_CHANNEL, {
    name: 'general',
    description: 'Welcome to #general',
    teamId: res.community.teamId,
    public: true,
  })

  const invite: any = await emitWithAck(rt.socket, SocketActions.VALIDATE_OR_CREATE_LONG_LIVED_LFA_INVITE, {
    id: undefined,
  })

  rt.session = {
    communityId: res.community.id,
    communityName: res.community.name,
    teamId: res.community.teamId,
    psk: res.community.psk,
    userId: res.identity.userId,
    peerId: res.identity.networkInfo.peerId.id,
    onionAddress: res.identity.networkInfo.hiddenService.onionAddress,
    peerList: res.community.peerList,
    generalChannelId: channelRes.channel?.id,
    inviteSeed: invite.newInvite?.seed,
    inviteSalt: invite.newInvite?.salt,
    inviteId: invite.newInvite?.id,
    username,
  }
  saveSession(rt.dataDir, rt.session)
  console.log(
    JSON.stringify(
      { ok: true, community: res.community.name, id: res.community.id, channelId: rt.session.generalChannelId },
      null,
      2
    )
  )
}

export function buildInviteUrl(session: HeadlessSession): string {
  if (!session.psk || !session.peerList?.length || !session.inviteSeed || !session.teamId || !session.communityName) {
    throw new Error('Session incomplete — run create (or join) first')
  }
  const pairs = p2pAddressesToPairs(session.peerList.slice(0, 3))
  return composeInvitationDeepUrl({
    version: InvitationDataVersion.v4 as any,
    psk: session.psk,
    pairs,
    authData: {
      communityName: session.communityName,
      seed: session.inviteSeed,
      teamId: session.teamId,
    },
  } as any)
}

export async function cmdInvite(rt: Runtime): Promise<void> {
  if (!rt.session.inviteSeed) {
    const invite: any = await emitWithAck(rt.socket, SocketActions.VALIDATE_OR_CREATE_LONG_LIVED_LFA_INVITE, {
      id: rt.session.inviteId,
    })
    if (invite.newInvite) {
      rt.session.inviteSeed = invite.newInvite.seed
      rt.session.inviteSalt = invite.newInvite.salt
      rt.session.inviteId = invite.newInvite.id
      saveSession(rt.dataDir, rt.session)
    }
  }
  console.log(buildInviteUrl(rt.session))
}

/** Accept deep `quiet-loki://?…`, share `quiet-loki://join#…`, or raw query params. */
function parseInviteInput(invite: string) {
  let url = invite.trim()
  if (url.includes('#')) {
    const hash = url.split('#', 2)[1] || ''
    url = `quiet-loki://?${hash}`
  } else if (!url.startsWith('quiet-loki://')) {
    url = `quiet-loki://?${url.replace(/^\?/, '')}`
  } else if (url.startsWith('quiet-loki://join?')) {
    url = url.replace('quiet-loki://join?', 'quiet-loki://?')
  }
  return parseInvitationLinkDeepUrl(url)
}


/** Resolves when launchCommunity acks or COMMUNITY_LAUNCHED fires (whichever first). */
function waitForCommunityLaunch(socket: Socket, communityId: string, timeoutMs = 180_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (fn: (v?: any) => void, v?: any) => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.off(SocketEvents.COMMUNITY_LAUNCHED, onLaunched)
      fn(v)
    }
    const onLaunched = (payload: any) => {
      if (payload?.id && payload.id !== communityId) return
      finish(resolve)
    }
    const timer = setTimeout(
      () => finish(reject, new Error(`Timeout waiting for launchCommunity / communityLaunched`)),
      timeoutMs
    )
    socket.on(SocketEvents.COMMUNITY_LAUNCHED, onLaunched)
    ;(socket as any).timeout(timeoutMs).emit(
      SocketActions.LAUNCH_COMMUNITY,
      { id: communityId },
      (err: Error | null) => {
        if (err) finish(reject, err)
        else finish(resolve)
      }
    )
  })
}

export async function cmdJoin(rt: Runtime, invite: string, username: string): Promise<void> {
  const inviteData = parseInviteInput(invite)
  const id = genCommunityId()
  const res: any = await emitWithAck(rt.socket, SocketActions.JOIN_COMMUNITY, {
    id,
    name: inviteData.authData.communityName,
    inviteData,
    username,
    tosAccepted: false,
  })
  if (!res?.community || !res.identity) {
    throw new Error(`joinCommunity failed: ${JSON.stringify(res)}`)
  }

  // Persist identity/community as soon as JOIN succeeds so later channel timeout cannot leave session unsaved.
  rt.session = {
    communityId: res.community.id,
    communityName: res.community.name,
    teamId: res.community.teamId,
    psk: res.community.psk,
    userId: res.identity.userId,
    peerId: res.identity.networkInfo.peerId.id,
    onionAddress: res.identity.networkInfo.hiddenService.onionAddress,
    peerList: res.community.peerList,
    username,
  }
  saveSession(rt.dataDir, rt.session)

  // Backend acks launchCommunity; also accept COMMUNITY_LAUNCHED so a missed ack still unblocks join.
  await waitForCommunityLaunch(rt.socket, res.community.id)

  await new Promise<void>(resolve => {
    const onChannels = (payload: any) => {
      const channels = payload?.channels || payload
      const list = Array.isArray(channels) ? channels : channels?.channels
      const general = (list || []).find((c: any) => c.name === 'general')
      if (general) {
        rt.session.generalChannelId = general.id
        saveSession(rt.dataDir, rt.session)
        rt.socket.off(SocketEvents.CHANNELS_STORED, onChannels)
        resolve()
      }
    }
    rt.socket.on(SocketEvents.CHANNELS_STORED, onChannels)
    setTimeout(() => {
      // Session already saved after JOIN; channel id is best-effort.
      rt.socket.off(SocketEvents.CHANNELS_STORED, onChannels)
      resolve()
    }, 20_000)
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        community: res.community.name,
        id: res.community.id,
        channelId: rt.session.generalChannelId || null,
      },
      null,
      2
    )
  )
}

export async function cmdSend(rt: Runtime, text: string): Promise<void> {
  if (!rt.session.generalChannelId || !rt.session.userId) {
    throw new Error('No #general channel in session — create/join first and wait for channel sync')
  }
  const message = {
    id: uuidv4(),
    type: MessageTypeBasic,
    message: text,
    createdAt: Math.floor(Date.now() / 1000),
    channelId: rt.session.generalChannelId,
    userId: rt.session.userId,
  }
  rt.socket.emit(SocketActions.SEND_MESSAGE, message)
  console.log(JSON.stringify({ ok: true, id: message.id }, null, 2))
}

export async function cmdMessages(rt: Runtime, ids: string[] = []): Promise<void> {
  if (!rt.session.generalChannelId || !rt.session.peerId || !rt.session.communityId) {
    throw new Error('Session incomplete for messages')
  }

  if (ids.length === 0) {
    const collected: any[] = []
    const onStored = (payload: any) => {
      for (const m of payload.messages || []) {
        if (m.channelId === rt.session.generalChannelId) collected.push(m)
      }
    }
    rt.socket.on(SocketEvents.MESSAGES_STORED, onStored)
    await new Promise(r => setTimeout(r, 3000))
    rt.socket.off(SocketEvents.MESSAGES_STORED, onStored)
    console.log(JSON.stringify(collected, null, 2))
    return
  }

  const res: any = await emitWithAck(rt.socket, SocketActions.GET_MESSAGES, {
    ids,
    peerId: rt.session.peerId,
    channelId: rt.session.generalChannelId,
    communityId: rt.session.communityId,
  })
  console.log(JSON.stringify(res?.messages || [], null, 2))
}

export async function cmdStatus(rt: Runtime): Promise<void> {
  console.log(
    JSON.stringify(
      {
        dataDir: rt.dataDir,
        port: rt.port,
        backendPid: rt.child.pid,
        lokinetWsPort: process.env.LOKINET_WS_PORT || '80',
        session: rt.session,
      },
      null,
      2
    )
  )
}
