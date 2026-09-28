import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'ระบบร้าน — ขาย ปิดยอด สต็อก',
        short_name: 'ระบบร้าน',
        description: 'ระบบขายหน้าร้าน ปิดยอดประจำวัน สต็อก และรายงาน สำหรับร้านเสื้อผ้า-รองเท้าในตลาด',
        lang: 'th',
        theme_color: '#f5c518',
        background_color: '#fbf8f1',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as any)
