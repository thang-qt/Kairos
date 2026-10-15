// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ServerError } from '@/lib/shell'
import { ConnectScreen } from './connect-screen'

vi.mock('@tanstack/react-router', function router() {
  return {
    Link: function Link({ to, children }: { to: string; children: ReactNode }) {
      return <a href={to}>{children}</a>
    },
  }
})
afterEach(function reset() {
  cleanup()
  Reflect.deleteProperty(window, 'kairosDesktop')
})

function stubServer(error?: ServerError) {
  const setServer = vi
    .fn()
    .mockResolvedValue(
      error
        ? { ok: false, error }
        : { ok: true, origin: 'https://kairos.example.com', insecure: false },
    )
  window.kairosDesktop = {
    platform: 'linux',
    isDesktop: true,
    server: null,
    setServer,
  }
  return setServer
}

it('renders setup and sends trimmed input through the bridge', async function submit() {
  const setServer = stubServer()
  render(<ConnectScreen />)
  expect(
    screen.getByRole('heading', { name: 'Connect to Kairos' }),
  ).toBeTruthy()
  const field = screen.getByLabelText('Server address')
  expect(field.getAttribute('placeholder')).toBe('kairos.example.com')
  fireEvent.change(field, { target: { value: '  kairos.example.com  ' } })
  fireEvent.submit(field.closest('form')!)
  await waitFor(function called() {
    expect(setServer).toHaveBeenCalledWith('kairos.example.com')
  })
  expect(screen.queryByRole('link', { name: 'Cancel' })).toBeNull()
})

it('prefills the current server and warns before an unencrypted connection', function warning() {
  stubServer()
  window.kairosDesktop!.server = 'https://kairos.example.com:8443'
  render(<ConnectScreen />)
  const field = screen.getByLabelText('Server address') as HTMLInputElement
  expect(field.value).toBe('kairos.example.com:8443')
  expect(
    screen.getByRole('link', { name: 'Cancel' }).getAttribute('href'),
  ).toBe('/')
  fireEvent.change(field, { target: { value: 'http://localhost:8080' } })
  expect(screen.getByText("This connection isn't encrypted.")).toBeTruthy()
})

it.each([
  ['unreachable', "Couldn't reach that address. Check it and your connection."],
  ['not-kairos', "That address doesn't look like a Kairos server."],
  ['certificate', "The server's certificate isn't trusted."],
  [
    'insecure-not-allowed',
    'Use https:// for servers outside your local network.',
  ],
  ['invalid-url', 'Enter a valid address.'],
] as const)('explains %s', async function failure(code, message) {
  stubServer(code)
  render(<ConnectScreen />)
  fireEvent.submit(screen.getByLabelText('Server address').closest('form')!)
  await waitFor(function errorVisible() {
    expect(screen.getByRole('alert').textContent).toBe(message)
  })
})

it('disables the form while the probe is pending', function pending() {
  const setServer = stubServer()
  setServer.mockImplementation(function wait() {
    return new Promise(function unresolved() {})
  })
  render(<ConnectScreen />)
  const field = screen.getByLabelText('Server address')
  fireEvent.submit(field.closest('form')!)
  expect((field.closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
  expect(
    screen
      .getByRole('button', { name: 'Connecting…' })
      .hasAttribute('disabled'),
  ).toBe(true)
})
