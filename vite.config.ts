import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // The downhill prototype: its own page, sharing the engine and design tokens.
        downhill: resolve(__dirname, 'downhill/index.html'),
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
} as any)
