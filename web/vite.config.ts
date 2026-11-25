import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In dev, the page talks to the agent on port 4780, and shows a made-up room when there is none. In a build, each
// agent serves the page itself.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: { proxy: Object.fromEntries(['/state', '/card', '/invite', '^/room(/.*)?$'].map((path) => [path, 'http://localhost:4780'])) },
})
