import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/noto-sans-thai-looped/400.css'
import '@fontsource/noto-sans-thai-looped/500.css'
import '@fontsource/noto-sans-thai-looped/700.css'
import './styles.css'
import './ui/ui.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
