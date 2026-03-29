import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'

import './styles.css'
import { registerServiceWorker } from './register-service-worker'
import { router } from './router'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

registerServiceWorker()

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
