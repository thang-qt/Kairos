// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MessageAttachmentImage } from './message-attachment-image'

afterEach(cleanup)

it('keeps the loaded preview and image node when storage acknowledges an attachment', function () {
  const { getByRole, rerender } = render(
    <MessageAttachmentImage
      source={{ type: 'base64', media_type: 'image/png', data: 'preview' }}
      alt="Attachment"
    />,
  )
  const image = getByRole('img')
  rerender(
    <MessageAttachmentImage
      source={{ type: 'asset', media_type: 'image/png', assetId: 'stored' }}
      alt="Attachment"
    />,
  )
  expect(getByRole('img')).toBe(image)
  expect(image.getAttribute('src')).toBe('data:image/png;base64,preview')
  rerender(
    <MessageAttachmentImage
      source={{ type: 'asset', media_type: 'image/png', assetId: 'stored' }}
      alt="Attachment"
    />,
  )
  expect(image.getAttribute('src')).toBe('data:image/png;base64,preview')
  rerender(
    <MessageAttachmentImage
      source={{
        type: 'asset',
        media_type: 'image/png',
        assetId: 'replacement',
      }}
      alt="Attachment"
    />,
  )
  expect(image.getAttribute('src')).toBe('/api/assets/replacement')
})

it('loads the canonical asset when opened from saved history', function () {
  const { getByRole } = render(
    <MessageAttachmentImage
      source={{ type: 'asset', media_type: 'image/png', assetId: 'stored' }}
      alt="Attachment"
    />,
  )
  expect(getByRole('img').getAttribute('src')).toBe('/api/assets/stored')
})
