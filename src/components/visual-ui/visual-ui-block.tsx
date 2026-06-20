import { useMemo, useState } from 'react'
import { VisualUiErrorBoundary } from './error-boundary'
import { parseVisualUiSource } from './parser'
import type { InputValues, VisualUiAction, VisualUiNode } from './types'
import { Markdown } from '@/components/prompt-kit/markdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

type VisualUiBlockProps = {
  source: string
  onCallback?: (message: string) => void
}

type SelectOption = {
  label: string
  value: string
}

function textValue(node: VisualUiNode) {
  return String(node.value ?? node.text ?? node.label ?? '')
}

function childrenOf(node: VisualUiNode) {
  return Array.isArray(node.children) ? node.children : []
}

function selectOptions(value: unknown): Array<SelectOption> {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === 'string') return { label: item, value: item }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>
      const label = String(record.label ?? record.value ?? '')
      const optionValue = String(record.value ?? record.label ?? '')
      return { label, value: optionValue }
    }
    return { label: String(item), value: String(item) }
  })
}

function collectDefaultValues(node: VisualUiNode): InputValues {
  const values: InputValues = {}

  function visit(current: VisualUiNode) {
    if (current.id) {
      if (current.type === 'input') {
        values[current.id] = String(current.value ?? '')
      }
      if (current.type === 'toggle') {
        values[current.id] = Boolean(current.checked ?? false)
      }
      if (current.type === 'select') {
        values[current.id] = String(
          current.selected ?? selectOptions(current.options)[0]?.value ?? '',
        )
      }
      if (current.type === 'choices') {
        values[current.id] = String(current.selected ?? '')
      }
    }
    for (const child of childrenOf(current)) visit(child)
  }

  visit(node)
  return values
}

function collectFieldIds(node: VisualUiNode): Array<string> {
  const ids: Array<string> = []

  function visit(current: VisualUiNode) {
    if (
      current.id &&
      (current.type === 'input' ||
        current.type === 'toggle' ||
        current.type === 'select' ||
        current.type === 'choices')
    ) {
      ids.push(current.id)
    }
    for (const child of childrenOf(current)) visit(child)
  }

  visit(node)
  return ids
}

function collectSubmitFieldIds(node: VisualUiNode): Set<string> {
  const ids = new Set<string>()

  function visit(current: VisualUiNode) {
    if (
      current.type === 'button' &&
      current.action?.type === 'callback' &&
      Array.isArray(current.action.collectFrom)
    ) {
      for (const id of current.action.collectFrom) ids.add(id)
    }
    for (const child of childrenOf(current)) visit(child)
  }

  visit(node)
  return ids
}

function hasCallbackButton(node: VisualUiNode): boolean {
  if (node.type === 'button' && node.action?.type === 'callback') return true
  return childrenOf(node).some(hasCallbackButton)
}

function readableValue(value: unknown) {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'string') return value
  return String(value ?? '')
}

function callbackMessage(
  action: VisualUiAction,
  values: InputValues,
  fallbackMessage: string,
) {
  const collectFrom =
    'collectFrom' in action && Array.isArray(action.collectFrom)
      ? action.collectFrom
      : []
  const collected = collectFrom
    .filter((id) => Object.prototype.hasOwnProperty.call(values, id))
    .map((id) => `${id}: ${readableValue(values[id])}`)

  if (collected.length > 0) return collected.join('\n')

  if ('data' in action && action.data) {
    const label = action.data.label ?? action.data.value
    if (label !== undefined) return readableValue(label)
  }

  return fallbackMessage
}

function InvalidVisualUiBlock() {
  return (
    <div className="my-2 rounded-[12px] border border-primary-200 bg-surface px-3 py-2 text-base text-primary-700">
      This visual UI block could not be rendered.
    </div>
  )
}

function buttonVariant(variant?: VisualUiNode['variant']) {
  if (variant === 'secondary') return 'secondary'
  if (variant === 'ghost') return 'ghost'
  return 'default'
}

function toneClassName(tone?: VisualUiNode['tone']) {
  if (tone === 'error') return 'border-red-300 bg-red-50 text-red-900'
  if (tone === 'warning') return 'border-yellow-300 bg-yellow-50 text-yellow-950'
  if (tone === 'success') return 'border-green-300 bg-green-50 text-green-950'
  if (tone === 'info') return 'border-primary-300 bg-primary-50 text-primary-950'
  return 'border-primary-200 bg-surface text-primary-950'
}

