import fs from 'fs'
import path from 'path'
import os from 'os'

export type HeadlessSession = {
  communityId?: string
  communityName?: string
  teamId?: string
  psk?: string
  userId?: string
  peerId?: string
  onionAddress?: string
  peerList?: string[]
  generalChannelId?: string
  inviteSeed?: string
  inviteSalt?: string
  inviteId?: string
  username?: string
}

export function defaultDataDir(name = 'QuietHeadless'): string {
  return path.join(os.homedir(), '.config', name)
}

export function sessionPath(dataDir: string): string {
  return path.join(dataDir, 'headless-session.json')
}

export function loadSession(dataDir: string): HeadlessSession {
  const p = sessionPath(dataDir)
  if (!fs.existsSync(p)) return {}
  return JSON.parse(fs.readFileSync(p, 'utf8')) as HeadlessSession
}

export function saveSession(dataDir: string, session: HeadlessSession): void {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(sessionPath(dataDir), JSON.stringify(session, null, 2))
}
