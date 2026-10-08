import { DEEP_URL_SCHEME, Site, parseInvitationLink, stripQuietLokiLinkPrefix } from '@quiet/common'
import { type InvitationData } from '@quiet/types'

export const getInvitationLinks = (codeOrUrl: string): InvitationData => {
  /**
   * Extract codes from invitation share url or return passed value for further error handling
   * @param codeOrUrl: full invitation link or just the code part of the link
   *
   * Accepted forms:
   *  - bare code:                    p=<pairs>&k=<psk>&a=<auth>&v=v4
   *  - Quiet Loki share link:        quiet-loki://join#p=...   (what Settings -> Add Members shows), also join/#
   *  - Quiet Loki deep link:         quiet-loki://?p=...
   *  - legacy https share link:      https://<Site.DOMAIN>/join#p=...
   *
   * quiet-loki:// links are recognised textually, not via URL host/pathname: Chromium (the renderer) and Node parse
   * non-special schemes differently (see stripQuietLokiLinkPrefix).
   */
  codeOrUrl = codeOrUrl.trim()

  const quietLokiCode = stripQuietLokiLinkPrefix(codeOrUrl)
  if (quietLokiCode !== null) {
    return parseInvitationLink(quietLokiCode)
  }

  let potentialLink
  let validUrl: URL | null = null

  let inviteLink = ''

  try {
    validUrl = new URL(codeOrUrl)
  } catch (e) {
    // It may be just code, not URL
    potentialLink = codeOrUrl
  }

  if (
    validUrl &&
    validUrl.protocol !== `${DEEP_URL_SCHEME}:` &&
    validUrl.host === Site.DOMAIN &&
    validUrl.pathname.includes(Site.JOIN_PAGE)
  ) {
    const hash = validUrl.hash
    if (hash) {
      // Parse hash
      inviteLink = hash.substring(1)
    }
  } else if (potentialLink) {
    // Parse code just as hash value
    inviteLink = potentialLink
  }

  return parseInvitationLink(inviteLink)
}
