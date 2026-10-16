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
