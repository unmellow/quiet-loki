import 'reflect-metadata'
import crypto from 'crypto'
import getPort from 'get-port'
import { io, Socket } from 'socket.io-client'
import { NestFactory } from '@nestjs/core'
import { INestApplicationContext } from '@nestjs/common'
import { AppModule } from '../../backend/src/nest/app.module'
import { ConnectionsManagerService } from '../../backend/src/nest/connections-manager/connections-manager.service'
import { torBinForPlatform, torDirForPlatform } from '../../backend/src/nest/common/utils'
import { composeInvitationShareUrl, p2pAddressesToPairs, parseInvitationLink } from '@quiet/common'
import {
  InvitationDataVersion,
  MessageType,
  SocketActions,
  SocketEvents,
  type ChannelMessage,
  type CreateChannelPayload,
  type CreateChannelResponse,
  type InitCommunityPayload,
  type InvitationDataV4,
  type MessagesLoadedPayload,
  type ResponseCreateCommunityPayload,
  type ResponseInvitePayload,
  type ResponseJoinCommunityPayload,
} from '@quiet/types'
import { v4 as uuidv4 } from 'uuid'
import { defaultDataDir, loadSession, saveSession, type HeadlessSession } from './session'

export type Runtime = {
  app: INestApplicationContext
  socket: Socket
  dataDir: string
  secret: string
  port: number
  session: HeadlessSession
}

function emitWithAck<T>(socket: Socket, event: string, payload: unknown, timeoutMs = 120_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ack on ${event}`)), timeoutMs)
    socket.timeout(timeoutMs).emit(event, payload, (err: Error | null, response: T) => {
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(response)
    })
  })
}

export async function startRuntime(opts: { dataDir?: string; resourcesPath?: string } = {}): Promise<Runtime> {
  process.env.QUIET_HEADLESS = '1'
  process.env.BACKEND = process.env.BACKEND || 'desktop'

  const dataDir = opts.dataDir || process.env.QUIET_HEADLESS_DATA_DIR || defaultDataDir()
  const resourcesPath = opts.resourcesPath || process.env.QUIET_RESOURCES || ''
  const secret = crypto.randomBytes(32).toString('hex')
  const port = await getPort()

  const app = await NestFactory.createApplicationContext(
    AppModule.forOptions({
      socketIOPort: port,
      socketIOSecret: secret,
      torBinaryPath: torBinForPlatform(resourcesPath),
      torResourcesPath: torDirForPlatform(resourcesPath),
      torControlPort: await getPort(),
      options: {
        env: {
          appDataPath: dataDir,
        },
        headless: true,
        createPaths: true,
      },
    })
  )

  // Headless skips Electron START wait; connect after Nest is listening.
  const socket = await new Promise<Socket>((resolve, reject) => {
    const s = io(`http://127.0.0.1:${port}`, {
      extraHeaders: { authorization: `Bearer ${secret}` },
      transports: ['websocket'],
      reconnection: false,
    })
    const t = setTimeout(() => reject(new Error('socket connect timeout')), 30_000)
    s.on('connect', () => {
      clearTimeout(t)
      s.emit(SocketActions.START)
      resolve(s)
    })
    s.on('connect_error', err => {
      clearTimeout(t)
      reject(err)
    })
  })

  const session = loadSession(dataDir)

  return { app, socket, dataDir, secret, port, session }
}

export async function stopRuntime(rt: Runtime): Promise<void> {
  try {
    const cm = rt.app.get(ConnectionsManagerService)
    await cm.closeAllServices()
  } catch {
    // ignore
  }
  rt.socket.close()
  await rt.app.close()
}

function genCommunityId(): string {
  return Array(16)
    .fill(null)
    .map(() => Math.random().toString(36).charAt(2))
    .join('')
}

