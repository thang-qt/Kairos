import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

type SystemPromptFieldProps = {
  value: string
  onChange: (value: string) => void
  debounceMs?: number
}

export function SystemPromptField({
  value,
  onChange,
  debounceMs = 0,
}: SystemPromptFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = useRef(onChange)

  // The save callback merges with the latest settings, not the settings that
  // happened to be present when the user started typing.
  useLayoutEffect(
    function updateSaveCallback() {
      save.current = onChange
    },
    [onChange],
  )

  function flush() {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (pending.current !== null) {
      const nextValue = pending.current
      pending.current = null
      save.current(nextValue)
    }
  }

  useEffect(function flushOnUnmount() {
    return flush
  }, [])

  // Once the server acknowledges the draft, follow authoritative updates again.
  if (draft !== null && draft === value) setDraft(null)

  return (
    <textarea
      aria-label="System prompt"
      value={draft ?? value}
      onChange={function handleChange(event) {
        const nextValue = event.target.value
        if (debounceMs === 0) {
          onChange(nextValue)
          return
        }
        setDraft(nextValue)
        pending.current = nextValue
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(flush, debounceMs)
      }}
      onBlur={flush}
      placeholder="You are a concise assistant..."
      className={cn(
        'min-h-28 w-full resize-y rounded-lg border border-primary-200 bg-surface px-3 py-2 text-sm text-primary-900 outline-none transition-colors placeholder:text-primary-600/70 focus:border-primary-500',
        'text-pretty',
      )}
    />
  )
}
