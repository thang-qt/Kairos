import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AuthShell } from './components/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getDesktopBridge, getShell } from '@/lib/shell'
import type { ServerError } from '@/lib/shell'

const errors: Record<ServerError, string> = {
  unreachable: "Couldn't reach that address. Check it and your connection.",
  'not-kairos': "That address doesn't look like a Kairos server.",
  certificate: "The server's certificate isn't trusted.",
  'insecure-not-allowed':
    'Use https:// for servers outside your local network.',
  'invalid-url': 'Enter a valid address.',
}

export function ConnectScreen() {
  const shell = getShell()
  const [address, setAddress] = useState(function initialAddress() {
    if (!shell.server) return ''
    const url = new URL(shell.server)
    return url.host
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ServerError | null>(null)
  const [override, setOverride] = useState(false)

  return (
    <AuthShell>
      <section className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-balance font-serif text-3xl font-medium text-primary-950">
            Connect to Kairos
          </h1>
          <p className="text-pretty text-sm text-primary-600">
            Enter the address of your Kairos server.
          </p>
        </div>
        <form
          className="space-y-4"
          onSubmit={async function connect(event) {
            event.preventDefault()
            if (pending) return
            setError(null)
            setPending(true)
            try {
              const bridge = getDesktopBridge()
              if (!bridge) throw new Error('Desktop bridge unavailable')
              const result = await bridge.setServer(address.trim())
              if (!result.ok) {
                setError(result.error)
                setPending(false)
              } else setOverride(result.overriddenByEnv === true)
            } catch {
              setError('unreachable')
              setPending(false)
            }
          }}
        >
          <fieldset disabled={pending} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-primary-700">
                Server address
              </span>
              <Input
                nativeInput
                name="server"
                placeholder="kairos.example.com"
                autoComplete="url"
                value={address}
                onChange={function changeAddress(event) {
                  setAddress(event.target.value)
                }}
                aria-invalid={error !== null}
                aria-describedby={error ? 'connect-error' : undefined}
              />
            </label>
            {/^http:\/\//i.test(address.trim()) ? (
              <p className="text-pretty text-xs text-primary-600">
                This connection isn't encrypted.
              </p>
            ) : null}
            {error ? (
              <p
                id="connect-error"
                role="alert"
                className="text-pretty text-sm text-primary-700"
              >
                {errors[error]}
              </p>
            ) : null}
            {override ? (
              <p role="status" className="text-pretty text-sm text-primary-600">
                Server saved. KAIROS_URL still selects the server for this
                session.
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              {shell.server ? (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={function cancel(event) {
                    if (pending) event.preventDefault()
                  }}
                  render={<Link to="/" />}
                >
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" disabled={pending}>
                {pending ? 'Connecting…' : 'Continue'}
              </Button>
            </div>
          </fieldset>
        </form>
      </section>
    </AuthShell>
  )
}
