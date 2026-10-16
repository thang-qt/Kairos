// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CodeBlock } from './code-block'

vi.mock('@/app/preferences/app-preferences', function mockPreferences() {
  return {
    useResolvedTheme: function useResolvedTheme() {
      return 'light'
    },
  }
})

afterEach(cleanup)

it.each([
  {
    language: 'tsx',
    content:
      'const Component = ({ value }: { value: string }) => <div>{value}</div>',
  },
  { language: 'jsx', content: 'const node = <div>{value}</div>' },
  {
    language: 'javascript',
    content: 'const match = value.match(/foo(?:bar)?/gi)',
  },
])(
  'loads the $language grammar and embedded grammars on demand',
  async function verifyLanguage({ language, content }) {
    const view = render(<CodeBlock content={content} language={language} />)

    await waitFor(function expectHighlightedTokens() {
      expect(
        view.container.querySelectorAll('pre code span').length,
      ).toBeGreaterThan(0)
    })
  },
)

it('shows new streaming content while its replacement highlight is debounced', async function showStreamingFallback() {
  const initialContent = 'const initial = "ready"'
  const nextContent = 'const initial = "ready"\nconst streamed = true'
  const view = render(
    <CodeBlock content={initialContent} language="typescript" />,
  )

  await waitFor(function expectInitialHighlight() {
    expect(
      view.container.querySelectorAll('pre code span').length,
    ).toBeGreaterThan(0)
  })

  view.rerender(
    <CodeBlock content={nextContent} language="typescript" streaming />,
  )

  const code = view.container.querySelector('pre code')
  expect(code?.textContent).toBe(nextContent)
  expect(code?.querySelectorAll('span')).toHaveLength(0)
})
