import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MessageItem,
  assistantPartRenderOrder,
  mapStandaloneToolResultToToolPart,
  modelFromMessage,
  areMessagesEqual,
} from './message-item'
import {
  splitAssistantActivity,
  mapToolCallToToolPart,
  showsLiveActivity,
} from './message-item-utils'
import { LiveActivity } from './live-activity'
import { ActivitySidebar } from './activity-sidebar'
import type { ConversationTurn } from '../types'

const modelLabelById = new Map([
  ['kairos-code', 'Kairos Code'],
  ['gpt-4.1', 'GPT-4.1'],
])

describe('assistantPartRenderOrder', function () {
  it('shows MCP response content instead of execution metadata', function () {
    const result: ConversationTurn = {
      role: 'toolResult',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            content: [{ type: 'text', text: 'Earth diameter: 12,742 km' }],
          }),
        },
      ],
      details: {
        mcpServer: 'WolframAlpha',
        mcpTool: 'WolframAlpha',
        approvalId: 'approval',
        durationMs: 5476,
      },
    }
    const tool = mapToolCallToToolPart(
      {
        type: 'toolCall',
        id: 'call',
        name: 'mcp_wolfram',
        arguments: { query: 'diameter of Earth' },
      },
      result,
    )
    expect(tool.output).toEqual({
      content: [{ type: 'text', text: 'Earth diameter: 12,742 km' }],
    })
    expect(tool.input).toEqual({ query: 'diameter of Earth' })
    expect(mapStandaloneToolResultToToolPart(result).output).toEqual(
      tool.output,
    )
  })
  it('keeps assistant content order from message parts', function () {
    const message: ConversationTurn = {
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
    const message: ConversationTurn = {
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

describe('provider tool progress', function () {
  it('shows a running remote tool as processing', function () {
    expect(
      mapToolCallToToolPart(
        {
          type: 'toolCall',
          id: 'call-provider',
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
    const message: ConversationTurn = {
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
  it('keeps imported model labels independent of configured model labels', function () {
    expect(
      modelFromMessage(
        {
          role: 'assistant',
          model: 'kairos-code',
          modelName: 'kairos-code',
          details: { importSource: 'chatgpt' },
        },
        modelLabelById,
      ),
    ).toBe('kairos-code')
  })
  it('prefers the explicit model name when present', function () {
    const message: ConversationTurn = {
      role: 'assistant',
      model: 'kairos-balanced',
      modelName: 'Kairos Balanced',
    }

    expect(modelFromMessage(message, modelLabelById)).toBe('Kairos Balanced')
  })

  it('falls back to the current model label when modelName is only the raw id', function () {
    const message: ConversationTurn = {
      role: 'assistant',
      model: 'kairos-code',
      modelName: 'kairos-code',
    }

    expect(modelFromMessage(message, modelLabelById)).toBe('Kairos Code')
  })

  it('uses nested model metadata before falling back to the id', function () {
    const message: ConversationTurn = {
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
    const message: ConversationTurn = {
      role: 'assistant',
      model: 'kairos-code',
    }

    expect(modelFromMessage(message, modelLabelById)).toBe('Kairos Code')
  })
})

describe('MessageItem', function () {
  it('renders stored assets through the authenticated API and keeps inline images', function () {
    const message: ConversationTurn = {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'asset',
            media_type: 'image/png',
            assetId: 'asset-id',
          },
        },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'abc' },
        },
      ],
    }
    const html = renderToStaticMarkup(
      React.createElement(MessageItem, { message, modelLabelById }),
    )
    expect(html).toContain('src="/api/assets/asset-id"')
    expect(html).toContain('src="data:image/png;base64,abc"')
  })

  it('moves active tool work into the activity sidebar', function () {
    const message: ConversationTurn = {
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
    const toolResultsByCallId = new Map<string, ConversationTurn>([
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

    const runningMessage = { ...message, status: 'running' }
    const html = renderToStaticMarkup(
      React.createElement(MessageItem, {
        message: runningMessage,
        toolResultsByCallId,
        modelLabelById,
      }),
    )

    expect(html).toContain('GPT-4.1')
    expect(html).toContain('Working…')
    expect(html).not.toContain('Calculating: 2 + 2')

    const activityHtml = renderToStaticMarkup(
      React.createElement(ActivitySidebar, {
        isOpen: true,
        messages: [runningMessage],
        onClose() {},
      }),
    )
    expect(activityHtml).toContain('Calculating: 2 + 2')
    expect(activityHtml).toContain('Calculating: 3 + 3')
  })

  it('shows live activity in the chat until the turn completes', function () {
    const working: ConversationTurn = {
      role: 'assistant',
      status: 'running',
      content: [
        { type: 'text', text: 'I will check that.' },
        {
          type: 'toolCall',
          id: 'call-1',
          name: 'math_eval',
          arguments: { expr: '2 + 2' },
        },
      ],
    }
    const toolResultsByCallId = new Map<string, ConversationTurn>([
      [
        'call-1',
        {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'math_eval',
          content: [{ type: 'text', text: '4' }],
        },
      ],
    ])
    function shows(message: ConversationTurn, enabled = true) {
      return showsLiveActivity(
        message,
        splitAssistantActivity(message, true, true),
        enabled,
      )
    }

    expect(shows(working)).toBe(true)
    expect(shows(working, false)).toBe(false)
    expect(shows({ ...working, status: 'completed' })).toBe(false)
    // The steps stay while the answer streams below them.
    expect(
      shows({
        ...working,
        content: [
          ...(working.content ?? []),
          { type: 'text', text: 'The answer is 4.', phase: 'final_answer' },
        ],
      } as ConversationTurn),
    ).toBe(true)

    const html = renderToStaticMarkup(
      React.createElement(LiveActivity, {
        message: working,
        activityIndexes: splitAssistantActivity(working, true, true)
          .activityIndexes,
        toolResultsByCallId,
      }),
    )
    expect(html).toContain('I will check that.')
    expect(html).toContain('Calculating: 2 + 2')
  })

  it('shows a generating indicator until the first output arrives', function () {
    function render(message: ConversationTurn) {
      return renderToStaticMarkup(
        React.createElement(MessageItem, { message, modelLabelById }),
      )
    }
    expect(
      render({ role: 'assistant', status: 'running', content: [] }),
    ).toContain('Generating')
    expect(
      render({
        role: 'assistant',
        status: 'running',
        content: [{ type: 'text', text: 'Hello' }],
      }),
    ).not.toContain('Generating')
    expect(
      render({ role: 'assistant', status: 'completed', content: [] }),
    ).not.toContain('Generating')
  })

  it('preserves user message line breaks in the rendered bubble', function () {
    const message: ConversationTurn = {
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

  it('keeps assistant actions hidden while its response is streaming', function () {
    const message: ConversationTurn = {
      id: 'assistant-1',
      role: 'assistant',
      __streamRunId: 'run-1',
      content: [{ type: 'text', text: 'Still generating' }],
    }

    const html = renderToStaticMarkup(
      React.createElement(MessageItem, {
        message,
        modelLabelById: new Map(),
        forceActionsVisible: true,
      }),
    )

    expect(html).toContain('data-message-actions-available="false"')
    expect(html).toContain('aria-hidden="true"')
  })
})

describe('areMessagesEqual render boundary', function () {
  it('considers identical messages with identical props as equal', function () {
    const message: ConversationTurn = {
      id: 'm1',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    }
    const modelLabelById = new Map()
    const prevProps = { message, modelLabelById }
    const nextProps = { message, modelLabelById }
    expect(areMessagesEqual(prevProps, nextProps)).toBe(true)
  })

  it('skips deep message signatures for an unchanged turn but checks tool maps', function () {
    const message: ConversationTurn = {
      id: 'm1',
      role: 'assistant',
      content: [{ type: 'text', text: 'x'.repeat(10_000) }],
    }
    const modelLabelById = new Map()
    const toolResultsByCallId = new Map()
    const stringify = vi.spyOn(JSON, 'stringify')

    expect(
      areMessagesEqual(
        { message, modelLabelById, toolResultsByCallId },
        { message, modelLabelById, toolResultsByCallId },
      ),
    ).toBe(true)
    expect(stringify).not.toHaveBeenCalled()
    expect(
      areMessagesEqual(
        { message, modelLabelById, toolResultsByCallId },
        { message, modelLabelById, toolResultsByCallId: new Map() },
      ),
    ).toBe(false)
    stringify.mockRestore()
  })

  it('considers a changed target highlight as not equal', function () {
    const message: ConversationTurn = {
      id: 'm1',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    }
    const modelLabelById = new Map()

    expect(
      areMessagesEqual(
        { message, modelLabelById, isHighlighted: false },
        { message, modelLabelById, isHighlighted: true },
      ),
    ).toBe(false)
  })

  it('considers messages with different text content as not equal', function () {
    const prevMsg: ConversationTurn = {
      id: 'm1',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    }
    const nextMsg: ConversationTurn = {
      id: 'm1',
      role: 'user',
      content: [{ type: 'text', text: 'world' }],
    }
    const modelLabelById = new Map()
    const prevProps = { message: prevMsg, modelLabelById }
    const nextProps = { message: nextMsg, modelLabelById }
    expect(areMessagesEqual(prevProps, nextProps)).toBe(false)
  })

  it('rerenders when an assistant message finishes streaming', function () {
    const streamingMessage: ConversationTurn = {
      id: 'assistant-1',
      role: 'assistant',
      __streamRunId: 'run-1',
      content: [{ type: 'text', text: 'Complete response' }],
    }
    const completedMessage: ConversationTurn = {
      ...streamingMessage,
      __streamRunId: null,
    }
    const modelLabelById = new Map()

    expect(
      areMessagesEqual(
        { message: streamingMessage, modelLabelById },
        { message: completedMessage, modelLabelById },
      ),
    ).toBe(false)
  })
})

describe('canonical lifecycle render boundary', function () {
  it('renders cancellation even when content has not changed', function () {
    const message: ConversationTurn = {
      id: 'turn',
      role: 'assistant',
      status: 'running',
      content: [],
    }
    expect(
      areMessagesEqual(
        { message, modelLabelById: new Map() },
        {
          message: { ...message, status: 'aborted' },
          modelLabelById: new Map(),
        },
      ),
    ).toBe(false)
  })
  it('shows a stopped tool without claiming it has a result', function () {
    const tool = mapToolCallToToolPart(
      { type: 'toolCall', id: 'call', name: 'fake', status: 'aborted' },
      undefined,
    )
    expect(tool.state).toBe('output-error')
    expect(tool.errorText).toBe('No result was saved for this call.')
  })
})

function routed(message: ConversationTurn) {
  const split = splitAssistantActivity(message, true, true)
  return {
    activity: split.activityIndexes,
    answer: [...split.answerIndexes].sort(),
  }
}

describe('assistant message phases', function () {
  it('routes explicit phases immediately and holds only unknown streaming text', function () {
    const message: ConversationTurn = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Searching', phase: 'commentary' },
        { type: 'toolCall', id: 'search', name: 'web_search' },
        { type: 'text', text: 'Yes', phase: 'final_answer' },
        { type: 'text', text: 'Let me check' },
      ],
    }
    expect(routed({ ...message, status: 'running' })).toEqual({
      activity: [0, 1, 3],
      answer: [2],
    })
    expect(routed(message)).toEqual({ activity: [0, 1], answer: [2, 3] })
  })

  it('keeps completed commentary in work while the next round streams', function () {
    const message: ConversationTurn = {
      role: 'assistant',
      status: 'running',
      content: [
        {
          type: 'text',
          text: 'Searching',
          phase: 'commentary',
          phaseSource: 'derived',
        },
        { type: 'toolCall', id: 'search', name: 'web_search' },
        {
          type: 'text',
          text: 'A short answer',
          phase: 'final_answer',
          phaseSource: 'provider',
        },
      ],
    }
    expect(routed(message)).toEqual({ activity: [0, 1], answer: [2] })
  })

  it('preserves legacy history and unknown streaming fallbacks', function () {
    const message: ConversationTurn = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Searching' },
        { type: 'toolCall', id: 'old', name: 'web_search' },
        { type: 'text', text: 'Answer' },
      ],
    }
    expect(routed(message).answer).toEqual([2])
    expect(routed({ ...message, status: 'running' }).answer).toEqual([])
    message.content![2] = {
      type: 'text',
      text: 'A sufficiently clear\nmultiline answer',
    }
    expect(routed({ ...message, status: 'running' }).answer).toEqual([2])
  })
})
