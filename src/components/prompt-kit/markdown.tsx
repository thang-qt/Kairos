import { Children, isValidElement, memo } from 'react'
import { math } from '@streamdown/math'
import 'katex/dist/katex.min.css'
import { Streamdown } from 'streamdown'
import { CodeBlock } from './code-block'
import { cn } from '@/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Record<string, React.ComponentType<any>>
}

function extractLanguage(className?: string): string {
  if (!className) return 'text'
  const match = className.match(/language-(\w+)/)
  return match ? match[1] : 'text'
}

function textFromNode(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textFromNode).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textFromNode(node.props.children)
  }
  return ''
}

function codePropsFromPreChildren(children: ReactNode): ComponentProps<'code'> | null {
  const child = Children.toArray(children)[0]
  if (!isValidElement<ComponentProps<'code'>>(child)) return null
  return child.props
}

const INITIAL_COMPONENTS: Record<string, React.ComponentType<any>> = {
  code: function CodeComponent({ children }) {
    return (
      <code className="rounded border border-primary-200 bg-primary-100 px-1.5 py-1 font-mono text-sm text-primary-900">
        {children}
      </code>
    )
  },
  pre: function PreComponent({ children }) {
    const codeProps = codePropsFromPreChildren(children)
    if (!codeProps) return <pre>{children}</pre>

    return (
      <CodeBlock
        content={textFromNode(codeProps.children)}
        language={extractLanguage(codeProps.className)}
        className="w-full"
      />
    )
  },
  h1: function H1Component({ children }) {
    return (
      <h1 className="text-xl font-medium text-primary-950 text-balance">
        {children}
      </h1>
    )
  },
  h2: function H2Component({ children }) {
    return (
      <h2 className="text-lg font-medium text-primary-900 text-balance">
        {children}
      </h2>
    )
  },
  h3: function H3Component({ children }) {
    return (
      <h3 className="font-medium text-primary-900 text-balance">{children}</h3>
    )
  },
  p: function PComponent({ children }) {
    return (
      <p className="text-primary-950 text-pretty leading-relaxed">{children}</p>
    )
  },
  ul: function UlComponent({ children }) {
    return (
      <ul className="ml-4 list-disc text-primary-950 marker:text-primary-400">
        {children}
      </ul>
    )
  },
  ol: function OlComponent({ children }) {
    return (
      <ol className="ml-4 list-decimal text-primary-950 marker:text-primary-500">
        {children}
      </ol>
    )
  },
  li: function LiComponent({ children }) {
    return <li className="leading-relaxed">{children}</li>
  },
  a: function AComponent({ children, href }) {
    return (
      <a
        href={href}
        className="text-primary-950 underline decoration-primary-300 underline-offset-4 transition-colors hover:text-primary-950 hover:decoration-primary-500"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    )
  },
  blockquote: function BlockquoteComponent({ children }) {
    return (
      <blockquote className="border-l-2 border-primary-300 pl-4 text-primary-900 italic">
        {children}
      </blockquote>
    )
  },
  strong: function StrongComponent({ children }) {
    return <strong className="font-medium text-primary-950">{children}</strong>
  },
  em: function EmComponent({ children }) {
    return <em className="italic text-primary-950">{children}</em>
  },
  hr: function HrComponent() {
    return <hr className="my-3 border-primary-200" />
  },
  table: function TableComponent({ children }) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    )
  },
  thead: function TheadComponent({ children }) {
    return (
      <thead className="border-b border-primary-200 bg-primary-50">
        {children}
      </thead>
    )
  },
  tbody: function TbodyComponent({ children }) {
    return <tbody className="divide-y divide-primary-100">{children}</tbody>
  },
  tr: function TrComponent({ children }) {
    return (
      <tr className="transition-colors hover:bg-primary-50/50">{children}</tr>
    )
  },
  th: function ThComponent({ children }) {
    return (
      <th className="px-3 py-2 text-left font-medium text-primary-950">
        {children}
      </th>
    )
  },
  td: function TdComponent({ children }) {
    return <td className="px-3 py-2 text-primary-950">{children}</td>
  },
}

const STREAMDOWN_PLUGINS = { math }

function MarkdownComponent({
  children,
  className,
  components = INITIAL_COMPONENTS,
}: MarkdownProps) {
  return (
    <Streamdown
      className={cn('flex flex-col gap-2', className)}
      components={components}
      plugins={STREAMDOWN_PLUGINS}
    >
      {children}
    </Streamdown>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = 'Markdown'

export { Markdown }
