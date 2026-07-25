// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatScrollControl } from './use-chat-scroll-control'
import type { GatewayMessage } from '../types'

function createMessages(count: number): Array<GatewayMessage> {
  return Array.from({ length: count }, function createMessage(_, index) {
    return {
      id: `message-${index}`,
      role: 'user',
      content: [{ type: 'text', text: String(index) }],
    }
  })
}

afterEach(function restoreAnimationFrames() {
  vi.restoreAllMocks()
})

describe('useChatScrollControl message visibility', function () {
  it('keeps expanded history mounted when messages append to the same session', function () {
    const lastUserRef = {
      current: null,
    } as React.MutableRefObject<HTMLDivElement | null>
    const { result, rerender } = renderHook(
      ({ messages, sessionKey }) =>
        useChatScrollControl({
          displayMessages: messages,
          loading: false,
          pinToTop: true,
          sessionKey,
          headerHeight: 0,
          lastUserRef,
        }),
      {
        initialProps: {
          messages: createMessages(40),
          sessionKey: 'session-a',
        },
      },
    )

    act(function expandHistory() {
      result.current.setVisibleCount(40)
    })
    rerender({ messages: createMessages(41), sessionKey: 'session-a' })

    expect(result.current.visibleCount).toBe(41)

    rerender({ messages: createMessages(41), sessionKey: 'session-b' })

    expect(result.current.visibleCount).toBe(30)
  })

  it('realigns a target in the following frame after post-render layout changes', function () {
    const frames: Array<FrameRequestCallback> = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
      function requestAnimationFrame(callback) {
        frames.push(callback)
        return frames.length
      },
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(
      function cancelAnimationFrame() {},
    )

    const viewport = document.createElement('div')
    const target = document.createElement('div')
    target.dataset.messageItem = ''
    target.dataset.messageId = 'message-0'
    viewport.append(target)
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      value: () => ({ top: 0 }),
    })
    let targetTop = 100
    Object.defineProperty(target, 'getBoundingClientRect', {
      value: () => ({ top: targetTop }),
    })
    const onTargetMessageReached = vi.fn()
    const lastUserRef = {
      current: null,
    } as React.MutableRefObject<HTMLDivElement | null>
    const { result } = renderHook(() =>
      useChatScrollControl({
        displayMessages: createMessages(1),
        loading: false,
        pinToTop: true,
        sessionKey: 'session-a',
        targetMessageId: 'message-0',
        headerHeight: 10,
        lastUserRef,
        onTargetMessageReached,
      }),
    )

    act(function attachViewport() {
      result.current.handleViewportNodeChange(viewport)
    })
    expect(frames).toHaveLength(1)

    act(function runInitialTargetAlignment() {
      frames.shift()?.(0)
    })
    expect(viewport.scrollTop).toBe(78)
    expect(onTargetMessageReached).toHaveBeenCalledOnce()
    expect(frames).toHaveLength(1)

    targetTop = 150
    act(function runPostRenderRealignment() {
      frames.shift()?.(0)
    })
    expect(viewport.scrollTop).toBe(206)
    expect(onTargetMessageReached).toHaveBeenCalledOnce()
  })

  it('preserves the pinned viewport when a streamed response becomes terminal', function () {
    const frames: Array<FrameRequestCallback> = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
      function requestAnimationFrame(callback) {
        frames.push(callback)
        return frames.length
      },
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(
      function cancelAnimationFrame() {},
    )
    const viewport = document.createElement('div')
    Object.defineProperties(viewport, {
      clientHeight: { value: 300 },
      scrollHeight: { value: 900 },
      scrollTop: { value: 120, writable: true },
    })
    const lastUser = document.createElement('div')
    Object.defineProperty(lastUser, 'getBoundingClientRect', {
      value: () => ({ top: 20, height: 40 }),
    })
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      value: () => ({ top: 0 }),
    })
    const lastUserRef = {
      current: lastUser,
    } as React.MutableRefObject<HTMLDivElement | null>
    const streamingMessages = createMessages(2)
    streamingMessages[1] = {
      id: 'assistant-1',
      role: 'assistant',
      content: [{ type: 'text', text: 'streaming' }],
      __streamRunId: 'run-1',
    }
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useChatScrollControl({
          displayMessages: messages,
          loading: false,
          pinToTop: true,
          sessionKey: 'throwaway',
          headerHeight: 0,
          slicedLastUserIndex: 0,
          lastUserRef,
        }),
      {
        initialProps: {
          messages: streamingMessages,
        },
      },
    )

    act(function attachViewport() {
      result.current.handleViewportNodeChange(viewport)
    })
    act(function applyInitialPin() {
      frames.shift()?.(0)
    })
    const pinnedScrollTop = viewport.scrollTop

    rerender({
      messages: streamingMessages.map(function finishMessage(message) {
        return { ...message, __streamRunId: null }
      }),
    })
    act(function runAnyCompletionFrames() {
      while (frames.length > 0) {
        frames.shift()?.(0)
      }
    })

    expect(viewport.scrollTop).toBe(pinnedScrollTop)
    expect(viewport.scrollTop).not.toBe(600)
  })
})
