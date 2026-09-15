import { createLibp2pAddress, filterValidAddresses } from './libp2p'
import { filterAndSortPeers } from './sortPeers'

describe('createLibp2pAddress', () => {
  it('uses an explicit port instead of LOKINET_WS_PORT', () => {
    const peerId = '12D3KooWSYQf8zzr5rYnUdLxYyLzHruQHPaMssja1ADifGAcN3qY'
    const snapp = 'f3lupwnhaqplbn4djaut5rtipwmlotlb57flfvjzgexek2yezlpj'
    const addr = createLibp2pAddress(snapp, peerId, 8081)
    expect(addr).toBe(`/dns4/${snapp}.loki/tcp/8081/ws/p2p/${peerId}`)
  })
})

describe('filterValidAddresses', () => {
  it('filters out invalid addresses', () => {
    const localAddress =
      '/dns4/f3lupwnhaqplbn4djaut5rtipwmlotlb57flfvjzgexek2yezlpj.loki/tcp/443/ws/p2p/12D3KooWSYQf8zzr5rYnUdLxYyLzHruQHPaMssja1ADifGAcN3qY'
    const valid = [
      '/dns4/gloao6h5plwjy4tdlze24zzgcxll6upq2ex2fmu2ohhyu4gtys4n.loki/tcp/443/ws/p2p/12D3KooWSYQf8zzr5rYnUdLxYyLzHruQHPaMssja1ADifGAcN4zF',
      '/dns4/gloao6h5plwjy4tdlze24zzgcxll6upq2ex2fmu2ohhyu4gtys4n.loki/tcp/80/ws/p2p/12D3KooWSYQf8zzr5rYnUdLxYyLzHruQHPaMssja1ADifGAcN4zF',
      '/dns4/gloao6h5plwjy4tdlze24zzgcxll6upq2ex2fmu2ohhyu4gtys4n.loki/tcp/8081/ws/p2p/12D3KooWSYQf8zzr5rYnUdLxYyLzHruQHPaMssja1ADifGAcN4zF',
    ]
    const addresses = [
      '/dns4/gloao6h5plwjy4tdlze24zzgcxll6upq2ex2fmu2ohhyu4gtys4n.loki/tcp/443/wss/p2p/12D3KooWSYQf8zzr5rYnUdLxYyLzHruQHPaMssja1ADifGAcN4zF',
      ...valid,
      'invalidAddress',
      '/dns4/somethingElse.loki/tcp/443/wss/p2p/QmZoiJNAvCffeEHBjk766nLuKVdkxkAT7wfFJDPPLsbKSA',
      '/dns4/gloao6h5plwjy4tdlze24zzgcxll6upq2ex2fmu2ohhyu4gtys4n.loki/tcp/443/ws/p2p/QmZoiJNAvCffeEHBjk766nLuKVdkxkAT7wfFJDPPLsbK',
      '/dns4/gloao6h5plwjy4tdlze24zzgcxll6upq2ex2fmu2ohhyu4gtys4.loki/tcp/443/ws/p2p/12D3KooWSYQf8zzr5rYnUdLxYyLzHruQHPaMssja1ADifGAcN4zF',
      'QmZoiJNAvCffeEHBjk766nLuKVdkxkAT7wfFJDPPLsbK',
    ]
    expect(filterAndSortPeers(addresses, [], localAddress)).toEqual([localAddress, ...valid])
  })

  it('sets local address as first without duplicating it', () => {
    const localAddress =
      '/dns4/gloao6h5plwjy4tdlze24zzgcxll6upq2ex2fmu2ohhyu4gtys4n.loki/tcp/80/ws/p2p/12D3KooWSYQf8zzr5rYnUdLxYyLzHruQHPaMssja1ADifGAcN4zF'
    const addresses = [
      localAddress,
      '/dns4/gloao6h5plwjy4tdlze24zzgcxll6upq2ex2fmu2ohhyu4gtys4n.loki/tcp/443/ws/p2p/12D3KooWSYQf8zzr5rYnUdLxYyLzHruQHPaMssja1ADifGAcN3qY',
    ]
    expect(filterAndSortPeers(addresses, [], localAddress)).toEqual([localAddress, addresses[1]])
  })

  it('accepts dynamic tcp ports', () => {
    const addr =
      '/dns4/gloao6h5plwjy4tdlze24zzgcxll6upq2ex2fmu2ohhyu4gtys4n.loki/tcp/8080/ws/p2p/12D3KooWSYQf8zzr5rYnUdLxYyLzHruQHPaMssja1ADifGAcN4zF'
    expect(filterValidAddresses([addr])).toEqual([addr])
  })
})
