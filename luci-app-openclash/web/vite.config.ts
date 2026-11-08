import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rig = process.env.OC_RIG ?? 'http://127.0.0.1:18080'

export default defineConfig({
  base: '/luci-static/resources/openclash/app/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    outDir: path.resolve(__dirname, '../root/www/luci-static/resources/openclash/app'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        assetFileNames: info => (info.names?.[0]?.endsWith('.css') && info.names[0].startsWith('index') ? 'assets/app.css' : 'assets/[name]-[hash][extname]'),
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  server: {
    proxy: {
      '/cgi-bin': { target: rig, changeOrigin: false },
      '/luci-static/resources/openclash/js': { target: rig },
      '/luci-static/resources/openclash/css': { target: rig },
      '/oc-api': { target: 'http://127.0.0.1:19090', ws: true, rewrite: p => p.replace(/^\/oc-api/, '') },
    },
  },
})
