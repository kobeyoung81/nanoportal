import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import mediaMinmax from 'postcss-media-minmax'
import { federation } from '@module-federation/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The shell is a Module Federation host: it must publish its React so a
    // remote panel renders with the same copy (a second React means broken
    // hooks and disconnected context).
    federation({
      name: 'portal',
      filename: 'remoteEntry.js',
      exposes: {},
      shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
    }),
  ],
  css: {
    postcss: {
      // Tailwind v4 emits Media Queries Level 4 range syntax (@media (width>=40rem)),
      // which requires Chrome 104+. Transpile it to legacy min-/max-width so the
      // portal works on older company browsers (e.g. Chrome 103).
      plugins: [mediaMinmax()],
    },
  },
  build: {
    // JS and CSS share one baseline: Vite's default ('baseline-widely-available')
    // resolves to chrome111, which is newer than the browsers this portal still
    // has to support.
    target: 'chrome103',
    // The lightningcss minifier would otherwise re-shorten min-width back to the
    // range syntax (its default target supports it), undoing the PostCSS fix.
    cssTarget: 'chrome103',
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/healthz': 'http://127.0.0.1:8080',
    },
  },
})
