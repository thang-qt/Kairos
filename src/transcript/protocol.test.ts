import { describe, expect, it } from 'vitest'
import { initialState, reduceTranscript } from './protocol'

describe('native transcript bridge reducer', function () {
  it('replaces conversations, appends and streams without changing other rows', function () {
    const user = { id: 'u', role: 'user' as const, text: 'Hello' }
    const initialized = reduceTranscript(initialState, {
      type: 'init',
      theme: { palette: 'mist', mode: 'dark' },
      insets: { top: 48, bottom: 120 },
      messages: [user],
    })
    const appended = reduceTranscript(initialized, {
      type: 'append',
      message: { id: 'a', role: 'assistant', text: '', streaming: true },
    })
    const delta = reduceTranscript(appended, {
      type: 'delta',
      id: 'a',
      text: 'A token',
    })
    const secondDelta = reduceTranscript(delta, {
      type: 'delta',
      id: 'a',
      text: ' and another',
    })
    const done = reduceTranscript(secondDelta, { type: 'done', id: 'a' })
    expect(done.messages[1]).toEqual({
      id: 'a',
      role: 'assistant',
      text: 'A token and another',
      streaming: false,
    })
    expect(done.messages[0]).toBe(user)
    expect(appended.messages[1].text).toBe('')
    expect(done.theme).toEqual({ palette: 'mist', mode: 'dark' })
    expect(done.insets.bottom).toBe(120)
    expect(
      reduceTranscript(done, { type: 'init', ...initialState }).messages,
    ).toEqual([])
  })
  it('keeps image metadata on a sent user bubble through streaming and clears it on conversation replacement', function () {
    const attachment = {
      url: 'https://appassets.androidplatform.net/screens/random.jpg',
      width: 486,
      height: 1080,
    }
    const user = {
      id: 'screen-user',
      role: 'user' as const,
      text: 'Explain this screen',
      attachment,
    }
    const appended = reduceTranscript(initialState, {
      type: 'append',
      message: user,
    })
    const streaming = reduceTranscript(appended, {
      type: 'append',
      message: { id: 'reply', role: 'assistant', text: '', streaming: true },
    })
    const delta = reduceTranscript(streaming, {
      type: 'delta',
      id: 'reply',
      text: 'Mock acknowledgement',
    })
    expect(
      reduceTranscript(delta, { type: 'done', id: 'reply' }).messages[0],
    ).toBe(user)
    expect(delta.messages[0].attachment).toEqual(attachment)
    expect(
      reduceTranscript(delta, { type: 'init', ...initialState }).messages,
    ).toEqual([])
  })
  it('ignores unknown ids and applies theme/inset changes without losing history', function () {
    const state = {
      ...initialState,
      messages: [{ id: 'u', role: 'user' as const, text: 'Keep' }],
    }
    expect(
      reduceTranscript(state, { type: 'delta', id: 'missing', text: 'x' })
        .messages,
    ).toEqual(state.messages)
    const themed = reduceTranscript(state, {
      type: 'theme',
      palette: 'tide',
      mode: 'dark',
    })
    expect(
      reduceTranscript(themed, { type: 'insets', top: 88, bottom: 300 }),
    ).toEqual({
      ...state,
      theme: { palette: 'tide', mode: 'dark' },
      insets: { top: 88, bottom: 300 },
    })
  })
})
