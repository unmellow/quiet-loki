import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { BrowserWindow } from 'electron'
import { DEEP_URL_SCHEME } from '@quiet/common'
import { createLogger } from './logger'

const logger = createLogger('invitation')

export const processInvitationCode = (mainWindow: BrowserWindow, code: string | string[]) => {
  if (!code || !code.length) return
  mainWindow.webContents.send('invitation', {
    code,
  })
}

/** Name the AppImage installs its .desktop entry under (matches the distro package's quiet-loki.desktop). */
export const DESKTOP_FILE_NAME = 'quiet-loki.desktop'
/** Template shipped next to the AppImage resources (electron-builder linux.extraFiles). */
const DESKTOP_FILE_RESOURCE = 'quiet.desktop'

export const updateDesktopFile = (isDev: boolean) => {
  if (isDev || process.platform !== 'linux') return
  // AppImage-only: distro packages (system electron + app.asar) ship their own .desktop entry and scheme
  // registration. Outside an AppImage, APPIMAGE is unset (Exec would become `undefined %U`) and
  // process.resourcesPath points at the system electron, not at our resources.
  if (!process.env.APPIMAGE) {
    logger.info('Not running from an AppImage, skipping .desktop file and scheme handler update')
    return
  }
  logger.info(`Updating desktop file and setting default scheme handler`)

  const desktopName = DESKTOP_FILE_NAME
  const appDesktopFile = path.join(os.homedir(), `.local/share/applications/${desktopName}`)
  const resource = path.join(process.resourcesPath, DESKTOP_FILE_RESOURCE)

  try {
    if (!fs.existsSync(appDesktopFile)) {
      fs.cpSync(resource, appDesktopFile)
    }
  } catch (e) {
    logger.error(`Can't copy .desktop file`, e)
  }

  try {
    updateExecPath(appDesktopFile)
  } catch (e) {
    logger.error(`Can't update .desktop file`, e)
  }

  try {
    const scheme = `x-scheme-handler/${DEEP_URL_SCHEME}`
    logger.info(execSync(`xdg-mime default ${desktopName} ${scheme}`).toString())
    logger.info(execSync(`xdg-mime query default ${scheme}`).toString())
  } catch (e) {
    logger.error("Couldn't set default scheme handler via xdg-mime", e)
  }

  try {
    logger.info(execSync(`xdg-settings set default-url-scheme-handler ${DEEP_URL_SCHEME} ${desktopName}`).toString())
  } catch (e) {
    logger.error("Couldn't update default scheme handler via xdg-settings", e)
  }
}

export const updateExecPath = (desktopFilePath: string) => {
  /** Update Exec in case user moved .AppImage */
  const execInfo = `Exec=${process.env.APPIMAGE} %U`
  const desktopFile = fs.readFileSync(desktopFilePath, { encoding: 'utf-8' })
  if (!desktopFile.includes(execInfo)) {
    // Replace old Exec with new Exec
    const lines = desktopFile.split('\n')
    const newLines = lines.filter(line => !line.includes('Exec=') && line !== '')
    newLines.push(execInfo)
    fs.writeFileSync(desktopFilePath, newLines.join('\n'))
  }
}
