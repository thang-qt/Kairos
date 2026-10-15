import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isHotkeyAction } from './hotkey-policy.js'

test('hotkey actions are an allowlist', function () {
  assert.equal(isHotkeyAction('show'), true)
  assert.equal(isHotkeyAction('new-chat'), true)
  assert.equal(isHotkeyAction('quit'), false)
})
