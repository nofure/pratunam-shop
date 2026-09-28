import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/noto-sans-thai-looped/400.css'
import '@fontsource/noto-sans-thai-looped/500.css'
import '@fontsource/noto-sans-thai-looped/700.css'
import './styles.css'
import './ui/ui.css'
import App from './App'

// Ask the browser not to evict IndexedDB under storage pressure — this is the shop's only copy
// of its sales when sync is off. Installed PWAs are usually granted this automatically.
if (navigator.storage?.persist) {
  navigator.storage.persisted().then((already) => {
    if (!already) void navigator.storage.persist()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
