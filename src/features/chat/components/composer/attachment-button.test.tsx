// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AttachmentButton } from './attachment-button'

afterEach(function reset() {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('uses asynchronous JPEG encoding and lowers quality until the image fits', async function () {
  class TestImage {
    width = 1600
    height = 800
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      this.onload?.()
    }
  }

  const toBlob = vi.fn(function encode(
    callback: BlobCallback,
    type?: string,
    quality?: number,
  ) {
    const size = quality === 0.75 ? 350 * 1024 : 240 * 1024
    callback(new Blob([new Uint8Array(size)], { type }))
  })
  vi.stubGlobal('Image', TestImage)
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(function createObjectURL() {
      return 'blob:test-image'
    }),
    revokeObjectURL: vi.fn(function revokeObjectURL() {}),
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob)

  const onFileSelect = vi.fn()
  const view = render(<AttachmentButton onFileSelect={onFileSelect} />)
  const input = view.container.querySelector('input[type="file"]')
  if (!input) throw new Error('Attachment file input was not rendered')
  fireEvent.change(input, {
    target: {
      files: [new File(['input'], 'photo.jpg', { type: 'image/jpeg' })],
    },
  })

  await waitFor(function selectedImage() {
    expect(onFileSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'image',
        base64: expect.any(String),
      }),
    )
  })
  expect(toBlob).toHaveBeenNthCalledWith(
    1,
    expect.any(Function),
    'image/jpeg',
    0.75,
  )
  expect(toBlob).toHaveBeenNthCalledWith(
    2,
    expect.any(Function),
    'image/jpeg',
    0.65,
  )
})
