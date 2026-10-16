'use client'

import { useCallback, useEffect, useRef } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { cn, randomUUID } from '@/lib/utils'

/** Maximum file size before compression (10MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024

/** Maximum dimension (width or height) for resized images */
const MAX_IMAGE_DIMENSION = 1280

/** Initial JPEG compression quality (0-1) */
const IMAGE_QUALITY = 0.75

/**
 * Target compressed image size in bytes (~300KB).
 * WebSocket limit is 512KB, and base64 encoding adds ~33% overhead.
 */
const TARGET_IMAGE_SIZE = 300 * 1024

/** Supported image MIME types */
const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]

/** File extensions accepted by the file input */
const ACCEPTED_EXTENSIONS = '.png,.jpg,.jpeg,.gif,.webp'

/**
 * Represents an image attachment ready to be sent with a message.
 */
export type AttachmentFile = {
  /** Unique identifier for the attachment */
  id: string
  /** File containing the same encoded image data as base64 */
  file: File
  /** Object URL for image preview */
  preview: string | null
  /** Attachment type (always 'image') */
  type: 'image'
  /** Base64-encoded image content (without data URL prefix) */
  base64: string | null
  /** Error message if processing failed */
  error?: string
}

type AttachmentButtonProps = {
  onFileSelect: (file: AttachmentFile) => void
  disabled?: boolean
  buttonProps?: React.ComponentProps<typeof Button>
  selectionGeneration?: number
  isSelectionCurrent?: (generation: number) => boolean
}

function isCurrentSelectionGeneration(): boolean {
  return true
}

/**
 * Checks if Canvas API is available in the current environment.
 */
function isCanvasSupported(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('2d'))
  } catch {
    return false
  }
}

/**
 * Compresses and resizes an image using the Canvas API.
 *
 * - Resizes images larger than MAX_IMAGE_DIMENSION
 * - Converts to JPEG (except PNG which may have transparency)
 * - Progressively reduces quality until under TARGET_IMAGE_SIZE
 *
 * @param file - Image file to compress
 * @returns Base64-encoded compressed image (without data URL prefix)
 * @throws Error if canvas is unavailable or image fails to load
 */
type EncodedImage = {
  file: File
  base64: string
}

async function compressImage(
  file: File,
  signal: AbortSignal,
): Promise<EncodedImage> {
  // Canvas only exposes a still frame, so preserve animated GIF bytes.
  if (file.type === 'image/gif') {
    const dataUrl = await blobToDataUrl(file, signal)
    const base64 = dataUrl.split(',')[1]
    if (!base64) throw new Error('Failed to encode image')
    return { file, base64 }
  }

  if (!isCanvasSupported()) {
    throw new Error('Image compression not available in this browser')
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    let settled = false

    function cleanup() {
      signal.removeEventListener('abort', abort)
      img.onload = null
      img.onerror = null
      URL.revokeObjectURL(objectUrl)
    }

    function finishWithError(error: Error) {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    function abort() {
      finishWithError(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Image processing cancelled.', 'AbortError'),
      )
    }

    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }

    img.onload = async () => {
      try {
        // Calculate new dimensions maintaining aspect ratio
        let width = img.width
        let height = img.height

        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_IMAGE_DIMENSION) / width)
            width = MAX_IMAGE_DIMENSION
          } else {
            width = Math.round((width * MAX_IMAGE_DIMENSION) / height)
            height = MAX_IMAGE_DIMENSION
          }
        }

        // Create canvas and draw resized image
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          finishWithError(new Error('Failed to get canvas context'))
          return
        }

        ctx.drawImage(img, 0, 0, width, height)

        // Use PNG for images that might have transparency, JPEG otherwise
        const outputType =
          file.type === 'image/png' ? 'image/png' : 'image/jpeg'
        let quality = IMAGE_QUALITY

        let blob = await canvasToBlob(canvas, outputType, quality, signal)

        if (outputType === 'image/jpeg') {
          while (blob.size > TARGET_IMAGE_SIZE && quality > 0.3) {
            quality -= 0.1
            blob = await canvasToBlob(canvas, outputType, quality, signal)
          }
        }

        const dataUrl = await blobToDataUrl(blob, signal)
        const base64 = dataUrl.split(',')[1]
        if (!base64) {
          finishWithError(new Error('Failed to encode image'))
          return
        }

        if (signal.aborted) {
          abort()
          return
        }
        settled = true
        cleanup()
        resolve({
          file: new File([blob], file.name, { type: blob.type }),
          base64,
        })
      } catch (err) {
        finishWithError(
          err instanceof Error ? err : new Error('Image compression failed'),
        )
      }
    }

    img.onerror = () => {
      finishWithError(new Error('Failed to load image'))
    }

    img.src = objectUrl
  })
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
  signal: AbortSignal,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false

    function cleanup() {
      signal.removeEventListener('abort', abort)
    }

    function fail(error: Error) {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    function abort() {
      fail(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Image processing cancelled.', 'AbortError'),
      )
    }

    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }
    canvas.toBlob(
      (blob) => {
        if (settled) return
        settled = true
        cleanup()
        if (signal.aborted)
          reject(new DOMException('Image processing cancelled.', 'AbortError'))
        else if (!blob) reject(new Error('Failed to encode image'))
        else resolve(blob)
      },
      mimeType,
      quality,
    )
  })
}