export async function cmdCreate(rt: Runtime, name: string, username: string): Promise<void> {
  const id = genCommunityId()
  const payload: InitCommunityPayload = {
    id,
    name,
    username,
    useServer: false,
    tosAccepted: false,
  }
  const res = await emitWithAck<ResponseCreateCommunityPayload | undefined>(
    rt.socket,
    SocketActions.CREATE_COMMUNITY,
    payload
  )
  if (!res?.community || !res.identity) {
    throw new Error('createCommunity failed: empty response')
  }

  const channelRes = await emitWithAck<CreateChannelResponse>(rt.socket, SocketActions.CREATE_CHANNEL, {
    name: 'general',
    description: 'Welcome to #general',
    teamId: res.community.teamId,
    public: true,
  } as CreateChannelPayload)

  const invite = await emitWithAck<ResponseInvitePayload>(
    rt.socket,
    SocketActions.VALIDATE_OR_CREATE_LONG_LIVED_LFA_INVITE,
    { id: undefined }
  )

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
  console.log(JSON.stringify({ ok: true, community: res.community.name, id: res.community.id, channelId: rt.session.generalChannelId }, null, 2))
}

export function buildInviteUrl(session: HeadlessSession): string {
  if (!session.psk || !session.peerList?.length || !session.inviteSeed || !session.teamId || !session.communityName) {
    throw new Error('Session incomplete — run create (or join) first')
  }
  const pairs = p2pAddressesToPairs(session.peerList.slice(0, 3))
  const inviteData: InvitationDataV4 = {
    version: InvitationDataVersion.v4,
    psk: session.psk,
    pairs,
    authData: {
      communityName: session.communityName,
      seed: session.inviteSeed,
      teamId: session.teamId,
    },
  }
  return composeInvitationShareUrl(inviteData)
}

export async function cmdInvite(rt: Runtime): Promise<void> {
  if (!rt.session.inviteSeed) {
    const invite = await emitWithAck<ResponseInvitePayload>(
      rt.socket,
      SocketActions.VALIDATE_OR_CREATE_LONG_LIVED_LFA_INVITE,
      { id: rt.session.inviteId }
    )
    if (invite.newInvite) {
      rt.session.inviteSeed = invite.newInvite.seed
      rt.session.inviteSalt = invite.newInvite.salt
      rt.session.inviteId = invite.newInvite.id
      saveSession(rt.dataDir, rt.session)
    }
  }
  const url = buildInviteUrl(rt.session)
  console.log(url)
}

export async function cmdJoin(rt: Runtime, invite: string, username: string): Promise<void> {
  const inviteData = parseInvitationLink(invite)
  const id = genCommunityId()
  const payload: InitCommunityPayload = {
    id,
    name: inviteData.authData.communityName,
    inviteData,
    username,
    tosAccepted: false,
  }
  const res = await emitWithAck<ResponseJoinCommunityPayload | undefined>(
    rt.socket,
    SocketActions.JOIN_COMMUNITY,
    payload
  )
  if (!res?.community || !res.identity) {
    throw new Error('joinCommunity failed: empty response')
  }
  await emitWithAck(rt.socket, SocketActions.LAUNCH_COMMUNITY, { id: res.community.id })

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

  // Wait briefly for #general metadata to replicate
  await new Promise<void>(resolve => {
    const onChannels = (payload: { channels?: { id: string; name: string }[] }) => {
      const general = payload.channels?.find(c => c.name === 'general')
      if (general) {
        rt.session.generalChannelId = general.id
        saveSession(rt.dataDir, rt.session)
        rt.socket.off(SocketEvents.CHANNELS_STORED, onChannels)
        resolve()
      }
    }
    rt.socket.on(SocketEvents.CHANNELS_STORED, onChannels)
    setTimeout(() => {
      rt.socket.off(SocketEvents.CHANNELS_STORED, onChannels)
      resolve()
    }, 15_000)
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
  const message: ChannelMessage = {
    id: uuidv4(),
    type: MessageType.Basic,
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
    // Collect ids from live events briefly, then also print anything already buffered.
    const collected: ChannelMessage[] = []
    const onStored = (payload: MessagesLoadedPayload) => {
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

  const res = await emitWithAck<MessagesLoadedPayload | undefined>(rt.socket, SocketActions.GET_MESSAGES, {
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
        lokinetWsPort: process.env.LOKINET_WS_PORT || '80',
        session: rt.session,
      },
      null,
      2
    )
  )
}

