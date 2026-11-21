/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @/ is src/ (the shadcn/ui components import each other this way)
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    host: true,
    // When running outside Docker, proxy the API to a local backend.
    proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://localhost:8000' },
    hmr: { clientPort: Number(process.env.VITE_HMR_CLIENT_PORT ?? 5173) },
    // Tunnels: any ngrok address is allowed (dev server only); add others with VITE_ALLOWED_HOSTS, comma separated.
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.app', '.ngrok.io', ...(process.env.VITE_ALLOWED_HOSTS ?? '').split(',').filter(Boolean)],
  },
  build: { sourcemap: true },
  test: {
    environment: 'happy-dom',
    setupFiles: ['src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
