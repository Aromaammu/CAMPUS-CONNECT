import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Whiteboard fonts are served by our own site (/excalidraw-assets/fonts/…) instead of a public CDN:
 * no outside requests from the class room, and it works where that CDN is blocked.
 */
function whiteboardAssets(): Plugin {
  const require = createRequire(import.meta.url);
  // The package only exposes its built files; fonts sit next to the production bundle.
  const fonts = join(dirname(require.resolve('@excalidraw/excalidraw')), 'fonts');
  const prefix = '/excalidraw-assets/fonts/';
  return {
    name: 'cc-whiteboard-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(prefix)) return next();
        const file = normalize(join(fonts, decodeURIComponent(req.url.slice(prefix.length).split('?')[0])));
        if (!file.startsWith(fonts) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(opts) {
      if (opts.dir) cpSync(fonts, join(opts.dir, 'excalidraw-assets', 'fonts'), { recursive: true });
    },
  };
}

const apiPort = process.env.CC_API_PORT || '3000';
export default defineConfig({
  plugins: [react(), whiteboardAssets()],
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
