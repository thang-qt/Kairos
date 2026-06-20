import type { VisualUiNode, VisualUiPart } from './types'

const MAX_NODE_COUNT = 250
const MAX_DEPTH = 20

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function countNodes(node: unknown, depth = 0): number {
  if (!isRecord(node) || depth > MAX_DEPTH) return MAX_NODE_COUNT + 1
  let count = 1
  const children = node.children
  if (Array.isArray(children)) {
    for (const child of children) count += countNodes(child, depth + 1)
  }
  const tabs = node.tabs
  if (Array.isArray(tabs)) {
    for (const tab of tabs) {
      if (!isRecord(tab) || !Array.isArray(tab.children)) continue
      for (const child of tab.children) count += countNodes(child, depth + 1)
    }
  }
  return count
}

export function parseVisualUiSource(source: string): VisualUiNode | null {
  try {
    const value = JSON.parse(source) as unknown
    if (!isRecord(value)) return null
    if (typeof value.type !== 'string') return null
    if (countNodes(value) > MAX_NODE_COUNT) return null
    return value as VisualUiNode
  } catch {
    return null
  }
}

export function extractVisualUiParts(
  text: string,
  options: { streaming?: boolean } = {},
): Array<VisualUiPart> {
  const parts: Array<VisualUiPart> = []
  const regex = /```visual-ui\s*\n([\s\S]*?)```/gi
  let lastIndex = 0
  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0
    const before = text.slice(lastIndex, index)
    if (before) parts.push({ type: 'markdown', content: before })
    parts.push({ type: 'ui', content: match[1] ?? '' })
    lastIndex = index + match[0].length
  }

  const pendingFenceIndex = text.slice(lastIndex).search(/```visual-ui\s*\n/i)
  if (pendingFenceIndex >= 0) {
    const absoluteIndex = lastIndex + pendingFenceIndex
    const before = text.slice(lastIndex, absoluteIndex)
    if (before) parts.push({ type: 'markdown', content: before })
    const pendingContent = text
      .slice(absoluteIndex)
      .replace(/^```visual-ui\s*\n/i, '')
    parts.push({
      type: options.streaming ? 'pending-ui' : 'markdown',
      content: options.streaming ? pendingContent : text.slice(absoluteIndex),
    })
    return parts
  }

  const after = text.slice(lastIndex)
  if (after) parts.push({ type: 'markdown', content: after })
  return parts.length > 0 ? parts : [{ type: 'markdown', content: text }]
}
