import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type VisualUiErrorBoundaryProps = {
  children: ReactNode
}

type VisualUiErrorBoundaryState = {
  failed: boolean
}

export class VisualUiErrorBoundary extends Component<
  VisualUiErrorBoundaryProps,
  VisualUiErrorBoundaryState
> {
  state: VisualUiErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): VisualUiErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Visual UI block failed to render:', error, info)
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          This visual UI block could not be rendered safely.
        </div>
      )
    }
    return this.props.children
  }
}
