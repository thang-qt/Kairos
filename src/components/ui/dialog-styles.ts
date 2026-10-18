// Keep dialogs and destructive confirmations on the same visual foundation.
export const dialogBackdropClassName =
  'fixed inset-0 z-50 bg-ink/40 transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 dark:bg-surface/40'

export const dialogPopupClassName =
  'fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(400px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-primary-200 bg-surface p-0 text-primary-900 shadow-lg transition-[opacity,scale] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 motion-reduce:transition-none'

export const dialogTitleClassName =
  'text-balance text-base font-medium text-primary-900'

export const dialogDescriptionClassName =
  'text-pretty text-sm leading-relaxed text-primary-600 wrap-anywhere'
