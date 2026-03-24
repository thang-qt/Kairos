import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type FullScreenMessageProps = {
  title: string
  detail?: string
  action?: ReactNode
  tone?: 'default' | 'error'
}

export function FullScreenMessage({
  title,
  detail,
  action,
  tone = 'default',
}: FullScreenMessageProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6 py-10 text-primary-900">
      <div
        className={cn(
          'w-full max-w-md rounded-3xl border border-primary-200 bg-primary-50/70 p-8 shadow-sm backdrop-blur-sm',
          tone === 'error' && 'border-red-200 bg-red-50/60',
        )}
      >
        <div className="space-y-3">
          <p className="text-balance font-serif text-3xl font-medium text-primary-950">
            {title}
          </p>
          {detail ? (
            <p className="text-pretty text-sm leading-6 text-primary-700">
              {detail}
            </p>
          ) : null}
        </div>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </div>
  )
}
