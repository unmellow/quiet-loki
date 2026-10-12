// Run with: node --test test/status.test.js   (after `npm run build`; imports the compiled lib/status.js)
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const path = require('path')
const { spawnSync } = require('child_process')
const { formatStatus, maskSessionSecrets, REDACTED } = require('../lib/status')

const PSK_BYTES = crypto.randomBytes(32)
const PSK = PSK_BYTES.toString('base64')
const SEED = 'S33dK8nown' + crypto.randomBytes(3).toString('hex')
const SALT = 'Sa1tK8nown' + crypto.randomBytes(3).toString('hex')
const forbidden = [
  PSK,
  PSK_BYTES.toString('base64url'),
  PSK_BYTES.toString('hex'),
  SEED,
  Buffer.from(SEED).toString('base64'),
  Buffer.from(SEED).toString('base64url'),
  Buffer.from(SEED).toString('hex'),
  SALT,
].map(f => f.replace(/=+$/, ''))

const info = () => ({
  dataDir: '/tmp/qh',
  port: 4677,
  backendPid: 4242,
  lokinetWsPort: '8080',
  session: {
    communityId: 'c',
    communityName: 'r6673test',
    teamId: 't',
    psk: PSK,
    peerId: 'QmPeer',
    onionAddress: 'addr',
    inviteSeed: SEED,
    inviteSalt: SALT,
    inviteId: 'invite-id',
  },
})

test('control: the raw status JSON would leak the psk and seed', () => {
  const raw = JSON.stringify(info(), null, 2)
  assert.ok(raw.includes(PSK) && raw.includes(SEED))
})

test('status masks psk, invite seed and salt by default (same JSON shape)', () => {
  const out = formatStatus(info())
  for (const form of forbidden) assert.ok(!out.includes(form), `leaked ${form}`)
  const parsed = JSON.parse(out)
  assert.deepEqual(Object.keys(parsed), ['dataDir', 'port', 'backendPid', 'lokinetWsPort', 'session'])
  assert.equal(parsed.session.psk, REDACTED)
  assert.equal(parsed.session.inviteSeed, REDACTED)
  assert.equal(parsed.session.inviteSalt, REDACTED)
  assert.equal(parsed.session.peerId, 'QmPeer')
  assert.equal(parsed.session.inviteId, 'invite-id')
})

test('--show-secrets shows them', () => {
  const parsed = JSON.parse(formatStatus(info(), { showSecrets: true }))
  assert.equal(parsed.session.psk, PSK)
  assert.equal(parsed.session.inviteSeed, SEED)
  assert.equal(parsed.session.inviteSalt, SALT)
})

test('maskSessionSecrets does not mutate the session and leaves missing values alone', () => {
  const s = info().session
  maskSessionSecrets(s)
  assert.equal(s.psk, PSK)
  assert.deepEqual(maskSessionSecrets({ communityId: 'c' }), { communityId: 'c' })
})

test('CLI: status accepts --show-secrets and documents it', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'lib', 'cli.js'), 'status', '--help'], {
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /--show-secrets/)
})
