import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import dns from 'node:dns/promises'
import https, { type RequestOptions } from 'node:https'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { fetchOriginal, isPublicAddress, assertPublicUrl } from '../src/original-fetch.ts'

test('original-page IP guard rejects private, reserved and transition networks', () => {
  for (const ip of ['0.1.2.3', '10.2.3.4', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.9', '192.0.2.1', '192.168.1.1', '192.88.99.1', '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:8.8.8.8', '64:ff9b::a00:1', '100::1', '2001::1', '2001:db8::1', '2002:7f00:1::', '3fff::1', 'fc00::1', 'fdff::1', 'fe80::1', 'ff02::1', 'not-an-ip']) assert.equal(isPublicAddress(ip), false, ip)
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '2001:4860:4860::8888', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip)
})

test('original-page URL guard normalizes HTTPS and rejects credential/local/port tricks', () => {
  assert.equal(assertPublicUrl('http://Public.example.com/event?a=1#part').href, 'https://public.example.com/event?a=1')
  assert.equal(assertPublicUrl('https://public.example.com.:443/event').href, 'https://public.example.com/event')
  for (const url of ['file:///etc/passwd', 'ftp://public.example.com/file', 'https://user:pass@public.example.com/', 'https://public.example.com:444/', 'http://public.example.com:8080/', 'https://localhost/', 'https://foo.localhost/', 'https://metadata.google.internal/', 'https://foo.local/', 'https://router/', 'https://127.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://[::ffff:127.0.0.1]/', 'https://public.example.com\n/', 'https://public.example.com/?access_token=secret', 'https://public.example.com/?X-Amz-Credential=secret', 'https://public.example.com/?API_KEY=secret']) assert.throws(() => assertPublicUrl(url), url)
})

type Response = { status?: number; headers?: Record<string, string>; body?: string | Buffer }
function transport(t: TestContext, responses: Response[]) {
  const calls: { url: URL; options: RequestOptions }[] = []
  t.mock.method(https, 'request', (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    calls.push({ url, options })
    const next = responses.shift()
    assert.ok(next, 'Unexpected extra HTTP request')
    const response = Object.assign(Readable.from([next.body ?? '<html>Event</html>']), { statusCode: next.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8', ...next.headers } }) as unknown as IncomingMessage
    const request = new EventEmitter() as ClientRequest
    request.end = (() => { queueMicrotask(() => callback(response)); return request }) as typeof request.end
    request.destroy = ((error?: Error) => { response.destroy(); if (error) queueMicrotask(() => request.emit('error', error)); return request }) as typeof request.destroy
    return request
  })
  return calls
}

test('original-page fetch checks every DNS address before creating a request', async t => {
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }])
  const calls = transport(t, [])
  await assert.rejects(fetchOriginal('https://public.example.com/'), /public address/i)
  assert.equal(calls.length, 0)
})

test('original-page fetch pins DNS, keeps TLS hostname, follows public redirects anonymously', async t => {
  const lookup = t.mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }])
  const calls = transport(t, [
    { status: 302, headers: { location: 'https://organizer.example.com/event', 'set-cookie': 'session=untrusted' } },
    { headers: { 'content-type': 'application/xhtml+xml' }, body: '<html>Original event</html>' },
  ])
  assert.deepEqual(await fetchOriginal('http://public.example.com/start'), { html: '<html>Original event</html>', url: 'https://organizer.example.com/event' })
  assert.equal(lookup.mock.callCount(), 2)
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.options.agent, false)
    assert.equal(call.options.rejectUnauthorized, true)
    assert.equal(call.options.family, 4)
    const headers = call.options.headers as Record<string, string>
    assert.equal(Object.keys(headers).some(key => /cookie|authorization|referer/i.test(key)), false)
    await new Promise<void>((resolve, reject) => call.options.lookup!(call.url.hostname, {}, (error, address, family) => {
      if (error) return reject(error)
      assert.equal(address, '93.184.216.34')
      assert.equal(family, 4)
      resolve()
    }))
  }
  assert.equal(lookup.mock.callCount(), 2, 'Pinned transport lookup must not resolve DNS again')
})

test('original-page redirects cannot reach private addresses or exceed three hops', async t => {
  t.mock.method(dns, 'lookup', async (hostname: string) => [{ address: hostname.startsWith('private') ? '10.0.0.1' : '8.8.8.8', family: 4 }])
  const calls = transport(t, [{ status: 302, headers: { location: 'https://private.example.com/' } }])
  await assert.rejects(fetchOriginal('https://public.example.com/'), /public address/i)
  assert.equal(calls.length, 1)
  t.mock.restoreAll()
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }])
  const hops = transport(t, Array.from({ length: 4 }, () => ({ status: 302, headers: { location: '/again' } })))
  await assert.rejects(fetchOriginal('https://public.example.com/'), /redirect/i)
  assert.equal(hops.length, 4)
})

test('original-page fetch bounds body size and requires uncompressed successful HTML', async t => {
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }])
  transport(t, [
    { headers: { 'content-type': 'application/json' } },
    { headers: { 'content-encoding': 'gzip' } },
    { status: 503 },
    { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } },
    { body: Buffer.alloc(2 * 1024 * 1024 + 1, 65) },
  ])
  for (const message of [/HTML/i, /encoding/i, /503/, /2 MiB/, /2 MiB/]) await assert.rejects(fetchOriginal('https://public.example.com/'), message)
})

test('original-page deadline includes DNS and never starts transport after expiration', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let finishDns!: (addresses: { address: string; family: number }[]) => void
  t.mock.method(dns, 'lookup', () => new Promise(resolve => { finishDns = resolve }))
  const calls = transport(t, [])
  const result = fetchOriginal('https://public.example.com/')
  const rejection = assert.rejects(result, /deadline/i)
  t.mock.timers.tick(20_000)
  await rejection
  finishDns([{ address: '8.8.8.8', family: 4 }])
  await Promise.resolve()
  assert.equal(calls.length, 0)
})

test('original-page deadline also aborts a request stalled before response headers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }])
  let signal: AbortSignal | undefined
  t.mock.method(https, 'request', (_url: URL, options: RequestOptions) => {
    signal = options.signal
    const request = new EventEmitter() as ClientRequest
    request.end = (() => request) as typeof request.end
    return request
  })
  const result = fetchOriginal('https://public.example.com/')
  const rejection = assert.rejects(result, /deadline/i)
  await Promise.resolve()
  assert.ok(signal)
  t.mock.timers.tick(20_000)
  await rejection
  assert.equal(signal.aborted, true)
})
