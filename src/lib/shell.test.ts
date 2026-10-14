// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { getShell } from './shell'

afterEach(function reset() {
  Reflect.deleteProperty(window, 'kairosDesktop')
})
it('describes the web shell without desktop capabilities', function web() {
  expect(getShell()).toEqual({
    isDesktop: false,
    providesIdentity: false,
    providesWindowControls: false,
    server: null,
    canChangeServer: false,
  })
})
it('reads desktop capabilities fresh on every call, including setup', function desktop() {
  window.kairosDesktop = {
    platform: 'linux',
    isDesktop: true,
    server: null,
    setServer: vi.fn(),
  }
  expect(getShell()).toEqual({
    isDesktop: true,
    providesIdentity: true,
    providesWindowControls: true,
    server: null,
    canChangeServer: true,
  })
  window.kairosDesktop.server = 'https://kairos.example.com'
  expect(getShell().server).toBe('https://kairos.example.com')
  Reflect.deleteProperty(window, 'kairosDesktop')
  expect(getShell().providesIdentity).toBe(false)
})
