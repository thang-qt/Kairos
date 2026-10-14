import { describe, expect, it } from 'vitest'
import { parseHotkey, rawHotkeyToParsedHotkey } from '@tanstack/react-hotkeys'
import { isMacPlatform, shortcutKeys, shortcutRegistry } from './shortcuts'
import { lastFencedCodeBlock } from './shortcuts-code'

it('has unique ids and no overlapping bindings in either platform', function () {
  expect(
    new Set(
      shortcutRegistry.map(function id(entry) {
        return entry.id
      }),
    ).size,
  ).toBe(shortcutRegistry.length)
  for (const platform of ['mac', 'windows'] as const) {
    const seen = new Map<string, string>()
    for (const entry of shortcutRegistry) {
      for (const binding of entry.bindings) {
        const parsed =
          typeof binding.hotkey === 'string'
            ? parseHotkey(binding.hotkey, platform)
            : rawHotkeyToParsedHotkey(binding.hotkey, platform)
        // All scopes coexist on the chat screen, so verify across scopes too.
        const key = JSON.stringify(parsed)
        expect(
          seen.get(key),
          `${entry.id} duplicates ${seen.get(key)}`,
        ).toBeUndefined()
        seen.set(key, entry.id)
      }
    }
  }
})

it('detects macOS and renders platform-specific modifiers', function () {
  expect(isMacPlatform('MacIntel')).toBe(true)
  expect(isMacPlatform('Linux x86_64')).toBe(false)
  expect(isMacPlatform('Win32')).toBe(false)
  expect(shortcutKeys(['Mod', 'Alt', 'Shift', 'M'], 'mac')).toEqual([
    '⌘',
    '⌥',
    '⇧',
    'M',
  ])
  expect(shortcutKeys(['Mod', 'Alt', 'Shift', 'M'], 'other')).toEqual([
    'Ctrl',
    'Alt',
    'Shift',
    'M',
  ])
})

describe('last fenced code block', function () {
  it('takes the last block, excluding the language and fences', function () {
    expect(
      lastFencedCodeBlock('```js\nfirst\n```\ntext\n~~~go\nlast\n~~~'),
    ).toBe('last')
  })
  it('handles longer fences, embedded fences, indentation and unfinished blocks', function () {
    expect(lastFencedCodeBlock('  ````md\n  ```\n  inner\n  ```\n  ````')).toBe(
      '```\ninner\n```',
    )
    expect(lastFencedCodeBlock('```js\npartial')).toBe('partial')
    expect(lastFencedCodeBlock('plain `inline` text')).toBeNull()
  })
})
