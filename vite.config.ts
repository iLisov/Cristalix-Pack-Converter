import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base = имя репозитория на GitHub Pages (https://<user>.github.io/cristalix-pack-converter/)
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/cristalix-pack-converter/' : '/',
  plugins: [react()],
})