function VisualUiRenderer({ source, onCallback }: VisualUiBlockProps) {
  const parsed = useMemo(() => parseVisualUiSource(source), [source])
  const submitFieldIds = useMemo(
    () => (parsed ? collectSubmitFieldIds(parsed) : new Set<string>()),
    [parsed],
  )
  const [values, setValues] = useState<InputValues>(() =>
    parsed ? collectDefaultValues(parsed) : {},
  )

  function setValue(id: string | undefined, value: InputValues[string]) {
    if (!id) return
    setValues((current) => ({ ...current, [id]: value }))
  }

  function runAction(action?: VisualUiAction) {
    if (!action) return
    if (action.type === 'open_url' && action.url) {
      window.open(action.url, '_blank', 'noopener,noreferrer')
      return
    }
    if (action.type === 'copy_to_clipboard') {
      void navigator.clipboard?.writeText(action.text ?? '')
      return
    }
    onCallback?.(callbackMessage(action, values, 'Continue'))
  }

  function renderNode(node: VisualUiNode, index: number): React.ReactNode {
    const key = `${node.type || 'node'}-${node.id || index}`

    switch (node.type) {
      case 'stack':
        return (
          <div key={key} className="flex flex-col gap-2.5">
            {childrenOf(node).map(renderNode)}
          </div>
        )
      case 'row':
        return (
          <div
            key={key}
            className="flex flex-wrap items-end gap-2 [&>label]:min-w-[min(12rem,100%)] [&>label]:flex-1"
          >
            {childrenOf(node).map(renderNode)}
          </div>
        )
      case 'form':
      case 'card':
        return (
          <div key={key} className="flex flex-col gap-2.5">
            {node.title ? (
              <div className="text-sm font-medium text-primary-950">
                {node.title}
              </div>
            ) : null}
            {node.description ? (
              <div className="text-base leading-relaxed text-primary-700">
                {node.description}
              </div>
            ) : null}
            {childrenOf(node).map(renderNode)}
          </div>
        )
      case 'text': {
        const style = node.style || 'body'
        return (
          <Markdown
            key={key}
            className={cn(
              'text-primary-950 bg-transparent w-full',
              style === 'title' && '[&_p]:text-base [&_p]:font-medium',
              style === 'body' && '[&_p]:text-base [&_p]:leading-relaxed',
              style === 'caption' &&
                '[&_p]:text-xs [&_p]:leading-relaxed [&_p]:text-primary-600',
            )}
          >
            {textValue(node)}
          </Markdown>
        )
      }
      case 'button':
        return (
          <Button
            key={key}
            size="sm"
            variant={buttonVariant(node.variant)}
            onClick={() => {
              if (!node.action) return
              if (node.action.type === 'callback') {
                onCallback?.(callbackMessage(node.action, values, node.label || 'Continue'))
                return
              }
              runAction(node.action)
            }}
          >
            {node.label || 'Continue'}
          </Button>
        )
      case 'input':
        return (
          <label key={key} className="flex flex-col gap-1.5">
            {node.label ? (
              <span className="text-xs text-primary-700">{node.label}</span>
            ) : null}
            <Input
              nativeInput
              placeholder={node.placeholder}
              value={String(values[node.id || ''] ?? node.value ?? '')}
              onChange={(event) => setValue(node.id, event.currentTarget.value)}
            />
          </label>
        )
      case 'toggle': {
        const checked = Boolean(values[node.id || ''] ?? node.checked ?? false)
        return (
          <label
            key={key}
            className="flex items-center justify-between gap-3 rounded-[10px] border border-primary-200 bg-surface px-3 py-2"
          >
            <span className="min-w-0 text-sm text-primary-950">
              {node.label}
            </span>
            <Switch
              checked={checked}
              onCheckedChange={(next) => setValue(node.id, next)}
            />
          </label>
        )
      }
      case 'select': {
        const options = selectOptions(node.options)
        return (
          <label key={key} className="flex flex-col gap-1.5">
            {node.label ? (
              <span className="text-xs text-primary-700">{node.label}</span>
            ) : null}
            <select
              className="h-8.5 rounded-lg border border-primary-200 bg-surface px-3 text-sm text-primary-950 shadow-xs/5 outline-none focus-visible:border-primary-500 focus-visible:ring-[3px] focus-visible:ring-primary-500/24"
              value={String(values[node.id || ''] ?? node.selected ?? '')}
              onChange={(event) => setValue(node.id, event.currentTarget.value)}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )
      }
      case 'choices': {
        const controlledBySubmit = Boolean(node.id && submitFieldIds.has(node.id))
        const selectedValue = node.id ? values[node.id] : undefined
        return (
          <div key={key} className="flex flex-wrap gap-2">
            {selectOptions(node.options).map((option) => {
              const selected = controlledBySubmit && selectedValue === option.value
              return (
                <Button
                  key={option.value}
                  size="sm"
                  variant={selected ? 'default' : 'secondary'}
                  onClick={() => {
                    if (node.id) setValue(node.id, option.value)
                    if (!controlledBySubmit) onCallback?.(option.label || option.value)
                  }}
                >
                  {option.label}
                </Button>
              )
            })}
          </div>
        )
      }
      case 'notice':
        return (
          <div
            key={key}
            className={cn(
              'rounded-[12px] border px-3 py-2 text-base leading-relaxed',
              toneClassName(node.tone),
            )}
          >
            {node.title ? <div className="font-medium">{node.title}</div> : null}
            {textValue(node) ? <div>{textValue(node)}</div> : null}
          </div>
        )
      default:
        return childrenOf(node).length > 0 ? (
          <div key={key} className="flex flex-col gap-2.5">
            {childrenOf(node).map(renderNode)}
          </div>
        ) : null
    }
  }

  if (!parsed) return <InvalidVisualUiBlock />

  const shouldAddSubmit =
    parsed.type === 'form' &&
    collectFieldIds(parsed).length > 0 &&
    !hasCallbackButton(parsed)

  return (
    <div className="my-2 w-full max-w-[900px]">
      {renderNode(parsed, 0)}
      {shouldAddSubmit ? (
        <div className="mt-2 flex justify-start">
          <Button
            size="sm"
            onClick={() =>
              onCallback?.(
                collectFieldIds(parsed)
                  .map((id) => `${id}: ${readableValue(values[id])}`)
                  .join('\n'),
              )
            }
          >
            Submit
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function VisualUiBlock(props: VisualUiBlockProps) {
  return (
    <VisualUiErrorBoundary>
      <VisualUiRenderer {...props} />
    </VisualUiErrorBoundary>
  )
}
