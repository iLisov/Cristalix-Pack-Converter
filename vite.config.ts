import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Относительный base: сборка работает и на GitHub Pages (/<repo>/), и локально, и в десктоп-обёртке.
export default defineConfig({
  base: './',
  plugins: [react()],
})
