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
})
