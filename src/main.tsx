import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { normalisePath } from '../shared/routes'
import { App } from './App'
import './styles/base.css'
import './styles/sections.css'

// Only the home page has the hero intro that index.html holds back for.
if (normalisePath(window.location.pathname) !== '/') document.documentElement.classList.remove('intro')

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
