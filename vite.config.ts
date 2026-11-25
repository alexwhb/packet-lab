/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { claudeCodeApiPlugin } from './server/vitePlugin.ts'

export default defineConfig({
  plugins: [react(), claudeCodeApiPlugin()],
  // Distinctive ports: settings (incl. an OpenRouter key) live in this origin's localStorage, which
  // any other app later served on the same origin (e.g. Vite's default localhost:5173) could read.
  server: { port: 7340 },
  preview: { port: 7341 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // server/ tests opt into the node environment with a `@vitest-environment node` docblock.
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
})
