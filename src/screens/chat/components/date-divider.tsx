type DateDividerProps = {
  timestamp: number
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isYesterday(date: Date, now: Date): boolean {
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  return isSameDay(date, yesterday)
}

function formatDividerDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()

  if (isSameDay(date, now)) return 'Today'
  if (isYesterday(date, now)) return 'Yesterday'

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date)
}

export function DateDivider({ timestamp }: DateDividerProps) {
  const label = formatDividerDate(timestamp)

  return (
    <div
      className="mx-auto my-4 flex w-full max-w-sm items-center gap-3 py-2 text-xs text-primary-500 select-none"
      role="separator"
      aria-label={label}
    >
      <div className="h-px flex-1 bg-primary-200/70" />
      <span>{label}</span>
      <div className="h-px flex-1 bg-primary-200/70" />
    </div>
  )
}
