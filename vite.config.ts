import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `vite build --mode demo`:瀏覽器內建 Postgres(PGlite)的示範版,不需要 Supabase
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo'
  const backend = demo ? './src/demo/backend.demo.ts' : './src/lib/backend.real.ts'
  return {
    base: demo ? './' : '/',
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@backend': fileURLToPath(new URL(backend, import.meta.url)) } },
    define: demo ? { 'import.meta.env.VITE_DEMO': JSON.stringify('1') } : {},
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    build: { outDir: demo ? 'dist-demo' : 'dist', chunkSizeWarningLimit: 2000 },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  }
})
