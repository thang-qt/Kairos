import { useEffect, useRef, useState } from 'react'

type SettleOptions = {
  // How long a shown value stays before it may be replaced.
  minDwellMs: number
  // How long a new value must wait before it is shown at all.
  settleMs: number
}

// Rate-limits a fast-changing display value: each shown value stays up for at
// least `minDwellMs`, new values wait `settleMs`, and intermediate values are
// skipped so only the newest one is shown when the wait ends.
export function useSettledValue<T>(
  value: T,
  { minDwellMs, settleMs }: SettleOptions,
): T {
  const [shown, setShown] = useState(value)
  const shownAtRef = useRef(Date.now())
  const pendingSinceRef = useRef<number | null>(null)

  useEffect(
    function scheduleSettledValue() {
      if (Object.is(value, shown)) {
        pendingSinceRef.current = null
        return
      }
      const now = Date.now()
      pendingSinceRef.current ??= now
      const showAt = Math.max(
        shownAtRef.current + minDwellMs,
        pendingSinceRef.current + settleMs,
      )
      const timer = window.setTimeout(
        function showLatest() {
          shownAtRef.current = Date.now()
          pendingSinceRef.current = null
          setShown(value)
        },
        Math.max(0, showAt - now),
      )
      return () => window.clearTimeout(timer)
    },
    [value, shown, minDwellMs, settleMs],
  )

  return shown
}
