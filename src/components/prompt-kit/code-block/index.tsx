import { useEffect, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import vitesseDark from '@shikijs/themes/vitesse-dark'
import vitesseLight from '@shikijs/themes/vitesse-light'
import { formatLanguageName, normalizeLanguage, resolveLanguage } from './utils'
import type { HighlighterCore } from 'shiki/core'
import { useResolvedTheme } from '@/app/preferences/app-preferences'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type CodeBlockProps = {
  content: string
  ariaLabel?: string
  language?: string
  className?: string
  streaming?: boolean
}

let highlighterPromise: Promise<HighlighterCore> | null = null
const languagePromises = new Map<string, Promise<void>>()

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [vitesseLight, vitesseDark],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return highlighterPromise
}

async function loadLanguage(highlighter: HighlighterCore, language: string) {
  let pending = languagePromises.get(language)
  if (!pending) {
    pending = (async function loadGrammar() {
      switch (language) {
        case 'bash':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/bash')).default,
          )
          break
        case 'c':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/c')).default,
          )
          break
        case 'cpp':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/cpp')).default,
          )
          break
        case 'csharp':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/csharp')).default,
          )
          break
        case 'css':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/css')).default,
          )
          break
        case 'diff':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/diff')).default,
          )
          break
        case 'dockerfile':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/dockerfile')).default,
          )
          break
        case 'go':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/go')).default,
          )
          break
        case 'graphql':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/graphql')).default,
          )
          break
        case 'html':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/html')).default,
          )
          break
        case 'java':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/java')).default,
          )
          break
        case 'javascript':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/javascript')).default,
          )
          break
        case 'json':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/json')).default,
          )
          break
        case 'jsx':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/jsx')).default,
          )
          break
        case 'kotlin':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/kotlin')).default,
          )
          break
        case 'markdown':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/markdown')).default,
          )
          break
        case 'php':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/php')).default,
          )
          break
        case 'python':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/python')).default,
          )
          break
        case 'regexp':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/regexp')).default,
          )
          break
        case 'ruby':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/ruby')).default,
          )
          break
        case 'rust':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/rust')).default,
          )
          break
        case 'shell':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/shell')).default,
          )
          break
        case 'sql':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/sql')).default,
          )
          break
        case 'swift':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/swift')).default,
          )
          break
        case 'toml':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/toml')).default,
          )
          break
        case 'typescript':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/typescript')).default,
          )
          break
        case 'tsx':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/tsx')).default,
          )
          break
        case 'xml':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/xml')).default,
          )
          break
        case 'yaml':
          await highlighter.loadLanguage(
            (await import('@shikijs/langs/yaml')).default,
          )
          break
      }
    })()
    languagePromises.set(language, pending)
    pending.catch(function clearFailedLanguage() {
      languagePromises.delete(language)
    })
  }
  return pending
}

export function CodeBlock({
  content,
  ariaLabel,
  language = 'text',
  className,
  streaming = false,
}: CodeBlockProps) {
  const resolvedTheme = useResolvedTheme()
  const [copied, setCopied] = useState(false)
  const [html, setHtml] = useState<string | null>(null)
  const [resolvedLanguage, setResolvedLanguage] = useState('text')
  const [headerBg, setHeaderBg] = useState<string | undefined>()

  const fallback = useMemo(() => {
    return content
  }, [content])

  const normalizedLanguage = normalizeLanguage(language || 'text')
  const themeName = resolvedTheme === 'dark' ? 'vitesse-dark' : 'vitesse-light'

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(
      function highlightWhenReady() {
        getHighlighter()
          .then(async function highlight(highlighter) {
            const lang = resolveLanguage(normalizedLanguage)
            if (lang !== 'text') await loadLanguage(highlighter, lang)
            if (!active) return
            const highlighted = highlighter.codeToHtml(content, {
              lang,
              theme: themeName,
            })
            if (active) {
              setResolvedLanguage(lang)
              setHtml(highlighted)
              const theme = highlighter.getTheme(themeName)
              setHeaderBg(theme.bg)
            }
          })
          .catch(function preservePlainText() {
            if (active) setHtml(null)
          })
      },
      streaming ? 450 : 80,
    )
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [content, normalizedLanguage, streaming, themeName])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  const isSingleLine = content.split('\n').length === 1
  const displayLanguage = formatLanguageName(resolvedLanguage)

  return (
    <div
      className={cn(
        'code-block group relative w-full max-w-full min-w-0 overflow-hidden rounded-lg border border-primary-200',
        className,
      )}
    >
      <div
        className={cn('flex items-center justify-between px-3 py-1')}
        style={{ backgroundColor: headerBg }}
      >
        <span className="text-xs leading-none font-medium text-primary-500">
          {displayLanguage}
        </span>
        <Button
          variant="ghost"
          aria-label={ariaLabel ?? 'Copy code'}
          className="h-auto gap-1 px-0 py-0 text-xs leading-none font-medium text-primary-500 hover:bg-transparent hover:text-primary-800"
          onClick={() => {
            handleCopy().catch(() => {})
          }}
        >
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            size={20}
            strokeWidth={1.5}
          />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {html ? (
        <div
          className={cn(
            'text-sm text-primary-900 [&>pre]:w-full [&>pre]:max-w-full [&>pre]:overflow-x-auto',
            isSingleLine
              ? '[&>pre]:whitespace-pre [&>pre]:px-3 [&>pre]:py-2'
              : '[&>pre]:px-3 [&>pre]:py-3',
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre
          className={cn(
            'text-sm max-w-full overflow-x-auto',
            isSingleLine ? 'whitespace-pre px-3 py-2' : 'px-3 py-3',
          )}
        >
          <code className="block min-w-full">{fallback}</code>
        </pre>
      )}
    </div>
  )
}
