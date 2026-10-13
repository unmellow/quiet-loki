import { randomBytes } from 'crypto'
import { inspect } from 'util'
import { runSaga } from 'redux-saga'

/**
 * Follow-up to #33: the owner logged `existingLongLivedInvite` / `lfaInviteData` with the real LFA invite seed and
 * salt. Run the saga against a stubbed socket and assert neither secret reaches log output.
 */

const SEED = 'S33dK8nown' + randomBytes(3).toString('hex')
const SALT = 'Sa1tK8nown' + randomBytes(3).toString('hex')
const NEW_SEED = 'N3wS33d' + randomBytes(3).toString('hex')
const NEW_SALT = 'N3wSa1t' + randomBytes(3).toString('hex')

const existingInvite = { id: 'existing-id', seed: SEED, salt: SALT, teamId: 'team-id' }
const newInvite = { id: 'new-id', seed: NEW_SEED, salt: NEW_SALT, teamId: 'team-id' }

jest.mock('../connection.selectors', () => ({
  connectionSelectors: { longLivedInvite: () => mockExistingInvite() },
}))
const mockExistingInvite = () => existingInvite
jest.mock('../connection.slice', () => ({
  connectionActions: { setLongLivedInvite: (payload: unknown) => ({ type: 'setLongLivedInvite', payload }) },
}))

const captureOutput = () => {
  const chunks: string[] = []
  const spies = [
    ...(['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map(m =>
      jest.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        chunks.push(args.map(a => (typeof a === 'string' ? a : inspect(a, { depth: null }))).join(' '))
      })
    ),
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      chunks.push(String(chunk))
      return true
    }),
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      chunks.push(String(chunk))
      return true
    }),
  ]
  return { text: () => chunks.join('\n'), restore: () => spies.forEach(s => s.mockRestore()) }
}

describe('createInviteSaga does not log the invite seed or salt', () => {
  it('masks existingLongLivedInvite and lfaInviteData', async () => {
    // required here (not imported) so the hoisted jest.mock factories run after the fixtures above exist
    const { createInviteSaga } = require('./createInvite.saga')
    const dispatched: any[] = []
    const socket = { emitWithAck: async () => ({ valid: false, newInvite }) }
    const out = captureOutput()
    try {
      await runSaga(
        { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
        createInviteSaga as any,
        socket,
        { type: 'createInvite', payload: {} }
      ).toPromise()
    } finally {
      out.restore()
    }
    // the real invite still reaches the store
    expect(dispatched).toContainEqual({ type: 'setLongLivedInvite', payload: newInvite })
    const text = out.text()
    expect(text).toContain('existingLongLivedInvite')
    expect(text).toContain('lfaInviteData')
    for (const secret of [SEED, SALT, NEW_SEED, NEW_SALT]) expect(text).not.toContain(secret)
  })
})