function blobToDataUrl(blob: Blob, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    let settled = false

    function cleanup() {
      signal.removeEventListener('abort', abort)
      reader.onload = null
      reader.onerror = null
      reader.onabort = null
    }

    function fail(error: Error) {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    function abort() {
      reader.abort()
      fail(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Image processing cancelled.', 'AbortError'),
      )
    }

    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        settled = true
        cleanup()
        resolve(reader.result)
      } else fail(new Error('Failed to encode image'))
    }
    reader.onerror = () => fail(new Error('Failed to encode image'))
    reader.onabort = () =>
      fail(new DOMException('Image processing cancelled.', 'AbortError'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Checks if a file is a supported image type.
 */
function isAcceptedImage(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(file.type)
}

/**
 * Button component for attaching images to messages.
 *
 * Features:
 * - Accepts PNG, JPG, GIF, WebP images
 * - Automatically compresses and resizes large images
 * - Generates preview URLs for selected images
 * - Handles errors gracefully with user-friendly messages
 */
export function AttachmentButton({
  onFileSelect,
  disabled = false,
  buttonProps,
  selectionGeneration = 0,
  isSelectionCurrent = isCurrentSelectionGeneration,
}: AttachmentButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const processingRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => processingRef.current?.abort()
  }, [])

  const handleClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      // Reset input to allow selecting the same file again
      event.target.value = ''
      processingRef.current?.abort()
      processingRef.current = null

      const id = randomUUID()

      // Validate file type
      if (!isAcceptedImage(file)) {
        onFileSelect({
          id,
          file,
          preview: null,
          type: 'image',
          base64: null,
          error:
            'Unsupported file type. Please use PNG, JPG, GIF, or WebP images.',
        })
        return
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        onFileSelect({
          id,
          file,
          preview: null,
          type: 'image',
          base64: null,
          error: 'Image is too large. Maximum size is 10MB.',
        })
        return
      }

      const controller = new AbortController()
      processingRef.current = controller
      const generation = selectionGeneration
      try {
        const encoded = await compressImage(file, controller.signal)
        if (controller.signal.aborted || !isSelectionCurrent(generation)) return
        const preview = URL.createObjectURL(encoded.file)

        onFileSelect({
          id,
          file: encoded.file,
          preview,
          type: 'image',
          base64: encoded.base64,
        })
      } catch (err) {
        if (controller.signal.aborted || !isSelectionCurrent(generation)) return
        onFileSelect({
          id,
          file,
          preview: null,
          type: 'image',
          base64: null,
          error: err instanceof Error ? err.message : 'Failed to process image',
        })
      } finally {
        if (processingRef.current === controller) processingRef.current = null
      }
    },
    [isSelectionCurrent, onFileSelect, selectionGeneration],
  )

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />
      <Button
        {...buttonProps}
        variant={buttonProps?.variant ?? 'ghost'}
        size={buttonProps?.size ?? 'icon-sm'}
        onClick={(event) => {
          buttonProps?.onClick?.(event)
          handleClick()
        }}
        disabled={disabled || buttonProps?.disabled}
        className={cn('rounded-full', buttonProps?.className)}
        aria-label="Attach image"
        type={buttonProps?.type ?? 'button'}
      >
        <HugeiconsIcon icon={PlusSignIcon} size={20} strokeWidth={1.5} />
      </Button>
    </>
  )
}
