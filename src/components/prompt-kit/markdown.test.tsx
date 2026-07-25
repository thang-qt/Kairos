import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from './markdown'

describe('Markdown', function () {
  it('renders fenced code blocks without a language as block code', function () {
    const html = renderToStaticMarkup(
      <Markdown>{'```\nconst answer = 42\n```'}</Markdown>,
    )

    expect(html).toContain('code-block')
    expect(html).toContain('Copy')
    expect(html).toContain('Text')
    expect(html).toContain('const answer = 42')
  })

  it('renders LaTeX inline and display delimiters as math', function () {
    const html = renderToStaticMarkup(
      <Markdown>{String.raw`Inline: \(x^2 + y^2\)

\[
\int_0^1 x\,dx
\]`}</Markdown>,
    )

    expect(html.match(/class="katex"/g)).toHaveLength(2)
    expect(html).toContain('katex-display')
    expect(html).not.toContain('\\(x^2 + y^2\\)')
    expect(html).not.toContain('\\[')
  })

  it('does not normalize LaTeX delimiters inside code', function () {
    const html = renderToStaticMarkup(
      <Markdown>
        {
          'Use \\(\\alpha\\), but keep `\\(\\beta\\)` literal.\n\n```tex\n\\[\\gamma\\]\n```'
        }
      </Markdown>,
    )

    expect(html).toContain('katex')
    expect(html).toContain('\\(\\beta\\)')
    expect(html).toContain('\\[\\gamma\\]')
  })
})
