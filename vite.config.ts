import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Школьный помощник',
        short_name: 'Школьный помощник',
        description: 'Семейный помощник для школьного дня',
        theme_color: '#08244A',
        background_color: '#FBF8FB',
        display: 'standalone',
        lang: 'ru',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icons/app-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: { navigateFallback: '/index.html' },
    }),
  ],
})
