import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from './markdown'

describe('Markdown', function () {
  it('blocks generated Markdown and HTML images without creating image requests', function () {
    const html = renderToStaticMarkup(
      <Markdown>
        {
          '![Generated](https://example.invalid/generated-image.png)\n\n<img src="https://example.invalid/generated-html.png" alt="HTML image" />'
        }
      </Markdown>,
    )

    expect(html).not.toContain('<img')
    expect(html).not.toContain('https://example.invalid')
    expect(html).not.toContain('rel="preload"')
    expect(html).toContain('External image blocked')
  })

  it('blocks imported Markdown and HTML images without creating image requests', function () {
    const html = renderToStaticMarkup(
      <Markdown blockRemoteImages>
        {
          '![External](https://example.invalid/private-image.png)\n\n<img src="https://example.invalid/private-html.png" alt="HTML image" />'
        }
      </Markdown>,
    )
    expect(html).not.toContain('<img')
    expect(html).not.toContain('rel="preload"')
    expect(html).toContain('External image blocked')
  })
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

  it('keeps benchmark currency comparisons as literal text', function () {
    const html = renderToStaticMarkup(
      <Markdown>
        {
          '- Vals Index: me $0.64, him $3.24. ~5x.\n- Vibe Code Bench: me $0.58, him $6.23. ~10x.\n- Code Migration: me $1.86, him $6.51.'
        }
      </Markdown>,
    )

    for (const price of [
      '$0.64',
      '$3.24',
      '$0.58',
      '$6.23',
      '$1.86',
      '$6.51',
    ]) {
      expect(html).toContain(price)
    }
    expect(html).not.toContain('class="katex"')
  })

  it('keeps prices literal alongside real inline math', function () {
    const html = renderToStaticMarkup(
      <Markdown>
        {'Prices: $1,234.56 and $390K. Formula: $x^2 + y^2$ and $2 + 2 = 4$.'}
      </Markdown>,
    )

    expect(html).toContain('$1,234.56')
    expect(html).toContain('$390K')
    expect(html.match(/class="katex"/g)).toHaveLength(2)
  })

  it('preserves display math and leaves dollar signs in inline code alone', function () {
    const html = renderToStaticMarkup(
      <Markdown>
        {'Use `$10` literally; price $20, or display $$E=mc^2$$.'}
      </Markdown>,
    )

    expect(html).toContain('$10')
    expect(html).toContain('$20')
    expect(html.match(/class="katex"/g)).toHaveLength(1)
  })

  it.each([
    'Plans are $10/month and $20/month',
    'Plans are "$10" and "$20"',
    "Plans are '$10' and '$20'",
    'Plans are $10/day and $20/year; formula: $2 + 2 = 4$',
  ])('keeps quoted prices and prices with units literal: %s', function (text) {
    const html = renderToStaticMarkup(<Markdown>{text}</Markdown>)

    expect(html).toContain('$10')
    expect(html).toContain('$20')
    expect(html.match(/class="katex"/g) ?? []).toHaveLength(
      text.includes('formula:') ? 1 : 0,
    )
  })

  it.each([
    '~~~sh\necho $10\n~~~',
    '~~~sh\necho $10',
    '    echo $10',
    '\techo $10',
    '> ~~~sh\n> echo $10\n> ~~~',
    '- example:\n\n      echo $10',
    '````sh\necho $10\n```\n````',
  ])('preserves currency inside Markdown code blocks: %s', function (code) {
    const html = renderToStaticMarkup(
      <Markdown>{code + '\n\nPlans cost $20/month and $30/month.'}</Markdown>,
    )

    expect(html).toContain('echo $10')
    expect(html).not.toContain('echo \\$10')
    expect(html).not.toContain('class="katex"')
  })
})
