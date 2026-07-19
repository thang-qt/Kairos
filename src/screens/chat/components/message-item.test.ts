import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MessageItem,
  assistantPartRenderOrder,
  mapStandaloneToolResultToToolPart,
  modelFromMessage,
} from './message-item'
import {
  mapToolCallToToolPart,
  toolChainMessagesSignature,
} from './message-item-utils'
import type { GatewayMessage } from '../types'

const modelLabelById = new Map([
  ['kairos-code', 'Kairos Code'],
  ['gpt-4.1', 'GPT-4.1'],
])

describe('assistantPartRenderOrder', function () {
  it('keeps assistant content order from message parts', function () {
    const message: GatewayMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'first' },
        { type: 'text', text: 'second' },
        {
          type: 'toolCall',
          id: 'functions.read:17',
          name: 'read',
          arguments: { file_path: '/tmp/a.md' },
        },
        { type: 'text', text: 'third' },
      ],
    }

    expect(assistantPartRenderOrder(message, true, true)).toEqual([
      'thinking',
      'text',
      'toolCall',
      'text',
    ])
  })

  it('ignores image content when classifying assistant render parts', function () {
    const message: GatewayMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'first' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'abc',
          },
        },
        {
          type: 'toolCall',
          id: 'functions.read:17',
          name: 'read',
        },
      ],
    }

    expect(assistantPartRenderOrder(message, true, true)).toEqual([
      'text',
      'toolCall',
    ])
  })
})

describe('toolChainMessagesSignature', function () {
  it('changes when intermediate assistant prose changes', function () {
    const first: GatewayMessage = {
      id: 'round-1',
      role: 'assistant',
      runId: 'run-1',
      content: [
        { type: 'text', text: 'I will search first.' },
        { type: 'toolCall', id: 'call-1', name: 'web_search' },
      ],
    }
    const second: GatewayMessage = {
      ...first,
      content: [
        { type: 'text', text: 'I will search a different thing.' },
        { type: 'toolCall', id: 'call-1', name: 'web_search' },
      ],
    }

    expect(toolChainMessagesSignature([first], undefined)).not.toBe(
      toolChainMessagesSignature([second], undefined),
    )
  })
})

describe('Hermes tool progress', function () {
  it('shows a running remote tool as processing', function () {
    expect(
      mapToolCallToToolPart(
        {
          type: 'toolCall',
          id: 'call-hermes',
          name: 'terminal',
          arguments: { label: 'pwd' },
          emoji: '💻',
          status: 'running',
        },
        undefined,
      ),
    ).toMatchObject({
      type: 'terminal',
      state: 'input-streaming',
      input: { label: 'pwd' },
      emoji: '💻',
    })
  })
})

describe('mapStandaloneToolResultToToolPart', function () {
  it('maps text-only toolResult content to visible output', function () {
    const message: GatewayMessage = {
      role: 'toolResult',
      toolCallId: 'functions.read:9',
      toolName: 'read',
      isError: false,
      content: [{ type: 'text', text: 'file contents' }],
      timestamp: 1,
    }

    expect(mapStandaloneToolResultToToolPart(message)).toEqual({
      type: 'read',
      state: 'output-available',
      output: { text: 'file contents' },
      toolCallId: 'functions.read:9',
      errorText: undefined,
    })
  })
})

describe('modelFromMessage', function () {
  it('prefers the explicit model name when present', function () {
    const message: GatewayMessage = {
      role: 'assistant',
      model: 'kairos-balanced',
      modelName: 'Kairos Balanced',
    }

    expect(modelFromMessage(message, modelLabelById)).toBe('Kairos Balanced')
  })

  it('falls back to the current model label when modelName is only the raw id', function () {
    const message: GatewayMessage = {
      role: 'assistant',
      model: 'kairos-code',
      modelName: 'kairos-code',
    }

    expect(modelFromMessage(message, modelLabelById)).toBe('Kairos Code')
  })

  it('uses nested model metadata before falling back to the id', function () {
    const message: GatewayMessage = {
      role: 'assistant',
      model: 'gpt-4.1',
      details: {
        model: {
          id: 'gpt-4.1',
          name: 'GPT-4.1',
        },
      },
    }

    expect(modelFromMessage(message, modelLabelById)).toBe('GPT-4.1')
  })

  it('uses server-loaded model labels before falling back to the id', function () {
    const message: GatewayMessage = {
      role: 'assistant',
      model: 'kairos-code',
    }

    expect(modelFromMessage(message, modelLabelById)).toBe('Kairos Code')
  })
})

describe('MessageItem', function () {
  it('renders an ungrouped tool turn naturally', function () {
    const message: GatewayMessage = {
      role: 'assistant',
      model: 'gpt-4.1',
      content: [
        { type: 'text', text: 'I will check that.' },
        {
          type: 'toolCall',
          id: 'call-1',
          name: 'math_eval',
          arguments: { expr: '2 + 2' },
        },
        { type: 'text', text: 'Next, I will verify another value.' },
        {
          type: 'toolCall',
          id: 'call-2',
          name: 'math_eval',
          arguments: { expr: '3 + 3' },
        },
      ],
    }
    const toolResultsByCallId = new Map<string, GatewayMessage>([
      [
        'call-1',
        {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'math_eval',
          content: [{ type: 'text', text: '4' }],
        },
      ],
      [
        'call-2',
        {
          role: 'toolResult',
          toolCallId: 'call-2',
          toolName: 'math_eval',
          content: [{ type: 'text', text: '6' }],
        },
      ],
    ])

    const html = renderToStaticMarkup(
      React.createElement(MessageItem, {
        message,
        toolResultsByCallId,
        modelLabelById,
      }),
    )

    expect(html).toContain('GPT-4.1')
    expect(html).toContain('Calculating: 2 + 2')
    expect(html).toContain('Calculating: 3 + 3')
  })

  it('preserves user message line breaks in the rendered bubble', function () {
    const message: GatewayMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'first line\nsecond line' }],
    }

    const html = renderToStaticMarkup(
      React.createElement(MessageItem, {
        message,
        modelLabelById: new Map(),
      }),
    )

    expect(html).toContain('whitespace-pre-wrap')
    expect(html).toContain('first line\nsecond line')
  })
})
