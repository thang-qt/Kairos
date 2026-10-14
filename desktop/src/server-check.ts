import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeServer, probeServer } from './server-policy.js'
import {
  getCurrentOrigin,
  getCurrentServer,
  setCurrentServer,
  setupOrigin,
} from './server-state.js'

test('normalizes origins and accepts HTTPS or local HTTP', function origins() {
  assert.deepEqual(normalizeServer(' kairos.example.com/chat?x=1#part '), {
    ok: true,
    origin: 'https://kairos.example.com',
    insecure: false,
  })
  assert.deepEqual(normalizeServer('localhost:3000'), {
    ok: true,
    origin: 'https://localhost:3000',
    insecure: false,
  })
  for (const host of [
    'localhost:3000',
    '127.0.0.1',
    '127.255.10.2',
    '[::1]:8080',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    'kairos.local',
  ]) {
    assert.deepEqual(normalizeServer(`http://${host}/new`), {
      ok: true,
      origin: `http://${host}`,
      insecure: true,
    })
  }
})
test('rejects public HTTP, credentials and invalid schemes', function rejectedOrigins() {
  for (const host of [
    'example.com',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '126.0.0.1',
    '[::2]',
    'kairos.local.example.com',
  ])
    assert.deepEqual(normalizeServer(`http://${host}`), {
      ok: false,
      error: 'insecure-not-allowed',
    })
  for (const input of [
    '',
    '   ',
    'ftp://localhost',
    'file:///tmp/file',
    'https://user:pass@example.com',
    'https://user@example.com',
    'https://bad host',
    5,
    null,
  ])
    assert.deepEqual(normalizeServer(input), {
      ok: false,
      error: 'invalid-url',
    })
})
test('probes capabilities with manual redirects and an abort signal', async function capabilities() {
  const result = await probeServer(
    'example.com/path',
    async function fetch(url, options) {
      assert.equal(url, 'https://example.com/api/app/capabilities')
      assert.equal(options.method, 'GET')
      assert.equal(options.redirect, 'manual')
      assert.equal(options.bypassCustomProtocolHandlers, true)
      assert.ok(options.signal)
      return Response.json({ capabilities: { auth: { enabled: false } } })
    },
  )
  assert.deepEqual(result, {
    ok: true,
    origin: 'https://example.com',
    insecure: false,
  })
})
test('maps failed probes without accepting wrong capabilities', async function failures() {
  for (const response of [
    new Response('no', { status: 404 }),
    new Response('<html>server</html>'),
    Response.json({ capabilities: { auth: null } }),
    Response.json({ auth: {} }),
  ]) {
    assert.deepEqual(
      await probeServer('example.com', async function fetch() {
        return response
      }),
      { ok: false, error: 'not-kairos' },
    )
  }
  assert.deepEqual(
    await probeServer('example.com', async function fetch() {
      throw new Error('net::ERR_CERT_AUTHORITY_INVALID')
    }),
    { ok: false, error: 'certificate' },
  )
  assert.deepEqual(
    await probeServer('example.com', async function fetch() {
      throw new DOMException('timeout', 'AbortError')
    }),
    { ok: false, error: 'unreachable' },
  )
})
test('never follows redirects to a different origin', async function redirects() {
  let count = 0
  assert.deepEqual(
    await probeServer('example.com', async function fetch() {
      count++
      return new Response(null, {
        status: 302,
        headers: { location: 'https://other.example/api/app/capabilities' },
      })
    }),
    { ok: false, error: 'not-kairos' },
  )
  assert.equal(count, 1)
  let url: string | undefined
  await probeServer('example.com', async function fetch(input) {
    if (!url) {
      url = input
      return new Response(null, {
        status: 302,
        headers: { location: '/api/app/capabilities?redirected=1' },
      })
    }
    assert.equal(input, 'https://example.com/api/app/capabilities?redirected=1')
    return Response.json({ capabilities: { auth: {} } })
  })
})
test('shares one mutable server origin and uses setup only when unconfigured', function state() {
  setCurrentServer(null)
  assert.equal(getCurrentServer(), null)
  assert.equal(getCurrentOrigin(), setupOrigin)
  setCurrentServer('https://one.example')
  assert.equal(getCurrentOrigin(), 'https://one.example')
  setCurrentServer('http://localhost:3000')
  assert.equal(getCurrentOrigin(), 'http://localhost:3000')
  setCurrentServer(null)
})
