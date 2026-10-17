import { describe, expect, it } from 'vitest'
import { initialState, reduceTranscript } from './protocol'
import type { ConversationTurn } from '@/features/chat/types'

describe('native transcript bridge reducer', function () {
  it('inserts and replaces real turns without changing sibling rows', function () {
    const user: ConversationTurn = {
      id: 'u',
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
    }
    const state = reduceTranscript(initialState, {
      type: 'init',
      ...initialState,
      sessionId: 'session',
      messages: [user],
    })
    const running: ConversationTurn = {
      id: 'a',
      role: 'assistant',
      status: 'running',
      steps: [],
      content: [
        { type: 'thinking', thinking: 'Reason' },
        { type: 'text', text: 'Answer', phase: 'final_answer' },
      ],
    }
    const appended = reduceTranscript(state, {
      type: 'upsert',
      message: running,
    })
    const final = { ...running, status: 'completed' }
    const done = reduceTranscript(appended, { type: 'upsert', message: final })
    expect(done.messages).toEqual([user, final])
    expect(done.messages[0]).toBe(user)
    expect(appended.messages[1]).toBe(running)
    expect(done.sessionId).toBe('session')
    expect(
      reduceTranscript(done, { type: 'remove', id: 'a' }).messages,
    ).toEqual([user])
    expect(
      reduceTranscript(done, { type: 'init', ...initialState }).messages,
    ).toEqual([])
  })
  it('updates MCP labels without replacing messages and clears labels for a new identity', function () {
    const message: ConversationTurn = { id: 'a', role: 'assistant' }
    const state = reduceTranscript(initialState, { type: 'upsert', message })
    const labeled = reduceTranscript(state, {
      type: 'tool-labels',
      labels: { mcp_alias: 'Files · read_file' },
    })
    expect(labeled.toolLabels.mcp_alias).toBe('Files · read_file')
    expect(labeled.messages).toBe(state.messages)
    expect(
      reduceTranscript(labeled, { type: 'init', ...initialState }).toolLabels,
    ).toEqual({})
  })
  it('preserves base64 image parts and unknown turn fields while updating only the assistant', function () {
    const user: ConversationTurn = {
      id: 'u',
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' },
        },
      ],
      extra: { untouched: true },
    }
    const state = reduceTranscript(initialState, {
      type: 'upsert',
      message: user,
    })
    const streamed = reduceTranscript(state, {
      type: 'upsert',
      message: { id: 'a', role: 'assistant', status: 'aborted' },
    })
    expect(streamed.messages[0]).toBe(user)
    expect(
      reduceTranscript(streamed, {
        type: 'theme',
        palette: 'tide',
        mode: 'dark',
      }).messages,
    ).toBe(streamed.messages)
    expect(
      reduceTranscript(streamed, { type: 'insets', top: 88, bottom: 300 })
        .insets,
    ).toEqual({ top: 88, bottom: 300 })
    expect(
      reduceTranscript(streamed, { type: 'remove', id: 'missing' }).messages,
    ).toEqual(streamed.messages)
  })
  it('preserves top anchoring through streaming updates and terminal output', function () {
    const state = reduceTranscript(initialState, {
      type: 'init',
      ...initialState,
      scrollPolicy: 'top',
      messages: [
        { id: 'a', role: 'assistant', status: 'running', content: [] },
      ],
    })
    const done = reduceTranscript(state, {
      type: 'upsert',
      message: {
        id: 'a',
        role: 'assistant',
        status: 'completed',
        __streamRunId: null,
        content: [
          { type: 'text', text: 'Finished answer', phase: 'final_answer' },
        ],
      },
    })
    expect(done.scrollPolicy).toBe('top')
    expect(done.messages[0]?.status).toBe('completed')
    expect(done.messages[0]?.content).toEqual([
      { type: 'text', text: 'Finished answer', phase: 'final_answer' },
    ])
    expect(
      reduceTranscript(done, { type: 'scroll-policy', policy: 'bottom' })
        .scrollPolicy,
    ).toBe('bottom')
  })
  it('updates overlay presentation without replacing streaming messages', function () {
    const next = reduceTranscript(initialState, {
      type: 'presentation',
      showModel: false,
      showActivity: false,
    })
    expect(next.presentation).toEqual({ showModel: false, showActivity: false })
    expect(next.messages).toBe(initialState.messages)
    expect(initialState.presentation).toEqual({
      showModel: true,
      showActivity: true,
    })
  })
})
