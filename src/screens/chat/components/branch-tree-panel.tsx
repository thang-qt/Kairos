import { memo, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { GitBranchIcon } from '@hugeicons/core-free-icons'
import type { SessionMeta } from '../types'
import { cn } from '@/lib/utils'

type TreeNode = {
  session: SessionMeta
  children: Array<TreeNode>
  depth: number
}

type BranchTreePanelProps = {
  sessions: Array<SessionMeta>
  activeSessionKey?: string
}

function buildTree(sessions: Array<SessionMeta>): Array<TreeNode> {
  const sessionsByKey = new Map(
    sessions.map(function mapSession(session) {
      return [session.key, session] as const
    }),
  )
  const childrenMap = new Map<string, Array<SessionMeta>>()
  const roots: Array<SessionMeta> = []

  for (const s of sessions) {
    const hasParent =
      typeof s.parentSessionKey === 'string' &&
      sessionsByKey.has(s.parentSessionKey)
    if (hasParent && s.parentSessionKey) {
      const siblings = childrenMap.get(s.parentSessionKey) ?? []
      siblings.push(s)
      childrenMap.set(s.parentSessionKey, siblings)
    } else {
      roots.push(s)
    }
  }

  function buildNode(session: SessionMeta, depth: number): TreeNode {
    const kids = childrenMap.get(session.key) ?? []
    return {
      session,
      depth,
      children: kids.map((child) => buildNode(child, depth + 1)),
    }
  }

  return roots.map((r) => buildNode(r, 0))
}

function getLabel(session: SessionMeta): string {
  return (
    session.label || session.title || session.derivedTitle || session.friendlyId
  )
}

function isOrphanBranch(
  session: SessionMeta,
  sessionsByKey: Map<string, SessionMeta>,
): boolean {
  return (
    typeof session.parentSessionKey === 'string' &&
    !sessionsByKey.has(session.parentSessionKey)
  )
}

type TreeNodeItemProps = {
  node: TreeNode
  activeSessionKey?: string
}

function TreeNodeItem({ node, activeSessionKey }: TreeNodeItemProps) {
  const isActive =
    node.session.key === activeSessionKey ||
    node.session.friendlyId === activeSessionKey
  const label = getLabel(node.session)

  return (
    <div>
      <Link
        to="/chat/$sessionKey"
        params={{ sessionKey: node.session.friendlyId }}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
          'hover:bg-primary-100',
          isActive
            ? 'bg-primary-200 font-medium text-primary-950'
            : 'text-primary-700',
        )}
        style={{ paddingLeft: `${8 + node.depth * 16}px` }}
      >
        {node.depth > 0 ? (
          <span className="mr-0.5 text-primary-400">↳</span>
        ) : null}
        <HugeiconsIcon
          icon={GitBranchIcon}
          size={12}
          strokeWidth={1.8}
          className={cn(
            'shrink-0',
            isActive ? 'text-primary-700' : 'text-primary-400',
          )}
        />
        <span className="truncate">{label}</span>
      </Link>
      {node.children.length > 0 ? (
        <div className="relative">
          <div
            className="absolute bottom-0 left-0 top-0 border-l border-primary-200"
            style={{ marginLeft: `${15 + node.depth * 16}px` }}
          />
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.session.key}
              node={child}
              activeSessionKey={activeSessionKey}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function BranchTreePanelComponent({
  sessions,
  activeSessionKey,
}: BranchTreePanelProps) {
  const sessionsByKey = useMemo(
    function createSessionsByKey() {
      return new Map(
        sessions.map(function mapSession(session) {
          return [session.key, session] as const
        }),
      )
    },
    [sessions],
  )
  const tree = useMemo(() => buildTree(sessions), [sessions])

  const relevantRoots = useMemo(() => {
    if (!activeSessionKey) return tree

    function containsKey(node: TreeNode, key: string): boolean {
      if (node.session.key === key || node.session.friendlyId === key) {
        return true
      }
      return node.children.some((child) => containsKey(child, key))
    }

    let currentKey = activeSessionKey
    const visited = new Set<string>()
    for (;;) {
      if (visited.has(currentKey)) break
      visited.add(currentKey)
      const session = sessions.find(
        (s) => s.key === currentKey || s.friendlyId === currentKey,
      )
      if (!session) break
      if (typeof session.parentSessionKey !== 'string') break
      currentKey = session.parentSessionKey
    }

    const relevant = tree.filter((root) => containsKey(root, currentKey))
    return relevant
  }, [tree, activeSessionKey, sessions])

  const hasForks = sessions.some((s) => typeof s.parentSessionKey === 'string')

  if (!hasForks) {
    return (
      <div className="flex h-32 flex-col items-center justify-center px-4 text-center text-xs text-primary-500">
        <HugeiconsIcon
          icon={GitBranchIcon}
          size={20}
          strokeWidth={1.5}
          className="mb-2 text-primary-400"
        />
        <p>No branches yet</p>
        <p className="mt-1 text-primary-400">
          Fork a response to create branches
        </p>
      </div>
    )
  }

  if (activeSessionKey && relevantRoots.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center px-4 text-center text-xs text-primary-500">
        <HugeiconsIcon
          icon={GitBranchIcon}
          size={20}
          strokeWidth={1.5}
          className="mb-2 text-primary-400"
        />
        <p>Branch tree unavailable</p>
        <p className="mt-1 text-primary-400">
          This conversation could not be matched to a visible branch root
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5 py-1">
      {(activeSessionKey ? relevantRoots : tree).map((root) => (
        <div key={root.session.key} className="flex flex-col gap-0.5">
          {isOrphanBranch(root.session, sessionsByKey) ? (
            <div className="px-2 pt-1 text-[11px] text-primary-400">
              Original deleted
            </div>
          ) : null}
          <TreeNodeItem node={root} activeSessionKey={activeSessionKey} />
        </div>
      ))}
    </div>
  )
}

export const BranchTreePanel = memo(BranchTreePanelComponent)
