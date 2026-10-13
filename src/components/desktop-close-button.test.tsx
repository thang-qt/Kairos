// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopCloseButton } from './desktop-close-button'
import { getDesktopBridge, isDesktopShell } from '@/lib/desktop-bridge'

afterEach(function resetDesktopBridge() {
  cleanup()
  Reflect.deleteProperty(window, 'kairosDesktop')
})

describe('DesktopCloseButton', function () {
  it('leaves the web app without a window control', function () {
    expect(getDesktopBridge()).toBeUndefined()
    expect(isDesktopShell()).toBe(false)
    const view = render(<DesktopCloseButton />)
    expect(view.container.childElementCount).toBe(0)
    expect(screen.queryByRole('button', { name: 'Close window' })).toBeNull()
  })

  it('shows Close in the desktop shell and invokes its bridge', function () {
    const closeWindow = vi.fn().mockResolvedValue(undefined)
    window.kairosDesktop = {
      platform: 'linux',
      isDesktop: true,
      hidePopup: vi.fn().mockResolvedValue(undefined),
      openMain: vi.fn().mockResolvedValue(undefined),
      closeWindow,
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
    }
    expect(isDesktopShell()).toBe(true)
    render(<DesktopCloseButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }))
    expect(closeWindow).toHaveBeenCalledOnce()
  })
})
