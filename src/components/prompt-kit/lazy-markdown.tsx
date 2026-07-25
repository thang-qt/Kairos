import { Suspense, lazy } from 'react'
import type { MarkdownProps } from './markdown'
import { cn } from '@/lib/utils'

const Markdown = lazy(async function loadMarkdown() {
  const module = await import('./markdown')
  return { default: module.Markdown }
})

function LazyMarkdown({ children, className, ...props }: MarkdownProps) {
  return (
    <Suspense
      fallback={
        <div className={cn('whitespace-pre-wrap text-pretty', className)}>
          {children}
        </div>
      }
    >
      <Markdown className={className} {...props}>
        {children}
      </Markdown>
    </Suspense>
  )
}

export { LazyMarkdown }
