import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rig = process.env.RC_RIG ?? 'http://127.0.0.1:18080'

export default defineConfig({
  base: '/luci-static/resources/routerclash/app/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    outDir: path.resolve(__dirname, '../root/www/luci-static/resources/routerclash/app'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    // app.htm links one stylesheet, split CSS would only load after visiting a lazy page
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        assetFileNames: info => (info.names?.[0]?.endsWith('.css') ? 'assets/app.css' : 'assets/[name]-[hash][extname]'),
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  server: {
    proxy: {
      '/cgi-bin': { target: rig, changeOrigin: false },
      '/luci-static/resources/routerclash/js': { target: rig },
      '/luci-static/resources/routerclash/css': { target: rig },
      '/rc-api': { target: 'http://127.0.0.1:19090', ws: true, rewrite: p => p.replace(/^\/rc-api/, '') },
    },
  },
})
