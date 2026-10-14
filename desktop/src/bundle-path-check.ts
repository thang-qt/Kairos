import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isNavigation,
  isServiceWorkerPath,
  resolveBundlePath,
} from './bundle-path.js'
import { createBundleHandler } from './bundle-response.js'
import { setupOrigin } from './server-state.js'

let fixture: string
let root: string

test('setup API never touches the network and handlers read the current origin', async function mutableOrigin() {
  let origin = setupOrigin
  let fetched = false
  const handler = createBundleHandler(
    function currentOrigin() {
      return origin
    },
    root,
    async function fetch() {
      fetched = true
      return new Response('backend')
    },
  )
  const response = await handler(
    new Request(`${setupOrigin}/api/app/capabilities`),
  )
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'no server configured' })
  assert.equal(fetched, false)
  origin = 'https://server.example'
  assert.equal(
    (await handler(new Request(`${setupOrigin}/api/me`))).status,
    503,
  )
  assert.equal(fetched, false)
  assert.equal(
    await (await handler(new Request(`${origin}/api/me`))).text(),
    'backend',
  )
  assert.equal(fetched, true)
})
before(async function createFixture() {
  fixture = await mkdtemp(join(tmpdir(), 'kairos-bundle-'))
  root = join(fixture, 'app-dist')
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<html>Kairos</html>')
  await writeFile(join(root, 'assets/main.js'), 'export {}')
  await writeFile(join(fixture, 'secret.txt'), 'outside')
  await symlink(join(fixture, 'secret.txt'), join(root, 'escape.txt'))
})
after(async function removeFixture() {
  await rm(fixture, { recursive: true, force: true })
})

test('maps the root and serves existing assets', async function rootAndAssets() {
  assert.equal(
    await resolveBundlePath(root, '/', false),
    join(root, 'index.html'),
  )
  assert.equal(
    await resolveBundlePath(root, '/assets/main.js', false),
    join(root, 'assets/main.js'),
  )
})
test('rejects traversal before normalization, malformed encoding and escaping symlinks', async function traversal() {
  for (const path of [
    '/../',
    '/../secret.txt',
    '/assets/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/assets/%2E%2E/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..%5csecret.txt',
    '/%00',
    '/%zz',
    '/escape.txt',
  ]) {
    assert.equal(await resolveBundlePath(root, path, true), undefined, path)
  }
})
test('uses SPA fallback only for navigation requests', async function spaFallback() {
  assert.equal(
    await resolveBundlePath(root, '/chat/example', true),
    join(root, 'index.html'),
  )
  assert.equal(
    await resolveBundlePath(root, '/assets/missing.js', false),
    undefined,
  )
  assert.equal(await resolveBundlePath(root, '/chat/example', false), undefined)
  assert.equal(
    isNavigation(
      new Request('https://kairos.example/chat', {
        headers: { Accept: 'text/html' },
      }),
    ),
    true,
  )
  assert.equal(
    isNavigation(new Request('https://kairos.example/assets/missing.js')),
    false,
  )
})
test('recognizes all blocked service worker files', function serviceWorkers() {
  for (const path of ['/sw.js', '/registerSW.js', '/workbox-abc123.js'])
    assert.equal(isServiceWorkerPath(path), true)
  assert.equal(isServiceWorkerPath('/assets/main.js'), false)
})

test('passes POST JSON and upload bodies, headers and options through unchanged', async function postBodies() {
  const upload = new FormData()
  upload.append('file', new Blob(['file contents']), 'example.txt')
  const requests = [
    new Request('https://kairos.example/api/chat', {
      method: 'POST',
      body: '{"prompt":"hello"}',
      headers: { 'content-type': 'application/json', 'x-kairos-test': 'body' },
    }),
    new Request('https://kairos.example/api/upload', {
      method: 'POST',
      body: upload,
    }),
  ]
  for (const request of requests) {
    const originalResponse = new Response('ok')
    const handler = createBundleHandler(
      'https://kairos.example',
      root,
      async function passthrough(input, options) {
        assert.equal(input, request)
        assert.equal(request.method, 'POST')
        assert.equal(request.bodyUsed, false)
        assert.deepEqual(options, { bypassCustomProtocolHandlers: true })
        return originalResponse
      },
    )
    assert.equal(await handler(request), originalResponse)
    if (request.url.endsWith('/chat')) {
      assert.equal(request.headers.get('x-kairos-test'), 'body')
      assert.equal(await request.text(), '{"prompt":"hello"}')
    } else {
      const form = await request.formData()
      assert.equal(await (form.get('file') as Blob).text(), 'file contents')
    }
  }
})

test(
  'returns streaming API responses before completion, with cancellation intact',
  { timeout: 1000 },
  async function streaming() {
    let controller: ReadableStreamDefaultController<Uint8Array>
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start: function start(value) {
        controller = value
        value.enqueue(new TextEncoder().encode('data: first\n\n'))
      },
      cancel: function cancel() {
        cancelled = true
      },
    })
    const response = new Response(stream, {
      headers: { 'content-type': 'text/event-stream' },
    })
    const handler = createBundleHandler(
      'https://kairos.example',
      root,
      async function passthrough() {
        return response
      },
    )
    const result = await handler(
      new Request('https://kairos.example/api/events'),
    )
    assert.equal(result, response)
    const reader = result.body!.getReader()
    assert.equal(
      new TextDecoder().decode((await reader.read()).value),
      'data: first\n\n',
    )
    controller!.enqueue(new TextEncoder().encode('data: second\n\n'))
    assert.equal(
      new TextDecoder().decode((await reader.read()).value),
      'data: second\n\n',
    )
    await reader.cancel()
    assert.equal(cancelled, true)
  },
)

test('passes other origins through and blocks workers before SPA fallback', async function routes() {
  const external = new Request('https://other.example/sw.js')
  const response = new Response('external')
  const handler = createBundleHandler(
    'https://kairos.example',
    root,
    async function passthrough(input) {
      assert.equal(input, external)
      return response
    },
  )
  assert.equal(await handler(external), response)
  for (const path of ['/sw.js', '/registerSW.js', '/workbox-abc.js']) {
    assert.equal(
      (
        await handler(
          new Request(`https://kairos.example${path}`, {
            headers: { accept: 'text/html' },
          }),
        )
      ).status,
      404,
    )
  }
  assert.equal(
    (await handler(new Request('https://kairos.example/assets/missing.js')))
      .status,
    404,
  )
})
