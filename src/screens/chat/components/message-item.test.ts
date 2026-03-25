import { describe, expect, it } from 'vitest'
import {
  assistantPartRenderOrder,
  mapStandaloneToolResultToToolPart,
  modelFromMessage,
} from './message-item'
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
