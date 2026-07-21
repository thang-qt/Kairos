import { beforeEach, describe, expect, it } from 'vitest'

import {
  beginFreshNewChat,
  defaultConversationSettings,
  mergeConversationSettings,
  useConversationSettingsStore,
} from './conversation-settings'

describe('conversation settings', function () {
  beforeEach(function resetNewConversationSettings() {
    useConversationSettingsStore.setState({
      settings: defaultConversationSettings,
    })
  })

  it('keeps new-conversation settings in memory and resets only its model', function () {
    useConversationSettingsStore.getState().updateSettings({
      model: 'provider/model-a',
      systemPrompt: 'keep this',
      webSearch: false,
    })

    beginFreshNewChat()

    expect(useConversationSettingsStore.getState().settings).toMatchObject({
      model: '',
      systemPrompt: 'keep this',
      webSearch: false,
    })
  })

  it('merges advanced settings without losing unchanged preferences', function () {
    const settings = mergeConversationSettings(defaultConversationSettings, {
      advanced: { ...defaultConversationSettings.advanced, temperature: 1.2 },
    })

    expect(settings.advanced).toMatchObject({
      temperature: 1.2,
      reasoningEffort: 'medium',
      topP: 1,
    })
  })
})
