import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const apiPort = process.env.CC_API_PORT || '3000';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: Number(process.env.CC_WEB_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
      '/socket.io': { target: `http://127.0.0.1:${apiPort}`, ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 2500 },
  test: { environment: 'jsdom', globals: true },
});
