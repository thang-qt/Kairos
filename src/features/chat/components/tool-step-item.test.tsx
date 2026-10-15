import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ToolStepItem,
  isPendingWebStep,
  toolStepFromPart,
} from './tool-step-item'
import type { ConversationTurn, ToolCallContent } from '../types'

function webStep(webTools: Array<Record<string, unknown>>) {
  const message: ConversationTurn = {
    role: 'assistant',
    content: [],
    details: { webTools },
  }
  return { kind: 'web' as const, key: 'web', message }
}

function count(html: string, text: string) {
  return html.split(text).length - 1
}

it('names a single read page once, as a host link', function singlePage() {
  const html = renderToStaticMarkup(
    <ToolStepItem
      step={webStep([
        {
          id: 'fetch-1',
          name: 'web_fetch',
          arguments: { url: 'https://thenewstack.io/rsc' },
          result: {
            url: 'https://thenewstack.io/rsc',
            title: 'The Problems With React Server Components',
            text: 'Server components move rendering to the server.',
          },
        },
      ])}
    />,
  )
  expect(html).toContain('Read The Problems With React Server Components')
  expect(count(html, '>thenewstack.io<')).toBe(1)
  expect(html).toContain('href="https://thenewstack.io/rsc"')
  expect(html).toContain('Details')
})

it('keeps source chips for searches', function search() {
  const html = renderToStaticMarkup(
    <ToolStepItem
      step={webStep([
        {
          id: 'search-1',
          name: 'web_search',
          arguments: { query: 'react server components' },
          result: {
            results: [
              { url: 'https://react.dev/rsc', title: 'RSC' },
              { url: 'https://thenewstack.io/rsc', title: 'Problems' },
            ],
          },
        },
      ])}
    />,
  )
  expect(html).toContain('Searched “react server components”')
  expect(html).toContain('>react.dev<')
  expect(html).toContain('>thenewstack.io<')
})

it('holds back a web call the backend marks as running', function running() {
  const message: ConversationTurn = {
    role: 'assistant',
    status: 'running',
    content: [
      {
        type: 'toolCall',
        id: 'search-1',
        name: 'web_search',
        arguments: { query: 'state of react' },
        status: 'running',
      },
    ],
  }
  const part = (message.content ?? [])[0] as ToolCallContent
  const step = toolStepFromPart(part, 0, message)
  expect(step.kind).toBe('web')
  expect(isPendingWebStep(step)).toBe(true)
})
