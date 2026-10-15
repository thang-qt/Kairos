import { useState } from 'react'
import type { ImageContent } from '../types'

type MessageAttachmentImageProps = {
  source: ImageContent['source']
  alt: string
}

function imageSource(source: ImageContent['source']): string {
  return source.type === 'asset'
    ? `/api/assets/${encodeURIComponent(source.assetId)}`
    : `data:${source.media_type};base64,${source.data}`
}

export function MessageAttachmentImage({
  source,
  alt,
}: MessageAttachmentImageProps) {
  const src = imageSource(source)
  const [display, setDisplay] = useState({ canonical: src, preview: src })
  if (display.canonical !== src) {
    // The first asset reference acknowledges the already visible local image.
    // Retain that preview only for this mounted attachment; future assets replace it.
    setDisplay({
      canonical: src,
      preview:
        display.canonical.startsWith('data:') && source.type === 'asset'
          ? display.preview
          : src,
    })
  }
  return (
    <img
      src={display.preview}
      alt={alt}
      className="max-w-[300px] max-h-[300px] rounded-lg object-cover"
    />
  )
}
