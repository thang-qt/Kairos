import type { ReactNode } from 'react'
import { KairosIconBig } from '@/components/icons/kairos-icon-big'

type AuthShellProps = {
  children: ReactNode
}

export function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-surface">
      {/* Subtle radial glow in the background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% -10%, oklch(0.92 0.008 80 / 0.6) 0%, transparent 70%)',
        }}
      />

      {/* Faint grid texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(oklch(0.3 0 80) 1px, transparent 1px), linear-gradient(90deg, oklch(0.3 0 80) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Top nav bar */}
      <header className="relative z-10 flex items-center px-6 py-4 sm:px-10">
        <div className="flex items-center gap-2 select-none">
          <KairosIconBig className="size-6 rounded-sm" />
          <span className="font-serif text-lg font-medium text-primary-950">
            Kairos
          </span>
        </div>
      </header>

      {/* Main centered content */}
      <main className="relative z-10 flex min-h-[calc(100vh-5rem)] items-center justify-center px-4 py-10">
        <div className="w-full max-w-[26rem]">
          {/* Card */}
          <div className="relative overflow-hidden rounded-[2rem] border border-primary-200 bg-primary-50/80 shadow-xl shadow-primary-900/5 backdrop-blur-sm">
            {/* Decorative top stripe */}
            <div
              aria-hidden
              className="h-0.5 w-full"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, oklch(0.6 0.008 80 / 0.5) 30%, oklch(0.7 0.006 80 / 0.7) 50%, oklch(0.6 0.008 80 / 0.5) 70%, transparent 100%)',
              }}
            />

            <div className="px-8 pb-8 pt-7 sm:px-9 sm:pb-9 sm:pt-8">
              {children}
            </div>
          </div>

          {/* Bottom tagline */}
          <p className="mt-6 text-center text-xs text-primary-500 select-none">
            A focused AI chat experience
          </p>
        </div>
      </main>
    </div>
  )
}
