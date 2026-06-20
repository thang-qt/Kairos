export type VisualUiNode = {
  type?: string
  children?: Array<VisualUiNode>
  value?: unknown
  title?: string
  label?: string
  description?: string
  id?: string
  placeholder?: string
  checked?: boolean
  options?: Array<string | { label?: string; value?: string }>
  selected?: string
  tone?: 'default' | 'info' | 'success' | 'warning' | 'error'
  action?: VisualUiAction
  variant?: 'primary' | 'secondary' | 'ghost'
}

export type VisualUiAction =
  | {
      type?: 'callback'
      event?: string
      data?: Record<string, unknown>
      collectFrom?: Array<string>
    }
  | { type?: 'open_url'; url?: string }
  | { type?: 'copy_to_clipboard'; text?: string }

export type VisualUiPart = {
  type: 'markdown' | 'ui' | 'pending-ui'
  content: string
}

export type InputValues = Record<string, string | boolean>
