import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './site.css'
import { Landing } from './landing'
import { applySiteTheme } from './site-preferences'

applySiteTheme()

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Landing />
    </StrictMode>,
  )
}
