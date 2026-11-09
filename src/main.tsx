import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/montserrat/cyrillic-500.css'
import '@fontsource/montserrat/latin-500.css'
import '@fontsource/montserrat/cyrillic-600.css'
import '@fontsource/montserrat/latin-600.css'
import '@fontsource/montserrat/cyrillic-700.css'
import '@fontsource/montserrat/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import './styles.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
