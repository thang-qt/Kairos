import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Shared building blocks for every settings page: a page header, grouped
// sections drawn as one bordered list, and rows with the control on the right.

export function SettingsPage({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-balance text-xl font-medium tracking-tight text-primary-950">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-xl text-pretty text-sm text-primary-500">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </header>
      {children}
    </div>
  )
}

export function SettingsSection({
  title,
  description,
  action,
  bare = false,
  children,
}: {
  title?: string
  description?: ReactNode
  action?: ReactNode
  // Bare sections skip the bordered list, for content that brings its own.
  bare?: boolean
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      {title || action ? (
        <div className="flex items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-balance text-sm font-medium text-primary-900">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-pretty text-xs text-primary-500">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {bare ? (
        children
      ) : (
        <div className="divide-y divide-primary-200 overflow-hidden rounded-xl border border-primary-200 bg-surface">
          {children}
        </div>
      )}
    </section>
  )
}

export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode
  description?: ReactNode
  htmlFor?: string
  children?: ReactNode
  className?: string
}) {
  const Label = htmlFor ? 'label' : 'div'
  return (
    <div
      className={cn(
        'flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <Label htmlFor={htmlFor} className="block text-sm text-primary-900">
          {label}
        </Label>
        {description ? (
          <div className="mt-0.5 text-pretty text-xs text-primary-500">
            {description}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      ) : null}
    </div>
  )
}

// A stacked label + control, for forms inside a section or dialog.
export function SettingsField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm text-primary-900">
        {label}
      </label>
      {children}
      {hint ? (
        <div className="text-pretty text-xs text-primary-500">{hint}</div>
      ) : null}
    </div>
  )
}

export function SettingsNotice({
  tone = 'info',
  children,
  onDismiss,
}: {
  tone?: 'info' | 'success' | 'error'
  children: ReactNode
  onDismiss?: () => void
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-pretty text-sm',
        tone === 'error'
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-primary-200 bg-primary-50 text-primary-800',
      )}
    >
      <div className="min-w-0">{children}</div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-xs text-primary-600 hover:text-primary-900"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  )
}

export function SettingsBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md bg-primary-100 px-1.5 py-0.5 text-xs text-primary-700">
      {children}
    </span>
  )
}

export function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        active ? 'bg-primary-700' : 'bg-primary-300',
      )}
    />
  )
}

export function SettingsEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center text-pretty text-sm text-primary-500">
      {children}
    </div>
  )
}

// Two options shown side by side, e.g. "Ask first" / "Always allow".
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  label,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex rounded-lg bg-primary-100 p-0.5',
        disabled && 'opacity-60',
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => {
              if (!active) onChange(option.value)
            }}
            className={cn(
              'h-7 whitespace-nowrap rounded-md px-2.5 text-xs text-primary-600 transition-colors hover:text-primary-900 disabled:pointer-events-none',
              active && 'bg-surface text-primary-900 shadow-xs/5',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

// Destructive actions ask for a second click instead of opening a dialog.
export function ConfirmButton({
  label,
  confirmLabel = 'Confirm',
  pending = false,
  onConfirm,
}: {
  label: string
  confirmLabel?: string
  pending?: boolean
  onConfirm: () => void
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setAsking(false)}
      >
        Cancel
      </Button>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() => {
          setAsking(false)
          onConfirm()
        }}
      >
        {confirmLabel}
      </Button>
    </span>
  )
}

export const TEXTAREA_CLASS =
  'min-h-24 w-full resize-y rounded-lg border border-primary-200 bg-surface px-3 py-2 text-sm text-primary-900 outline-none transition-colors placeholder:text-primary-500 hover:border-primary-300 focus:border-primary-400'
