import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 4280,
    // Same-origin in dev too, so cookies and CSRF behave exactly as they do in production.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:4281',
        changeOrigin: true,
      },
    },
  },
  build: { target: 'es2022', sourcemap: false },
});
