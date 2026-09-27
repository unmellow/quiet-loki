import { DESKTOP_FILE_NAME, updateDesktopFile, updateExecPath } from './invitation'
import tmp from 'tmp'
import path from 'path'
import fs from 'fs'
import os from 'os'
import childProcess from 'child_process'

describe('Invitation code helper', () => {
  const originalEnv = process.env
  let appImagePath: string
  let filePath: string
  let desktopFileEntry: string

  beforeEach(() => {
    jest.resetModules()
    appImagePath = '/path/Quiet.AppImage'
    process.env = {
      ...originalEnv,
      APPIMAGE: appImagePath,
    }
    const tmpDir = tmp.dirSync({ mode: 0o750, prefix: 'quietDesktop', unsafeCleanup: true }).name
    filePath = path.join(tmpDir, '.desktop')
    desktopFileEntry = `[Desktop Entry]\nName=Quiet\nExec=${appImagePath} %U`
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('replaces Exec in .desktop file if APPIMAGE path differs', () => {
    fs.writeFileSync(filePath, '[Desktop Entry]\nName=Quiet\nExec=/old/path/Quiet.AppImage %U')
    updateExecPath(filePath)
    const updatedContent = fs.readFileSync(filePath, { encoding: 'utf-8' })
    expect(updatedContent).toEqual(desktopFileEntry)
  })

  it('adds Exec to .desktop file', () => {
    fs.writeFileSync(filePath, '[Desktop Entry]\nName=Quiet')
    updateExecPath(filePath)
    const updatedContent = fs.readFileSync(filePath, { encoding: 'utf-8' })
    expect(updatedContent).toEqual(desktopFileEntry)
  })

  it('does not modify .desktop file if Exec is valid', () => {
    fs.writeFileSync(filePath, desktopFileEntry)
    const writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync')
    updateExecPath(filePath)
    expect(writeFileSyncSpy).not.toBeCalled()
    const content = fs.readFileSync(filePath, { encoding: 'utf-8' })
    expect(content).toEqual(desktopFileEntry)
  })
})

describe('updateDesktopFile', () => {
  const originalEnv = process.env
  const originalResourcesPath = (process as any).resourcesPath
  let tmpDir: string
  let execSyncSpy: jest.SpyInstance

  beforeEach(() => {
    tmpDir = tmp.dirSync({ mode: 0o750, prefix: 'quietDesktopFile', unsafeCleanup: true }).name
    jest.spyOn(os, 'homedir').mockReturnValue(path.join(tmpDir, 'home'))
    execSyncSpy = jest.spyOn(childProcess, 'execSync').mockReturnValue(Buffer.from(''))
  })

  afterEach(() => {
    process.env = originalEnv
    ;(process as any).resourcesPath = originalResourcesPath
    jest.restoreAllMocks()
  })

  const itOnLinux = process.platform === 'linux' ? it : it.skip

  itOnLinux('does nothing outside an AppImage (system electron / distro package)', () => {
    process.env = { ...originalEnv }
    delete process.env.APPIMAGE
    const cpSyncSpy = jest.spyOn(fs, 'cpSync')
    const writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync')

    updateDesktopFile(false)

    expect(cpSyncSpy).not.toHaveBeenCalled()
    expect(writeFileSyncSpy).not.toHaveBeenCalled()
    expect(execSyncSpy).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(tmpDir, 'home'))).toBe(false)
  })

  itOnLinux('installs quiet-loki.desktop and registers only the quiet-loki scheme in an AppImage', () => {
    const appImagePath = '/opt/Quiet-Loki.AppImage'
    process.env = { ...originalEnv, APPIMAGE: appImagePath }
    const resourcesDir = path.join(tmpDir, 'resources')
    fs.mkdirSync(resourcesDir)
    fs.copyFileSync(path.join(__dirname, '../../resources/quiet.desktop'), path.join(resourcesDir, 'quiet.desktop'))
    ;(process as any).resourcesPath = resourcesDir
    const applicationsDir = path.join(tmpDir, 'home', '.local/share/applications')
    fs.mkdirSync(applicationsDir, { recursive: true })

    updateDesktopFile(false)

    expect(DESKTOP_FILE_NAME).toBe('quiet-loki.desktop')
    const installed = fs.readFileSync(path.join(applicationsDir, 'quiet-loki.desktop'), { encoding: 'utf-8' })
    expect(installed).toContain('MimeType=x-scheme-handler/quiet-loki')
    expect(installed).toContain(`Exec=${appImagePath} %U`)
    expect(installed).not.toContain('Exec=undefined')

    const commands = execSyncSpy.mock.calls.map(call => String(call[0]))
    expect(commands).toContain('xdg-mime default quiet-loki.desktop x-scheme-handler/quiet-loki')
    expect(commands).toContain('xdg-settings set default-url-scheme-handler quiet-loki quiet-loki.desktop')
    expect(commands.some(c => /x-scheme-handler\/quiet( |$)|default-url-scheme-handler quiet /.test(c))).toBe(false)
  })
})
