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

it('preserves animated GIF bytes and their MIME type', async function () {
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(function createObjectURL() {
      return 'blob:animated-gif'
    }),
    revokeObjectURL: vi.fn(function revokeObjectURL() {}),
  })
  const onFileSelect = vi.fn()
  const view = render(<AttachmentButton onFileSelect={onFileSelect} />)
  const input = view.container.querySelector('input[type="file"]')
  if (!input) throw new Error('Attachment file input was not rendered')
  const gif = new File(['animated-gif'], 'animation.gif', { type: 'image/gif' })
  fireEvent.change(input, { target: { files: [gif] } })

  await waitFor(function selectedGif() {
    expect(onFileSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        file: gif,
        base64: btoa('animated-gif'),
      }),
    )
  })
  expect(toBlob).not.toHaveBeenCalled()
})

it('uses the MIME type of the actual canvas output', async function () {
  class TestImage {
    width = 800
    height = 600
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      this.onload?.()
    }
  }

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
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    function encode(callback) {
      callback(new Blob(['encoded'], { type: 'image/png' }))
    },
  )

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
        file: expect.objectContaining({ type: 'image/png' }),
        base64: btoa('encoded'),
      }),
    )
  })
})

it('keeps WebP compression output labeled as JPEG', async function () {
  class TestImage {
    width = 800
    height = 600
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      this.onload?.()
    }
  }

  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
  vi.stubGlobal('Image', TestImage)
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(function createObjectURL() {
      return 'blob:webp-image'
    }),
    revokeObjectURL: vi.fn(function revokeObjectURL() {}),
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  toBlob.mockImplementation(function encode(callback) {
    callback(new Blob(['encoded-webp'], { type: 'image/jpeg' }))
  })

  const onFileSelect = vi.fn()
  const view = render(<AttachmentButton onFileSelect={onFileSelect} />)
  const input = view.container.querySelector('input[type="file"]')
  if (!input) throw new Error('Attachment file input was not rendered')
  fireEvent.change(input, {
    target: {
      files: [new File(['input'], 'photo.webp', { type: 'image/webp' })],
    },
  })

  await waitFor(function selectedImage() {
    expect(onFileSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({
          name: 'photo.webp',
          type: 'image/jpeg',
        }),
        base64: btoa('encoded-webp'),
      }),
    )
  })
  expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.75)
})

it('discards a compression result after the composer generation changes', async function () {
  class TestImage {
    width = 800
    height = 600
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      this.onload?.()
    }
  }

  let currentGeneration = 1
  let finishEncoding: BlobCallback | undefined
  const isSelectionCurrent = vi.fn(function isSelectionCurrent(
    generation: number,
  ) {
    return generation === currentGeneration
  })
  const createObjectURL = vi.fn(function createObjectURL() {
    return 'blob:test-image'
  })
  const revokeObjectURL = vi.fn(function revokeObjectURL() {})
  vi.stubGlobal('Image', TestImage)
  vi.stubGlobal('URL', {
    createObjectURL,
    revokeObjectURL,
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    function encode(callback) {
      finishEncoding = callback
    },
  )

  const onFileSelect = vi.fn()
  const view = render(
    <AttachmentButton
      onFileSelect={onFileSelect}
      selectionGeneration={1}
      isSelectionCurrent={isSelectionCurrent}
    />,
  )
  const input = view.container.querySelector('input[type="file"]')
  if (!input) throw new Error('Attachment file input was not rendered')
  fireEvent.change(input, {
    target: {
      files: [new File(['input'], 'photo.jpg', { type: 'image/jpeg' })],
    },
  })

  await waitFor(function startedEncoding() {
    expect(finishEncoding).toEqual(expect.any(Function))
  })
  currentGeneration += 1
  finishEncoding?.(new Blob(['encoded'], { type: 'image/jpeg' }))
  await waitFor(function completedCompression() {
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-image')
    expect(isSelectionCurrent).toHaveBeenCalledWith(1)
  })

  expect(onFileSelect).not.toHaveBeenCalled()
  expect(createObjectURL).toHaveBeenCalledTimes(1)
})
