import { Module } from '@nestjs/common'
import { CONFIG_OPTIONS, TOR_CONTROL_PARAMS, TOR_PARAMS_PROVIDER, TOR_PASSWORD_PROVIDER } from '../const'
import { ConfigOptions } from '../types'
import { TorControl } from './tor-control.service'
import { Tor as TorDaemon } from './tor.service'
import { Tor } from './tor.service.lokinet-shim'
import { TorControlAuthType, TorPasswordProvider } from './tor.types'
import { torPasswordProvider } from './tor-password.provider'
import * as os from 'os'
import { SocketModule } from '../socket/socket.module'
import { createLogger } from '../common/logger'

const logger = createLogger('Lokinet')

const torParamsProvider = {
  provide: TOR_PARAMS_PROVIDER,
  useFactory: (_configOptions: ConfigOptions) => {
    // Quiet Loki is Loki-only: never resolve or pass a Tor binary path.
    const torPath = ''
    const options = {
      env: {
        HOME: os.homedir(),
      },
    }

    logger.info('Lokinet overlay params (no Tor binary)', JSON.stringify({ torPath }, null, 2))

    return { torPath, options }
  },
  inject: [CONFIG_OPTIONS],
}

const torControlParams = {
  provide: TOR_CONTROL_PARAMS,
  useFactory: (configOptions: ConfigOptions, torPasswordProvider: TorPasswordProvider | null) => {
    const usesCookieAuth = Boolean(configOptions.torAuthCookie) || torPasswordProvider === null
    return {
      port: configOptions.torControlPort,
      host: 'localhost',
      auth: {
        value: configOptions.torAuthCookie || torPasswordProvider?.torPassword || '',
        type: usesCookieAuth ? TorControlAuthType.COOKIE : TorControlAuthType.PASSWORD,
      },
    }
  },
  inject: [CONFIG_OPTIONS, TOR_PASSWORD_PROVIDER],
}

@Module({
  imports: [SocketModule],
  providers: [
    Tor,
    // Nest token alias: leftover injectors typed against tor.service still get the Loki overlay.
    { provide: TorDaemon, useExisting: Tor },
    TorControl,
    torControlParams,
    torPasswordProvider,
    torParamsProvider,
  ],
  exports: [Tor, TorDaemon, TorControl],
})
export class TorModule {}
