import dns from 'node:dns/promises'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'

const forbidden = new BlockList()
// Conservatively exclude all IANA special-purpose IPv4 blocks, plus multicast.
// https://www.iana.org/assignments/iana-ipv4-special-registry/
for (const subnet of ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.31.196.0/24', '192.52.193.0/24', '192.88.99.0/24', '192.168.0.0/16', '192.175.48.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4']) {
  const [address, prefix] = subnet.split('/')
  forbidden.addSubnet(address!, Number(prefix), 'ipv4')
}
// Allow ordinary global IPv6 unicast only, excluding special/transition ranges.
// This also excludes every IPv4-mapped, NAT64, link-local and unique-local address.
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
for (const subnet of ['2001::/23', '2001:db8::/32', '2002::/16', '2620:4f:8000::/48', '3fff::/20']) {
  const [address, prefix] = subnet.split('/')
  forbidden.addSubnet(address!, Number(prefix), 'ipv6')
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (address.includes('%')) return false
  if (family === 4) return !forbidden.check(address, 'ipv4')
  return family === 6 && globalV6.check(address, 'ipv6') && !forbidden.check(address, 'ipv6')
}

export function assertPublicUrl(raw: string): URL {
  if ([...raw].some(char => char <= ' ' || char === '\u007f' || char === '\\')) throw new Error('Invalid public URL')
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Public page requires credential-free HTTPS on port 443')
  // Public legacy links are upgraded; no plaintext connection is ever made.
  url.protocol = 'https:'
  url.hash = ''
  url.hostname = url.hostname.replace(/\.$/, '')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('Public page requires a public address')
  } else if (!hostname.includes('.') || hostname.length > 253 || hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) || /(?:^|\.)(?:localhost|localdomain|local|internal|lan|home|arpa|test|invalid|example|onion)$/.test(hostname)) {
    throw new Error('Public page requires a public hostname')
  }
  for (const key of url.searchParams.keys()) {
    if (/^(?:auth|key|code|sig)$|(?:^|[-_])(?:token|apikey|api[-_]?key|secret|password|passwd|authorization|credential|signature|session(?:id)?)(?:$|[-_])/i.test(key)) throw new Error('Public page URL contains credentials')
  }
  return url
}

async function fetchResource(raw: string, signal: AbortSignal, types: string[], maxBytes: number): Promise<{ body: Buffer; url: string }> {
  let url = assertPublicUrl(raw)
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted()
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const literalFamily = isIP(hostname)
    const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await dns.lookup(hostname, { all: true, verbatim: true })
    signal.throwIfAborted()
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address) || item.family !== isIP(item.address))) throw new Error('Public page DNS must contain only public addresses')
    const address = addresses[0]!
    const response = await new Promise<{ body?: Buffer; location?: string }>((resolve, reject) => {
      const request = https.request(url, {
        method: 'GET', agent: false, family: address.family, rejectUnauthorized: true,
        signal, maxHeaderSize: 16 * 1024,
        // Pin the validated answer while retaining the hostname for SNI/certificate checks.
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
        headers: { 'User-Agent': 'CampusRadar/1.0 (+https://campus-radar.com)', Accept: types.join(', '), 'Accept-Encoding': 'identity' },
      }, incoming => {
        incoming.on('error', reject)
        const fail = (message: string) => { incoming.destroy(); reject(new Error(message)) }
        const status = incoming.statusCode || 0
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = incoming.headers.location
          incoming.destroy()
          if (!location) reject(new Error('Original page redirect missing location'))
          else resolve({ location })
          return
        }
        if (status !== 200) return fail(`Original page HTTP ${status}`)
        const contentType = (incoming.headers['content-type'] || '').split(';')[0]!.trim().toLowerCase()
        if (!types.includes(contentType)) return fail('Unexpected content type; original pages must be HTML')
        if (incoming.headers['content-encoding'] && incoming.headers['content-encoding'] !== 'identity') return fail('Unsupported original page encoding')
        if (Number(incoming.headers['content-length']) > maxBytes) return fail(`Original resource exceeds ${maxBytes / 1024 / 1024} MiB`)
        const chunks: Buffer[] = []
        let bytes = 0
        incoming.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > maxBytes) { fail(`Original resource exceeds ${maxBytes / 1024 / 1024} MiB`); return }
          chunks.push(Buffer.from(chunk))
        })
        incoming.on('end', () => resolve({ body: Buffer.concat(chunks) }))
      })
      request.on('error', reject)
      request.end()
    })
    if (response.body !== undefined) return { body: response.body, url: url.href }
    if (redirects === 3) throw new Error('Original page exceeds three redirects')
    url = assertPublicUrl(new URL(response.location!, url).href)
  }
  throw new Error('Original page redirect limit')
}

export async function fetchPublicFile(url: string, types: string[], maxBytes: number): Promise<{ body: Buffer; url: string }> {
  const controller = new AbortController()
  const expired = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }))
  const deadline = setTimeout(() => controller.abort(new Error('Original page deadline exceeded')), 20_000)
  try { return await Promise.race([fetchResource(url, controller.signal, types, maxBytes), expired]) }
  finally { clearTimeout(deadline) }
}

export async function fetchOriginal(url: string): Promise<{ html: string; url: string }> {
  const result = await fetchPublicFile(url, ['text/html', 'application/xhtml+xml'], 2 * 1024 * 1024)
  return { html: result.body.toString('utf8'), url: result.url }
}
