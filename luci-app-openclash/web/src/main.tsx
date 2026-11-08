import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import './index.css'
import '@/components/arc/foundation.css'
import App from './App.tsx'

const dark = matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => {
  document.documentElement.dataset.theme = dark.matches ? 'dark' : 'light'
  document.documentElement.classList.toggle('dark', dark.matches)
}
applyTheme()
dark.addEventListener('change', applyTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
