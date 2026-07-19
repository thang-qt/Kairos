import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  beginFreshNewChat,
  clearConversationModelOverride,
  copyConversationSettings,
  defaultConversationSettings,
  useConversationSettingsStore,
} from './conversation-settings'

describe('conversation settings model override', function () {
  beforeEach(function resetStore() {
    vi.spyOn(console, 'error').mockImplementation(
      function ignorePersistWarning() {},
    )
    vi.spyOn(console, 'warn').mockImplementation(
      function ignorePersistWarning() {},
    )
    useConversationSettingsStore.setState({ conversations: {} })
  })

  afterEach(function restoreConsole() {
    vi.restoreAllMocks()
  })

  it('clears only the model override for a fresh new chat', function () {
    useConversationSettingsStore.getState().updateConversationSettings('new', {
      model: 'provider/model-a',
      systemPrompt: 'keep this',
      webSearch: false,
    })

    beginFreshNewChat()

    expect(
      useConversationSettingsStore.getState().conversations.new,
    ).toMatchObject({
      model: '',
      systemPrompt: 'keep this',
      webSearch: false,
    })
  })

  it('preserves copied pending model for created sessions before clearing new', function () {
    useConversationSettingsStore.getState().updateConversationSettings('new', {
      model: 'provider/model-a',
      systemPrompt: 'draft prompt',
    })

    copyConversationSettings('new', 'created-chat')
    clearConversationModelOverride('new')

    expect(
      useConversationSettingsStore.getState().conversations['created-chat']
        .model,
    ).toBe('provider/model-a')
    expect(
      useConversationSettingsStore.getState().conversations.new.model,
    ).toBe('')
  })

  it('does not clear existing session model settings', function () {
    useConversationSettingsStore
      .getState()
      .updateConversationSettings('existing-chat', {
        model: 'provider/model-a',
      })

    clearConversationModelOverride('new')

    expect(
      useConversationSettingsStore.getState().conversations['existing-chat']
        .model,
    ).toBe('provider/model-a')
    expect(defaultConversationSettings.model).toBe('')
  })
})
