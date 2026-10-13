import { useEffect, useState } from 'react'
import { normalizeMessageTimestamp } from '../utils'
import { formatActivityDuration } from './message-item-utils'

type ElapsedTimeProps = {
  startedAt: unknown
  className?: string
}

// Live wall-clock timer for a turn that is still running. The interval is a
// subscription to the clock, so it is the one place this needs an effect.
export function ElapsedTime({ startedAt, className }: ElapsedTimeProps) {
  const start = normalizeMessageTimestamp(startedAt)
  const [now, setNow] = useState(() => Date.now())

  useEffect(
    function tickWhileRunning() {
      if (start === null) return
      const interval = window.setInterval(() => setNow(Date.now()), 1000)
      return () => window.clearInterval(interval)
    },
    [start],
  )

  if (start === null) return null
  const elapsed = Math.max(0, now - start)
  return (
    <span className={className}>
      {elapsed < 1000
        ? '0s'
        : formatActivityDuration(Math.floor(elapsed / 1000) * 1000).replace(
            '.0s',
            's',
          )}
    </span>
  )
}
