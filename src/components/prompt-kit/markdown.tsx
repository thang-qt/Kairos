import { Children, isValidElement, memo, useMemo } from 'react'
import { createMathPlugin } from '@streamdown/math'
import 'katex/dist/katex.min.css'
import { Streamdown } from 'streamdown'
import { CodeBlock } from './code-block'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Record<string, React.ComponentType<any>>
  blockRemoteImages?: boolean
  streaming?: boolean
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

function codePropsFromPreChildren(
  children: ReactNode,
): ComponentProps<'code'> | null {
  const child = Children.toArray(children)[0]
  if (!isValidElement<ComponentProps<'code'>>(child)) return null
  return child.props
}

function backtickRunLength(markdown: string, start: number): number {
  let end = start
  while (markdown[end] === '`') end += 1
  return end - start
}

function findClosingBackticks(
  markdown: string,
  start: number,
  runLength: number,
): number {
  let cursor = start

  while (cursor < markdown.length) {
    const next = markdown.indexOf('`', cursor)
    if (next === -1) return -1
    if (backtickRunLength(markdown, next) === runLength) return next
    cursor = next + 1
  }

  return -1
}

function findLatexMathClose(
  markdown: string,
  delimiter: '\\)' | '\\]',
  start: number,
): number {
  let cursor = start

  while (cursor < markdown.length) {
    const next = markdown.indexOf(delimiter, cursor)
    if (next === -1) return -1
    if (next === 0 || markdown[next - 1] !== '\\') return next
    cursor = next + delimiter.length
  }

  return -1
}

const CURRENCY_AMOUNT =
  /^\$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[kKmMbB]?(?=\s|[.,;:!?)}\]–—-]|$)/

/** Match the native parser's rules: no space before the close or digit after it. */
function findInlineMathClose(markdown: string, start: number): number {
  if (!markdown[start] || /\s/.test(markdown[start])) return -1

  let cursor = start
  while (cursor < markdown.length) {
    const close = markdown.indexOf('$', cursor)
    if (close === -1 || markdown.slice(cursor, close).includes('\n')) return -1

    const after = markdown[close + 1] ?? ''
    if (
      close > start &&
      markdown[close - 1] !== '\\' &&
      !/\s/.test(markdown[close - 1]) &&
      !/\d/.test(after) &&
      after !== '$'
    ) return close

    cursor = close + 1
  }
  return -1
}

/** Escape only currency dollars; keep inline and display LaTeX untouched. */
function protectCurrencyDollars(markdown: string): string {
  let protectedText = ''
  let cursor = 0

  while (cursor < markdown.length) {
    if (markdown[cursor] === '\\' && cursor + 1 < markdown.length) {
      protectedText += markdown.slice(cursor, cursor + 2)
      cursor += 2
      continue
    }

    if (markdown[cursor] === '`') {
      const run = backtickRunLength(markdown, cursor)
      const close = findClosingBackticks(markdown, cursor + run, run)
      if (close === -1) {
        protectedText += markdown.slice(cursor)
        break
      }
      protectedText += markdown.slice(cursor, close + run)
      cursor = close + run
      continue
    }

    if (markdown.startsWith('$$', cursor)) {
      const close = markdown.indexOf('$$', cursor + 2)
      const end = close === -1 ? markdown.length : close + 2
      protectedText += markdown.slice(cursor, end)
      cursor = end
      continue
    }

    if (markdown[cursor] === '$') {
      const close = findInlineMathClose(markdown, cursor + 1)
      // A dollar immediately before a digit starts the next price, not the
      // closing delimiter. Don't pair a price with a later equation either.
      if (
        CURRENCY_AMOUNT.test(markdown.slice(cursor)) &&
        (close === -1 || markdown.slice(cursor + 1, close).includes('$'))
      ) {
        protectedText += '\\$'
        cursor += 1
        continue
      }
      if (close !== -1) {
        protectedText += markdown.slice(cursor, close + 1)
        cursor = close + 1
        continue
      }
    }

    protectedText += markdown[cursor]
    cursor += 1
  }

  return protectedText
}

function normalizeLatexMathDelimiters(markdown: string): string {
  let normalized = ''
  let cursor = 0

  while (cursor < markdown.length) {
    if (markdown[cursor] === '`') {
      const runLength = backtickRunLength(markdown, cursor)
      const close = findClosingBackticks(
        markdown,
        cursor + runLength,
        runLength,
      )

      if (close === -1) {
        normalized += markdown.slice(cursor)
        break
      }

      const end = close + runLength
      normalized += markdown.slice(cursor, end)
      cursor = end
      continue
    }

    const opening = markdown.slice(cursor, cursor + 2)
    if (
      (opening === '\\(' || opening === '\\[') &&
      (cursor === 0 || markdown[cursor - 1] !== '\\')
    ) {
      const closing = opening === '\\(' ? '\\)' : '\\]'
      const close = findLatexMathClose(markdown, closing, cursor + 2)

      if (close !== -1) {
        const marker = opening === '\\(' ? '$' : '$$'
        normalized += `${marker}${markdown.slice(cursor + 2, close)}${marker}`
        cursor = close + 2
        continue
      }
    }

    normalized += markdown[cursor]
    cursor += 1
  }

  return normalized
}

const INITIAL_COMPONENTS: Record<string, React.ComponentType<any>> = {
  code: function CodeComponent({ children }) {
    return (
      <code className="rounded border border-primary-200 bg-primary-100 px-1.5 py-1 font-mono text-sm text-primary-900">
        {children}
      </code>
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

const STREAMDOWN_PLUGINS = {
  math: createMathPlugin({ singleDollarTextMath: true }),
}

function ImportedImage({ alt }: { alt?: string }) {
  return (
    <span className="text-pretty text-sm text-primary-500">
      [External image blocked{alt ? `: ${alt}` : ''}]
    </span>
  )
}

const SAFE_COMPONENTS = { ...INITIAL_COMPONENTS, img: ImportedImage }

function MarkdownComponent({
  children,
  className,
  components = INITIAL_COMPONENTS,
  blockRemoteImages = false,
  streaming = false,
}: MarkdownProps) {
  const markdownComponents = useMemo(() => {
    const defaultPre: React.ComponentType<any> = function PreComponent({
      children,
    }) {
      const codeProps = codePropsFromPreChildren(children)
      if (!codeProps) return <pre>{children}</pre>

      return (
        <CodeBlock
          content={textFromNode(codeProps.children)}
          language={extractLanguage(codeProps.className)}
          className="w-full"
          streaming={streaming}
        />
      )
    }
    return {
      // Markdown can contain generated or imported URLs. Keep images on the
      // dedicated attachment path so rendering text never starts a request.
      ...(blockRemoteImages
        ? SAFE_COMPONENTS
        : { ...components, img: ImportedImage }),
      pre: components.pre ?? defaultPre,
    }
  }, [blockRemoteImages, components, streaming])

  return (
    <Streamdown
      className={cn('flex flex-col gap-2', className)}
      components={markdownComponents}
      plugins={STREAMDOWN_PLUGINS}
    >
      {normalizeLatexMathDelimiters(protectCurrencyDollars(children))}
    </Streamdown>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = 'Markdown'

export { Markdown }
